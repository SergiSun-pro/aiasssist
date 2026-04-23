import 'dotenv/config'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyToken, createToken, hashPassword, verifyPassword } from './auth.js'
import { readUsers, writeUsers, ensureDefaultAdmin, createId as createUserId } from './users.js'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.join(__dirname, 'db.json')

app.use(express.json({ limit: '15mb' }))

// === AUTH ===

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) { res.status(400).json({ error: 'Укажите логин и пароль' }); return }
  const users = await readUsers()
  const user = users.find((u) => u.username === username)
  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: 'Неверный логин или пароль' }); return
  }
  const token = createToken(user)
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } })
})

function authMiddleware(req, res, next) {
  const token = (req.headers.authorization ?? '').replace('Bearer ', '')
  const payload = verifyToken(token)
  if (!payload) { res.status(401).json({ error: 'Не авторизован' }); return }
  req.user = payload
  next()
}

app.use('/api', authMiddleware)

app.get('/api/auth/me', (req, res) => res.json({ user: req.user }))

app.get('/api/auth/users', async (req, res) => {
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Доступ запрещён' }); return }
  const users = await readUsers()
  res.json({ users: users.map((u) => ({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt })) })
})

app.post('/api/auth/users', async (req, res) => {
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Доступ запрещён' }); return }
  const { username, password, role = 'user' } = req.body ?? {}
  if (!username || !password) { res.status(400).json({ error: 'Укажите логин и пароль' }); return }
  const users = await readUsers()
  if (users.find((u) => u.username === username)) { res.status(409).json({ error: 'Пользователь уже существует' }); return }
  const newUser = { id: createUserId(), username, passwordHash: hashPassword(password), role: role === 'admin' ? 'admin' : 'user', createdAt: Date.now() }
  users.push(newUser)
  await writeUsers(users)
  res.json({ user: { id: newUser.id, username: newUser.username, role: newUser.role } })
})

app.delete('/api/auth/users/:id', async (req, res) => {
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Доступ запрещён' }); return }
  if (req.params.id === req.user.id) { res.status(400).json({ error: 'Нельзя удалить себя' }); return }
  const users = await readUsers()
  const index = users.findIndex((u) => u.id === req.params.id)
  if (index === -1) { res.status(404).json({ error: 'Пользователь не найден' }); return }
  users.splice(index, 1)
  await writeUsers(users)
  res.json({ ok: true })
})

async function ensureDb() {
  try {
    await fs.access(DB_PATH)
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify({ documents: [], todos: [], instructions: [] }, null, 2), 'utf8')
  }
}

async function readDb() {
  await ensureDb()
  const raw = await fs.readFile(DB_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    todos: Array.isArray(parsed.todos) ? parsed.todos : [],
    instructions: Array.isArray(parsed.instructions) ? parsed.instructions : []
  }
}

async function writeDb(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
}

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeDate(value) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}


app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    res.status(500).json({
      error: 'OPENROUTER_API_KEY не задан на сервере'
    })
    return
  }

  const { model, messages } = req.body ?? {}
  if (!model || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Неверный payload: ожидаются model и messages[]' })
    return
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: messages.map((message) => {
          const safeRole = message.role === 'assistant' ? 'assistant' : 'user'
          const safeContent =
            typeof message.content === 'string' || Array.isArray(message.content)
              ? message.content
              : ''
          return {
            role: safeRole,
            content: safeContent
          }
        })
      })
    })

    const data = await response.json()
    if (!response.ok) {
      res.status(response.status).json({
        error: data?.error?.message ?? `OpenRouter error ${response.status}`
      })
      return
    }

    const reply = data?.choices?.[0]?.message?.content
    if (!reply) {
      res.status(502).json({ error: 'OpenRouter вернул пустой ответ' })
      return
    }

    res.json({ reply })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown proxy error'
    })
  }
})

app.get('/api/documents', async (req, res) => {
  const db = await readDb()
  const query = String(req.query.q ?? '').trim().toLowerCase()
  if (!query) {
    res.json({ documents: db.documents })
    return
  }

  const filtered = db.documents.filter((document) => {
    if (document.title.toLowerCase().includes(query)) return true
    if (document.docType.toLowerCase().includes(query)) return true
    if ((document.tags ?? []).some((t) => t.toLowerCase().includes(query))) return true
    return Object.entries(document.fields ?? {}).some(
      ([key, value]) => key.toLowerCase().includes(query) || String(value).toLowerCase().includes(query)
    )
  })
  res.json({ documents: filtered })
})

