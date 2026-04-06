import 'dotenv/config'
import express from 'express'

const app = express()
const port = Number(process.env.PORT ?? 8787)

app.use(express.json({ limit: '15mb' }))

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

app.listen(port, () => {
  console.log(`Proxy server listening on http://localhost:${port}`)
})
