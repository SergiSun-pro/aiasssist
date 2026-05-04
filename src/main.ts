import './style.css'
import { filesToImageDataUrls, readAsDataUrl } from './pdfUtils'
import { clearToken, createUser, deleteUser, fetchUsers, getCurrentUser, login } from './auth'
import type { AuthUser } from './auth'
import { createDocument, deleteDocument, extractDocument, listDocuments, listTodos, runReminders, setTodoDone, updateDocument } from './documentsApi'
import { createInstruction, deleteInstruction, listInstructions, updateInstruction } from './instructionsApi'
import { createTask, deleteTask, listTasks, updateTask } from './tasksApi'
import { createRoutine, deleteRoutine, deleteRoutineLog, listRoutineLogs, listRoutines, logRoutine, updateRoutine } from './routinesApi'
import { createHabit, deleteHabit, listHabitLogs, listHabits, logHabit, updateHabit } from './habitsApi'
import { getSettings, saveSettings } from './settingsApi'
import type { UserSettings } from './settingsApi'
import { requestOpenRouterCompletion } from './openrouter'
import { LocalConversationsRepository } from './storage'
import type { AppNotification, AppState, ChatMessage, Conversation, DocumentRecord, Habit, HabitLog, Instruction, InstructionStep, OnMissed, Routine, RoutineLog, ScheduledTask, TodoItem } from './types'

const DEFAULT_MODELS = ['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku', 'google/gemini-2.0-flash-001', 'deepseek/deepseek-chat-v3-0324']
const VISION_MODELS = ['openai/gpt-4o-mini', 'anthropic/claude-3.5-haiku', 'google/gemini-2.0-flash-001']
const MODEL_LABELS: Record<string, string> = {
  'openai/gpt-4o-mini': 'GPT-4o mini',
  'anthropic/claude-3.5-haiku': 'Claude 3.5 Haiku',
  'google/gemini-2.0-flash-001': 'Gemini 2.0 Flash',
  'deepseek/deepseek-chat-v3-0324': 'DeepSeek Chat V3'
}
const repository = new LocalConversationsRepository()
const initialState = repository.load()

const state: AppState = { conversations: initialState.conversations, activeConversationId: initialState.activeConversationId }
let documents: DocumentRecord[] = []
let todos: TodoItem[] = []
let instructions: Instruction[] = []
let instructionSubView: 'list' | 'add' | 'edit' | 'view' = 'list'
let activeInstruction: Instruction | null = null
let tasks: ScheduledTask[] = []
let routines: Routine[] = []
let routineLogs: RoutineLog[] = []
let habits: Habit[] = []
let habitLogs: HabitLog[] = []
let tasksSubView: 'tasks' | 'routines' | 'habits' | 'calendar' | 'review' | 'task-form' | 'routine-form' | 'habit-form' = 'tasks'
let editingTask: ScheduledTask | null = null
let editingRoutine: Routine | null = null
let editingHabit: Habit | null = null
let calendarWeekOffset = 0
let reviewTargetDate = ''

const DAYS_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб']
const PRESET_COLORS = ['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#f97316']
let activeTab: 'chat' | 'documents' | 'todos' | 'base' | 'notifications' | 'users' | 'instructions' | 'tasks' = 'chat'
let docImageDataUrl: string | undefined
let docExtractImages: string[] = []
let docTags: string[] = []
let notifications: AppNotification[] = loadNotifications()
let currentUser: AuthUser | null = null

function loadNotifications(): AppNotification[] {
  try { return JSON.parse(localStorage.getItem('aiassist.notifications.v1') ?? '[]') } catch { return [] }
}
function saveNotifications() {
  localStorage.setItem('aiassist.notifications.v1', JSON.stringify(notifications))
}
function addNotification(text: string) {
  notifications.unshift({ id: createId(), text, createdAt: Date.now(), read: false })
  saveNotifications()
  updateNotificationBadge()
}

let userSettings: UserSettings = {}
let modelSelect: HTMLSelectElement | undefined
let contentRoot: HTMLDivElement
let conversationListEl: HTMLDivElement
let selectedModel: string = localStorage.getItem('aiassist.model.v1') ?? 'openai/gpt-4.1-mini'

function getCurrentModel(): string {
  return modelSelect?.value || selectedModel
}

function checkAuthAndInit() {
  currentUser = getCurrentUser()
  if (!currentUser) { showLoginForm(); return }
  initApp()
}

function showLoginForm() {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <h1 class="login-title">aiasssist</h1>
        <form id="login-form" class="login-form">
          <input id="login-username" placeholder="Логин" autocomplete="username" required />
          <input id="login-password" type="password" placeholder="Пароль" autocomplete="current-password" required />
          <button type="submit" id="login-btn">Войти</button>
          <p id="login-error" class="login-error hidden"></p>
        </form>
      </div>
    </div>`
  document.querySelector<HTMLFormElement>('#login-form')!.onsubmit = async (e) => {
    e.preventDefault()
    const username = document.querySelector<HTMLInputElement>('#login-username')!.value.trim()
    const password = document.querySelector<HTMLInputElement>('#login-password')!.value
    const btn = document.querySelector<HTMLButtonElement>('#login-btn')!
    const errEl = document.querySelector<HTMLParagraphElement>('#login-error')!
    btn.textContent = 'Вхожу...'
    btn.disabled = true
    errEl.classList.add('hidden')
    try {
      currentUser = await login(username, password)
      initApp()
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : 'Ошибка входа'
      errEl.classList.remove('hidden')
      btn.textContent = 'Войти'
      btn.disabled = false
    }
  }
}

function initApp() {
  const isAdmin = currentUser?.role === 'admin'
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<div class="app-root">
  <header class="app-header">
    <div class="app-brand">aiasssist</div>
    <nav class="app-nav">
      <button id="tab-chat" class="nav-tab active" data-label="Чат"><span class="nav-icon">💬</span><span class="nav-label">Чат</span></button>
      <button id="tab-docs" class="nav-tab" data-label="Документы"><span class="nav-icon">📄</span><span class="nav-label">Документы</span></button>
      <button id="tab-base" class="nav-tab" data-label="База"><span class="nav-icon">📚</span><span class="nav-label">База</span></button>
      <button id="tab-todos" class="nav-tab" data-label="Дела"><span class="nav-icon">✓</span><span class="nav-label">Дела</span></button>
      <button id="tab-tasks" class="nav-tab" data-label="Задачи"><span class="nav-icon">📅</span><span class="nav-label">Задачи</span></button>
      <button id="tab-instructions" class="nav-tab" data-label="Инструкции"><span class="nav-icon">📋</span><span class="nav-label">Инструкции</span></button>
      <button id="tab-notifications" class="nav-tab tab-notify" data-label="Уведомления"><span class="nav-icon">🔔</span><span class="nav-label">Уведомления</span><span id="notify-badge" class="notify-badge hidden"></span></button>
      ${isAdmin ? '<button id="tab-users" class="nav-tab" data-label="Пользователи"><span class="nav-icon">👥</span><span class="nav-label">Пользователи</span></button>' : ''}
    </nav>
    <div class="app-user">
      <span class="app-user-name">${currentUser?.username ?? ''}</span>
      <button id="settings-btn" class="logout-btn" title="Настройки">⚙</button>
      <button id="logout-btn" class="logout-btn" title="Выйти">⎋</button>
    </div>
  </header>
  <main class="app-main">
    <aside id="chat-sidebar" class="chat-sidebar">
      <button id="new-chat-button" class="new-chat-btn">+ Новая беседа</button>
      <div class="conversations-label">Беседы</div>
      <div id="conversation-list" class="conversation-list"></div>
    </aside>
    <section class="app-content">
      <div id="content-root"></div>
    </section>
  </main>
</div>`

  contentRoot = document.querySelector<HTMLDivElement>('#content-root')!
  conversationListEl = document.querySelector<HTMLDivElement>('#conversation-list')!

  if (!state.activeConversationId) createConversation('Новая беседа')

  document.querySelector<HTMLButtonElement>('#new-chat-button')!.addEventListener('click', () => { createConversation('Новая беседа'); setTab('chat') })
  document.querySelector<HTMLButtonElement>('#tab-chat')!.addEventListener('click', () => setTab('chat'))
  document.querySelector<HTMLButtonElement>('#tab-docs')!.addEventListener('click', () => setTab('documents'))
  document.querySelector<HTMLButtonElement>('#tab-base')!.addEventListener('click', () => setTab('base'))
  document.querySelector<HTMLButtonElement>('#tab-todos')!.addEventListener('click', () => setTab('todos'))
  document.querySelector<HTMLButtonElement>('#tab-tasks')!.addEventListener('click', () => setTab('tasks'))
  document.querySelector<HTMLButtonElement>('#tab-instructions')!.addEventListener('click', () => setTab('instructions'))
  document.querySelector<HTMLButtonElement>('#tab-notifications')!.addEventListener('click', () => setTab('notifications'))
  document.querySelector<HTMLButtonElement>('#settings-btn')!.addEventListener('click', showSettingsModal)
  document.querySelector<HTMLButtonElement>('#logout-btn')!.addEventListener('click', () => { clearToken(); currentUser = null; showLoginForm() })
  if (isAdmin) document.querySelector<HTMLButtonElement>('#tab-users')?.addEventListener('click', () => setTab('users'))

  applyTabLayout()
  getSettings().then((s) => { userSettings = s }).catch(() => {})
  refreshData().finally(() => { render(); updateNotificationBadge() })
  requestNotificationPermission()
  runRemindersAndNotify()
  setInterval(runRemindersAndNotify, 30 * 60 * 1000)
}

function applyTabLayout() {
  const sidebar = document.querySelector<HTMLElement>('#chat-sidebar')
  if (!sidebar) return
  if (activeTab === 'chat') sidebar.classList.remove('hidden-sidebar')
  else sidebar.classList.add('hidden-sidebar')
}

checkAuthAndInit()

function setTab(tab: 'chat' | 'documents' | 'todos' | 'base' | 'notifications' | 'users' | 'instructions' | 'tasks') {
  activeTab = tab
  document.querySelectorAll('.nav-tab').forEach((el) => el.classList.remove('active'))
  const tabId = tab === 'documents' ? 'docs' : tab === 'notifications' ? 'notifications' : tab
  document.querySelector(`#tab-${tabId}`)?.classList.add('active')
  if (tab === 'notifications') {
    updateNotificationBadge()
  }
  applyTabLayout()
  render()
}

function render() {
  renderConversations()
  if (activeTab === 'chat') renderChat()
  if (activeTab === 'documents') renderDocuments()
  if (activeTab === 'base') renderBase()
  if (activeTab === 'todos') renderTodos()
  if (activeTab === 'notifications') renderNotifications()
  if (activeTab === 'tasks') renderTasksSection()
  if (activeTab === 'instructions') renderInstructions()
  if (activeTab === 'users') renderUsers()
}

function updateNotificationBadge() {
  const badge = document.querySelector<HTMLSpanElement>('#notify-badge')
  if (!badge) return
  const unread = notifications.filter((n) => !n.read).length
  if (unread > 0) {
    badge.textContent = String(unread)
    badge.classList.remove('hidden')
  } else {
    badge.classList.add('hidden')
  }
}

