import { authFetch } from './auth'
import type { ScheduledTask } from './types'

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `API error ${response.status}`)
  return data as T
}

export type TaskPayload = Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt'>

export async function listTasks(): Promise<ScheduledTask[]> {
  const response = await authFetch('/api/tasks')
  return parseResponse<{ tasks: ScheduledTask[] }>(response).then((v) => v.tasks)
}

export async function createTask(payload: Partial<TaskPayload>): Promise<ScheduledTask> {
  const response = await authFetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return parseResponse<{ task: ScheduledTask }>(response).then((v) => v.task)
}

export async function updateTask(id: string, payload: Partial<TaskPayload>): Promise<ScheduledTask> {
  const response = await authFetch(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return parseResponse<{ task: ScheduledTask }>(response).then((v) => v.task)
}

export async function deleteTask(id: string): Promise<void> {
  const response = await authFetch(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await parseResponse<{ ok: true }>(response)
}
