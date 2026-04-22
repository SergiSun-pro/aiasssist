import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { hashPassword } from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const USERS_PATH = path.join(__dirname, 'users.json')

function createId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

export async function readUsers() {
  try {
    const raw = await fs.readFile(USERS_PATH, 'utf8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

export async function writeUsers(users) {
  await fs.writeFile(USERS_PATH, JSON.stringify(users, null, 2), 'utf8')
}

export async function ensureDefaultAdmin() {
  const users = await readUsers()
  if (users.length > 0) return
  const username = process.env.ADMIN_USERNAME || 'admin'
  const password = process.env.ADMIN_PASSWORD || 'admin123'
  const admin = { id: createId(), username, passwordHash: hashPassword(password), role: 'admin', createdAt: Date.now() }
  await writeUsers([admin])
  console.log(`Создан admin: ${username} / ${password}`)
  console.log('Смените пароль в .env через ADMIN_USERNAME и ADMIN_PASSWORD')
}

export { createId }
