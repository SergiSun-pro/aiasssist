import type { DocumentRecord, TodoItem } from './types'

export interface CreateDocumentInput {
  title: string
  docType: string
  fields: Record<string, string>
  imageDataUrl?: string
  notifyEnabled: boolean
  notifyBeforeDays: number
  expiresAt?: string
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error ?? `API error ${response.status}`)
  }
  return data as T
}

export async function listDocuments(query = ''): Promise<DocumentRecord[]> {
  const url = query ? `/api/documents?q=${encodeURIComponent(query)}` : '/api/documents'
  const response = await fetch(url)
  return parseResponse<{ documents: DocumentRecord[] }>(response).then((v) => v.documents)
}

export async function createDocument(payload: CreateDocumentInput): Promise<DocumentRecord> {
  const response = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return parseResponse<{ document: DocumentRecord }>(response).then((v) => v.document)
}

export async function runReminders(): Promise<void> {
  const response = await fetch('/api/reminders/run', { method: 'POST' })
  await parseResponse<{ ok: true }>(response)
}

export async function listTodos(): Promise<TodoItem[]> {
  const response = await fetch('/api/todos')
  return parseResponse<{ todos: TodoItem[] }>(response).then((v) => v.todos)
}

export async function setTodoDone(id: string, done: boolean): Promise<void> {
  const response = await fetch(`/api/todos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ done })
  })
  await parseResponse<{ todo: TodoItem }>(response)
}

export async function extractDocument(imageDataUrl: string, model: string): Promise<{
  title: string
  docType: string
  fields: Record<string, string>
  expiresAt?: string
}> {
  const response = await fetch('/api/documents/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageDataUrl, model })
  })
  return parseResponse<{
    title: string
    docType: string
    fields: Record<string, string>
    expiresAt?: string
  }>(response)
}