async function renderUsers() {
  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div><h2>Пользователи</h2><p class="page-subtitle">Управление доступом к приложению</p></div>
    </div>
    <form id="user-form" class="doc-form users-form">
      <div class="form-section">
        <label class="form-label">Новый пользователь</label>
        <div class="form-row">
          <input id="user-username" placeholder="Логин" required />
          <input id="user-password" type="password" placeholder="Пароль" required />
        </div>
        <label class="checkbox-label">
          <input id="user-is-admin" type="checkbox" /> Сделать администратором
        </label>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-primary">Создать пользователя</button>
      </div>
      <p id="user-error" class="login-error hidden"></p>
    </form>
    <div class="users-section-label">Все пользователи</div>
    <div id="users-list" class="users-list"></div>
  </section>`

  async function loadAndRenderList() {
    const list = document.querySelector<HTMLDivElement>('#users-list')!
    try {
      const users = await fetchUsers()
      list.innerHTML = ''
      for (const u of users) {
        const row = document.createElement('div')
        row.className = 'user-row'
        const isSelf = u.id === currentUser?.id
        row.innerHTML = `
          <div class="user-avatar">${u.username.charAt(0).toUpperCase()}</div>
          <div class="user-info">
            <div class="user-name">${escapeAttr(u.username)}${isSelf ? ' <span class="user-self">(вы)</span>' : ''}</div>
            <div class="user-role">${u.role === 'admin' ? 'Администратор' : 'Пользователь'}</div>
          </div>
          ${!isSelf ? `<button class="user-delete" data-id="${u.id}" title="Удалить">✕</button>` : ''}
        `
        row.querySelector<HTMLButtonElement>('.user-delete')?.addEventListener('click', async () => {
          if (!confirm(`Удалить пользователя ${u.username}?`)) return
          try { await deleteUser(u.id); await loadAndRenderList() } catch (e) { alert(e instanceof Error ? e.message : 'Ошибка') }
        })
        list.appendChild(row)
      }
    } catch { list.innerHTML = '<p class="hint">Не удалось загрузить пользователей</p>' }
  }

  await loadAndRenderList()

  document.querySelector<HTMLFormElement>('#user-form')!.onsubmit = async (e) => {
    e.preventDefault()
    const username = document.querySelector<HTMLInputElement>('#user-username')!.value.trim()
    const password = document.querySelector<HTMLInputElement>('#user-password')!.value
    const isAdmin = document.querySelector<HTMLInputElement>('#user-is-admin')!.checked
    const errEl = document.querySelector<HTMLParagraphElement>('#user-error')!
    errEl.classList.add('hidden')
    try {
      await createUser(username, password, isAdmin ? 'admin' : 'user')
      document.querySelector<HTMLInputElement>('#user-username')!.value = ''
      document.querySelector<HTMLInputElement>('#user-password')!.value = ''
      await loadAndRenderList()
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : 'Ошибка'
      errEl.classList.remove('hidden')
    }
  }
}

function renderNotifications() {
  const unread = notifications.filter((n) => !n.read).length
  contentRoot.innerHTML = `<section class="notifications-panel">
    <div class="page-header-row">
      <div><h2>Уведомления</h2><p class="page-subtitle">Всего: ${notifications.length}</p></div>
      <div class="notify-actions">
        ${unread > 0 ? '<button id="mark-all-read" class="btn-secondary">Прочитать все</button>' : ''}
        ${notifications.length > 0 ? '<button id="clear-notifications" class="btn-secondary btn-danger">Очистить все</button>' : ''}
      </div>
    </div>
    <div id="notify-list" class="notify-list"></div>
  </section>`
  document.querySelector<HTMLButtonElement>('#mark-all-read')?.addEventListener('click', () => {
    notifications.forEach((n) => (n.read = true))
    saveNotifications()
    updateNotificationBadge()
    renderNotifications()
  })
  const clearBtn = document.querySelector<HTMLButtonElement>('#clear-notifications')
  if (clearBtn) clearBtn.onclick = () => {
    if (!confirm('Очистить все уведомления?')) return
    notifications = []
    saveNotifications()
    updateNotificationBadge()
    renderNotifications()
  }
  const list = document.querySelector<HTMLDivElement>('#notify-list')!
  if (notifications.length === 0) { list.innerHTML = '<p class="hint">Уведомлений пока нет.</p>'; return }
  for (const n of notifications) {
    const item = document.createElement('div')
    item.className = `notify-item${n.read ? ' read' : ''}`
    const date = new Date(n.createdAt).toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    item.innerHTML = `<span class="notify-dot"></span><div class="notify-body"><p class="notify-text">${escapeAttr(n.text)}</p><span class="notify-date">${date}</span></div>`
    list.appendChild(item)
  }
}

function renderConversations() {
  conversationListEl.innerHTML = ''
  for (const c of state.conversations) {
    const item = document.createElement('div')
    item.className = `conversation-item ${c.id === state.activeConversationId ? 'active' : ''}`

    const titleBtn = document.createElement('button')
    titleBtn.className = 'conv-title-btn'
    titleBtn.textContent = c.title
    titleBtn.title = c.title
    titleBtn.onclick = () => { state.activeConversationId = c.id; persistAndRender() }

    const actions = document.createElement('div')
    actions.className = 'conv-actions'

    const renameBtn = document.createElement('button')
    renameBtn.className = 'conv-action-btn'
    renameBtn.title = 'Переименовать'
    renameBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
    renameBtn.onclick = (e) => {
      e.stopPropagation()
      const newTitle = prompt('Название беседы:', c.title)
      if (newTitle?.trim()) { c.title = newTitle.trim(); persistAndRender() }
    }

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'conv-action-btn conv-delete-btn'
    deleteBtn.title = 'Удалить беседу'
    deleteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
    deleteBtn.onclick = (e) => {
      e.stopPropagation()
      if (!confirm(`Удалить беседу «${c.title}»?`)) return
      deleteConversation(c.id)
    }

    actions.append(renameBtn, deleteBtn)
    item.append(titleBtn, actions)
    conversationListEl.appendChild(item)
  }
}

function deleteConversation(id: string) {
  state.conversations = state.conversations.filter((c) => c.id !== id)
  if (state.activeConversationId === id) {
    state.activeConversationId = state.conversations[0]?.id ?? null
    if (!state.activeConversationId) createConversation('Новая беседа')
  }
  persistAndRender()
}

function renderChat() {
  const modelOptions = DEFAULT_MODELS.map((m) => `<option value="${m}"${selectedModel === m ? ' selected' : ''}>${MODEL_LABELS[m] ?? m}</option>`).join('')
  contentRoot.innerHTML = `<div class="chat-wrap">
    <div id="messages" class="messages"></div>
    <div class="composer-area">
      <form id="composer-form" class="composer">
        <div class="composer-shell">
          <label class="attach-button" title="Прикрепить файл">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
            <input id="file-input" type="file" />
          </label>
          <textarea id="prompt-input" placeholder="Напишите сообщение... (Enter — отправить, Shift+Enter — новая строка)" rows="1"></textarea>
          <button id="send-button" type="submit" class="send-icon" title="Отправить">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
        <div class="composer-footer">
          <label class="model-label">
            <span class="model-label-text">Модель</span>
            <select id="model-select" class="model-select">${modelOptions}</select>
          </label>
          <span id="file-name" class="file-name"></span>
        </div>
      </form>
    </div>
  </div>`
  modelSelect = document.querySelector<HTMLSelectElement>('#model-select')!
  modelSelect.addEventListener('change', () => { selectedModel = modelSelect!.value; localStorage.setItem('aiassist.model.v1', selectedModel) })
  const messagesEl = document.querySelector<HTMLDivElement>('#messages')!
  const current = getActiveConversation()
  if (!current || current.messages.length === 0) messagesEl.innerHTML = '<p class="hint">Начни диалог с моделью.</p>'
  else for (const m of current.messages) {
    const item = document.createElement('article')
    item.className = `message ${m.role}`
    item.innerHTML = `<div class="message-meta">${m.role === 'user' ? 'Ты' : `ИИ${m.model ? ` (${m.model})` : ''}`}</div>${m.displayImage ? `<img class="message-image" src="${m.displayImage}" alt="Фото документа" title="Нажмите для просмотра" />` : ''}<pre class="message-content"></pre>`
    if (m.displayImage) {
      const img = item.querySelector<HTMLImageElement>('.message-image')!
      img.onclick = () => openImageFullscreen(m.displayImage!)
    }
    item.querySelector('pre')!.textContent = m.content.replace(/\[(TASK|ROUTINE|HABIT)\][\s\S]*?\[\/\1\]/gi, '').replace(/\n{3,}/g, '\n\n').trim()
    messagesEl.appendChild(item)
    if (m.taskProposal) {
      const p = m.taskProposal as Record<string, unknown>
      const card = document.createElement('div')
      card.className = 'task-proposal-card'
      const typeLabels: Record<string, string> = { fixed: 'Фиксированная', flexible: 'Гибкая', periodic: 'Периодическая' }
      const needsDate = !p.scheduledDate && (p.type === 'fixed' || p.type === 'periodic')
      const recurrenceLabel: Record<string, string> = { daily: 'ежедневно', weekly: 'еженедельно', monthly: 'ежемесячно' }
      card.innerHTML = `
        <div class="task-proposal-header"><span class="task-proposal-icon">📋</span><span>Предлагаемая задача</span></div>
        <div class="task-proposal-title">${escapeAttr(String(p.title ?? ''))}</div>
        <div class="task-proposal-meta">
          <span class="task-type-badge task-type-${p.type}">${typeLabels[String(p.type)] ?? String(p.type)}</span>
          <span>${p.weight ?? 1} ед.</span>
          ${p.scheduledDate ? `<span>📅 ${p.scheduledDate}${p.scheduledTime ? ' ' + p.scheduledTime : ''}</span>` : ''}
          ${p.recurrence ? `<span>🔁 ${recurrenceLabel[String(p.recurrence)] ?? p.recurrence}</span>` : ''}
          ${p.deadline ? `<span>⏰ до ${p.deadline}</span>` : ''}
          ${p.context ? `<span>📍 ${escapeAttr(String(p.context))}</span>` : ''}
        </div>
        ${p.notes ? `<div class="task-proposal-notes">${escapeAttr(String(p.notes))}</div>` : ''}
        ${needsDate ? `<div class="task-proposal-date-row"><label style="font-size:13px;color:var(--muted)">📅 Дата первого события:</label><input type="date" class="proposal-date-input" value="${todayStr()}" /></div>` : ''}
        <div class="task-proposal-actions">
          <button class="btn-primary task-proposal-save">✓ Добавить задачу</button>
          <button class="btn-secondary task-proposal-edit">✏ Изменить</button>
          <button class="btn-secondary task-proposal-dismiss">✕</button>
        </div>`
      card.querySelector('.task-proposal-save')!.addEventListener('click', async () => {
        const dateInput = card.querySelector<HTMLInputElement>('.proposal-date-input')
        const scheduledDate = dateInput?.value || String(p.scheduledDate || '')
        if (needsDate && !scheduledDate) { alert('Укажи дату первого события'); return }
        await createTask({ ...(p as Parameters<typeof createTask>[0]), scheduledDate: scheduledDate || undefined })
        await refreshData()
        card.innerHTML = '<div style="padding:8px 12px;color:var(--accent);font-size:13px">✓ Задача добавлена</div>'
      })
      card.querySelector('.task-proposal-edit')!.addEventListener('click', () => {
        editingTask = { id: '', createdAt: 0, updatedAt: 0, done: false, skipped: false, accumulation: 0, notes: '', context: '', conditions: '' } as ScheduledTask
        Object.assign(editingTask, p)
        tasksSubView = 'task-form'; setTab('tasks')
      })
      card.querySelector('.task-proposal-dismiss')!.addEventListener('click', () => card.remove())
      messagesEl.appendChild(card)
    }

    // карточки предложений рутин
    for (const r of (m.routineProposals ?? [])) {
      const times = r.times as Record<string, string> | undefined
      const days = (Array.isArray(r.daysOfWeek) ? r.daysOfWeek as number[] : [])
        .map((d) => { const t = times?.[String(d)] ?? (r.time as string | undefined); return DAYS_SHORT[d] + (t ? ' ' + t : '') }).join(', ')
      const rcard = document.createElement('div')
      rcard.className = 'task-proposal-card'
      rcard.style.borderColor = String(r.color ?? '#4f46e5')
      rcard.innerHTML = `
        <div class="task-proposal-header"><span class="task-proposal-icon">🔁</span><span>Предлагаемая рутина</span></div>
        <div class="task-proposal-title">${escapeAttr(String(r.title ?? ''))}</div>
        <div class="task-proposal-meta">
          <span class="task-type-badge task-type-periodic">Рутина</span>
          <span>${r.weight ?? 1} ед.</span>
          ${days ? `<span>📅 ${days}</span>` : ''}
          ${r.time ? `<span>⏰ ${r.time}</span>` : ''}
          ${r.context ? `<span>📍 ${escapeAttr(String(r.context))}</span>` : ''}
        </div>
        ${r.notes ? `<div class="task-proposal-notes">${escapeAttr(String(r.notes))}</div>` : ''}
        <div class="task-proposal-actions">
          <button class="btn-primary rp-save">✓ Добавить рутину</button>
          <button class="btn-secondary rp-edit">✏ Изменить</button>
          <button class="btn-secondary rp-dismiss">✕</button>
        </div>`
      rcard.querySelector('.rp-save')!.addEventListener('click', async () => {
        await createRoutine(r as Parameters<typeof createRoutine>[0])
        await refreshData()
        rcard.innerHTML = '<div style="padding:8px 12px;color:var(--accent);font-size:13px">✓ Рутина добавлена</div>'
      })
      rcard.querySelector('.rp-edit')!.addEventListener('click', () => {
        editingRoutine = { id: '', title: '', createdAt: 0, updatedAt: 0, notes: '', context: '', color: '#4f46e5', daysOfWeek: [], weight: 1, onMissed: 'skip' } as Routine
        Object.assign(editingRoutine, r)
        tasksSubView = 'routine-form'; setTab('tasks')
      })
      rcard.querySelector('.rp-dismiss')!.addEventListener('click', () => rcard.remove())
      messagesEl.appendChild(rcard)
    }

    // виджет итога дня
    if (m.dailyReview) {
      const conv = getActiveConversation()
      if (conv) renderDailyReviewWidget(m.dailyReview.date, m.dailyReview.confirmed ?? false, messagesEl, m, conv)
    }
  }
  messagesEl.scrollTop = messagesEl.scrollHeight

  const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
  const fileNameNode = document.querySelector<HTMLSpanElement>('#file-name')!
  const promptTextarea = document.querySelector<HTMLTextAreaElement>('#prompt-input')!
  const formEl = document.querySelector<HTMLFormElement>('#composer-form')!
  fileInput.onchange = () => {
    const name = fileInput.files?.[0]?.name
    fileNameNode.textContent = name ? `📎 ${name}` : ''
  }
  promptTextarea.addEventListener('input', () => {
    promptTextarea.style.height = 'auto'
    promptTextarea.style.height = Math.min(promptTextarea.scrollHeight, 200) + 'px'
  })
  promptTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      formEl.requestSubmit()
    }
  })
  document.querySelector<HTMLFormElement>('#composer-form')!.onsubmit = async (event) => {
    event.preventDefault()
    const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt-input')!
    const text = promptInput.value.trim()
    const currentConversation = getActiveConversation()
    if (!text || !currentConversation) return
    const file = fileInput.files?.[0]
    const userMessage: ChatMessage = { id: createId(), role: 'user', content: text, createdAt: Date.now(), attachmentName: file?.name }
    let displayImageUrl: string | undefined
    let aiImageDataUrl: string | undefined
    if (file) {
      userMessage.content = `${text}\n\n[Файл: ${file.name}]\n${await getFilePreview(file)}`
      const fileImage = await getImageDataUrl(file)
      if (fileImage) { displayImageUrl = fileImage; aiImageDataUrl = fileImage }
    }
    if (!displayImageUrl) {
      // показываем фото документа в чате, но не отправляем в AI — поля уже есть в системном промпте
      displayImageUrl = findDocumentImage(text)
    }
    if (displayImageUrl) userMessage.displayImage = displayImageUrl
    currentConversation.messages.push(userMessage)
    currentConversation.updatedAt = Date.now()
    if (currentConversation.title === 'Новая беседа') currentConversation.title = text.slice(0, 40)
    persistAndRender()
    try {
      const reply = await requestOpenRouterCompletion({
        model: getCurrentModel(),
        messages: currentConversation.messages,
        imageDataUrl: aiImageDataUrl,
        systemPrompt: buildDocumentSystemPrompt()
      })
      const taskMatch = reply.match(/\[TASK\]([\s\S]*?)\[\/TASK\]/i)
      const routineMatches = [...reply.matchAll(/\[ROUTINE\]([\s\S]*?)\[\/ROUTINE\]/gi)]
      const habitMatch = reply.match(/\[HABIT\]([\s\S]*?)\[\/HABIT\]/i)
      const cleanReply = reply
        .replace(/\[TASK\][\s\S]*?\[\/TASK\]/gi, '')
        .replace(/\[ROUTINE\][\s\S]*?\[\/ROUTINE\]/gi, '')
        .replace(/\[HABIT\][\s\S]*?\[\/HABIT\]/gi, '')
        .replace(/\n{3,}/g, '\n\n').trim()
      const aiMsg: ChatMessage = { id: createId(), role: 'assistant', content: cleanReply, createdAt: Date.now(), model: getCurrentModel() }
      const reviewDate = extractReviewDate(text)
      if (reviewDate) aiMsg.dailyReview = { date: reviewDate }
      if (taskMatch) { try { aiMsg.taskProposal = JSON.parse(taskMatch[1].trim()) } catch { /* ignore */ } }
      if (habitMatch) { try { aiMsg.taskProposal = { ...JSON.parse(habitMatch[1].trim()), _type: 'habit' } } catch { /* ignore */ } }
      if (routineMatches.length > 0) {
        const parsed: Record<string, unknown>[] = []
        for (const m of routineMatches) {
          try { parsed.push(JSON.parse(m[1].trim())) } catch { /* ignore */ }
        }
        // если AI создал несколько блоков с одним названием — объединяем daysOfWeek
        if (parsed.length > 1) {
          const merged = new Map<string, Record<string, unknown>>()
          for (const r of parsed) {
            const key = String(r.title ?? '').toLowerCase()
            if (merged.has(key)) {
              const existing = merged.get(key)!
              const existDays = Array.isArray(existing.daysOfWeek) ? existing.daysOfWeek as number[] : []
              const newDays = Array.isArray(r.daysOfWeek) ? r.daysOfWeek as number[] : []
              existing.daysOfWeek = [...new Set([...existDays, ...newDays])].sort()
            } else {
              merged.set(key, { ...r })
            }
          }
          aiMsg.routineProposals = [...merged.values()]
        } else {
          aiMsg.routineProposals = parsed
        }
      }
      currentConversation.messages.push(aiMsg)
    } catch (error) {
      currentConversation.messages.push({ id: createId(), role: 'assistant', content: `Ошибка: ${error instanceof Error ? error.message : 'Unknown error'}`, createdAt: Date.now() })
    }
    promptInput.value = ''
    fileInput.value = ''
    fileNameNode.textContent = 'Файл не выбран'
    persistAndRender()
  }
}

function renderDocuments() {
  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header">
      <h2>Добавить документ</h2>
      <p class="page-subtitle">Загрузите фото — поля заполнятся автоматически. Или внесите данные вручную.</p>
    </div>
    <form id="doc-form" class="doc-form">
      <div class="form-section">
        <label class="form-label">Фото документа</label>
        <div id="drop-zone" class="drop-zone">
          <div class="drop-zone-icon">📷</div>
          <div id="drop-label" class="drop-zone-text">Перетащите фото или PDF сюда, или нажмите для выбора<br><span class="drop-hint">Можно выбрать несколько файлов для многостраничных документов</span></div>
          <input id="doc-image" type="file" accept="image/*,application/pdf" multiple />
        </div>
        <button id="doc-extract" type="button" class="btn-secondary">✨ Распознать поля</button>
      </div>

      <div class="form-section">
        <label class="form-label">Основная информация</label>
        <div class="form-row">
          <input id="doc-title" placeholder="Название документа" required />
          <input id="doc-type" placeholder="Тип (паспорт, ИНН, договор...)" required />
        </div>
      </div>

      <div class="form-section">
        <label class="form-label">Поля документа</label>
        <div class="fields-editor">
          <div id="fields-list" class="fields-list"></div>
          <button id="add-field-btn" type="button" class="add-field-btn">+ Добавить поле</button>
        </div>
      </div>

      <div class="form-section">
        <label class="form-label">Теги</label>
        <div class="tags-editor">
          <div id="tags-chips" class="tags-chips"></div>
          <input id="tags-input" class="tags-input" placeholder="Введите тег и нажмите Enter или запятую" />
        </div>
      </div>

      <div class="form-section">
        <label class="form-label">Срок действия и напоминание</label>
        <div class="form-row">
          <input id="doc-expires" type="date" />
          <div class="notify-controls">
            <label class="checkbox-label"><input id="doc-notify" type="checkbox" checked /> Уведомлять</label>
            <label class="notify-days-label">за <input id="doc-notify-days" type="number" min="0" value="1" /> дней</label>
          </div>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn-primary">Сохранить документ</button>
      </div>
    </form>
  </section>`

  docTags = []
  docExtractImages = []
  renderFieldsList([])
  renderTagChips()

  document.querySelector<HTMLInputElement>('#tags-input')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = (e.target as HTMLInputElement).value.trim().replace(/,+$/, '')
      if (val && !docTags.includes(val)) { docTags.push(val); renderTagChips() }
      ;(e.target as HTMLInputElement).value = ''
    }
  })

  document.querySelector<HTMLButtonElement>('#add-field-btn')!.onclick = () => {
    addFieldRow()
  }
  const docImageInput = document.querySelector<HTMLInputElement>('#doc-image')!
  const dropZone = document.querySelector<HTMLDivElement>('#drop-zone')!
  const dropLabel = document.querySelector<HTMLDivElement>('#drop-label')!

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
    if (!arr.length) return
    const btn = document.querySelector<HTMLButtonElement>('#doc-extract')
    if (btn) { btn.textContent = 'Обрабатываю файлы...'; btn.disabled = true }
    docExtractImages = await filesToImageDataUrls(arr)
    const firstImage = arr.find((f) => f.type.startsWith('image/'))
    docImageDataUrl = firstImage ? await readAsDataUrl(firstImage) : docExtractImages[0]
    const names = arr.map((f) => f.name).join(', ')
    const pages = docExtractImages.length
    dropLabel.innerHTML = `✓ Файлов: <strong>${arr.length}</strong> · Страниц: <strong>${pages}</strong><br><span class="drop-hint">${escapeAttr(names)}</span>`
    if (btn) { btn.textContent = '✨ Распознать поля'; btn.disabled = false }
  }

  docImageInput.onchange = (e) => { const files = (e.target as HTMLInputElement).files; if (files) handleFiles(files) }

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    if (e.dataTransfer?.files.length) await handleFiles(e.dataTransfer.files)
  })
  dropZone.addEventListener('click', () => docImageInput.click())
  document.querySelector<HTMLButtonElement>('#doc-extract')!.onclick = async () => {
    if (!docExtractImages.length) { alert('Сначала выберите фото или PDF документа'); return }
    const btn = document.querySelector<HTMLButtonElement>('#doc-extract')!
    const extractModel = VISION_MODELS.includes(getCurrentModel()) ? getCurrentModel() : VISION_MODELS[0]
    btn.textContent = 'Распознаю...'
    btn.disabled = true
    try {
      const parsed = await extractDocument(docExtractImages, extractModel)
      ;(document.querySelector<HTMLInputElement>('#doc-title')!).value = parsed.title
      ;(document.querySelector<HTMLInputElement>('#doc-type')!).value = parsed.docType
      ;(document.querySelector<HTMLInputElement>('#doc-expires')!).value = parsed.expiresAt ?? ''
      renderFieldsList(Object.entries(parsed.fields))
    } catch (error) {
      alert(`Ошибка распознавания: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`)
    } finally {
      btn.textContent = '✨ Распознать поля'
      btn.disabled = false
    }
  }
  document.querySelector<HTMLFormElement>('#doc-form')!.onsubmit = async (event) => {
    event.preventDefault()
    const fields = collectFields()
    await createDocument({
      title: document.querySelector<HTMLInputElement>('#doc-title')!.value.trim(),
      docType: document.querySelector<HTMLInputElement>('#doc-type')!.value.trim(),
      fields,
      tags: [...docTags],
      imageDataUrl: docImageDataUrl,
      notifyEnabled: document.querySelector<HTMLInputElement>('#doc-notify')!.checked,
      notifyBeforeDays: Number(document.querySelector<HTMLInputElement>('#doc-notify-days')!.value || '1'),
      expiresAt: document.querySelector<HTMLInputElement>('#doc-expires')!.value || undefined
    })
    docImageDataUrl = undefined
    docExtractImages = []
    docTags = []
    await refreshData()
    renderDocuments()
  }
}

