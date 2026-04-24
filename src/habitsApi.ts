import { authFetch } from './auth'
import type { Habit, HabitLog } from './types'

async function parse<T>(r: Response): Promise<T> {
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `API error ${r.status}`)
  return d as T
}

export type HabitPayload = Omit<Habit, 'id' | 'createdAt' | 'updatedAt'>

export async function listHabits(): Promise<Habit[]> {
  return parse<{ habits: Habit[] }>(await authFetch('/api/habits')).then(v => v.habits)
}

export async function createHabit(p: HabitPayload): Promise<Habit> {
  return parse<{ habit: Habit }>(await authFetch('/api/habits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })).then(v => v.habit)
}

export async function updateHabit(id: string, p: Partial<HabitPayload>): Promise<Habit> {
  return parse<{ habit: Habit }>(await authFetch(`/api/habits/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })).then(v => v.habit)
}

export async function deleteHabit(id: string): Promise<void> {
  await parse<{ ok: true }>(await authFetch(`/api/habits/${id}`, { method: 'DELETE' }))
}

export async function listHabitLogs(startDate?: string): Promise<HabitLog[]> {
  const url = startDate ? `/api/habit-logs?start=${startDate}` : '/api/habit-logs'
  return parse<{ logs: HabitLog[] }>(await authFetch(url)).then(v => v.logs)
}

export async function logHabit(habitId: string, date: string, count: number): Promise<HabitLog> {
  return parse<{ log: HabitLog }>(await authFetch('/api/habit-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ habitId, date, count }) })).then(v => v.log)
}
