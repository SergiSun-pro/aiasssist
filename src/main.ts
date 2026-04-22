import './style.css'
import { createDocument, extractDocument, listDocuments, listTodos, runReminders, setTodoDone } from './documentsApi'
import { requestOpenRouterCompletion } from './openrouter'
import { LocalConversationsRepository } from './storage'
import type { AppState, ChatMessage, Conversation, DocumentRecord, TodoItem } from './types'

const DEFAULT_MODELS = ['openai/gpt-4.1-mini', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat-v3-0324']
const VISION_MODELS = ['openai/gpt-4.1-mini', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-pro']
const repository = new LocalConversationsRepository()
const initialState = repository.load()

const state: AppState = { conversations: initialState.conversations, activeConversationId: initialState.activeConversationId }
let documents: DocumentRecord[] = []
let todos: TodoItem[] = []
let activeTab: 'chat' | 'documents' | 'todos' | 'base' = 'chat'
let docImageDataUrl: string | undefined

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main class="layout">
  <aside class="sidebar">
    <h1>aiasssist</h1>
    <button id="new-chat-button">+ Новая беседа</button>
    <div id="conversation-list" class="conversation-list"></div>
    <nav class="tabs">
      <button id="tab-chat" class="tab active">Чат</button>
      <button id="tab-docs" class="tab">Документы</button>
      <button id="tab-base" class="tab">База</button>
      <button id="tab-todos" class="tab">Дела</button>
    </nav>
  </aside>
  <section class="chat-panel">
    <header class="toolbar">
      <label class="toolbar-item"><span>Модель</span><select id="model-select"></select></label>
      <button id="run-reminders" type="button">Обновить напоминания</button>
    </header>
    <div id="content-root"></div>
  </section>
</main>`

const modelSelect = document.querySelector<HTMLSelectElement>('#model-select')!
const contentRoot = document.querySelector<HTMLDivElement>('#content-root')!
const conversationListEl = document.querySelector<HTMLDivElement>('#conversation-list')!

DEFAULT_MODELS.forEach((model) => modelSelect.append(new Option(model, model)))
if (!state.activeConversationId) createConversation('Новая беседа')

document.querySelector<HTMLButtonElement>('#new-chat-button')!.addEventListener('click', () => { createConversation('Новая беседа'); render() })
document.querySelector<HTMLButtonElement>('#tab-chat')!.addEventListener('click', () => setTab('chat'))
document.querySelector<HTMLButtonElement>('#tab-docs')!.addEventListener('click', () => setTab('documents'))
document.querySelector<HTMLButtonElement>('#tab-base')!.addEventListener('click', () => setTab('base'))
document.querySelector<HTMLButtonElement>('#tab-todos')!.addEventListener('click', () => setTab('todos'))
document.querySelector<HTMLButtonElement>('#run-reminders')!.addEventListener('click', () => runRemindersAndNotify())

refreshData().finally(render)
requestNotificationPermission()
runRemindersAndNotify()
setInterval(runRemindersAndNotify, 30 * 60 * 1000)

function setTab(tab: 'chat' | 'documents' | 'todos' | 'base') {
  activeTab = tab
  document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'))
  const tabId = tab === 'documents' ? 'docs' : tab
  document.querySelector(`#tab-${tabId}`)?.classList.add('active')
  render()
}

function render() {
  renderConversations()
  if (activeTab === 'chat') renderChat()
  if (activeTab === 'documents') renderDocuments()
  if (activeTab === 'base') renderBase()
  if (activeTab === 'todos') renderTodos()
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
  contentRoot.innerHTML = `<div id="messages" class="messages"></div>
  <form id="composer-form" class="composer">
    <div class="composer-shell">
      <label class="attach-button">+<input id="file-input" type="file" /></label>
      <textarea id="prompt-input" placeholder="Сообщение..." rows="1"></textarea>
      <button id="send-button" type="submit" class="send-icon">➤</button>
    </div>
    <span id="file-name" class="file-name">Файл не выбран</span>
  </form>`
  const messagesEl = document.querySelector<HTMLDivElement>('#messages')!
  const current = getActiveConversation()
  if (!current || current.messages.length === 0) messagesEl.innerHTML = '<p class="hint">Начни диалог с моделью.</p>'
  else for (const m of current.messages) {
    const item = document.createElement('article')
    item.className = `message ${m.role}`
    item.innerHTML = `<div class="message-meta">${m.role === 'user' ? 'Ты' : `ИИ${m.model ? ` (${m.model})` : ''}`}</div>${m.displayImage ? `<img class="message-image" src="${m.displayImage}" alt="Фото документа" />` : ''}<pre class="message-content"></pre>`
    item.querySelector('pre')!.textContent = m.content
    messagesEl.appendChild(item)
  }
  messagesEl.scrollTop = messagesEl.scrollHeight

  const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
  const fileNameNode = document.querySelector<HTMLSpanElement>('#file-name')!
  fileInput.onchange = () => { fileNameNode.textContent = fileInput.files?.[0]?.name ?? 'Файл не выбран' }
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
        model: modelSelect.value,
        messages: currentConversation.messages,
        imageDataUrl,
        systemPrompt: buildDocumentSystemPrompt()
      })
      currentConversation.messages.push({ id: createId(), role: 'assistant', content: reply, createdAt: Date.now(), model: modelSelect.value })
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
    <div class="docs-actions">
      <input id="doc-search" placeholder="Поиск по названию и полям" />
      <button id="doc-search-btn">Найти</button>
    </div>
    <form id="doc-form" class="doc-form">
      <input id="doc-title" placeholder="Название документа" required />
      <input id="doc-type" placeholder="Тип документа" required />
      <div class="fields-editor">
        <div id="fields-list" class="fields-list"></div>
        <button id="add-field-btn" type="button" class="add-field-btn">+ Добавить поле</button>
      </div>
      <input id="doc-expires" type="date" />
      <label class="checkbox-label"><input id="doc-notify" type="checkbox" checked /> Уведомлять об окончании срока</label>
      <label class="notify-days-label">За сколько дней уведомить: <input id="doc-notify-days" type="number" min="0" value="1" style="width:70px" /></label>
      <label class="file-button">Фото документа<input id="doc-image" type="file" accept="image/*" /></label>
      <div class="docs-actions">
        <button id="doc-extract" type="button">Распознать поля с фото</button>
        <button type="submit">Сохранить документ</button>
      </div>
    </form>
    <div id="docs-list" class="docs-list"></div>
  </section>`

  renderFieldsList([])

  document.querySelector<HTMLButtonElement>('#add-field-btn')!.onclick = () => {
    addFieldRow()
  }
  document.querySelector<HTMLButtonElement>('#doc-search-btn')!.onclick = async () => {
    documents = await listDocuments((document.querySelector<HTMLInputElement>('#doc-search')?.value ?? '').trim())
    renderDocumentsList()
  }
  document.querySelector<HTMLInputElement>('#doc-image')!.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    docImageDataUrl = await getImageDataUrl(file)
  }
  document.querySelector<HTMLButtonElement>('#doc-extract')!.onclick = async () => {
    if (!docImageDataUrl) { alert('Сначала выберите фото документа'); return }
    const btn = document.querySelector<HTMLButtonElement>('#doc-extract')!
    const extractModel = VISION_MODELS.includes(modelSelect.value) ? modelSelect.value : VISION_MODELS[0]
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
    <div class="docs-actions">
      <input id="base-search" placeholder="Поиск по названию и полям" />
      <button id="base-search-btn">Найти</button>
    </div>
    <div id="base-list" class="docs-list"></div>
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
      ${d.imageDataUrl ? `<img class="doc-image" src="${d.imageDataUrl}" alt="Фото документа" />` : ''}
    `
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