function renderBase() {
  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div><h2>База документов</h2><p class="page-subtitle">Всего: ${documents.length}</p></div>
    </div>
    <div class="search-bar">
      <input id="base-search" placeholder="🔍 Поиск по названию, типу, полям..." />
      <button id="base-search-btn" class="btn-secondary">Найти</button>
    </div>
    <div id="base-list" class="docs-grid"></div>
  </section>`
  renderBaseList(documents)
  document.querySelector<HTMLButtonElement>('#base-search-btn')!.onclick = async () => {
    const q = (document.querySelector<HTMLInputElement>('#base-search')?.value ?? '').trim()
    const results = await listDocuments(q)
    renderBaseList(results)
  }
  document.querySelector<HTMLInputElement>('#base-search')!.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const q = (e.target as HTMLInputElement).value.trim()
      const results = await listDocuments(q)
      renderBaseList(results)
    }
  })
}

function renderBaseList(docs: DocumentRecord[]) {
  const list = document.querySelector<HTMLDivElement>('#base-list')
  if (!list) return
  if (docs.length === 0) { list.innerHTML = '<p class="hint">Документы не найдены</p>'; return }
  list.innerHTML = ''
  for (const d of docs) {
    const card = document.createElement('article')
    card.className = 'doc-card'
    const fields = Object.entries(d.fields ?? {}).map(([k, v]) => `<div class="doc-field"><span class="doc-field-key">${escapeAttr(k)}</span><span class="doc-field-val">${escapeAttr(String(v))}</span></div>`).join('')
    const tagsHtml = (d.tags ?? []).length > 0 ? `<div class="doc-tags">${(d.tags!).map((t) => `<span class="tag-chip tag-chip-sm">${escapeAttr(t)}</span>`).join('')}</div>` : ''
    card.innerHTML = `
      <div class="doc-card-header">
        <div>
          <h3>${escapeAttr(d.title)}</h3>
          <p class="doc-type">${escapeAttr(d.docType)}</p>
        </div>
        ${d.expiresAt ? `<span class="doc-expires">до ${d.expiresAt}</span>` : ''}
      </div>
      ${tagsHtml}
      ${fields ? `<div class="doc-fields">${fields}</div>` : ''}
      ${d.imageDataUrl ? `<img class="doc-image" src="${d.imageDataUrl}" alt="Фото документа" title="Нажмите для просмотра" />` : ''}
      <div class="doc-card-actions">
        <button class="doc-edit-btn btn-secondary">✏️ Редактировать</button>
        <button class="doc-delete-btn btn-secondary btn-danger">🗑 Удалить</button>
      </div>
    `
    if (d.imageDataUrl) {
      const img = card.querySelector<HTMLImageElement>('.doc-image')!
      img.onclick = () => openImageFullscreen(d.imageDataUrl!)
    }
    card.querySelector<HTMLButtonElement>('.doc-edit-btn')!.onclick = () => showEditModal(d)
    card.querySelector<HTMLButtonElement>('.doc-delete-btn')!.onclick = async () => {
      if (!confirm(`Удалить документ «${d.title}»?`)) return
      await deleteDocument(d.id)
      await refreshData()
      renderBase()
    }
    list.appendChild(card)
  }
}

function showSettingsModal() {
  const tr = userSettings.todoRules ?? {}
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:600px">
      <div class="modal-header">
        <h2>Настройки</h2>
        <button id="settings-close" class="modal-close">✕</button>
      </div>
      <form id="settings-form">
        <div class="settings-section-label">Правила списка дел</div>
        <p class="page-subtitle" style="margin:0 0 16px">ИИ использует эти данные чтобы давать персонализированные советы по задачам</p>

        <div class="form-section">
          <label class="form-label">Откуда берутся мои дела</label>
          <textarea id="s-sources" class="settings-textarea" placeholder="Например: рабочие задачи в Notion, домашние дела, звонки клиентам...">${escapeAttr(tr.sources ?? '')}</textarea>
        </div>
        <div class="form-section">
          <label class="form-label">Параметры для отслеживания</label>
          <textarea id="s-params" class="settings-textarea" placeholder="Например: количество звонков, выполненных задач, километров...">${escapeAttr(tr.trackedParams ?? '')}</textarea>
        </div>
        <div class="form-section">
          <label class="form-label">Норма в день (количество единиц)</label>
          <input id="s-units" placeholder="Например: 5 задач, 3 встречи, 10 000 шагов..." value="${escapeAttr(tr.dailyUnits ?? '')}" />
        </div>
        <div class="form-row">
          <div class="form-section" style="flex:1">
            <label class="form-label">Что для меня легко</label>
            <textarea id="s-easy" class="settings-textarea" placeholder="Например: короткие задачи, звонки, рутинные дела...">${escapeAttr(tr.easyTasks ?? '')}</textarea>
          </div>
          <div class="form-section" style="flex:1">
            <label class="form-label">Что для меня сложно</label>
            <textarea id="s-hard" class="settings-textarea" placeholder="Например: долгие отчёты, срочные дедлайны...">${escapeAttr(tr.hardTasks ?? '')}</textarea>
          </div>
        </div>
        <div class="form-section">
          <label class="form-label">Общее</label>
          <textarea id="s-general" class="settings-textarea" placeholder="Любая дополнительная информация о вашем стиле работы...">${escapeAttr(tr.general ?? '')}</textarea>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn-primary">Сохранить</button>
          <button type="button" id="settings-cancel" class="btn-secondary">Отмена</button>
        </div>
        <p id="settings-status" class="login-error hidden"></p>
      </form>
    </div>`

  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.querySelector('#settings-close')!.addEventListener('click', close)
  overlay.querySelector('#settings-cancel')!.addEventListener('click', close)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

  overlay.querySelector<HTMLFormElement>('#settings-form')!.onsubmit = async (e) => {
    e.preventDefault()
    const statusEl = overlay.querySelector<HTMLParagraphElement>('#settings-status')!
    const val = (id: string) => overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>(id)!.value.trim()
    try {
      userSettings = await saveSettings({
        todoRules: {
          sources: val('#s-sources'),
          trackedParams: val('#s-params'),
          dailyUnits: val('#s-units'),
          easyTasks: val('#s-easy'),
          hardTasks: val('#s-hard'),
          general: val('#s-general')
        }
      })
      statusEl.textContent = '✓ Сохранено'
      statusEl.style.color = 'var(--accent)'
      statusEl.classList.remove('hidden')
      setTimeout(() => close(), 800)
    } catch (err) {
      statusEl.textContent = err instanceof Error ? err.message : 'Ошибка сохранения'
      statusEl.style.color = ''
      statusEl.classList.remove('hidden')
    }
  }
}

function suggestDocumentUpdate(doc: DocumentRecord) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:460px;text-align:center;gap:16px;padding:36px 28px;">
      <div style="font-size:48px;line-height:1;">📄</div>
      <h2 style="margin:0;">Срок документа истёк</h2>
      <p style="color:var(--text-secondary);margin:0;">Документ <strong>${escapeAttr(doc.title)}</strong> просрочен (${doc.expiresAt}). Хотите обновить данные и загрузить новое фото?</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:8px;">
        <button id="suggest-yes" class="btn-primary">Обновить документ</button>
        <button id="suggest-no" class="btn-secondary">Позже</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.querySelector<HTMLButtonElement>('#suggest-no')!.onclick = close
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })
  overlay.querySelector<HTMLButtonElement>('#suggest-yes')!.onclick = () => {
    close()
    showEditModal(doc)
  }
}

