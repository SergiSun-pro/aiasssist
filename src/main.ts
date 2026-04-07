import './style.css'
import { requestOpenRouterCompletion } from './openrouter'
import { LocalConversationsRepository } from './storage'
import type { AppState, ChatMessage, Conversation } from './types'

const DEFAULT_MODELS = [
  'openai/gpt-4.1-mini',
  'openai/gpt-4.1',
  'anthropic/claude-3.5-sonnet',
  'anthropic/claude-3.7-sonnet',
  'google/gemini-2.0-flash-001',
  'google/gemini-2.5-pro',
  'deepseek/deepseek-chat-v3-0324',
  'deepseek/deepseek-r1'
]

const repository = new LocalConversationsRepository()
const initialState = repository.load()

const state: AppState = {
  conversations: initialState.conversations,
  activeConversationId: initialState.activeConversationId
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<main class="layout">
  <aside class="sidebar">
    <div class="brand">
      <h1>aiasssist</h1>
      <button id="new-chat-button" type="button">+ Новая беседа</button>
    </div>
    <div id="conversation-list" class="conversation-list"></div>
  </aside>

  <section class="chat-panel">
    <header class="toolbar">
      <label class="toolbar-item">
        <span>Модель</span>
        <select id="model-select"></select>
      </label>
      <span class="toolbar-note">Ключ хранится только на backend-proxy</span>
    </header>

    <div id="messages" class="messages"></div>

    <form id="composer-form" class="composer">
      <div class="composer-shell">
        <label class="attach-button" title="Прикрепить файл">
          +
          <input id="file-input" type="file" />
        </label>
        <textarea id="prompt-input" placeholder="Сообщение..." rows="1"></textarea>
        <button id="send-button" type="submit" class="send-icon" title="Отправить">➤</button>
      </div>
      <span id="file-name" class="file-name">Файл не выбран</span>
    </form>
  </section>
</main>
`

const conversationList = document.querySelector<HTMLDivElement>('#conversation-list')
const messagesNode = document.querySelector<HTMLDivElement>('#messages')
const modelSelect = document.querySelector<HTMLSelectElement>('#model-select')
const newChatButton = document.querySelector<HTMLButtonElement>('#new-chat-button')
const promptInput = document.querySelector<HTMLTextAreaElement>('#prompt-input')
const composerForm = document.querySelector<HTMLFormElement>('#composer-form')
const fileInput = document.querySelector<HTMLInputElement>('#file-input')
const fileNameNode = document.querySelector<HTMLSpanElement>('#file-name')
const sendButton = document.querySelector<HTMLButtonElement>('#send-button')

if (
  !conversationList ||
  !messagesNode ||
  !modelSelect ||
  !newChatButton ||
  !promptInput ||
  !composerForm ||
  !fileInput ||
  !fileNameNode ||
  !sendButton
) {
  throw new Error('UI is not initialized')
}

const conversationListEl: HTMLDivElement = conversationList
const messagesEl: HTMLDivElement = messagesNode

DEFAULT_MODELS.forEach((model) => {
  const option = document.createElement('option')
  option.value = model
  option.textContent = model
  modelSelect.appendChild(option)
})

if (!state.activeConversationId && state.conversations.length > 0) {
  state.activeConversationId = state.conversations[0].id
}
if (!state.activeConversationId) {
  createConversation('Новая беседа')
}

render()

newChatButton.addEventListener('click', () => {
  createConversation('Новая беседа')
  render()
})

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  fileNameNode.textContent = file ? file.name : 'Файл не выбран'
})

composerForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const current = getActiveConversation()
  if (!current) {
    return
  }

  const text = promptInput.value.trim()
  if (!text) {
    return
  }

  const userMessage: ChatMessage = {
    id: createId(),
    role: 'user',
    content: text,
    createdAt: Date.now(),
    attachmentName: fileInput.files?.[0]?.name
  }

  const attachedFile = fileInput.files?.[0]
  let imageDataUrl: string | undefined

  if (userMessage.attachmentName) {
    const preview = await getFilePreview(attachedFile)
    userMessage.content = `${text}\n\n[Файл: ${userMessage.attachmentName}]\n${preview}`
    imageDataUrl = await getImageDataUrl(attachedFile)
  }

  current.messages.push(userMessage)
  current.updatedAt = Date.now()
  if (current.title === 'Новая беседа') {
    current.title = text.slice(0, 40)
  }
  persistAndRender()

  sendButton.disabled = true
  sendButton.textContent = 'Отправка...'

  try {
    const model = modelSelect.value
    const responseText = await requestOpenRouterCompletion({
      model,
      messages: current.messages,
      imageDataUrl
    })
    current.messages.push({
      id: createId(),
      role: 'assistant',
      content: responseText,
      createdAt: Date.now(),
      model
    })
    current.updatedAt = Date.now()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка OpenRouter'
    appendErrorMessage(message)
  } finally {
    sendButton.disabled = false
    sendButton.textContent = 'Отправить'
    promptInput.value = ''
    fileInput.value = ''
    fileNameNode.textContent = 'Файл не выбран'
    persistAndRender()
  }
})

function render(): void {
  renderConversations()
  renderMessages()
}

function renderConversations(): void {
  conversationListEl.innerHTML = ''
  for (const conversation of state.conversations) {
    const button = document.createElement('button')
    button.className = `conversation-item ${
      conversation.id === state.activeConversationId ? 'active' : ''
    }`
    button.textContent = conversation.title
    button.addEventListener('click', () => {
      state.activeConversationId = conversation.id
      persistAndRender()
    })
    conversationListEl.appendChild(button)
  }
}

function renderMessages(): void {
  const current = getActiveConversation()
  if (!current) {
    messagesEl.innerHTML = '<p class="hint">Создай беседу, чтобы начать.</p>'
    return
  }

  if (current.messages.length === 0) {
    messagesEl.innerHTML = '<p class="hint">Начни диалог с моделью.</p>'
    return
  }

  messagesEl.innerHTML = ''
  for (const message of current.messages) {
    const item = document.createElement('article')
    item.className = `message ${message.role}`

    const meta = document.createElement('div')
    meta.className = 'message-meta'
    meta.textContent = message.role === 'user' ? 'Ты' : `ИИ${message.model ? ` (${message.model})` : ''}`

    const text = document.createElement('pre')
    text.className = 'message-content'
    text.textContent = message.content

    item.append(meta, text)
    messagesEl.appendChild(item)
  }

  messagesEl.scrollTop = messagesEl.scrollHeight
}

function createConversation(title: string): Conversation {
  const conversation: Conversation = {
    id: createId(),
    title,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  }
  state.conversations.unshift(conversation)
  state.activeConversationId = conversation.id
  persist()
  return conversation
}

function getActiveConversation(): Conversation | undefined {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId)
}

function appendErrorMessage(errorText: string): void {
  const current = getActiveConversation()
  if (!current) {
    return
  }
  current.messages.push({
    id: createId(),
    role: 'assistant',
    content: `Ошибка: ${errorText}`,
    createdAt: Date.now()
  })
  current.updatedAt = Date.now()
  persistAndRender()
}

async function getFilePreview(file: File | undefined): Promise<string> {
  if (!file) {
    return ''
  }
  const isTextFile =
    file.type.startsWith('text/') ||
    file.name.endsWith('.md') ||
    file.name.endsWith('.json') ||
    file.name.endsWith('.ts') ||
    file.name.endsWith('.js')

  if (!isTextFile) {
    return '[Бинарный файл - в контекст отправлено только имя файла]'
  }

  const text = await file.text()
  const snippet = text.slice(0, 4000)
  return `[Содержимое файла, первые ${snippet.length} символов]:\n${snippet}`
}

async function getImageDataUrl(file: File | undefined): Promise<string | undefined> {
  if (!file || !file.type.startsWith('image/')) {
    return undefined
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'))
    reader.readAsDataURL(file)
  })
}

function persistAndRender(): void {
  persist()
  render()
}

function persist(): void {
  repository.save(state)
}

function createId(): string {
  const maybeCrypto = globalThis.crypto
  if (maybeCrypto && typeof maybeCrypto.randomUUID === 'function') {
    return maybeCrypto.randomUUID()
  }

  if (maybeCrypto && typeof maybeCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    maybeCrypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Ignore registration errors in local development.
    })
  })
}