function renderDocumentsList() {
  const list = document.querySelector<HTMLDivElement>('#docs-list')
  if (!list) return
  list.innerHTML = documents.map((d) => `<article class="doc-card"><h3>${d.title}</h3><p>${d.docType}</p><p>Срок: ${d.expiresAt ?? 'не указан'}</p><pre>${JSON.stringify(d.fields, null, 2)}</pre></article>`).join('') || '<p class="hint">Документы не найдены</p>'
}

function renderTodos() {
  contentRoot.innerHTML = `<section class="todos"><div id="todo-list"></div></section>`
  const list = document.querySelector<HTMLDivElement>('#todo-list')!
  if (todos.length === 0) { list.innerHTML = '<p class="hint">Дел пока нет.</p>'; return }
  for (const todo of todos) {
    const row = document.createElement('label')
    row.className = 'todo-row'
    row.innerHTML = `<input type="checkbox" ${todo.done ? 'checked' : ''}/><span>${todo.text} (${todo.dueDate})</span>`
    row.querySelector('input')!.addEventListener('change', async (e) => {
      await setTodoDone(todo.id, (e.target as HTMLInputElement).checked)
      await refreshData()
      renderTodos()
    })
    list.appendChild(row)
  }
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

  console.log('[findDocumentImage] docs total:', documents.length)
  console.log('[findDocumentImage] docs with image:', documents.filter((d) => d.imageDataUrl).length)
  console.log('[findDocumentImage] titles:', documents.map((d) => d.title))

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
    if (activeTab === 'todos') renderTodos()
    if (newTodos.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
      for (const todo of newTodos) {
        new Notification('Напоминание', { body: todo.text, icon: '/pwa-icon.svg' })
      }
    }
  } catch {
    // сеть недоступна — игнорируем
  }
}
