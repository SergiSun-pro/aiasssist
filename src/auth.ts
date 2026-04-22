const TOKEN_KEY = 'aiassist.token.v1'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'user'
  exp?: number
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function getCurrentUser(): AuthUser | null {
  const token = getToken()
  if (!token) return null
  try {
    const [payloadB64] = token.split('.')
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))) as AuthUser
    if ((payload.exp ?? 0) < Date.now()) { clearToken(); return null }
    return payload
  } catch {
    return null
  }
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'Ошибка входа')
  setToken(data.token)
  return data.user as AuthUser
}

export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken()
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  })
}

export async function fetchUsers(): Promise<AuthUser[]> {
  const res = await authFetch('/api/auth/users')
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  return data.users
}

export async function createUser(username: string, password: string, role: 'admin' | 'user'): Promise<AuthUser> {
  const res = await authFetch('/api/auth/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
  return data.user
}

export async function deleteUser(id: string): Promise<void> {
  const res = await authFetch(`/api/auth/users/${id}`, { method: 'DELETE' })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error)
}
