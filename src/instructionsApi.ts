import { authFetch } from './auth'
import type { Instruction } from './types'

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `API error ${response.status}`)
  return data as T
}

export type InstructionPayload = Omit<Instruction, 'id' | 'createdAt' | 'updatedAt'>

export async function listInstructions(): Promise<Instruction[]> {
  const response = await authFetch('/api/instructions')
  return parseResponse<{ instructions: Instruction[] }>(response).then((v) => v.instructions)
}

export async function createInstruction(payload: InstructionPayload): Promise<Instruction> {
  const response = await authFetch('/api/instructions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return parseResponse<{ instruction: Instruction }>(response).then((v) => v.instruction)
}

export async function updateInstruction(id: string, payload: Partial<InstructionPayload>): Promise<Instruction> {
  const response = await authFetch(`/api/instructions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  return parseResponse<{ instruction: Instruction }>(response).then((v) => v.instruction)
}

export async function deleteInstruction(id: string): Promise<void> {
  const response = await authFetch(`/api/instructions/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await parseResponse<{ ok: true }>(response)
}