app.get('/api/documents/:id', async (req, res) => {
  const db = await readDb()
  const doc = db.documents.find((d) => d.id === req.params.id)
  if (!doc) { res.status(404).json({ error: 'Документ не найден' }); return }
  res.json({ document: doc })
})

app.post('/api/documents', async (req, res) => {
  const { title, docType, fields, tags, imageDataUrl, notifyEnabled, notifyBeforeDays, expiresAt } = req.body ?? {}
  if (!title || !docType) {
    res.status(400).json({ error: 'title и docType обязательны' })
    return
  }

  const db = await readDb()
  const document = {
    id: createId(),
    title: String(title),
    docType: String(docType),
    fields: typeof fields === 'object' && fields ? fields : {},
    tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [],
    imageDataUrl: typeof imageDataUrl === 'string' ? imageDataUrl : undefined,
    notifyEnabled: Boolean(notifyEnabled),
    notifyBeforeDays: Number.isFinite(Number(notifyBeforeDays)) ? Number(notifyBeforeDays) : 1,
    expiresAt: normalizeDate(expiresAt),
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  db.documents.unshift(document)
  await writeDb(db)
  res.json({ document })
})

app.patch('/api/documents/:id', async (req, res) => {
  const db = await readDb()
  const doc = db.documents.find((d) => d.id === req.params.id)
  if (!doc) { res.status(404).json({ error: 'Документ не найден' }); return }
  const { title, docType, fields, tags, imageDataUrl, notifyEnabled, notifyBeforeDays, expiresAt } = req.body ?? {}
  if (title != null) doc.title = String(title)
  if (docType != null) doc.docType = String(docType)
  if (fields != null && typeof fields === 'object') doc.fields = fields
  if (Array.isArray(tags)) doc.tags = tags.map(String).filter(Boolean)
  if (imageDataUrl != null) doc.imageDataUrl = typeof imageDataUrl === 'string' ? imageDataUrl : undefined
  doc.notifyEnabled = Boolean(notifyEnabled)
  doc.notifyBeforeDays = Number.isFinite(Number(notifyBeforeDays)) ? Number(notifyBeforeDays) : 1
  doc.expiresAt = normalizeDate(expiresAt)
  doc.updatedAt = Date.now()
  await writeDb(db)
  res.json({ document: doc })
})

app.delete('/api/documents/:id', async (req, res) => {
  const db = await readDb()
  const index = db.documents.findIndex((d) => d.id === req.params.id)
  if (index === -1) { res.status(404).json({ error: 'Документ не найден' }); return }
  db.documents.splice(index, 1)
  db.todos = db.todos.filter((t) => t.documentId !== req.params.id)
  await writeDb(db)
  res.json({ ok: true })
})

app.get('/api/todos', async (_req, res) => {
  const db = await readDb()
  res.json({ todos: db.todos })
})

app.patch('/api/todos/:id', async (req, res) => {
  const db = await readDb()
  const todo = db.todos.find((item) => item.id === req.params.id)
  if (!todo) {
    res.status(404).json({ error: 'Todo не найден' })
    return
  }
  todo.done = Boolean(req.body?.done)
  await writeDb(db)
  res.json({ todo })
})

app.post('/api/reminders/run', async (_req, res) => {
  const db = await readDb()
  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const newTodos = []

  for (const document of db.documents) {
    if (!document.notifyEnabled || !document.expiresAt) continue
    const expires = new Date(document.expiresAt)
    const notifyAt = new Date(expires)
    notifyAt.setDate(notifyAt.getDate() - Number(document.notifyBeforeDays ?? 0))
    const notifyIso = notifyAt.toISOString().slice(0, 10)
    if (notifyIso > todayIso) continue

    const exists = db.todos.some(
      (todo) => todo.documentId === document.id && todo.text.includes(document.title) && !todo.done
    )
    if (!exists) {
      const todo = {
        id: createId(),
        documentId: document.id,
        text: `Проверь окончание документа: ${document.title}`,
        dueDate: todayIso,
        done: false,
        createdAt: Date.now()
      }
      db.todos.unshift(todo)
      newTodos.push(todo)
    }
  }

  for (const todo of db.todos) {
    if (todo.done) continue
    if (todo.dueDate < todayIso) {
      const nextDay = new Date(today)
      nextDay.setDate(nextDay.getDate() + 1)
      todo.dueDate = nextDay.toISOString().slice(0, 10)
    }
  }

  await writeDb(db)
  res.json({ ok: true, newTodos })
})

app.post('/api/documents/extract', async (req, res) => {
  const apiKey = process.env.OPENROUTER_API_KEY
  const { imageDataUrls, imageDataUrl, model } = req.body ?? {}
  const images = Array.isArray(imageDataUrls) ? imageDataUrls : (imageDataUrl ? [imageDataUrl] : null)

  if (!apiKey) {
    res.status(500).json({ error: 'OPENROUTER_API_KEY не задан на сервере' })
    return
  }
  if (!images?.length || !model) {
    res.status(400).json({ error: 'Требуются imageDataUrls и model' })
    return
  }

  try {
    const imageContent = images.map((url) => ({ type: 'image_url', image_url: { url } }))
    const pageNote = images.length > 1 ? ` Документ состоит из ${images.length} страниц/изображений — объедини данные со всех страниц в один JSON.` : ''

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Извлеки из изображений документа данные в виде JSON: {"title":"название документа","docType":"тип документа","expiresAt":"YYYY-MM-DD или пусто","fields":{"название поля на русском":"значение"}}. Все названия полей и значения должны быть на русском языке. Только валидный JSON без пояснений.${pageNote}`
              },
              ...imageContent
            ]
          }
        ]
      })
    })
    const data = await response.json()
    const text = data?.choices?.[0]?.message?.content
    if (!response.ok || !text) {
      res.status(502).json({ error: data?.error?.message ?? 'Не удалось распознать документ' })
      return
    }

    const clean = String(text).replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
    const parsed = JSON.parse(clean)
    res.json({
      title: parsed.title ?? 'Новый документ',
      docType: parsed.docType ?? 'Документ',
      expiresAt: normalizeDate(parsed.expiresAt),
      fields: typeof parsed.fields === 'object' && parsed.fields ? parsed.fields : {}
    })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Ошибка распознавания документа'
    })
  }
})

// === INSTRUCTIONS ===

app.get('/api/instructions', async (_req, res) => {
  const db = await readDb()
  res.json({ instructions: db.instructions })
})

app.post('/api/instructions', async (req, res) => {
  const { title, tags, steps } = req.body ?? {}
  if (!title) { res.status(400).json({ error: 'title обязателен' }); return }
  const db = await readDb()
  const instruction = {
    id: createId(),
    title: String(title),
    tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [],
    steps: Array.isArray(steps) ? steps : [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  db.instructions.unshift(instruction)
  await writeDb(db)
  res.json({ instruction })
})

app.patch('/api/instructions/:id', async (req, res) => {
  const db = await readDb()
  const instruction = db.instructions.find((i) => i.id === req.params.id)
  if (!instruction) { res.status(404).json({ error: 'Инструкция не найдена' }); return }
  const { title, tags, steps } = req.body ?? {}
  if (title != null) instruction.title = String(title)
  if (Array.isArray(tags)) instruction.tags = tags.map(String).filter(Boolean)
  if (Array.isArray(steps)) instruction.steps = steps
  instruction.updatedAt = Date.now()
  await writeDb(db)
  res.json({ instruction })
})

app.delete('/api/instructions/:id', async (req, res) => {
  const db = await readDb()
  const index = db.instructions.findIndex((i) => i.id === req.params.id)
  if (index === -1) { res.status(404).json({ error: 'Инструкция не найдена' }); return }
  db.instructions.splice(index, 1)
  await writeDb(db)
  res.json({ ok: true })
})

ensureDefaultAdmin().then(() => {
  app.listen(port, () => {
    console.log(`Proxy server listening on http://localhost:${port}`)
  })
})
