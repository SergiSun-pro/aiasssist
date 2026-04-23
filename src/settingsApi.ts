import { authFetch } from './auth'

export interface TodoRules {
  sources: string
  trackedParams: string
  dailyUnits: string
  easyTasks: string
  hardTasks: string
  general: string
}

export interface UserSettings {
  todoRules?: Partial<TodoRules>
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `API error ${response.status}`)
  return data as T
}

export async function getSettings(): Promise<UserSettings> {
  const response = await authFetch('/api/settings')
  return parseResponse<{ settings: UserSettings }>(response).then((v) => v.settings)
}

export async function saveSettings(settings: UserSettings): Promise<UserSettings> {
  const response = await authFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
  return parseResponse<{ settings: UserSettings }>(response).then((v) => v.settings)
}
