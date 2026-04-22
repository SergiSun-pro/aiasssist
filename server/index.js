import 'dotenv/config'
import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DB_PATH = path.join(__dirname, 'db.json')

app.use(express.json({ limit: '15mb' }))

async function ensureDb() {
  try {
    await fs.access(DB_PATH)
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify({ documents: [], todos: [] }, null, 2), 'utf8')
  }
}

async function readDb() {
  await ensureDb()
  const raw = await fs.readFile(DB_PATH, 'utf8')
  const parsed = JSON.parse(raw)
  return {
    documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    todos: Array.isArray(parsed.todos) ? parsed.todos : []
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

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
  const { title, docType, fields, imageDataUrl, notifyEnabled, notifyBeforeDays, expiresAt } = req.body ?? {}
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
  const imageDataUrl = req.body?.imageDataUrl
  const model = req.body?.model

  if (!apiKey) {
    res.status(500).json({ error: 'OPENROUTER_API_KEY не задан на сервере' })
    return
  }
  if (!imageDataUrl || !model) {
    res.status(400).json({ error: 'Требуются imageDataUrl и model' })
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
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Извлеки из изображения документа JSON формата {"title":"","docType":"","expiresAt":"YYYY-MM-DD или пусто","fields":{"key":"value"}}. Только валидный JSON без пояснений.'
              },
              { type: 'image_url', image_url: { url: imageDataUrl } }
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

app.listen(port, () => {
  console.log(`Proxy server listening on http://localhost:${port}`)
})