function showEditModal(doc: DocumentRecord) {
  let editImageDataUrl: string | undefined = doc.imageDataUrl
  let editTags: string[] = [...(doc.tags ?? [])]

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'

  const tagsChipsHtml = () => editTags.map((t) =>
    `<span class="tag-chip">${escapeAttr(t)}<button type="button" class="tag-chip-remove" data-tag="${escapeAttr(t)}">✕</button></span>`
  ).join('')

  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h2>Редактировать документ</h2>
        <button id="modal-close" class="modal-close" title="Закрыть">✕</button>
      </div>
      <form id="edit-doc-form" class="doc-form">
        <div class="form-section">
          <label class="form-label">Фото документа</label>
          <div id="edit-drop-zone" class="drop-zone">
            <div class="drop-zone-icon">📷</div>
            <div id="edit-drop-label" class="drop-zone-text">${doc.imageDataUrl ? '✓ Фото загружено' : 'Перетащите фото сюда или нажмите для выбора'}</div>
            <input id="edit-doc-image" type="file" accept="image/*" />
          </div>
        </div>
        <div class="form-section">
          <label class="form-label">Основная информация</label>
          <div class="form-row">
            <input id="edit-doc-title" placeholder="Название документа" value="${escapeAttr(doc.title)}" required />
            <input id="edit-doc-type" placeholder="Тип документа" value="${escapeAttr(doc.docType)}" required />
          </div>
        </div>
        <div class="form-section">
          <label class="form-label">Поля документа</label>
          <div class="fields-editor">
            <div id="edit-fields-list" class="fields-list"></div>
            <button id="edit-add-field-btn" type="button" class="add-field-btn">+ Добавить поле</button>
          </div>
        </div>
        <div class="form-section">
          <label class="form-label">Теги</label>
          <div class="tags-editor">
            <div id="edit-tags-chips" class="tags-chips">${tagsChipsHtml()}</div>
            <input id="edit-tags-input" class="tags-input" placeholder="Введите тег и нажмите Enter или запятую" />
          </div>
        </div>
        <div class="form-section">
          <label class="form-label">Срок действия и напоминание</label>
          <div class="form-row">
            <input id="edit-doc-expires" type="date" value="${doc.expiresAt ?? ''}" />
            <div class="notify-controls">
              <label class="checkbox-label"><input id="edit-doc-notify" type="checkbox" ${doc.notifyEnabled ? 'checked' : ''} /> Уведомлять</label>
              <label class="notify-days-label">за <input id="edit-doc-notify-days" type="number" min="0" value="${doc.notifyBeforeDays}" /> дней</label>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn-primary">Сохранить изменения</button>
          <button type="button" id="modal-cancel" class="btn-secondary">Отмена</button>
        </div>
        <p id="edit-error" class="login-error hidden"></p>
      </form>
    </div>`

  document.body.appendChild(overlay)

  const close = () => overlay.remove()
  overlay.querySelector<HTMLButtonElement>('#modal-close')!.onclick = close
  overlay.querySelector<HTMLButtonElement>('#modal-cancel')!.onclick = close
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

  // поля
  const editFieldsList = overlay.querySelector<HTMLDivElement>('#edit-fields-list')!
  for (const [k, v] of Object.entries(doc.fields ?? {})) {
    const row = document.createElement('div')
    row.className = 'field-row'
    row.innerHTML = `<input class="field-key" placeholder="Название поля" value="${escapeAttr(k)}" /><input class="field-value" placeholder="Значение" value="${escapeAttr(String(v))}" /><button type="button" class="field-remove" title="Удалить">✕</button>`
    row.querySelector<HTMLButtonElement>('.field-remove')!.onclick = () => row.remove()
    editFieldsList.appendChild(row)
  }
  if (editFieldsList.children.length === 0) {
    const row = document.createElement('div')
    row.className = 'field-row'
    row.innerHTML = `<input class="field-key" placeholder="Название поля" /><input class="field-value" placeholder="Значение" /><button type="button" class="field-remove">✕</button>`
    row.querySelector<HTMLButtonElement>('.field-remove')!.onclick = () => row.remove()
    editFieldsList.appendChild(row)
  }
  overlay.querySelector<HTMLButtonElement>('#edit-add-field-btn')!.onclick = () => {
    const row = document.createElement('div')
    row.className = 'field-row'
    row.innerHTML = `<input class="field-key" placeholder="Название поля" /><input class="field-value" placeholder="Значение" /><button type="button" class="field-remove">✕</button>`
    row.querySelector<HTMLButtonElement>('.field-remove')!.onclick = () => row.remove()
    editFieldsList.appendChild(row)
  }

  // теги
  const editTagsChips = overlay.querySelector<HTMLDivElement>('#edit-tags-chips')!
  const refreshEditTags = () => {
    editTagsChips.innerHTML = tagsChipsHtml()
    editTagsChips.querySelectorAll<HTMLButtonElement>('.tag-chip-remove').forEach((btn) => {
      btn.onclick = () => { editTags = editTags.filter((t) => t !== btn.dataset.tag); refreshEditTags() }
    })
  }
  refreshEditTags()
  overlay.querySelector<HTMLInputElement>('#edit-tags-input')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = (e.target as HTMLInputElement).value.trim().replace(/,+$/, '')
      if (val && !editTags.includes(val)) { editTags.push(val); refreshEditTags() }
      ;(e.target as HTMLInputElement).value = ''
    }
  })

  // фото
  const dropZone = overlay.querySelector<HTMLDivElement>('#edit-drop-zone')!
  const dropLabel = overlay.querySelector<HTMLDivElement>('#edit-drop-label')!
  const imgInput = overlay.querySelector<HTMLInputElement>('#edit-doc-image')!
  const handleImg = async (file: File | undefined) => {
    editImageDataUrl = await getImageDataUrl(file)
    if (file && editImageDataUrl) dropLabel.innerHTML = `✓ Фото выбрано: <strong>${file.name}</strong>`
  }
  imgInput.onchange = (e) => handleImg((e.target as HTMLInputElement).files?.[0])
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over')
    const file = e.dataTransfer?.files?.[0]
    if (file?.type.startsWith('image/')) await handleImg(file)
  })
  dropZone.addEventListener('click', () => imgInput.click())

  // сабмит
  overlay.querySelector<HTMLFormElement>('#edit-doc-form')!.onsubmit = async (e) => {
    e.preventDefault()
    const errEl = overlay.querySelector<HTMLParagraphElement>('#edit-error')!
    const fields: Record<string, string> = {}
    overlay.querySelectorAll<HTMLDivElement>('.field-row').forEach((row) => {
      const k = row.querySelector<HTMLInputElement>('.field-key')!.value.trim()
      const v = row.querySelector<HTMLInputElement>('.field-value')!.value.trim()
      if (k) fields[k] = v
    })
    try {
      await updateDocument(doc.id, {
        title: overlay.querySelector<HTMLInputElement>('#edit-doc-title')!.value.trim(),
        docType: overlay.querySelector<HTMLInputElement>('#edit-doc-type')!.value.trim(),
        fields,
        tags: [...editTags],
        imageDataUrl: editImageDataUrl,
        notifyEnabled: overlay.querySelector<HTMLInputElement>('#edit-doc-notify')!.checked,
        notifyBeforeDays: Number(overlay.querySelector<HTMLInputElement>('#edit-doc-notify-days')!.value || '1'),
        expiresAt: overlay.querySelector<HTMLInputElement>('#edit-doc-expires')!.value || undefined
      })
      await refreshData()
      close()
      renderBase()
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : 'Ошибка сохранения'
      errEl.classList.remove('hidden')
    }
  }
}

function renderFieldsList(entries: [string, string][]) {
  const list = document.querySelector<HTMLDivElement>('#fields-list')!
  list.innerHTML = ''
  if (entries.length === 0) { addFieldRow(); return }
  for (const [key, value] of entries) addFieldRow(key, String(value))
}

function addFieldRow(key = '', value = '') {
  const list = document.querySelector<HTMLDivElement>('#fields-list')
  if (!list) return
  const row = document.createElement('div')
  row.className = 'field-row'
  row.innerHTML = `<input class="field-key" placeholder="Название поля" value="${escapeAttr(key)}" /><input class="field-value" placeholder="Значение" value="${escapeAttr(value)}" /><button type="button" class="field-remove" title="Удалить">✕</button>`
  row.querySelector<HTMLButtonElement>('.field-remove')!.onclick = () => row.remove()
  list.appendChild(row)
}

// ===================== TASKS =====================

const ON_MISSED_LABELS: Record<OnMissed, string> = { skip: 'Пропустить', accumulate: 'Накопить', reschedule: 'Перенести' }

function todayStr() { return new Date().toISOString().slice(0, 10) }
function dayStr(d: Date) { return d.toISOString().slice(0, 10) }
function addDays(base: Date, n: number) { const d = new Date(base); d.setDate(d.getDate() + n); return d }

function taskDeadlineStatus(task: ScheduledTask): 'overdue' | 'soon' | 'ok' {
  if (!task.deadline) return 'ok'
  const today = todayStr()
  if (task.deadline < today) return 'overdue'
  const diff = (new Date(task.deadline).getTime() - new Date(today).getTime()) / 86400000
  if (diff <= 3) return 'soon'
  return 'ok'
}

function renderTasksSection() {
  if (tasksSubView === 'task-form') { renderTaskForm(editingTask ?? undefined); return }
  if (tasksSubView === 'routine-form') { renderRoutineForm(editingRoutine ?? undefined); return }
  if (tasksSubView === 'habit-form') { renderHabitForm(editingHabit ?? undefined); return }
  if (tasksSubView === 'review') { renderDailyReview(); return }

  const dailyLimit = parseFloat(userSettings.todoRules?.dailyUnits ?? '') || 0
  const today = todayStr()
  const backlog = tasks.filter((t) => !t.scheduledDate && !t.done && !t.skipped)
  const todayTasks = tasks.filter((t) => t.scheduledDate === today && !t.done && !t.skipped)
  const todayRoutines = routines.filter((r) => r.daysOfWeek.includes(new Date().getDay()))
  const totalUnits = todayTasks.reduce((s, t) => s + t.weight + t.accumulation, 0) + todayRoutines.reduce((s, r) => s + r.weight, 0)

  const isActive = (v: string) => tasksSubView === v ? 'active' : ''
  contentRoot.innerHTML = `<section class="documents tasks-section">
    <div class="page-header-row">
      <div><h2>Планирование</h2><p class="page-subtitle">Сегодня: ${totalUnits}${dailyLimit ? '/' + dailyLimit : ''} ед.</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button id="tasks-review-btn" class="btn-secondary">📊 Итог дня</button>
        ${ tasksSubView === 'tasks' ? '<button id="tasks-add-btn" class="btn-primary">+ Задача</button>' : '' }
        ${ tasksSubView === 'routines' ? '<button id="routine-add-btn" class="btn-primary">+ Рутина</button>' : '' }
        ${ tasksSubView === 'habits' ? '<button id="habit-add-btn" class="btn-primary">+ Привычка</button>' : '' }
      </div>
    </div>
    <div class="tasks-sub-tabs">
      <button id="tasks-tab-tasks" class="tasks-sub-tab ${isActive('tasks')}">📋 Задачи <span class="tasks-badge">${backlog.length}</span></button>
      <button id="tasks-tab-routines" class="tasks-sub-tab ${isActive('routines')}">🔁 Рутины <span class="tasks-badge">${routines.length}</span></button>
      <button id="tasks-tab-habits" class="tasks-sub-tab ${isActive('habits')}">🌱 Привычки <span class="tasks-badge">${habits.length}</span></button>
      <button id="tasks-tab-calendar" class="tasks-sub-tab ${isActive('calendar')}">📅 Календарь</button>
    </div>
    <div id="tasks-content"></div>
  </section>`

  document.querySelector('#tasks-review-btn')!.addEventListener('click', () => {
    if (!reviewTargetDate) reviewTargetDate = dayStr(addDays(new Date(), -1))
    tasksSubView = 'review'
    renderTasksSection()
  })
  document.querySelector('#tasks-tab-tasks')!.addEventListener('click', () => { tasksSubView = 'tasks'; renderTasksSection() })
  document.querySelector('#tasks-tab-routines')!.addEventListener('click', () => { tasksSubView = 'routines'; renderTasksSection() })
  document.querySelector('#tasks-tab-habits')!.addEventListener('click', () => { tasksSubView = 'habits'; renderTasksSection() })
  document.querySelector('#tasks-tab-calendar')!.addEventListener('click', () => { tasksSubView = 'calendar'; renderTasksSection() })
  document.querySelector('#tasks-add-btn')?.addEventListener('click', () => { editingTask = null; tasksSubView = 'task-form'; renderTasksSection() })
  document.querySelector('#routine-add-btn')?.addEventListener('click', () => { editingRoutine = null; tasksSubView = 'routine-form'; renderTasksSection() })
  document.querySelector('#habit-add-btn')?.addEventListener('click', () => { editingHabit = null; tasksSubView = 'habit-form'; renderTasksSection() })

  if (tasksSubView === 'calendar') renderCalendarView()
  else if (tasksSubView === 'routines') renderRoutinesView()
  else if (tasksSubView === 'habits') renderHabitsView()
  else renderBacklogView()
}

// ─── Daily Review ──────────────────────────────────────────────────────────

const RU_MONTHS: Record<string, string> = {
  'янв': '01', 'фев': '02', 'мар': '03', 'апр': '04', 'май': '05', 'мая': '05',
  'июн': '06', 'июл': '07', 'авг': '08', 'сен': '09', 'окт': '10', 'ноя': '11', 'дек': '12'
}

function extractReviewDate(text: string): string | null {
  const lower = text.toLowerCase()
  const keywords = ['итог дня', 'итоги дня', 'подвести итог', 'подведем итог', 'подведём итог', 'подведи итог', 'разбор дня', 'итоги за', 'итоги сегодня', 'что я сделал', 'итог за', 'подводим итог', 'давай итог', 'итог по', 'подведи итоги']
  if (!keywords.some((kw) => lower.includes(kw))) return null

  if (lower.includes('вчера')) return dayStr(addDays(new Date(), -1))
  if (lower.includes('сегодня')) return todayStr()

  // "22 апреля 2026" или "22 апреля"
  const ruMatch = lower.match(/(\d{1,2})\s+(янв\w*|фев\w*|мар\w*|апр\w*|май\w*|мая|июн\w*|июл\w*|авг\w*|сен\w*|окт\w*|ноя\w*|дек\w*)(?:\s+(\d{4}))?/)
  if (ruMatch) {
    const day = ruMatch[1].padStart(2, '0')
    const monthKey = Object.keys(RU_MONTHS).find((k) => ruMatch[2].startsWith(k))
    const month = monthKey ? RU_MONTHS[monthKey] : null
    const year = ruMatch[3] ?? String(new Date().getFullYear())
    if (month) return `${year}-${month}-${day}`
  }

  // "22.04" или "22/04"
  const numMatch = text.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/)
  if (numMatch) {
    const y = numMatch[3] ? (numMatch[3].length === 2 ? '20' + numMatch[3] : numMatch[3]) : String(new Date().getFullYear())
    return `${y}-${numMatch[2].padStart(2,'0')}-${numMatch[1].padStart(2,'0')}`
  }

  return dayStr(addDays(new Date(), -1))
}

function renderDailyReviewWidget(reviewDate: string, confirmed: boolean, container: HTMLElement, msg: ChatMessage, conv: typeof state.conversations[0]) {
  const dateLabel = new Date(reviewDate + 'T12:00').toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' })
  const dow = new Date(reviewDate + 'T12:00').getDay()
  const dayTasks = tasks.filter((t) => t.scheduledDate === reviewDate)
  const dayRoutines = routines.filter((r) => r.daysOfWeek.includes(dow))

  const widget = document.createElement('div')
  widget.className = `daily-review-widget${confirmed ? ' confirmed' : ''}`

  if (confirmed) {
    widget.innerHTML = `<div class="drw-done">✓ Итог за ${dateLabel} подведён</div>`
    container.appendChild(widget)
    return
  }

  const actionOpts = (def: string) => (['reschedule','accumulate','skip','forget'] as const)
    .map((v) => `<option value="${v}" ${def === v ? 'selected':''}>${{reschedule:'Перенести',accumulate:'Накопить',skip:'Пропустить',forget:'Забыть'}[v]}</option>`).join('')

  const buildItem = (id: string, type: 'task'|'routine', title: string, weight: number, done: boolean, onMissed: string) => {
    const log = type === 'routine' ? routineLogs.find((l) => l.routineId === id && l.date === reviewDate) : null
    const isDone = type === 'task' ? done : log?.status === 'done'
    return `<div class="drw-item" data-id="${id}" data-type="${type}" data-weight="${weight}" data-on-missed="${onMissed}">
      <label class="drw-check-label">
        <input type="checkbox" class="drw-done-check" ${isDone ? 'checked' : ''} />
        <span class="drw-item-title">${escapeAttr(title)}</span>
        <span class="drw-item-weight">${weight} ед.</span>
      </label>
      <div class="drw-undone-row ${isDone ? 'hidden' : ''}">
        <select class="drw-action">${actionOpts(onMissed)}</select>
        <div class="drw-reschedule-row hidden">
          <input type="date" class="drw-date" min="${todayStr()}" />
          <button type="button" class="drw-suggest-btn">Предложить</button>
        </div>
      </div>
    </div>`
  }

  const routineRows = dayRoutines.map((r) => buildItem(r.id, 'routine', r.title, r.weight, false, r.onMissed)).join('')
  const taskRows = dayTasks.map((t) => buildItem(t.id, 'task', t.title, t.weight, t.done || t.skipped, t.onMissed)).join('')

  widget.innerHTML = `
    <div class="drw-header">📊 Итог — ${dateLabel}</div>
    ${dayRoutines.length ? `<div class="drw-section">Рутины</div>${routineRows}` : ''}
    ${dayTasks.length ? `<div class="drw-section">Задачи</div>${taskRows}` : ''}
    ${!dayRoutines.length && !dayTasks.length ? '<p class="hint" style="margin:8px 0">На этот день ничего не было запланировано.</p>' : ''}
    <div class="drw-footer">
      <button class="drw-confirm btn-primary">Подтвердить итог →</button>
    </div>`

  // логика показа/скрытия строки действия + дата для переноса
  widget.querySelectorAll<HTMLDivElement>('.drw-item').forEach((item) => {
    const check = item.querySelector<HTMLInputElement>('.drw-done-check')!
    const undoneRow = item.querySelector<HTMLDivElement>('.drw-undone-row')!
    const actionSel = item.querySelector<HTMLSelectElement>('.drw-action')!
    const reschedRow = item.querySelector<HTMLDivElement>('.drw-reschedule-row')!
    const suggestBtn = item.querySelector<HTMLButtonElement>('.drw-suggest-btn')!
    const dateInput = item.querySelector<HTMLInputElement>('.drw-date')!

    const updateVisibility = () => {
      undoneRow.classList.toggle('hidden', check.checked)
      reschedRow.classList.toggle('hidden', actionSel.value !== 'reschedule')
    }
    check.addEventListener('change', updateVisibility)
    actionSel.addEventListener('change', updateVisibility)

    suggestBtn.addEventListener('click', () => {
      const routine = routines.find((r) => r.id === item.dataset.id)
      const suggestions = routine
        ? suggestRescheduleDates(routine, reviewDate)
        : [{ date: dayStr(addDays(new Date(reviewDate + 'T12:00'), 1)) }, { date: dayStr(addDays(new Date(reviewDate + 'T12:00'), 2)) }]
      const menu = document.createElement('div')
      menu.className = 'routine-action-menu'
      const rect = suggestBtn.getBoundingClientRect()
      menu.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px`
      menu.innerHTML = suggestions.slice(0,3).map((s) =>
        `<button class="rma-btn" data-date="${s.date}">${new Date(s.date + 'T12:00').toLocaleDateString('ru',{weekday:'short',day:'numeric',month:'short'})}</button>`
      ).join('')
      document.body.appendChild(menu)
      menu.querySelectorAll<HTMLButtonElement>('[data-date]').forEach((b) => {
        b.addEventListener('click', () => { dateInput.value = b.dataset.date!; menu.remove() })
      })
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50)
    })
  })

  // подтверждение
  widget.querySelector('.drw-confirm')!.addEventListener('click', async () => {
    await confirmDailyReview(widget, reviewDate)
    msg.dailyReview = { date: reviewDate, confirmed: true }
    persist()
    widget.replaceWith((() => { const d = document.createElement('div'); d.className = 'daily-review-widget confirmed'; d.innerHTML = `<div class="drw-done">✓ Итог за ${dateLabel} подведён</div>`; return d })())
    // показываем обновлённое расписание следующего дня
    await showPostReviewSchedule(reviewDate, conv)
  })

  container.appendChild(widget)
}

async function confirmDailyReview(widget: HTMLElement, reviewDate: string) {
  const tomorrow = dayStr(addDays(new Date(reviewDate + 'T12:00'), 1))
  for (const item of widget.querySelectorAll<HTMLDivElement>('.drw-item')) {
    const id = item.dataset.id!
    const type = item.dataset.type as 'task' | 'routine'
    const weight = Number(item.dataset.weight) || 1
    const check = item.querySelector<HTMLInputElement>('.drw-done-check')!
    const action = item.querySelector<HTMLSelectElement>('.drw-action')?.value ?? 'skip'
    const targetDate = item.querySelector<HTMLInputElement>('.drw-date')?.value || tomorrow

    if (check.checked) {
      if (type === 'task') await updateTask(id, { done: true })
      else await logRoutine(id, reviewDate, 'done')
    } else {
      if (action === 'forget') {
        if (type === 'task') await updateTask(id, { skipped: true })
        else await logRoutine(id, reviewDate, 'skipped')
      } else if (action === 'skip') {
        if (type === 'task') await updateTask(id, { skipped: true })
        else await logRoutine(id, reviewDate, 'skipped')
      } else if (action === 'reschedule') {
        if (type === 'task') {
          await updateTask(id, { scheduledDate: targetDate, done: false, skipped: false })
        } else {
          await logRoutine(id, reviewDate, 'skipped')
          const r = routines.find((x) => x.id === id)
          if (r) await createTask({ title: r.title + ' ↷', weight: r.weight, context: r.context, conditions: '', scheduledDate: targetDate, scheduledTime: r.times?.[String(new Date(reviewDate+'T12:00').getDay())] ?? r.time, onMissed: 'skip', accumulation: 0, done: false, skipped: false, notes: `Перенос с ${reviewDate}` })
        }
      } else if (action === 'accumulate') {
        if (type === 'task') {
          await updateTask(id, { scheduledDate: tomorrow, accumulation: weight, done: false, skipped: false })
        } else {
          await logRoutine(id, reviewDate, 'skipped')
          const r = routines.find((x) => x.id === id)
          if (r) await createTask({ title: r.title + ' ↷', weight: r.weight * 2, context: r.context, conditions: '', scheduledDate: tomorrow, onMissed: 'accumulate', accumulation: r.weight, done: false, skipped: false, notes: `Накопление с ${reviewDate}` })
        }
      }
    }
  }
  await refreshData()
}

async function showPostReviewSchedule(reviewDate: string, conv: typeof state.conversations[0]) {
  const tomorrow = dayStr(addDays(new Date(reviewDate + 'T12:00'), 1))
  const days = Array.from({ length: 3 }, (_, i) => dayStr(addDays(new Date(tomorrow + 'T12:00'), i)))
  const dailyLimit = parseFloat(userSettings.todoRules?.dailyUnits ?? '') || 0

  const lines = days.map((d) => {
    const dow = new Date(d + 'T12:00').getDay()
    const dayTasks = tasks.filter((t) => t.scheduledDate === d && !t.done && !t.skipped)
    const dayRoutines = routines.filter((r) => r.daysOfWeek.includes(dow))
    const units = dayTasks.reduce((s, t) => s + t.weight + t.accumulation, 0) + dayRoutines.reduce((s, r) => s + r.weight, 0)
    const over = dailyLimit > 0 && units > dailyLimit
    const label = new Date(d + 'T12:00').toLocaleDateString('ru', { weekday: 'short', day: 'numeric', month: 'short' })
    const items = [
      ...dayRoutines.map((r) => `  🔁 ${r.title}${r.times?.[String(dow)] ?? r.time ? ' ' + (r.times?.[String(dow)] ?? r.time) : ''}`),
      ...dayTasks.map((t) => `  📋 ${t.title}${t.accumulation ? ' (+' + t.accumulation + 'ед.)' : ''}`)
    ].join('\n')
    return `**${label}** — ${units}${dailyLimit ? '/' + dailyLimit : ''} ед.${over ? ' ⚠️' : ''}\n${items || '  _(пусто)_'}`
  }).join('\n\n')

  const scheduleMsg: ChatMessage = {
    id: createId(), role: 'assistant',
    content: `Вот расписание на ближайшие дни после подведения итогов:\n\n${lines}\n\nВсё верно, или что-то скорректируем?`,
    createdAt: Date.now(), model: 'system'
  }
  conv.messages.push(scheduleMsg)
  persist()
  renderChat()
}

// ─── End Daily Review ───────────────────────────────────────────────────────

function calcDayLoad(date: string): number {
  const dow = new Date(date).getDay()
  const taskLoad = tasks.filter((t) => t.scheduledDate === date && !t.done && !t.skipped).reduce((s, t) => s + t.weight + t.accumulation, 0)
  const routineLoad = routines.filter((r) => r.daysOfWeek.includes(dow)).reduce((s, r) => s + r.weight, 0)
  return taskLoad + routineLoad
}

function suggestRescheduleDates(routine: Routine, originalDate: string, count = 4): Array<{ date: string; load: number }> {
  const result: Array<{ date: string; load: number }> = []
  for (let i = 1; i <= 10 && result.length < count; i++) {
    const d = addDays(new Date(originalDate), i)
    const ds = dayStr(d)
    if (routine.daysOfWeek.includes(d.getDay())) continue // плановый день и так будет
    result.push({ date: ds, load: calcDayLoad(ds) })
  }
  return result.sort((a, b) => a.load - b.load)
}

