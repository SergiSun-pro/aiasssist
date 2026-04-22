import type { ChatMessage } from './types'

export interface OpenRouterRequest {
  model: string
  messages: ChatMessage[]
  imageDataUrl?: string
  systemPrompt?: string
}

interface ProxyResponse {
  reply?: string
  error?: string
}

export async function requestOpenRouterCompletion({
  model,
  messages,
  imageDataUrl,
  systemPrompt
}: OpenRouterRequest): Promise<string> {
  const payloadMessages: unknown[] = []

  if (systemPrompt) {
    payloadMessages.push({ role: 'system', content: systemPrompt })
  }

  for (const [index, message] of messages.entries()) {
    const isLastMessage = index === messages.length - 1
    const canAttachImage = isLastMessage && message.role === 'user' && imageDataUrl

    if (canAttachImage) {
      payloadMessages.push({
        role: message.role,
        content: [
          { type: 'text', text: message.content },
          { type: 'image_url', image_url: { url: imageDataUrl } }
        ]
      })
    } else {
      payloadMessages.push({ role: message.role, content: message.content })
    }
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: payloadMessages
    })
  })

  const data = (await response.json()) as ProxyResponse

  if (!response.ok) {
    throw new Error(data.error ?? `Proxy error ${response.status}`)
  }

  const text = data.reply?.trim()
  if (!text) {
    throw new Error('OpenRouter вернул пустой ответ')
  }

  return text
}
