import './style.css'
import { clearToken, createUser, deleteUser, fetchUsers, getCurrentUser, login } from './auth'
import type { AuthUser } from './auth'
import { createDocument, extractDocument, listDocuments, listTodos, runReminders, setTodoDone } from './documentsApi'
import { requestOpenRouterCompletion } from './openrouter'
import { LocalConversationsRepository } from './storage'
import type { AppNotification, AppState, ChatMessage, Conversation, DocumentRecord, TodoItem } from './types'

const DEFAULT_MODELS = ['openai/gpt-4.1-mini', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat-v3-0324']
const VISION_MODELS = ['openai/gpt-4.1-mini', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-pro']
const repository = new LocalConversationsRepository()
const initialState = repository.load()

const state: AppState = { conversations: initialState.conversations, activeConversationId: initialState.activeConversationId }
let documents: DocumentRecord[] = []
let todos: TodoItem[] = []
let activeTab: 'chat' | 'documents' | 'todos' | 'base' | 'notifications' | 'users' = 'chat'
let docImageDataUrl: string | undefined
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
      <button id="tab-notifications" class="nav-tab tab-notify" data-label="Уведомления"><span class="nav-icon">🔔</span><span class="nav-label">Уведомления</span><span id="notify-badge" class="notify-badge hidden"></span></button>
      ${isAdmin ? '<button id="tab-users" class="nav-tab" data-label="Пользователи"><span class="nav-icon">👥</span><span class="nav-label">Пользователи</span></button>' : ''}
    </nav>
    <div class="app-user">
      <span class="app-user-name">${currentUser?.username ?? ''}</span>
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
  document.querySelector<HTMLButtonElement>('#tab-notifications')!.addEventListener('click', () => setTab('notifications'))
  document.querySelector<HTMLButtonElement>('#logout-btn')!.addEventListener('click', () => { clearToken(); currentUser = null; showLoginForm() })
  if (isAdmin) document.querySelector<HTMLButtonElement>('#tab-users')?.addEventListener('click', () => setTab('users'))

  applyTabLayout()
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

function setTab(tab: 'chat' | 'documents' | 'todos' | 'base' | 'notifications' | 'users') {
  activeTab = tab
  document.querySelectorAll('.nav-tab').forEach((el) => el.classList.remove('active'))
  const tabId = tab === 'documents' ? 'docs' : tab
  document.querySelector(`#tab-${tabId}`)?.classList.add('active')
  if (tab === 'notifications') {
    notifications.forEach((n) => (n.read = true))
    saveNotifications()
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
  contentRoot.innerHTML = `<section class="notifications-panel">
    <div class="page-header-row">
      <div><h2>Уведомления</h2><p class="page-subtitle">Всего: ${notifications.length}</p></div>
      ${notifications.length > 0 ? '<button id="clear-notifications" class="btn-secondary">Очистить все</button>' : ''}
    </div>
    <div id="notify-list" class="notify-list"></div>
  </section>`
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
    const b = document.createElement('button')
    b.className = `conversation-item ${c.id === state.activeConversationId ? 'active' : ''}`
    b.textContent = c.title
    b.onclick = () => { state.activeConversationId = c.id; persistAndRender() }
    conversationListEl.appendChild(b)
  }
}

function renderChat() {
  const modelOptions = DEFAULT_MODELS.map((m) => `<option value="${m}"${selectedModel === m ? ' selected' : ''}>${m}</option>`).join('')
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
          <select id="model-select" class="model-select">${modelOptions}</select>
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
    let imageDataUrl: string | undefined
    if (file) {
      userMessage.content = `${text}\n\n[Файл: ${file.name}]\n${await getFilePreview(file)}`
      imageDataUrl = await getImageDataUrl(file)
    }
    if (!imageDataUrl) imageDataUrl = findDocumentImage(text)
    if (imageDataUrl) userMessage.displayImage = imageDataUrl
    currentConversation.messages.push(userMessage)
    currentConversation.updatedAt = Date.now()
    if (currentConversation.title === 'Новая беседа') currentConversation.title = text.slice(0, 40)
    persistAndRender()
    try {
      const reply = await requestOpenRouterCompletion({
        model: getCurrentModel(),
        messages: currentConversation.messages,
        imageDataUrl,
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
          <div id="drop-label" class="drop-zone-text">Перетащите фото сюда или нажмите для выбора</div>
          <input id="doc-image" type="file" accept="image/*" />
        </div>
        <button id="doc-extract" type="button" class="btn-secondary">✨ Распознать поля с фото</button>
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

  renderFieldsList([])

  document.querySelector<HTMLButtonElement>('#add-field-btn')!.onclick = () => {
    addFieldRow()
  }
  const docImageInput = document.querySelector<HTMLInputElement>('#doc-image')!
  const dropZone = document.querySelector<HTMLDivElement>('#drop-zone')!
  const dropLabel = document.querySelector<HTMLDivElement>('#drop-label')!

  async function handleImageFile(file: File | undefined) {
    docImageDataUrl = await getImageDataUrl(file)
    if (file && docImageDataUrl) dropLabel.innerHTML = `✓ Фото выбрано: <strong>${file.name}</strong>`
  }

  docImageInput.onchange = (e) => handleImageFile((e.target as HTMLInputElement).files?.[0])

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'))
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault()
    dropZone.classList.remove('drag-over')
    const file = e.dataTransfer?.files?.[0]
    if (file?.type.startsWith('image/')) await handleImageFile(file)
  })
  dropZone.addEventListener('click', () => docImageInput.click())
  document.querySelector<HTMLButtonElement>('#doc-extract')!.onclick = async () => {
    if (!docImageDataUrl) { alert('Сначала выберите фото документа'); return }
    const btn = document.querySelector<HTMLButtonElement>('#doc-extract')!
    const extractModel = VISION_MODELS.includes(getCurrentModel()) ? getCurrentModel() : VISION_MODELS[0]
    btn.textContent = 'Распознаю...'
    btn.disabled = true
    try {
      const parsed = await extractDocument(docImageDataUrl, extractModel)
      ;(document.querySelector<HTMLInputElement>('#doc-title')!).value = parsed.title
      ;(document.querySelector<HTMLInputElement>('#doc-type')!).value = parsed.docType
      ;(document.querySelector<HTMLInputElement>('#doc-expires')!).value = parsed.expiresAt ?? ''
      renderFieldsList(Object.entries(parsed.fields))
    } catch (error) {
      alert(`Ошибка распознавания: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`)
    } finally {
      btn.textContent = 'Распознать поля с фото'
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
      imageDataUrl: docImageDataUrl,
      notifyEnabled: document.querySelector<HTMLInputElement>('#doc-notify')!.checked,
      notifyBeforeDays: Number(document.querySelector<HTMLInputElement>('#doc-notify-days')!.value || '1'),
      expiresAt: document.querySelector<HTMLInputElement>('#doc-expires')!.value || undefined
    })
    docImageDataUrl = undefined
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
    card.innerHTML = `
      <div class="doc-card-header">
        <div>
          <h3>${escapeAttr(d.title)}</h3>
          <p class="doc-type">${escapeAttr(d.docType)}</p>
        </div>
        ${d.expiresAt ? `<span class="doc-expires">до ${d.expiresAt}</span>` : ''}
      </div>
      ${fields ? `<div class="doc-fields">${fields}</div>` : ''}
      ${d.imageDataUrl ? `<img class="doc-image" src="${d.imageDataUrl}" alt="Фото документа" title="Нажмите для просмотра" />` : ''}
    `
    if (d.imageDataUrl) {
      const img = card.querySelector<HTMLImageElement>('.doc-image')!
      img.onclick = () => openImageFullscreen(d.imageDataUrl!)
    }
    list.appendChild(card)
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
    await setTodoDone(todo.id, (e.target as HTMLInputElement).checked)
    await refreshData()
    renderTodos()
  })
  list.appendChild(row)
}

async function refreshData() {
  try {
    documents = await listDocuments()
    todos = await listTodos()
  } catch {
    documents = []
    todos = []
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
      d.expiresAt ? `  Срок действия: ${d.expiresAt}` : '',
      d.notifyEnabled ? `  Уведомление: за ${d.notifyBeforeDays} дн.` : '',
      fields ? `  Поля:\n${fields}` : '',
      d.imageDataUrl ? '  Фото: есть' : ''
    ].filter(Boolean).join('\n')
  }).join('\n\n')
  const todoLines = todos.filter((t) => !t.done).map((t) => `- ${t.text} (до ${t.dueDate})`).join('\n')
  return [
    'Ты персональный ассистент. У пользователя есть следующие документы:',
    docLines || 'нет',
    todoLines ? `\nАктивные напоминания:\n${todoLines}` : '',
    '\nВАЖНО про фото: когда пользователь просит показать фото документа, изображение уже автоматически отображается в интерфейсе над твоим ответом. Ты получаешь это фото вместе с сообщением. Никогда не говори что не можешь показать фото. Никогда не пиши markdown-ссылки на изображения вида ![](). Просто скажи "Вот фото:" и при желании опиши что на нём видно.'
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