function showRoutineActionMenu(routine: Routine, date: string, anchor: HTMLElement) {
  document.querySelector('.routine-action-menu')?.remove()
  const log = routineLogs.find((l) => l.routineId === routine.id && l.date === date)
  const menu = document.createElement('div')
  menu.className = 'routine-action-menu'
  const rect = anchor.getBoundingClientRect()
  menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${Math.min(rect.left, window.innerWidth - 200)}px`

  if (log) {
    menu.innerHTML = `<button class="rma-btn">↩ Снять отметку</button>`
    menu.querySelector('.rma-btn')!.addEventListener('click', async () => {
      await deleteRoutineLog(log.id); await refreshData(); menu.remove(); renderCalendarView()
    })
  } else {
    menu.innerHTML = `
      <div class="rma-title">${escapeAttr(routine.title)}</div>
      <button class="rma-btn rma-done">✓ Выполнено</button>
      <button class="rma-btn rma-move">↷ Перенести</button>
      <button class="rma-btn rma-skip">✗ Пропустить</button>`
    menu.querySelector('.rma-done')!.addEventListener('click', async () => {
      await logRoutine(routine.id, date, 'done'); await refreshData(); menu.remove(); renderCalendarView()
    })
    menu.querySelector('.rma-skip')!.addEventListener('click', async () => {
      await logRoutine(routine.id, date, 'skipped'); await refreshData(); menu.remove(); renderCalendarView()
    })
    menu.querySelector('.rma-move')!.addEventListener('click', () => {
      menu.remove(); showRescheduleModal(routine, date)
    })
  }

  document.body.appendChild(menu)
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50)
}

function showRescheduleModal(routine: Routine, originalDate: string) {
  const suggestions = suggestRescheduleDates(routine, originalDate)
  const dailyLimit = parseFloat(userSettings.todoRules?.dailyUnits ?? '') || 0
  const origLabel = new Date(originalDate).toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'short' })

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  const suggBtns = suggestions.map(({ date, load }) => {
    const label = new Date(date).toLocaleDateString('ru', { weekday: 'short', day: 'numeric', month: 'short' })
    const over = dailyLimit > 0 && load > dailyLimit
    return `<button class="reschedule-day-btn ${over ? 'over-limit' : ''}" data-date="${date}">
      <span class="rd-label">${label}</span>
      <span class="rd-load ${over ? 'warn' : ''}">${load}${dailyLimit ? '/' + dailyLimit : ''} ед.</span>
    </button>`
  }).join('')

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px">
      <div class="modal-header"><h2>Перенести</h2><button id="rm-close" class="modal-close">✕</button></div>
      <p style="color:var(--text-secondary);font-size:14px;margin:0 0 16px">«${escapeAttr(routine.title)}» — ${origLabel}</p>
      <label class="form-label">Предложения (отсортированы по нагрузке)</label>
      <div class="reschedule-suggestions">${suggBtns}</div>
      <div class="form-section" style="margin-top:12px">
        <label class="form-label">Другая дата</label>
        <input type="date" id="rm-custom-date" />
      </div>
      <div class="form-actions">
        <button id="rm-confirm" class="btn-primary">Перенести</button>
        <button id="rm-cancel" class="btn-secondary">Отмена</button>
      </div>
    </div>`

  document.body.appendChild(overlay)
  let selectedDate = suggestions[0]?.date ?? ''
  const allBtns = overlay.querySelectorAll<HTMLButtonElement>('.reschedule-day-btn')
  allBtns[0]?.classList.add('selected')

  allBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      allBtns.forEach((b) => b.classList.remove('selected'))
      btn.classList.add('selected')
      selectedDate = btn.dataset.date!
      ;(overlay.querySelector('#rm-custom-date') as HTMLInputElement).value = ''
    })
  })
  overlay.querySelector<HTMLInputElement>('#rm-custom-date')!.addEventListener('input', (e) => {
    selectedDate = (e.target as HTMLInputElement).value
    allBtns.forEach((b) => b.classList.remove('selected'))
  })

  const close = () => overlay.remove()
  overlay.querySelector('#rm-close')!.addEventListener('click', close)
  overlay.querySelector('#rm-cancel')!.addEventListener('click', close)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close() })

  overlay.querySelector('#rm-confirm')!.addEventListener('click', async () => {
    if (!selectedDate) { alert('Выбери дату'); return }
    const overLimit = dailyLimit > 0 && calcDayLoad(selectedDate) > dailyLimit
    if (overLimit && !confirm(`На этот день нагрузка превысит лимит (${dailyLimit} ед.). Всё равно перенести?`)) return
    await logRoutine(routine.id, originalDate, 'skipped')
    const dow = new Date(originalDate).getDay()
    const dayTime = routine.times?.[String(dow)] ?? routine.time
    await createTask({
      title: routine.title + ' ↷',
      weight: routine.weight,
      context: routine.context,
      conditions: '',
      scheduledDate: selectedDate,
      scheduledTime: dayTime,
      onMissed: 'skip',
      accumulation: 0,
      done: false,
      skipped: false,
      notes: `Перенос с ${originalDate}`
    })
    await refreshData(); close(); renderCalendarView()
  })
}

function renderBacklogView() {
  const container = document.querySelector<HTMLDivElement>('#tasks-content')!
  const backlog = tasks.filter((t) => !t.scheduledDate && !t.done && !t.skipped)
  const scheduled = tasks.filter((t) => t.scheduledDate && !t.done && !t.skipped)
  const done = tasks.filter((t) => t.done || t.skipped)
  const grp = (label: string, items: ScheduledTask[]) => items.length ? `<div class="tasks-group-label">${label}</div>${items.map((t) => renderTaskCard(t)).join('')}` : ''
  container.innerHTML = `
    ${grp('🔴 Просрочен дедлайн', backlog.filter((t) => taskDeadlineStatus(t) === 'overdue'))}
    ${grp('🟡 Дедлайн скоро', backlog.filter((t) => taskDeadlineStatus(t) === 'soon'))}
    ${grp('Без даты', backlog.filter((t) => taskDeadlineStatus(t) === 'ok'))}
    ${grp('📅 Запланировано', scheduled)}
    ${done.length ? `<div class="tasks-group-label">✓ Выполнено</div>${done.slice(0, 5).map((t) => renderTaskCard(t, true)).join('')}` : ''}
    ${!tasks.length ? '<p class="hint">Задач пока нет. Создай первую или спроси ИИ в чате.</p>' : ''}
  `
  container.querySelectorAll<HTMLElement>('[data-task-id]').forEach((el) => wireTaskCard(el))
}

function renderTaskCard(task: ScheduledTask, compact = false): string {
  const status = taskDeadlineStatus(task)
  const w = task.weight + task.accumulation
  return `<div class="task-card task-status-${status}${task.done ? ' task-done' : ''}${task.skipped ? ' task-skipped' : ''}" data-task-id="${task.id}">
    <div class="task-card-row">
      <label class="task-check-label"><input type="checkbox" class="task-check" ${task.done ? 'checked' : ''} /></label>
      <div class="task-card-body">
        <div class="task-card-title">${escapeAttr(task.title)}${task.accumulation > 0 ? ` <span class="task-accum">+${task.accumulation}ед.</span>` : ''}</div>
        ${!compact ? `<div class="task-card-meta">
          <span class="task-weight">${w} ед.</span>
          ${task.scheduledDate ? `<span>📅 ${task.scheduledDate}${task.scheduledTime ? ' ' + task.scheduledTime : ''}</span>` : ''}
          ${task.deadline ? `<span class="task-deadline-${status}">⏰ ${task.deadline}</span>` : ''}
          ${task.context ? `<span>📍 ${escapeAttr(task.context)}</span>` : ''}
        </div>` : ''}
      </div>
      <div class="task-card-actions-inline">
        <button class="task-btn-edit conv-action-btn" title="Редактировать">✏</button>
        <button class="task-btn-delete conv-action-btn conv-delete-btn" title="Удалить">✕</button>
      </div>
    </div>
  </div>`
}

function wireTaskCard(el: HTMLElement) {
  const id = el.dataset.taskId!
  const task = tasks.find((t) => t.id === id)!
  el.querySelector<HTMLInputElement>('.task-check')?.addEventListener('change', async (e) => {
    await updateTask(id, { done: (e.target as HTMLInputElement).checked }); await refreshData(); renderTasksSection()
  })
  el.querySelector<HTMLButtonElement>('.task-btn-edit')?.addEventListener('click', () => { editingTask = task; tasksSubView = 'task-form'; renderTasksSection() })
  el.querySelector<HTMLButtonElement>('.task-btn-delete')?.addEventListener('click', async () => {
    if (!confirm(`Удалить «${task.title}»?`)) return
    await deleteTask(id); await refreshData(); renderTasksSection()
  })
}

// ─── Routines view ───────────────────────────────────────────────────────────

function renderRoutinesView() {
  const container = document.querySelector<HTMLDivElement>('#tasks-content')!
  if (!routines.length) { container.innerHTML = '<p class="hint">Рутин пока нет. Создай первую — они будут показываться в календаре каждую неделю.</p>'; return }
  container.innerHTML = ''
  for (const r of routines) {
    const card = document.createElement('div')
    card.className = 'routine-card'
    card.style.borderLeftColor = r.color
    const days = r.daysOfWeek.sort().map((d) => {
      const t = r.times?.[String(d)] ?? r.time
      return `<span class="day-badge">${DAYS_SHORT[d]}${t ? ' ' + t : ''}</span>`
    }).join('')
    card.innerHTML = `
      <div class="task-card-row">
        <div style="width:10px;height:10px;border-radius:50%;background:${r.color};flex-shrink:0;margin-top:4px"></div>
        <div class="task-card-body">
          <div class="task-card-title">${escapeAttr(r.title)}</div>
          <div class="task-card-meta">${days}<span class="task-weight">${r.weight} ед.</span>${r.context ? `<span>📍 ${escapeAttr(r.context)}</span>` : ''}</div>
        </div>
        <div class="task-card-actions-inline" style="opacity:1">
          <button class="r-edit conv-action-btn">✏</button>
          <button class="r-del conv-action-btn conv-delete-btn">✕</button>
        </div>
      </div>`
    card.querySelector('.r-edit')!.addEventListener('click', () => { editingRoutine = r; tasksSubView = 'routine-form'; renderTasksSection() })
    card.querySelector('.r-del')!.addEventListener('click', async () => {
      if (!confirm(`Удалить рутину «${r.title}»?`)) return
      await deleteRoutine(r.id); await refreshData(); renderTasksSection()
    })
    container.appendChild(card)
  }
}

function renderRoutineForm(routine?: Routine) {
  const isEdit = !!routine?.id
  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div style="display:flex;align-items:center;gap:12px">
        <button id="rf-back" class="btn-secondary">← Назад</button>
        <h2 style="margin:0">${isEdit ? 'Редактировать рутину' : 'Новая рутина'}</h2>
      </div>
    </div>
    <form id="routine-form" class="doc-form">
      <div class="form-section">
        <label class="form-label">Название</label>
        <input id="rf-title" placeholder="Например: Тренировка" value="${escapeAttr(routine?.title ?? '')}" required />
      </div>
      <div class="form-section">
        <label class="form-label">Дни недели и время</label>
        <div class="dow-time-grid">
          ${[1,2,3,4,5,6,0].map((d) => {
            const checked = (routine?.daysOfWeek ?? []).includes(d)
            const dayTime = routine?.times?.[String(d)] ?? (checked && !routine?.times ? (routine?.time ?? '') : '')
            return `<label class="dow-time-row ${checked ? 'active' : ''}">
              <input type="checkbox" class="dow-check" value="${d}" ${checked ? 'checked' : ''} />
              <span class="dow-name">${DAYS_SHORT[d]}</span>
              <input type="time" class="dow-time-input" data-day="${d}" value="${dayTime}" ${!checked ? 'disabled' : ''} placeholder="--:--" />
            </label>`
          }).join('')}
        </div>
      </div>
      <div class="form-row">
        <div class="form-section" style="flex:0 0 120px"><label class="form-label">Вес (ед.)</label><input id="rf-weight" type="number" min="0.5" step="0.5" value="${routine?.weight ?? 1}" /></div>
        <div class="form-section" style="flex:1"><label class="form-label">При пропуске</label><select id="rf-onmissed">${(['skip','accumulate','reschedule'] as OnMissed[]).map((v) => `<option value="${v}" ${routine?.onMissed === v ? 'selected' : ''}>${ON_MISSED_LABELS[v]}</option>`).join('')}</select></div>
      </div>
      <div class="form-section"><label class="form-label">Контекст</label><input id="rf-context" placeholder="Где происходит?" value="${escapeAttr(routine?.context ?? '')}" /></div>
      <div class="form-section">
        <label class="form-label">Цвет</label>
        <div class="color-picker">${PRESET_COLORS.map((c) => `<button type="button" class="color-dot ${routine?.color === c ? 'selected' : ''}" style="background:${c}" data-color="${c}"></button>`).join('')}</div>
        <input type="hidden" id="rf-color" value="${routine?.color ?? PRESET_COLORS[0]}" />
      </div>
      <div class="form-section"><label class="form-label">Заметки</label><textarea id="rf-notes" rows="2">${escapeAttr(routine?.notes ?? '')}</textarea></div>
      <div class="form-actions">
        <button type="submit" class="btn-primary">${isEdit ? 'Сохранить' : 'Создать рутину'}</button>
        <button type="button" id="rf-cancel" class="btn-secondary">Отмена</button>
      </div>
      <p id="rf-error" class="login-error hidden"></p>
    </form>
  </section>`

  const goBack = () => { tasksSubView = 'routines'; editingRoutine = null; renderTasksSection() }
  document.querySelector('#rf-back')!.addEventListener('click', goBack)
  document.querySelector('#rf-cancel')!.addEventListener('click', goBack)

  // дни недели — подсветка + enable/disable time input
  document.querySelectorAll<HTMLLabelElement>('.dow-time-row').forEach((row) => {
    const cb = row.querySelector<HTMLInputElement>('.dow-check')!
    const ti = row.querySelector<HTMLInputElement>('.dow-time-input')!
    cb.addEventListener('change', () => {
      row.classList.toggle('active', cb.checked)
      ti.disabled = !cb.checked
      if (!cb.checked) ti.value = ''
    })
  })

  // цвет
  document.querySelectorAll<HTMLButtonElement>('.color-dot').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach((b) => b.classList.remove('selected'))
      btn.classList.add('selected')
      document.querySelector<HTMLInputElement>('#rf-color')!.value = btn.dataset.color!
    })
  })

  document.querySelector<HTMLFormElement>('#routine-form')!.onsubmit = async (e) => {
    e.preventDefault()
    const v = (id: string) => (document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id)!).value.trim()
    const daysOfWeek = Array.from(document.querySelectorAll<HTMLInputElement>('.dow-check:checked')).map((c) => Number(c.value))
    if (!daysOfWeek.length) { const err = document.querySelector<HTMLParagraphElement>('#rf-error')!; err.textContent = 'Выбери хотя бы один день'; err.classList.remove('hidden'); return }
    const times: Record<string, string> = {}
    document.querySelectorAll<HTMLInputElement>('.dow-time-input:not([disabled])').forEach((ti) => { if (ti.value) times[ti.dataset.day!] = ti.value })
    const firstTime = Object.values(times)[0]
    const payload = { title: v('#rf-title'), daysOfWeek, time: firstTime, times: Object.keys(times).length ? times : undefined, weight: parseFloat(v('#rf-weight')) || 1, context: v('#rf-context'), color: v('#rf-color') || PRESET_COLORS[0], onMissed: v('#rf-onmissed') as OnMissed, notes: v('#rf-notes') }
    try {
      if (isEdit && routine?.id) await updateRoutine(routine.id, payload)
      else await createRoutine(payload)
      await refreshData(); goBack()
    } catch (err) {
      const el = document.querySelector<HTMLParagraphElement>('#rf-error')!
      el.textContent = err instanceof Error ? err.message : 'Ошибка'; el.classList.remove('hidden')
    }
  }
}

// ─── Habits view ─────────────────────────────────────────────────────────────

function getHabitStreak(habitId: string): number {
  let streak = 0
  const today = todayStr()
  for (let i = 0; i >= -365; i--) {
    const ds = dayStr(addDays(new Date(), i))
    const log = habitLogs.find((l) => l.habitId === habitId && l.date === ds)
    if (!log || log.count === 0) {
      if (ds === today) continue  // сегодня ещё не отмечено — не ломает серию
      break
    }
    streak++
  }
  return streak
}

function renderHabitsView() {
  const container = document.querySelector<HTMLDivElement>('#tasks-content')!
  if (!habits.length) { container.innerHTML = '<p class="hint">Привычек пока нет. Создай первую — и начни отслеживать серии!</p>'; return }
  const today = todayStr()
  container.innerHTML = ''

  for (const habit of habits) {
    const todayLog = habitLogs.find((l) => l.habitId === habit.id && l.date === today)
    const todayCount = todayLog?.count ?? 0
    const streak = getHabitStreak(habit.id)
    const done = todayCount >= habit.targetCount

    // 21-day history grid
    const gridDays = Array.from({ length: 21 }, (_, i) => {
      const ds = dayStr(addDays(new Date(), -(20 - i)))
      const log = habitLogs.find((l) => l.habitId === habit.id && l.date === ds)
      const count = log?.count ?? 0
      const pct = Math.min(count / habit.targetCount, 1)
      const alpha = pct === 0 ? '0.1' : pct < 1 ? '0.5' : '1'
      return `<div class="habit-grid-day" style="background:${habit.color};opacity:${alpha}" title="${ds}: ${count}/${habit.targetCount}"></div>`
    }).join('')

    const progressDots = Array.from({ length: habit.targetCount }, (_, i) =>
      `<span class="habit-dot ${i < todayCount ? 'filled' : ''}" style="${i < todayCount ? `background:${habit.color}` : ''}"></span>`
    ).join('')

    const card = document.createElement('div')
    card.className = `habit-card ${done ? 'habit-done' : ''}`
    card.innerHTML = `
      <div class="habit-card-top">
        <div class="habit-icon" style="background:${habit.color}20;color:${habit.color}">${habit.icon}</div>
        <div class="habit-info">
          <div class="habit-title">${escapeAttr(habit.title)}</div>
          ${habit.description ? `<div class="habit-desc">${escapeAttr(habit.description)}</div>` : ''}
          <div class="habit-progress">${progressDots}<span class="habit-count">${todayCount}/${habit.targetCount}</span></div>
        </div>
        <div class="habit-right">
          ${streak > 0 ? `<div class="habit-streak">🔥 ${streak}</div>` : ''}
          <div class="habit-actions">
            <button class="habit-plus" style="background:${habit.color}" ${done ? 'disabled' : ''}>+</button>
            ${todayCount > 0 ? '<button class="habit-minus">−</button>' : ''}
          </div>
          <div class="habit-card-btns">
            <button class="h-edit conv-action-btn">✏</button>
            <button class="h-del conv-action-btn conv-delete-btn">✕</button>
          </div>
        </div>
      </div>
      <div class="habit-grid">${gridDays}</div>`

    card.querySelector('.habit-plus')?.addEventListener('click', async () => {
      await logHabit(habit.id, today, todayCount + 1); await refreshData(); renderHabitsView()
    })
    card.querySelector('.habit-minus')?.addEventListener('click', async () => {
      await logHabit(habit.id, today, Math.max(0, todayCount - 1)); await refreshData(); renderHabitsView()
    })
    card.querySelector('.h-edit')!.addEventListener('click', () => { editingHabit = habit; tasksSubView = 'habit-form'; renderTasksSection() })
    card.querySelector('.h-del')!.addEventListener('click', async () => {
      if (!confirm(`Удалить привычку «${habit.title}»?`)) return
      await deleteHabit(habit.id); await refreshData(); renderTasksSection()
    })
    container.appendChild(card)
  }
}

function renderHabitForm(habit?: Habit) {
  const isEdit = !!habit?.id
  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div style="display:flex;align-items:center;gap:12px">
        <button id="hf-back" class="btn-secondary">← Назад</button>
        <h2 style="margin:0">${isEdit ? 'Редактировать привычку' : 'Новая привычка'}</h2>
      </div>
    </div>
    <form id="habit-form" class="doc-form">
      <div class="form-row">
        <div class="form-section" style="flex:0 0 80px">
          <label class="form-label">Иконка</label>
          <input id="hf-icon" placeholder="😊" value="${habit?.icon ?? '⭐'}" style="text-align:center;font-size:24px;width:64px" maxlength="2" />
        </div>
        <div class="form-section" style="flex:1">
          <label class="form-label">Название привычки</label>
          <input id="hf-title" placeholder="Например: Зарядка" value="${escapeAttr(habit?.title ?? '')}" required />
        </div>
      </div>
      <div class="form-section"><label class="form-label">Описание (необязательно)</label><input id="hf-desc" placeholder="Подробности..." value="${escapeAttr(habit?.description ?? '')}" /></div>
      <div class="form-row">
        <div class="form-section" style="flex:0 0 160px"><label class="form-label">Цель в день (раз)</label><input id="hf-target" type="number" min="1" max="100" value="${habit?.targetCount ?? 1}" /></div>
      </div>
      <div class="form-section">
        <label class="form-label">Цвет</label>
        <div class="color-picker">${PRESET_COLORS.map((c) => `<button type="button" class="color-dot ${(habit?.color ?? PRESET_COLORS[2]) === c ? 'selected' : ''}" style="background:${c}" data-color="${c}"></button>`).join('')}</div>
        <input type="hidden" id="hf-color" value="${habit?.color ?? PRESET_COLORS[2]}" />
      </div>
      <div class="form-section"><label class="form-label">Заметки</label><textarea id="hf-notes" rows="2">${escapeAttr(habit?.notes ?? '')}</textarea></div>
      <div class="form-actions">
        <button type="submit" class="btn-primary">${isEdit ? 'Сохранить' : 'Создать привычку'}</button>
        <button type="button" id="hf-cancel" class="btn-secondary">Отмена</button>
      </div>
      <p id="hf-error" class="login-error hidden"></p>
    </form>
  </section>`

  const goBack = () => { tasksSubView = 'habits'; editingHabit = null; renderTasksSection() }
  document.querySelector('#hf-back')!.addEventListener('click', goBack)
  document.querySelector('#hf-cancel')!.addEventListener('click', goBack)
  document.querySelectorAll<HTMLButtonElement>('.color-dot').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach((b) => b.classList.remove('selected'))
      btn.classList.add('selected')
      document.querySelector<HTMLInputElement>('#hf-color')!.value = btn.dataset.color!
    })
  })

  document.querySelector<HTMLFormElement>('#habit-form')!.onsubmit = async (e) => {
    e.preventDefault()
    const v = (id: string) => (document.querySelector<HTMLInputElement | HTMLTextAreaElement>(id)!).value.trim()
    try {
      const payload = { title: v('#hf-title'), description: v('#hf-desc'), icon: v('#hf-icon') || '⭐', color: v('#hf-color') || PRESET_COLORS[2], targetCount: parseInt(v('#hf-target')) || 1, notes: v('#hf-notes') }
      if (isEdit && habit?.id) await updateHabit(habit.id, payload)
      else await createHabit(payload)
      await refreshData(); goBack()
    } catch (err) {
      const el = document.querySelector<HTMLParagraphElement>('#hf-error')!
      el.textContent = err instanceof Error ? err.message : 'Ошибка'; el.classList.remove('hidden')
    }
  }
}

