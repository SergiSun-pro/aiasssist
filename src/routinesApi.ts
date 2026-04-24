import { authFetch } from './auth'
import type { Routine, RoutineLog } from './types'

async function parse<T>(r: Response): Promise<T> {
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `API error ${r.status}`)
  return d as T
}

export type RoutinePayload = Omit<Routine, 'id' | 'createdAt' | 'updatedAt'> & { times?: Record<string, string> }

export async function listRoutines(): Promise<Routine[]> {
  return parse<{ routines: Routine[] }>(await authFetch('/api/routines')).then(v => v.routines)
}

export async function createRoutine(p: RoutinePayload): Promise<Routine> {
  return parse<{ routine: Routine }>(await authFetch('/api/routines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })).then(v => v.routine)
}

export async function updateRoutine(id: string, p: Partial<RoutinePayload>): Promise<Routine> {
  return parse<{ routine: Routine }>(await authFetch(`/api/routines/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })).then(v => v.routine)
}

export async function deleteRoutine(id: string): Promise<void> {
  await parse<{ ok: true }>(await authFetch(`/api/routines/${id}`, { method: 'DELETE' }))
}

export async function listRoutineLogs(startDate?: string): Promise<RoutineLog[]> {
  const url = startDate ? `/api/routine-logs?start=${startDate}` : '/api/routine-logs'
  return parse<{ logs: RoutineLog[] }>(await authFetch(url)).then(v => v.logs)
}

export async function logRoutine(routineId: string, date: string, status: 'done' | 'skipped'): Promise<RoutineLog> {
  return parse<{ log: RoutineLog }>(await authFetch('/api/routine-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routineId, date, status }) })).then(v => v.log)
}

export async function deleteRoutineLog(id: string): Promise<void> {
  await parse<{ ok: true }>(await authFetch(`/api/routine-logs/${id}`, { method: 'DELETE' }))
}
