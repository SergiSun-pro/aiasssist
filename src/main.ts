import './style.css'
import { filesToImageDataUrls, readAsDataUrl } from './pdfUtils'
import { clearToken, createUser, deleteUser, fetchUsers, getCurrentUser, login } from './auth'
import type { AuthUser } from './auth'
import { createDocument, deleteDocument, extractDocument, listDocuments, listTodos, runReminders, setTodoDone, updateDocument } from './documentsApi'
import { createInstruction, deleteInstruction, listInstructions, updateInstruction } from './instructionsApi'
import { getSettings, saveSettings } from './settingsApi'
import type { UserSettings } from './settingsApi'
import { requestOpenRouterCompletion } from './openrouter'
import { LocalConversationsRepository } from './storage'
import type { AppNotification, AppState, ChatMessage, Conversation, DocumentRecord, Instruction, InstructionStep, TodoItem } from './types'

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
let activeTab: 'chat' | 'documents' | 'todos' | 'base' | 'notifications' | 'users' | 'instructions' = 'chat'
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

function setTab(tab: 'chat' | 'documents' | 'todos' | 'base' | 'notifications' | 'users' | 'instructions') {
  activeTab = tab
  document.querySelectorAll('.nav-tab').forEach((el) => el.classList.remove('active'))
  const tabId = tab === 'documents' ? 'docs' : tab
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
    item.querySelector('pre')!.textContent = m.content
    messagesEl.appendChild(item)
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
      currentConversation.messages.push({ id: createId(), role: 'assistant', content: reply, createdAt: Date.now(), model: getCurrentModel() })
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
    ;[documents, todos, instructions] = await Promise.all([listDocuments(), listTodos(), listInstructions()])
  } catch {
    documents = []
    todos = []
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
  if (documents.length === 0 && todos.length === 0) return 'Ты персональный ассистент. Документов пока нет.'
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
    'Ты персональный ассистент.',
    todoRulesText,
    'ДОКУМЕНТЫ ПОЛЬЗОВАТЕЛЯ:',
    docLines || 'нет',
    todoLines ? `АКТИВНЫЕ НАПОМИНАНИЯ:\n${todoLines}` : '',
    instrLines ? `ИНСТРУКЦИИ ПОЛЬЗОВАТЕЛЯ (${instructions.length}):\n${instrLines}` : '',
    'ПРАВИЛА:\n- Когда спрашивают об инструкции — излагай шаги последовательно или все сразу в зависимости от контекста. Анализируй и объясняй, не просто воспроизводи текст.\n- Если в инструкции нужны документы — показывай их данные из списка выше.\n- Фото документа уже отображается в интерфейсе. Не говори что не можешь показать фото. Не пиши markdown ![](). Просто скажи "Вот фото:" и опиши содержимое.'
  ].filter(Boolean).join('\n\n')
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
