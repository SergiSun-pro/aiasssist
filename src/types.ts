export type Role = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  model?: string
  attachmentName?: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface AppState {
  conversations: Conversation[]
  activeConversationId: string | null
}

export interface DocumentRecord {
  id: string
  title: string
  docType: string
  fields: Record<string, string>
  imageDataUrl?: string
  notifyEnabled: boolean
  notifyBeforeDays: number
  expiresAt?: string
  createdAt: number
  updatedAt: number
}

export interface TodoItem {
  id: string
  documentId: string
  text: string
  dueDate: string
  done: boolean
  createdAt: number
}
