export type Role = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  createdAt: number
  model?: string
  attachmentName?: string
  displayImage?: string
  taskProposal?: Record<string, unknown>
  routineProposal?: Record<string, unknown>
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface AppState {
  conversations: Conversation[]
  activeConversationId: string | null
}

export interface DocumentRecord {
  id: string
  title: string
  docType: string
  fields: Record<string, string>
  tags?: string[]
  imageDataUrl?: string
  notifyEnabled: boolean
  notifyBeforeDays: number
  expiresAt?: string
  createdAt: number
  updatedAt: number
}

export interface TodoItem {
  id: string
  documentId: string
  text: string
  dueDate: string
  done: boolean
  createdAt: number
}

export type TaskType = 'fixed' | 'flexible' | 'periodic'
export type OnMissed = 'skip' | 'accumulate' | 'reschedule'

export interface Routine {
  id: string
  title: string
  daysOfWeek: number[]   // 0=вс, 1=пн, 2=вт, 3=ср, 4=чт, 5=пт, 6=сб
  time?: string
  weight: number
  context: string
  color: string
  onMissed: OnMissed
  notes: string
  tags?: string[]
  createdAt: number
  updatedAt: number
}

export interface RoutineLog {
  id: string
  routineId: string
  date: string           // YYYY-MM-DD
  status: 'done' | 'skipped'
  createdAt: number
}

export interface Habit {
  id: string
  title: string
  description: string
  icon: string
  color: string
  targetCount: number    // сколько раз в день
  daysOfWeek?: number[]  // если пусто — каждый день
  notes: string
  tags?: string[]
  createdAt: number
  updatedAt: number
}

export interface HabitLog {
  id: string
  habitId: string
  date: string           // YYYY-MM-DD
  count: number
  createdAt: number
}

export interface ScheduledTask {
  id: string
  title: string
  type: TaskType
  weight: number
  context: string
  conditions: string
  deadline?: string
  scheduledDate?: string
  scheduledTime?: string
  recurrence?: string
  onMissed: OnMissed
  accumulation: number
  chainId?: string
  chainOrder?: number
  done: boolean
  skipped: boolean
  notes: string
  createdAt: number
  updatedAt: number
}

export interface InstructionStep {
  id: string
  text: string
  imageDataUrl?: string
  attachmentName?: string
  attachmentDataUrl?: string
}

export interface Instruction {
  id: string
  title: string
  tags: string[]
  steps: InstructionStep[]
  createdAt: number
  updatedAt: number
}

export interface AppNotification {
  id: string
  text: string
  createdAt: number
  read: boolean
}
