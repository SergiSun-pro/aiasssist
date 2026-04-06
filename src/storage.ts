import type { AppState, Conversation } from './types'

const STORAGE_KEY = 'aiassist.state.v1'

export interface ConversationsRepository {
  load(): AppState
  save(state: AppState): void
}

export class LocalConversationsRepository implements ConversationsRepository {
  load(): AppState {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return { conversations: [], activeConversationId: null }
    }

    try {
      const parsed = JSON.parse(raw) as AppState
      return {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        activeConversationId: parsed.activeConversationId ?? null
      }
    } catch {
      return { conversations: [], activeConversationId: null }
    }
  }

  save(state: AppState): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

export interface DbAdapter {
  fetchConversations(): Promise<Conversation[]>
  saveConversations(conversations: Conversation[]): Promise<void>
}

export const createDbAdapterPlaceholder = (): DbAdapter => {
  return {
    async fetchConversations() {
      return []
    },
    async saveConversations() {
      return
    }
  }
}