function renderCalendarView() {
  const container = document.querySelector<HTMLDivElement>('#tasks-content')!
  const weekStart = addDays(new Date(), calendarWeekOffset * 7 - new Date().getDay() + 1)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const dailyLimit = parseFloat(userSettings.todoRules?.dailyUnits ?? '') || 0

  const nav = `<div class="calendar-nav">
    <button id="cal-prev" class="btn-secondary">← Предыдущая</button>
    <span class="calendar-week-label">${weekStart.toLocaleDateString('ru', { day: 'numeric', month: 'long' })} – ${days[6].toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
    <button id="cal-next" class="btn-secondary">Следующая →</button>
    ${calendarWeekOffset !== 0 ? '<button id="cal-today" class="btn-secondary">Сегодня</button>' : ''}
  </div>`

  const grid = `<div class="calendar-grid">${days.map((day) => {
    const ds = dayStr(day)
    const dow = day.getDay()
    const dayRoutines = routines.filter((r) => r.daysOfWeek.includes(dow))
    const dayTasks = tasks.filter((t) => !t.done && !t.skipped && t.scheduledDate === ds)
    const routineUnits = dayRoutines.reduce((s, r) => s + r.weight, 0)
    const taskUnits = dayTasks.reduce((s, t) => s + t.weight + t.accumulation, 0)
    const units = routineUnits + taskUnits
    const isToday = ds === todayStr()
    const overLimit = dailyLimit > 0 && units > dailyLimit
    const routineChips = dayRoutines.map((r) => {
      const log = routineLogs.find((l) => l.routineId === r.id && l.date === ds)
      const dayTime = r.times?.[String(dow)] ?? r.time
      return `<div class="cal-routine-chip ${log?.status === 'done' ? 'cal-done' : log?.status === 'skipped' ? 'cal-skipped' : ''}" style="border-left:3px solid ${r.color}" data-routine-id="${r.id}" data-date="${ds}" title="${escapeAttr(r.title)}">${escapeAttr(r.title.slice(0, 16))}${r.title.length > 16 ? '…' : ''}${dayTime ? ' ' + dayTime : ''}</div>`
    }).join('')
    const taskChips = dayTasks.map((t) => `<div class="cal-task-chip task-type-flexible" data-task-id="${t.id}" title="${escapeAttr(t.title)}">${escapeAttr(t.title.slice(0, 18))}${t.title.length > 18 ? '…' : ''}</div>`).join('')
    return `<div class="calendar-day ${isToday ? 'today' : ''}">
      <div class="calendar-day-header"><span class="cal-day-name">${DAYS_SHORT[dow]}</span><span class="cal-day-num ${isToday ? 'today' : ''}">${day.getDate()}</span></div>
      ${dailyLimit ? `<div class="cal-units ${overLimit ? 'over-limit' : ''}">${units}/${dailyLimit}</div>` : units > 0 ? `<div class="cal-units">${units} ед.</div>` : ''}
      <div class="cal-tasks">${routineChips}${taskChips}</div>
      <button class="cal-add-btn" data-date="${ds}">+</button>
    </div>`
  }).join('')}</div>`

  container.innerHTML = nav + grid
  document.querySelector('#cal-prev')!.addEventListener('click', () => { calendarWeekOffset--; renderCalendarView() })
  document.querySelector('#cal-next')!.addEventListener('click', () => { calendarWeekOffset++; renderCalendarView() })
  document.querySelector('#cal-today')?.addEventListener('click', () => { calendarWeekOffset = 0; renderCalendarView() })

  // клик по рутине — меню действий
  container.querySelectorAll<HTMLElement>('.cal-routine-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation()
      const routine = routines.find((r) => r.id === chip.dataset.routineId)!
      showRoutineActionMenu(routine, chip.dataset.date!, chip)
    })
  })
  container.querySelectorAll<HTMLElement>('.cal-task-chip[data-task-id]').forEach((chip) => {
    const task = tasks.find((t) => t.id === chip.dataset.taskId)
    if (task) chip.addEventListener('click', () => { editingTask = task; tasksSubView = 'task-form'; renderTasksSection() })
  })
  container.querySelectorAll<HTMLButtonElement>('.cal-add-btn').forEach((btn) => {
    btn.addEventListener('click', () => { editingTask = { scheduledDate: btn.dataset.date } as ScheduledTask; tasksSubView = 'task-form'; renderTasksSection() })
  })
}

