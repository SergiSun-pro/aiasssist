import './style.css'
import { createDocument, extractDocument, listDocuments, listTodos, runReminders, setTodoDone } from './documentsApi'
import { requestOpenRouterCompletion } from './openrouter'
import { LocalConversationsRepository } from './storage'
import type { AppState, ChatMessage, Conversation, DocumentRecord, TodoItem } from './types'

const DEFAULT_MODELS = ['openai/gpt-4.1-mini', 'anthropic/claude-3.7-sonnet', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat-v3-0324']
const repository = new LocalConversationsRepository()
const initialState = repository.load()

const state: AppState = { conversations: initialState.conversations, activeConversationId: initialState.activeConversationId }
let documents: DocumentRecord[] = []
let todos: TodoItem[] = []
let activeTab: 'chat' | 'documents' | 'todos' = 'chat'
let docImageDataUrl: string | undefined

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `<main class="layout">
  <aside class="sidebar">
    <h1>aiasssist</h1>
    <button id="new-chat-button">+ Новая беседа</button>
    <div id="conversation-list" class="conversation-list"></div>
    <nav class="tabs">
      <button id="tab-chat" class="tab active">Чат</button>
      <button id="tab-docs" class="tab">Документы</button>
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
document.querySelector<HTMLButtonElement>('#tab-todos')!.addEventListener('click', () => setTab('todos'))
document.querySelector<HTMLButtonElement>('#run-reminders')!.addEventListener('click', async () => { await runReminders(); await refreshData(); if (activeTab === 'todos') renderTodos() })

refreshData().finally(render)

function setTab(tab: 'chat' | 'documents' | 'todos') {
  activeTab = tab
  document.querySelectorAll('.tab').forEach((el) => el.classList.remove('active'))
  document.querySelector(`#tab-${tab === 'documents' ? 'docs' : tab}`)?.classList.add('active')
  render()
}

function render() {
  renderConversations()
  if (activeTab === 'chat') renderChat()
  if (activeTab === 'documents') renderDocuments()
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
    item.innerHTML = `<div class="message-meta">${m.role === 'user' ? 'Ты' : `ИИ${m.model ? ` (${m.model})` : ''}`}</div><pre class="message-content"></pre>`
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
    currentConversation.messages.push(userMessage)
    currentConversation.updatedAt = Date.now()
    if (currentConversation.title === 'Новая беседа') currentConversation.title = text.slice(0, 40)
    persistAndRender()
    try {
      const docsContext = documents.slice(0, 5).map((d) => `${d.title} (${d.docType})`).join(', ')
      const reply = await requestOpenRouterCompletion({
        model: modelSelect.value,
        messages: [...currentConversation.messages, { id: createId(), role: 'user', content: `Контекст документов: ${docsContext || 'нет'}`, createdAt: Date.now() }],
        imageDataUrl
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
      <textarea id="doc-fields" placeholder='Поля JSON, например {"номер":"123"}'></textarea>
      <input id="doc-expires" type="date" />
      <label><input id="doc-notify" type="checkbox" checked /> Уведомлять об окончании</label>
      <input id="doc-notify-days" type="number" min="0" value="1" />
      <label class="file-button">Фото документа<input id="doc-image" type="file" accept="image/*" /></label>
      <div class="docs-actions">
        <button id="doc-extract" type="button">Распознать поля</button>
        <button type="submit">Сохранить документ</button>
      </div>
    </form>
    <div id="docs-list" class="docs-list"></div>
  </section>`
  document.querySelector<HTMLButtonElement>('#doc-search-btn')!.onclick = async () => {
    documents = await listDocuments((document.querySelector<HTMLInputElement>('#doc-search')?.value ?? '').trim())
    renderDocumentsList()
  }
  document.querySelector<HTMLInputElement>('#doc-image')!.onchange = async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    docImageDataUrl = await getImageDataUrl(file)
  }
  document.querySelector<HTMLButtonElement>('#doc-extract')!.onclick = async () => {
    if (!docImageDataUrl) return
    const parsed = await extractDocument(docImageDataUrl, modelSelect.value)
    ;(document.querySelector<HTMLInputElement>('#doc-title')!).value = parsed.title
    ;(document.querySelector<HTMLInputElement>('#doc-type')!).value = parsed.docType
    ;(document.querySelector<HTMLTextAreaElement>('#doc-fields')!).value = JSON.stringify(parsed.fields, null, 2)
    ;(document.querySelector<HTMLInputElement>('#doc-expires')!).value = parsed.expiresAt ?? ''
  }
  document.querySelector<HTMLFormElement>('#doc-form')!.onsubmit = async (event) => {
    event.preventDefault()
    const fieldsRaw = document.querySelector<HTMLTextAreaElement>('#doc-fields')!.value.trim()
    const fields = fieldsRaw ? JSON.parse(fieldsRaw) : {}
    await createDocument({
      title: document.querySelector<HTMLInputElement>('#doc-title')!.value.trim(),
      docType: document.querySelector<HTMLInputElement>('#doc-type')!.value.trim(),
      fields,
      imageDataUrl: docImageDataUrl,
      notifyEnabled: document.querySelector<HTMLInputElement>('#doc-notify')!.checked,
      notifyBeforeDays: Number(document.querySelector<HTMLInputElement>('#doc-notify-days')!.value || '1'),
      expiresAt: document.querySelector<HTMLInputElement>('#doc-expires')!.value || undefined
    })
    await refreshData()
    renderDocuments()
  }
  renderDocumentsList()
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

if ('serviceWorker' in navigator) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
