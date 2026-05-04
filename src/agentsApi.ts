import { authFetch } from './auth'
import type { Agent, AgentTask } from './types'

async function parse<T>(r: Response): Promise<T> {
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `API error ${r.status}`)
  return d as T
}

export type AgentPayload = Omit<Agent, 'id' | 'createdAt' | 'updatedAt'>

export async function listAgents(): Promise<Agent[]> {
  return parse<{ agents: Agent[] }>(await authFetch('/api/agents')).then(v => v.agents)
}

export async function createAgent(p: AgentPayload): Promise<Agent> {
  return parse<{ agent: Agent }>(await authFetch('/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })).then(v => v.agent)
}

export async function updateAgent(id: string, p: Partial<AgentPayload>): Promise<Agent> {
  return parse<{ agent: Agent }>(await authFetch(`/api/agents/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })).then(v => v.agent)
}

export async function deleteAgent(id: string): Promise<void> {
  await parse<{ ok: true }>(await authFetch(`/api/agents/${id}`, { method: 'DELETE' }))
}

export async function listAgentTasks(agentId: string): Promise<AgentTask[]> {
  return parse<{ tasks: AgentTask[] }>(await authFetch(`/api/agents/${agentId}/tasks`)).then(v => v.tasks)
}

export async function createAgentTask(agentId: string, title: string): Promise<AgentTask> {
  return parse<{ task: AgentTask }>(await authFetch(`/api/agents/${agentId}/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) })).then(v => v.task)
}

export async function updateAgentTask(agentId: string, taskId: string, payload: Partial<Pick<AgentTask, 'title' | 'messages'>>): Promise<AgentTask> {
  return parse<{ task: AgentTask }>(await authFetch(`/api/agents/${agentId}/tasks/${taskId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })).then(v => v.task)
}

export async function deleteAgentTask(agentId: string, taskId: string): Promise<void> {
  await parse<{ ok: true }>(await authFetch(`/api/agents/${agentId}/tasks/${taskId}`, { method: 'DELETE' }))
}
