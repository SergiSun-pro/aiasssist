export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'OPENROUTER_API_KEY не задан' })
    return
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}
  const { model, messages } = body
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
        messages
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

    res.status(200).json({ reply })
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown proxy error'
    })
  }
}