function renderTaskForm(task?: ScheduledTask) {
  const isEdit = !!(task?.id)
  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div style="display:flex;align-items:center;gap:12px">
        <button id="task-form-back" class="btn-secondary">← Назад</button>
        <h2 style="margin:0">${isEdit ? 'Редактировать задачу' : 'Новая задача'}</h2>
      </div>
    </div>
    <form id="task-form" class="doc-form">
      <div class="form-section"><label class="form-label">Что нужно сделать?</label>
        <input id="tf-title" placeholder="Название задачи" value="${escapeAttr(task?.title ?? '')}" required /></div>
      <div class="form-row">
        <div class="form-section" style="flex:0 0 130px"><label class="form-label">Вес (ед.)</label>
          <input id="tf-weight" type="number" min="0.5" step="0.5" value="${task?.weight ?? 1}" /></div>
        <div class="form-section" style="flex:1"><label class="form-label">При пропуске</label>
          <select id="tf-onmissed">${(['skip','accumulate','reschedule'] as OnMissed[]).map((v) => `<option value="${v}" ${(task?.onMissed ?? 'reschedule') === v ? 'selected' : ''}>${ON_MISSED_LABELS[v]}</option>`).join('')}</select></div>
      </div>
      <div class="form-row">
        <div class="form-section" style="flex:1"><label class="form-label">Запланировать на</label>
          <input id="tf-date" type="date" value="${task?.scheduledDate ?? ''}" /></div>
        <div class="form-section" style="flex:0 0 130px"><label class="form-label">Время</label>
          <input id="tf-time" type="time" value="${task?.scheduledTime ?? ''}" /></div>
        <div class="form-section" style="flex:1"><label class="form-label">Дедлайн</label>
          <input id="tf-deadline" type="date" value="${task?.deadline ?? ''}" /></div>
      </div>
      <div class="form-row">
        <div class="form-section" style="flex:1"><label class="form-label">Контекст</label>
          <input id="tf-context" placeholder="Дома, в офисе..." value="${escapeAttr(task?.context ?? '')}" /></div>
        <div class="form-section" style="flex:1"><label class="form-label">Условия</label>
          <input id="tf-conditions" placeholder="Нужен интернет..." value="${escapeAttr(task?.conditions ?? '')}" /></div>
      </div>
      <div class="form-section"><label class="form-label">Заметки</label>
        <textarea id="tf-notes" rows="2" placeholder="Детали...">${escapeAttr(task?.notes ?? '')}</textarea></div>
      <div class="form-actions">
        <button type="submit" class="btn-primary">${isEdit ? 'Сохранить' : 'Создать задачу'}</button>
        <button type="button" id="task-form-cancel" class="btn-secondary">Отмена</button>
      </div>
      <p id="task-form-error" class="login-error hidden"></p>
    </form>
  </section>`

  const goBack = () => { tasksSubView = 'tasks'; editingTask = null; renderTasksSection() }
  document.querySelector('#task-form-back')!.addEventListener('click', goBack)
  document.querySelector('#task-form-cancel')!.addEventListener('click', goBack)
  document.querySelector<HTMLFormElement>('#task-form')!.onsubmit = async (e) => {
    e.preventDefault()
    const v = (id: string) => (document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id)!).value.trim()
    const errEl = document.querySelector<HTMLParagraphElement>('#task-form-error')!
    try {
      const payload = { title: v('#tf-title'), weight: parseFloat(v('#tf-weight')) || 1, onMissed: v('#tf-onmissed') as OnMissed, scheduledDate: v('#tf-date') || undefined, scheduledTime: v('#tf-time') || undefined, deadline: v('#tf-deadline') || undefined, context: v('#tf-context'), conditions: v('#tf-conditions'), notes: v('#tf-notes'), done: false, skipped: false, accumulation: 0 }
      if (isEdit && task?.id) await updateTask(task.id, payload)
      else await createTask(payload)
      await refreshData(); goBack()
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : 'Ошибка'; errEl.classList.remove('hidden')
    }
  }
}

function renderDailyReview() {
  const targetDate = reviewTargetDate || dayStr(addDays(new Date(), -1))
  const dateLabel = new Date(targetDate + 'T12:00').toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long' })
  const dow = new Date(targetDate + 'T12:00').getDay()
  const dayTasks = tasks.filter((t) => t.scheduledDate === targetDate)
  const dayRoutines = routines.filter((r) => r.daysOfWeek.includes(dow))
  const nextDay = dayStr(addDays(new Date(targetDate + 'T12:00'), 1))
  const hasAnything = dayTasks.length > 0 || dayRoutines.length > 0

  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div style="display:flex;align-items:center;gap:12px">
        <button id="review-back" class="btn-secondary">← Назад</button>
        <div>
          <h2 style="margin:0">Итог дня</h2>
          <p class="page-subtitle" style="margin:0">${dateLabel}</p>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:13px;color:var(--muted)">Дата:</span>
        <input type="date" id="review-date-nav" class="review-date-input" value="${targetDate}" max="${todayStr()}" style="padding:6px 10px;border:1px solid var(--accent);border-radius:6px;font-size:14px;color:var(--accent);font-weight:600;background:var(--accent-soft);cursor:pointer" />
      </div>
    </div>
    ${!hasAnything ? '<p class="hint">На этот день ничего не было запланировано.</p>' : `
      ${dayRoutines.length ? `<div class="tasks-group-label">Рутины</div><div id="review-routines"></div>` : ''}
      ${dayTasks.length ? `<div class="tasks-group-label">Задачи</div><div id="review-tasks"></div>` : ''}
      <div class="form-actions" style="margin-top:20px">
        <button id="review-submit" class="btn-primary">Подтвердить итог →</button>
      </div>`}
  </section>`

  document.querySelector('#review-back')!.addEventListener('click', () => { tasksSubView = 'tasks'; renderTasksSection() })
  document.querySelector<HTMLInputElement>('#review-date-nav')!.addEventListener('change', (e) => {
    reviewTargetDate = (e.target as HTMLInputElement).value
    renderDailyReview()
  })
  if (!hasAnything) return

  type Decision = { action: 'done' | 'skip' | 'accumulate' | 'reschedule'; date?: string }
  const taskDecisions: Record<string, Decision> = {}
  const routineDecisions: Record<string, Decision> = {}

  dayTasks.forEach((t) => {
    const log = routineLogs.find((l) => l.routineId === t.id && l.date === targetDate)
    taskDecisions[t.id] = { action: t.done ? 'done' : (t.onMissed as 'done' | 'skip' | 'accumulate' | 'reschedule') || 'reschedule' }
    void log
  })
  dayRoutines.forEach((r) => {
    const log = routineLogs.find((l) => l.routineId === r.id && l.date === targetDate)
    routineDecisions[r.id] = { action: log?.status === 'done' ? 'done' : (r.onMissed as Decision['action']) || 'skip' }
  })

  const buildRow = (id: string, title: string, weight: number, dec: Decision, onDecChange: (d: Decision) => void) => {
    const row = document.createElement('div')
    row.className = 'review-row'
    const isDone = dec.action === 'done'
    row.innerHTML = `
      <div class="review-row-title">
        <label class="task-check-label"><input type="checkbox" class="rv-done-check" ${isDone ? 'checked' : ''} /></label>
        <span class="rv-title">${escapeAttr(title)}</span>
        <span class="task-weight">${weight} ед.</span>
      </div>
      <div class="review-row-actions ${isDone ? 'hidden' : ''}">
        ${(['skip','accumulate','reschedule'] as const).map((a) =>
          `<button class="rv-btn ${dec.action === a ? 'rv-active' : ''}" data-action="${a}">${{skip:'Пропустить',accumulate:'Накопить',reschedule:'Перенести'}[a]}</button>`
        ).join('')}
        ${dec.action === 'reschedule' ? `
          <input type="date" class="rv-date" value="${dec.date ?? nextDay}" />
          <button class="rv-suggest-btn" type="button">💡</button>` : ''}
      </div>`
    row.querySelector<HTMLInputElement>('.rv-done-check')!.addEventListener('change', (e) => {
      onDecChange({ action: (e.target as HTMLInputElement).checked ? 'done' : 'reschedule' })
      renderRows()
    })
    row.querySelectorAll<HTMLButtonElement>('.rv-btn[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => { onDecChange({ action: btn.dataset.action as Decision['action'] }); renderRows() })
    })
    row.querySelector<HTMLInputElement>('.rv-date')?.addEventListener('change', (e) => {
      dec.date = (e.target as HTMLInputElement).value
    })
    row.querySelector<HTMLButtonElement>('.rv-suggest-btn')?.addEventListener('click', () => {
      const routine = routines.find((x) => x.id === id)
      const suggestions = routine ? suggestRescheduleDates(routine, targetDate, 3) : [{ date: nextDay }, { date: dayStr(addDays(new Date(targetDate+'T12:00'), 2)) }]
      const menu = document.createElement('div')
      menu.className = 'routine-action-menu'
      const btn = row.querySelector<HTMLButtonElement>('.rv-suggest-btn')!
      const rect = btn.getBoundingClientRect()
      menu.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;z-index:300`
      menu.innerHTML = suggestions.map((s) => `<button class="rma-btn" data-date="${s.date}">${new Date(s.date+'T12:00').toLocaleDateString('ru',{weekday:'short',day:'numeric',month:'short'})}</button>`).join('')
      document.body.appendChild(menu)
      menu.querySelectorAll<HTMLButtonElement>('[data-date]').forEach((b) => {
        b.addEventListener('click', () => {
          onDecChange({ action: 'reschedule', date: b.dataset.date }); menu.remove(); renderRows()
        })
      })
      setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 50)
    })
    return row
  }

  const renderRows = () => {
    const rList = document.querySelector<HTMLDivElement>('#review-routines')
    const tList = document.querySelector<HTMLDivElement>('#review-tasks')
    if (rList) {
      rList.innerHTML = ''
      dayRoutines.forEach((r) => rList.appendChild(buildRow(r.id, r.title, r.weight, routineDecisions[r.id], (d) => { routineDecisions[r.id] = d })))
    }
    if (tList) {
      tList.innerHTML = ''
      dayTasks.forEach((t) => tList.appendChild(buildRow(t.id, t.title, t.weight, taskDecisions[t.id], (d) => { taskDecisions[t.id] = d })))
    }
  }
  renderRows()

  document.querySelector('#review-submit')!.addEventListener('click', async () => {
    // обработка задач
    for (const task of dayTasks) {
      const dec = taskDecisions[task.id]
      if (dec.action === 'done') await updateTask(task.id, { done: true })
      else if (dec.action === 'skip') await updateTask(task.id, { skipped: true })
      else if (dec.action === 'accumulate') await updateTask(task.id, { scheduledDate: nextDay, accumulation: task.accumulation + task.weight, skipped: false })
      else if (dec.action === 'reschedule') await updateTask(task.id, { scheduledDate: dec.date || nextDay, done: false, skipped: false })
    }
    // обработка рутин
    for (const r of dayRoutines) {
      const dec = routineDecisions[r.id]
      const existLog = routineLogs.find((l) => l.routineId === r.id && l.date === targetDate)
      if (dec.action === 'done') {
        if (!existLog) await logRoutine(r.id, targetDate, 'done')
      } else if (dec.action === 'skip') {
        if (!existLog) await logRoutine(r.id, targetDate, 'skipped')
      } else if (dec.action === 'reschedule') {
        if (!existLog) await logRoutine(r.id, targetDate, 'skipped')
        await createTask({ title: r.title + ' ↷', weight: r.weight, context: r.context, conditions: '', scheduledDate: dec.date || nextDay, scheduledTime: r.times?.[String(dow)] ?? r.time, onMissed: 'skip', accumulation: 0, done: false, skipped: false, notes: `Перенос с ${targetDate}` })
      } else if (dec.action === 'accumulate') {
        if (!existLog) await logRoutine(r.id, targetDate, 'skipped')
        await createTask({ title: r.title + ' ↷', weight: r.weight * 2, context: r.context, conditions: '', scheduledDate: nextDay, onMissed: 'skip', accumulation: r.weight, done: false, skipped: false, notes: `Накопление с ${targetDate}` })
      }
    }
    await refreshData()
    tasksSubView = 'calendar'
    renderTasksSection()
  })
}

// ===================== END TASKS =====================

// ===================== INSTRUCTIONS =====================

function renderInstructions() {
  if (instructionSubView === 'add' || instructionSubView === 'edit') { renderInstructionForm(activeInstruction ?? undefined); return }
  if (instructionSubView === 'view' && activeInstruction) { renderInstructionView(activeInstruction); return }
  renderInstructionsList()
}

function renderInstructionsList() {
  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div><h2>Инструкции</h2><p class="page-subtitle">Пошаговые руководства · Всего: ${instructions.length}</p></div>
      <button id="add-instruction-btn" class="btn-primary">+ Добавить инструкцию</button>
    </div>
    <div id="instructions-list" class="instructions-list"></div>
  </section>`
  document.querySelector<HTMLButtonElement>('#add-instruction-btn')!.onclick = () => {
    instructionSubView = 'add'; activeInstruction = null; renderInstructions()
  }
  const list = document.querySelector<HTMLDivElement>('#instructions-list')!
  if (instructions.length === 0) {
    list.innerHTML = '<p class="hint">Инструкций пока нет. Создайте первую!</p>'; return
  }
  for (const instr of instructions) {
    const card = document.createElement('article')
    card.className = 'instruction-card'
    const tagsHtml = instr.tags.length ? instr.tags.map((t) => `<span class="tag-chip tag-chip-sm">${escapeAttr(t)}</span>`).join('') : ''
    card.innerHTML = `
      <div class="instruction-card-header">
        <div class="instruction-card-title">${escapeAttr(instr.title)}</div>
        <div class="instruction-card-meta">${instr.steps.length} шаг${instr.steps.length === 1 ? '' : instr.steps.length < 5 ? 'а' : 'ов'}</div>
      </div>
      ${tagsHtml ? `<div class="doc-tags">${tagsHtml}</div>` : ''}
      <div class="instruction-card-preview">${escapeAttr(instr.steps[0]?.text.slice(0, 100) ?? '')}${(instr.steps[0]?.text.length ?? 0) > 100 ? '...' : ''}</div>
      <div class="doc-card-actions">
        <button class="instr-view-btn btn-primary">👁 Просмотр</button>
        <button class="instr-edit-btn btn-secondary">✏️ Редактировать</button>
        <button class="instr-pdf-btn btn-secondary">📄 PDF</button>
        <button class="instr-delete-btn btn-secondary btn-danger">🗑</button>
      </div>`
    card.querySelector('.instr-view-btn')!.addEventListener('click', () => { activeInstruction = instr; instructionSubView = 'view'; renderInstructions() })
    card.querySelector('.instr-edit-btn')!.addEventListener('click', () => { activeInstruction = instr; instructionSubView = 'edit'; renderInstructions() })
    card.querySelector('.instr-pdf-btn')!.addEventListener('click', () => downloadInstructionPdf(instr))
    card.querySelector('.instr-delete-btn')!.addEventListener('click', async () => {
      if (!confirm(`Удалить инструкцию «${instr.title}»?`)) return
      await deleteInstruction(instr.id); await refreshData(); renderInstructions()
    })
    list.appendChild(card)
  }
}

function renderInstructionView(instr: Instruction) {
  const tagsHtml = instr.tags.length ? instr.tags.map((t) => `<span class="tag-chip tag-chip-sm">${escapeAttr(t)}</span>`).join('') : ''
  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div style="display:flex;align-items:center;gap:12px;">
        <button id="instr-back" class="btn-secondary">← Назад</button>
        <div><h2 style="margin:0">${escapeAttr(instr.title)}</h2>${tagsHtml ? `<div class="doc-tags" style="margin-top:4px">${tagsHtml}</div>` : ''}</div>
      </div>
      <div style="display:flex;gap:8px">
        <button id="instr-edit-view" class="btn-secondary">✏️ Редактировать</button>
        <button id="instr-pdf-view" class="btn-secondary">📄 Скачать PDF</button>
      </div>
    </div>
    <div id="instr-steps-view" class="instr-steps-view"></div>
  </section>`
  document.querySelector('#instr-back')!.addEventListener('click', () => { instructionSubView = 'list'; activeInstruction = null; renderInstructions() })
  document.querySelector('#instr-edit-view')!.addEventListener('click', () => { instructionSubView = 'edit'; renderInstructions() })
  document.querySelector('#instr-pdf-view')!.addEventListener('click', () => downloadInstructionPdf(instr))
  const stepsEl = document.querySelector<HTMLDivElement>('#instr-steps-view')!
  if (instr.steps.length === 0) { stepsEl.innerHTML = '<p class="hint">Шагов нет.</p>'; return }
  instr.steps.forEach((step, i) => {
    const div = document.createElement('div')
    div.className = 'instr-step-view'
    div.innerHTML = `
      <div class="instr-step-number">Шаг ${i + 1}</div>
      <div class="instr-step-text">${escapeAttr(step.text).replace(/\n/g, '<br>')}</div>
      ${step.imageDataUrl ? `<img class="instr-step-img" src="${step.imageDataUrl}" alt="Фото шага" title="Нажмите для просмотра" />` : ''}
      ${step.attachmentName ? `<div class="instr-step-file"><a class="instr-file-link" href="${step.attachmentDataUrl}" download="${escapeAttr(step.attachmentName)}">📎 ${escapeAttr(step.attachmentName)}</a></div>` : ''}`
    if (step.imageDataUrl) div.querySelector<HTMLImageElement>('.instr-step-img')!.onclick = () => openImageFullscreen(step.imageDataUrl!)
    stepsEl.appendChild(div)
  })
}

function renderInstructionForm(instr?: Instruction) {
  const isEdit = !!instr
  let formTags: string[] = [...(instr?.tags ?? [])]
  let formSteps: Array<{ id: string; text: string; imageDataUrl?: string; attachmentName?: string; attachmentDataUrl?: string }> =
    instr ? instr.steps.map((s) => ({ ...s })) : [{ id: createId(), text: '' }]

  contentRoot.innerHTML = `<section class="documents">
    <div class="page-header-row">
      <div style="display:flex;align-items:center;gap:12px;">
        <button id="instr-form-back" class="btn-secondary">← Назад</button>
        <h2 style="margin:0">${isEdit ? 'Редактировать инструкцию' : 'Новая инструкция'}</h2>
      </div>
    </div>
    <form id="instr-form" class="doc-form">
      <div class="form-section">
        <label class="form-label">Название инструкции</label>
        <input id="instr-title" placeholder="Например: Как оформить ОСАГО" value="${escapeAttr(instr?.title ?? '')}" required />
      </div>
      <div class="form-section">
        <label class="form-label">Теги</label>
        <div class="tags-editor">
          <div id="instr-tags-chips" class="tags-chips"></div>
          <input id="instr-tags-input" class="tags-input" placeholder="Введите тег и нажмите Enter или запятую" />
        </div>
      </div>
      <div class="form-section">
        <label class="form-label">Шаги</label>
        <div id="instr-steps-editor" class="instr-steps-editor"></div>
        <button id="add-step-btn" type="button" class="add-field-btn" style="margin-top:8px">+ Добавить шаг</button>
      </div>
      <div class="form-actions">
        <button type="submit" class="btn-primary">${isEdit ? 'Сохранить изменения' : 'Создать инструкцию'}</button>
        <button type="button" id="instr-cancel" class="btn-secondary">Отмена</button>
      </div>
      <p id="instr-error" class="login-error hidden"></p>
    </form>
  </section>`

  const goBack = () => { instructionSubView = isEdit ? 'view' : 'list'; renderInstructions() }
  document.querySelector('#instr-form-back')!.addEventListener('click', goBack)
  document.querySelector('#instr-cancel')!.addEventListener('click', goBack)

  // теги
  const tagsChipsEl = document.querySelector<HTMLDivElement>('#instr-tags-chips')!
  const refreshTags = () => {
    tagsChipsEl.innerHTML = formTags.map((t) => `<span class="tag-chip">${escapeAttr(t)}<button type="button" class="tag-chip-remove" data-tag="${escapeAttr(t)}">✕</button></span>`).join('')
    tagsChipsEl.querySelectorAll<HTMLButtonElement>('.tag-chip-remove').forEach((btn) => {
      btn.onclick = () => { formTags = formTags.filter((t) => t !== btn.dataset.tag); refreshTags() }
    })
  }
  refreshTags()
  document.querySelector<HTMLInputElement>('#instr-tags-input')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const val = (e.target as HTMLInputElement).value.trim().replace(/,+$/, '')
      if (val && !formTags.includes(val)) { formTags.push(val); refreshTags() }
      ;(e.target as HTMLInputElement).value = ''
    }
  })

  // редактор шагов
  const stepsEditor = document.querySelector<HTMLDivElement>('#instr-steps-editor')!
  const renderStepEditors = () => {
    stepsEditor.innerHTML = ''
    formSteps.forEach((step, i) => {
      const div = document.createElement('div')
      div.className = 'instr-step-edit'
      div.dataset.stepId = step.id
      div.innerHTML = `
        <div class="instr-step-edit-header">
          <span class="instr-step-num">Шаг ${i + 1}</span>
          <div style="display:flex;gap:4px">
            ${i > 0 ? `<button type="button" class="step-move-up conv-action-btn" title="Вверх">↑</button>` : ''}
            ${i < formSteps.length - 1 ? `<button type="button" class="step-move-down conv-action-btn" title="Вниз">↓</button>` : ''}
            <button type="button" class="step-remove conv-action-btn conv-delete-btn" title="Удалить шаг">✕</button>
          </div>
        </div>
        <textarea class="step-text-input" placeholder="Текст шага..." rows="3">${escapeAttr(step.text)}</textarea>
        <div class="step-attachments">
          <div class="step-drop-zone ${step.imageDataUrl ? 'has-image' : ''}" data-step="${step.id}">
            ${step.imageDataUrl ? `<img class="step-preview-img" src="${step.imageDataUrl}" alt="фото" /><button type="button" class="step-img-remove">✕ убрать фото</button>` : `<span class="drop-hint">📷 Перетащите фото или нажмите</span>`}
            <input type="file" class="step-img-input" accept="image/*" style="display:none" />
          </div>
          <div class="step-file-area">
            ${step.attachmentName ? `<span class="step-file-name">📎 ${escapeAttr(step.attachmentName)}<button type="button" class="step-file-remove">✕</button></span>` : `<label class="step-file-label">📎 Прикрепить файл<input type="file" class="step-file-input" style="display:none" /></label>`}
          </div>
        </div>`
      // обновляем данные шага при изменении textarea
      div.querySelector<HTMLTextAreaElement>('.step-text-input')!.addEventListener('input', (e) => {
        const s = formSteps.find((x) => x.id === step.id); if (s) s.text = (e.target as HTMLTextAreaElement).value
      })
      // фото шага
      const dropZone = div.querySelector<HTMLDivElement>('.step-drop-zone')!
      const imgInput = div.querySelector<HTMLInputElement>('.step-img-input')!
      const handleStepImg = async (file: File | undefined) => {
        if (!file?.type.startsWith('image/')) return
        const url = await readAsDataUrl(file)
        const s = formSteps.find((x) => x.id === step.id); if (s) s.imageDataUrl = url
        renderStepEditors()
      }
      dropZone.addEventListener('click', (e) => { if ((e.target as HTMLElement).classList.contains('step-img-remove')) return; imgInput.click() })
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over') })
      dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
      dropZone.addEventListener('drop', async (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); await handleStepImg(e.dataTransfer?.files?.[0]) })
      imgInput.onchange = (e) => handleStepImg((e.target as HTMLInputElement).files?.[0])
      div.querySelector<HTMLButtonElement>('.step-img-remove')?.addEventListener('click', () => {
        const s = formSteps.find((x) => x.id === step.id); if (s) s.imageDataUrl = undefined; renderStepEditors()
      })
      // файл шага
      const fileInput = div.querySelector<HTMLInputElement>('.step-file-input')
      fileInput?.addEventListener('change', async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return
        const dataUrl = await readAsDataUrl(file)
        const s = formSteps.find((x) => x.id === step.id)
        if (s) { s.attachmentName = file.name; s.attachmentDataUrl = dataUrl }
        renderStepEditors()
      })
      div.querySelector<HTMLButtonElement>('.step-file-remove')?.addEventListener('click', () => {
        const s = formSteps.find((x) => x.id === step.id)
        if (s) { s.attachmentName = undefined; s.attachmentDataUrl = undefined }
        renderStepEditors()
      })
      // перемещение/удаление
      div.querySelector<HTMLButtonElement>('.step-move-up')?.addEventListener('click', () => {
        const idx = formSteps.findIndex((x) => x.id === step.id)
        if (idx > 0) { [formSteps[idx - 1], formSteps[idx]] = [formSteps[idx], formSteps[idx - 1]]; renderStepEditors() }
      })
      div.querySelector<HTMLButtonElement>('.step-move-down')?.addEventListener('click', () => {
        const idx = formSteps.findIndex((x) => x.id === step.id)
        if (idx < formSteps.length - 1) { [formSteps[idx], formSteps[idx + 1]] = [formSteps[idx + 1], formSteps[idx]]; renderStepEditors() }
      })
      div.querySelector<HTMLButtonElement>('.step-remove')?.addEventListener('click', () => {
        if (formSteps.length === 1) return
        formSteps = formSteps.filter((x) => x.id !== step.id); renderStepEditors()
      })
      stepsEditor.appendChild(div)
    })
  }
  renderStepEditors()

  document.querySelector<HTMLButtonElement>('#add-step-btn')!.onclick = () => {
    formSteps.push({ id: createId(), text: '' }); renderStepEditors()
    stepsEditor.lastElementChild?.scrollIntoView({ behavior: 'smooth' })
  }

  // сабмит
  document.querySelector<HTMLFormElement>('#instr-form')!.onsubmit = async (e) => {
    e.preventDefault()
    const title = document.querySelector<HTMLInputElement>('#instr-title')!.value.trim()
    const errEl = document.querySelector<HTMLParagraphElement>('#instr-error')!
    const validSteps = formSteps.filter((s) => s.text.trim()) as InstructionStep[]
    if (!validSteps.length) { errEl.textContent = 'Добавьте хотя бы один шаг'; errEl.classList.remove('hidden'); return }
    try {
      if (isEdit && instr) {
        activeInstruction = await updateInstruction(instr.id, { title, tags: formTags, steps: validSteps })
      } else {
        activeInstruction = await createInstruction({ title, tags: formTags, steps: validSteps })
      }
      await refreshData()
      instructionSubView = 'view'
      renderInstructions()
    } catch (err) {
      errEl.textContent = err instanceof Error ? err.message : 'Ошибка сохранения'
      errEl.classList.remove('hidden')
    }
  }
}

function downloadInstructionPdf(instr: Instruction) {
  const win = window.open('', '_blank')
  if (!win) return
  const stepsHtml = instr.steps.map((step, i) => `
    <div class="step">
      <div class="step-num">Шаг ${i + 1}</div>
      <div class="step-text">${escapeAttr(step.text).replace(/\n/g, '<br>')}</div>
      ${step.imageDataUrl ? `<img class="step-img" src="${step.imageDataUrl}" alt="Фото" />` : ''}
      ${step.attachmentName ? `<div class="step-file">📎 ${escapeAttr(step.attachmentName)}</div>` : ''}
    </div>`).join('')
  const tagsHtml = instr.tags.length ? `<div class="tags">${instr.tags.map((t) => `<span class="tag">${escapeAttr(t)}</span>`).join('')}</div>` : ''
  win.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${escapeAttr(instr.title)}</title><style>
    body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:32px;color:#1e293b;max-width:800px;margin:0 auto}
    h1{font-size:26px;font-weight:700;margin:0 0 8px;color:#1e293b}
    .tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}
    .tag{background:#ede9fe;color:#4f46e5;padding:3px 10px;border-radius:99px;font-size:12px;font-weight:500}
    .meta{color:#64748b;font-size:13px;margin-bottom:24px}
    .step{margin-bottom:24px;padding:16px 20px;border:1px solid #e2e8f0;border-radius:12px;page-break-inside:avoid}
    .step-num{font-size:12px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
    .step-text{font-size:15px;line-height:1.6;white-space:pre-wrap}
    .step-img{max-width:100%;max-height:400px;border-radius:8px;margin-top:12px;border:1px solid #e2e8f0;display:block}
    .step-file{margin-top:8px;color:#64748b;font-size:13px}
    @media print{body{padding:16px}.step{page-break-inside:avoid}}
  </style></head><body>
    <h1>${escapeAttr(instr.title)}</h1>
    ${tagsHtml}
    <div class="meta">${instr.steps.length} шаг${instr.steps.length === 1 ? '' : instr.steps.length < 5 ? 'а' : 'ов'} · ${new Date(instr.createdAt).toLocaleDateString('ru')}</div>
    ${stepsHtml}
    <script>window.onload=()=>{window.print()}<\/script>
  </body></html>`)
  win.document.close()
}

// ===================== END INSTRUCTIONS =====================

function renderTagChips() {
  const container = document.querySelector<HTMLDivElement>('#tags-chips')
  if (!container) return
  container.innerHTML = ''
  for (const tag of docTags) {
    const chip = document.createElement('span')
    chip.className = 'tag-chip'
    chip.innerHTML = `${escapeAttr(tag)}<button type="button" class="tag-chip-remove" data-tag="${escapeAttr(tag)}">✕</button>`
    chip.querySelector('button')!.onclick = () => {
      docTags = docTags.filter((t) => t !== tag)
      renderTagChips()
    }
    container.appendChild(chip)
  }
}

function collectFields(): Record<string, string> {
  const result: Record<string, string> = {}
  document.querySelectorAll<HTMLDivElement>('.field-row').forEach((row) => {
    const key = row.querySelector<HTMLInputElement>('.field-key')!.value.trim()
    const value = row.querySelector<HTMLInputElement>('.field-value')!.value.trim()
    if (key) result[key] = value
  })
  return result
}

function escapeAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderTodos() {
  const active = todos.filter((t) => !t.done)
  const done = todos.filter((t) => t.done)
  contentRoot.innerHTML = `<section class="todos">
    <div class="page-header-row">
      <div><h2>Список дел</h2><p class="page-subtitle">Активных: ${active.length}${done.length > 0 ? ` · Выполнено: ${done.length}` : ''}</p></div>
      <button id="refresh-reminders" class="btn-secondary">🔄 Обновить</button>
    </div>
    ${active.length > 0 ? '<div class="todos-section-label">Активные</div>' : ''}
    <div id="todo-list-active"></div>
    ${done.length > 0 ? '<div class="todos-section-label">Выполненные</div>' : ''}
    <div id="todo-list-done"></div>
  </section>`
  document.querySelector<HTMLButtonElement>('#refresh-reminders')!.addEventListener('click', () => runRemindersAndNotify())
  if (todos.length === 0) {
    document.querySelector<HTMLDivElement>('#todo-list-active')!.innerHTML = '<p class="hint">Дел пока нет. Добавьте документ со сроком — и система напомнит о нём.</p>'
    return
  }
  const renderList = (list: HTMLElement, items: TodoItem[]) => {
    for (const todo of items) renderTodoRow(list, todo)
  }
  renderList(document.querySelector<HTMLDivElement>('#todo-list-active')!, active)
  renderList(document.querySelector<HTMLDivElement>('#todo-list-done')!, done)
}

function renderTodoRow(list: HTMLElement, todo: TodoItem) {
  const row = document.createElement('label')
  row.className = `todo-row${todo.done ? ' done' : ''}`
  row.innerHTML = `<input type="checkbox" ${todo.done ? 'checked' : ''}/><div class="todo-body"><div class="todo-text">${escapeAttr(todo.text)}</div><div class="todo-date">до ${todo.dueDate}</div></div>`
  row.querySelector('input')!.addEventListener('change', async (e) => {
    const checked = (e.target as HTMLInputElement).checked
    await setTodoDone(todo.id, checked)
    await refreshData()
    renderTodos()
    if (checked && todo.documentId) {
      const doc = documents.find((d) => d.id === todo.documentId)
      if (doc) suggestDocumentUpdate(doc)
    }
  })
  list.appendChild(row)
}

async function refreshData() {
  try {
    const startDate = dayStr(addDays(new Date(), -30))
  ;[documents, todos, instructions, tasks, routines, routineLogs, habits, habitLogs] = await Promise.all([listDocuments(), listTodos(), listInstructions(), listTasks(), listRoutines(), listRoutineLogs(startDate), listHabits(), listHabitLogs(startDate)])
  } catch {
    documents = []
    todos = []; tasks = []; routines = []; routineLogs = []; habits = []; habitLogs = []
    instructions = []
  }
}

function createConversation(title: string): Conversation {
  const c: Conversation = { id: createId(), title, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }
  state.conversations.unshift(c); state.activeConversationId = c.id; persist(); return c
}
function getActiveConversation() { return state.conversations.find((c) => c.id === state.activeConversationId) }
function persistAndRender() { persist(); render() }
function persist() { repository.save(state) }
function createId() { return `${Date.now()}-${Math.random().toString(16).slice(2)}` }
async function getFilePreview(file: File) { return file.type.startsWith('text/') ? `[Содержимое файла]:\n${(await file.text()).slice(0, 4000)}` : '[Бинарный файл]' }
async function getImageDataUrl(file: File | undefined) { if (!file?.type.startsWith('image/')) return undefined; return new Promise<string>((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsDataURL(file) }) }

function openImageFullscreen(src: string) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(`<!DOCTYPE html><html><head><title>Фото документа</title><style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh;}img{max-width:100%;max-height:100vh;object-fit:contain;}</style></head><body><img src="${src}" /></body></html>`)
  win.document.close()
}

function buildDocumentSystemPrompt(): string {
  if (documents.length === 0 && todos.length === 0 && tasks.length === 0) return `Ты — Chief of Staff пользователя. СЕГОДНЯ: ${todayStr()}. Общайся на «ты», лаконично, без канцелярита. Данных в базе пока нет.`
  const docLines = documents.map((d) => {
    const fields = Object.entries(d.fields ?? {}).map(([k, v]) => `    ${k}: ${v}`).join('\n')
    return [
      `- ${d.title} (${d.docType})`,
      (d.tags ?? []).length > 0 ? `  Теги: ${d.tags!.join(', ')}` : '',
      d.expiresAt ? `  Срок действия: ${d.expiresAt}` : '',
      d.notifyEnabled ? `  Уведомление: за ${d.notifyBeforeDays} дн.` : '',
      fields ? `  Поля:\n${fields}` : '',
      d.imageDataUrl ? '  Фото: есть' : ''
    ].filter(Boolean).join('\n')
  }).join('\n\n')
  const todoLines = todos.filter((t) => !t.done).map((t) => `- ${t.text} (до ${t.dueDate})`).join('\n')
  const instrLines = instructions.map((instr) => {
    const steps = instr.steps.map((s, i) => `  Шаг ${i + 1}: ${s.text}`).join('\n')
    return [`📋 ${instr.title}${instr.tags.length ? ` [${instr.tags.join(', ')}]` : ''}`, steps].filter(Boolean).join('\n')
  }).join('\n\n')

  const tr = userSettings.todoRules
  const todoRulesText = tr && Object.values(tr).some(Boolean) ? [
    'ПРАВИЛА СПИСКА ДЕЛ ПОЛЬЗОВАТЕЛЯ:',
    tr.sources ? `Откуда берутся дела: ${tr.sources}` : '',
    tr.trackedParams ? `Параметры для отслеживания: ${tr.trackedParams}` : '',
    tr.dailyUnits ? `Норма в день: ${tr.dailyUnits}` : '',
    tr.easyTasks ? `Что легко: ${tr.easyTasks}` : '',
    tr.hardTasks ? `Что сложно: ${tr.hardTasks}` : '',
    tr.general ? `Общее: ${tr.general}` : ''
  ].filter(Boolean).join('\n') : ''

  return [
    `СЕГОДНЯ: ${todayStr()} (${new Date().toLocaleDateString('ru', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}). Используй эту дату для всех расчётов K и срочности. Не используй никакую другую дату как "сегодня".

РОЛЬ: Ты — Chief of Staff (руководитель аппарата). Твоя задача — фильтровать шум и управлять вниманием пользователя. Ты не просто хранишь данные — ты оцениваешь их значимость в контексте времени и ситуации. Общайся на «ты», лаконично, по-человечески, без канцелярита.

ПРИНЦИП СРОЧНОСТИ: перед ответом рассчитай K = (остаток) / (весь срок).
• K < 10% или < 7 дней → КРИТИЧЕСКИЙ: выноси в начало жирным, описывай подробно.
• K 10–25% → ПРЕДУПРЕЖДЕНИЕ: одна короткая строка, без деталей.
• K > 25% → МОЛЧАНИЕ: не упоминай. Если всё остальное в норме — добавь в конце: «Остальное в порядке».

ПРАВИЛА КОММУНИКАЦИИ:
• Не упоминай бессрочные документы, если вопрос не про «собрать пакет документов».
• Игнорируй архивные/списанные объекты — исключи их из ответа полностью.
• Не пиши «у тебя есть запись о...», «судя по названию...», «в поле...», «согласно базе». Говори как человек: «твой паспорт», «страховка», «визит к врачу».
• Не вставляй UUID, внутренние id, технические пути.
• Разные люди: не переноси факты между разными владельцами/ФИО даже при схожей теме.

АЛГОРИТМ РАБОТЫ:
1. Анализ: какая дата? Что активно в переданном контексте?
2. Фильтрация: что требует внимания сейчас (K-критерий, не архив)?
3. Синтез: сначала критические дедлайны → краткий статус активного → один проактивный совет «заодно».

РЕЖИМЫ:
• Факты → только результат анализа.
• Брейншторм → спарринг-партнёр, используй знание ресурсов пользователя для оценки реалистичности.
• Инструкция → выдавай шаги порционно.

СЛУЖЕБНОЕ: не утверждай, что других документов нет (контекст может быть неполным). Если данных недостаточно — скажи кратко, чего не хватает.`,
    todoRulesText,
    'ДОКУМЕНТЫ ПОЛЬЗОВАТЕЛЯ:',
    docLines || 'нет',
    todoLines ? `АКТИВНЫЕ НАПОМИНАНИЯ:\n${todoLines}` : '',
    instrLines ? `ИНСТРУКЦИИ (${instructions.length}):\n${instrLines}` : '',
    buildTasksContext(),
    `ПРАВИЛА:
- Инструкции: разбирай шаги с пояснениями. Если нужны документы — показывай их данные.
- Фото документа уже показывается в интерфейсе. Не говори что не можешь показать. Не пиши markdown ![](). Скажи "Вот фото:" и опиши.

КОГДА ДОБАВЛЯТЬ БЛОКИ В КОНЕЦ ОТВЕТА:

▶ РУТИНА — если дело ПОВТОРЯЕТСЯ регулярно (каждую неделю, по дням недели):
[ROUTINE]{"title":"...","daysOfWeek":[3,0],"times":{"3":"18:00","0":"14:00"},"weight":2,"context":"...","color":"#4f46e5","onMissed":"skip","notes":"..."}[/ROUTINE]
daysOfWeek числа: 0=вс,1=пн,2=вт,3=ср,4=чт,5=пт,6=сб
times — объект вида {"день":"время"} — используй когда у разных дней разное время.
Если время одинаковое для всех дней — используй поле "time" вместо "times".
ВАЖНО: ВСЕ дни в ОДНОМ блоке! "Среда 18:00 и воскресенье 14:00" = daysOfWeek:[3,0], times:{"3":"18:00","0":"14:00"}. НЕ создавай 2 блока!

▶ ЗАДАЧА — если дело ОДНОРАЗОВОЕ (с дедлайном, без повторения):
[TASK]{"title":"...","weight":1,"context":"...","conditions":"...","deadline":"YYYY-MM-DD или пусто","scheduledDate":"YYYY-MM-DD или пусто","scheduledTime":"HH:MM или пусто","onMissed":"reschedule","notes":"..."}[/TASK]

▶ ПРИВЫЧКА — если ежедневная практика для трекинга серий (зарядка, вода, чтение):
[HABIT]{"title":"...","description":"...","icon":"😊","color":"#10b981","targetCount":1,"notes":"..."}[/HABIT]

Если информации недостаточно — уточни, не добавляй блок. Если просто разговор — не добавляй блоки.`
  ].filter(Boolean).join('\n\n')
}

function buildTasksContext(): string {
  if (tasks.length === 0) return ''
  const today = new Date().toISOString().slice(0, 10)
  const todayTasks = tasks.filter((t) => t.scheduledDate === today && !t.done && !t.skipped)
  const backlog = tasks.filter((t) => !t.scheduledDate && !t.done && !t.skipped)
  const lines: string[] = ['ЗАДАЧИ:']
  if (todayTasks.length) lines.push(`Сегодня (${today}):\n${todayTasks.map((t) => `  - ${t.title} [${t.type}, ${t.weight} ед.${t.deadline ? ', до ' + t.deadline : ''}]`).join('\n')}`)
  if (backlog.length) lines.push(`Бэклог (${backlog.length}):\n${backlog.slice(0, 8).map((t) => `  - ${t.title}${t.deadline ? ' [до ' + t.deadline + ']' : ''}`).join('\n')}`)
  return lines.join('\n')
}

function findDocumentImage(text: string): string | undefined {
  const lower = text.toLowerCase()
  const photoKeywords = ['фото', 'покажи', 'картинк', 'изображени', 'скан', 'фотограф', 'photo', 'image']

  // сначала пробуем найти по названию документа
  for (const doc of documents) {
    if (doc.imageDataUrl && lower.includes(doc.title.toLowerCase())) return doc.imageDataUrl
  }

  // если просят фото без указания документа — берём первый документ с фото
  const hasPhotoRequest = photoKeywords.some((kw) => lower.includes(kw))
  if (hasPhotoRequest) {
    const withPhoto = documents.filter((d) => d.imageDataUrl)
    if (withPhoto.length > 0) return withPhoto[0].imageDataUrl
  }

  return undefined
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })

function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

async function runRemindersAndNotify() {
  try {
    const newTodos = await runReminders()
    await refreshData()
    if (newTodos.length > 0) {
      for (const todo of newTodos) {
        addNotification(todo.text)
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Напоминание', { body: todo.text, icon: '/pwa-icon.svg' })
        }
      }
    }
    if (activeTab === 'todos') renderTodos()
    if (activeTab === 'notifications') renderNotifications()
  } catch {
    // сеть недоступна — игнорируем
  }
}
