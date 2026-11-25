import { useSyncExternalStore } from 'react'
import type { AssistantFocus, AssistantPlan, AssistantTurn } from './plan'
import type { AssistantResult } from './types'
import type { AssistantImage } from './images'
import type { WorkspaceContext } from './workspace'

export interface ConversationTurn extends AssistantTurn { id: number; answer?: string; focus?: AssistantFocus; contextFocus: AssistantFocus; credentialKey?: string; result?: AssistantResult; pathPlan?: AssistantPlan; error?: string; fixture?: boolean; images?: AssistantImage[]; workspace?: WorkspaceContext }

export interface Conversation { id: string; startedAt: number; updatedAt: number; turns: ConversationTurn[]; activeTurn: number }
interface ConversationState { current: Conversation; archived: Conversation[] }

/* AI 대화는 화면 하나가 아니라 이 탭 전체에 하나다. 화면 이동, 닫기, 새로고침에도 남고 새 대화를 열 때만 이전 대화로 넘어간다.
 * 쓰다 만 질문과 같이 sessionStorage 에 둔다. 브라우저 탭을 닫으면 지워진다 */
const STORAGE_KEY = 'aegi-ai-conversations'
export const ARCHIVE_LIMIT = 10
const TURN_LIMIT = 20

const blank = (): Conversation => ({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, startedAt: Date.now(), updatedAt: Date.now(), turns: [], activeTurn: 0 })

function read(): ConversationState {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? 'null') as ConversationState | null
    if (parsed && Array.isArray(parsed.current?.turns) && Array.isArray(parsed.archived)) return parsed
  } catch { /* 읽을 수 없으면 빈 대화로 시작 */ }
  return { current: blank(), archived: [] }
}

const withoutImages = (c: Conversation): Conversation => ({ ...c, turns: c.turns.map(({ images, ...turn }) => turn) })

/* 저장 공간이 모자라면 이미지부터 빼고, 그래도 모자라면 오래된 이전 대화부터 덜어 낸다 */
function write(next: ConversationState) {
  const attempts: ConversationState[] = [next, { current: next.current, archived: next.archived.map(withoutImages) }]
  for (let keep = next.archived.length - 1; keep >= 0; keep--) attempts.push({ current: withoutImages(next.current), archived: next.archived.slice(0, keep).map(withoutImages) })
  for (const attempt of attempts) {
    try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attempt)); return } catch { /* 다음 방법 */ }
  }
}

let state: ConversationState | null = null
const listeners = new Set<() => void>()
const current = () => (state ??= read())
function commit(next: ConversationState) {
  state = next; write(next)
  listeners.forEach(listener => listener())
}

export function useConversations(): ConversationState {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, current, current)
}

export function getConversation(): Conversation { return current().current }

export function updateTurns(update: (turns: ConversationTurn[]) => ConversationTurn[]) {
  const s = current(), turns = update(s.current.turns)
  if (turns !== s.current.turns) commit({ ...s, current: { ...s.current, turns: turns.slice(-TURN_LIMIT), updatedAt: Date.now() } })
}

export function setActiveTurnId(activeTurn: number) {
  const s = current()
  if (s.current.activeTurn !== activeTurn) commit({ ...s, current: { ...s.current, activeTurn } })
}

const archive = (archived: Conversation[], conversation: Conversation) => conversation.turns.length ? [conversation, ...archived].slice(0, ARCHIVE_LIMIT) : archived

/** 새 대화. 지금 대화는 이전 대화 목록 맨 앞으로 옮긴다 */
export function startNewConversation() {
  const s = current()
  commit({ current: blank(), archived: archive(s.archived, s.current) })
}

/** 이전 대화를 다시 연다. 지금 대화는 이전 대화 목록으로 옮긴다 */
export function openConversation(id: string): Conversation | undefined {
  const s = current()
  const found = s.archived.find(c => c.id === id)
  if (!found) return undefined
  commit({ current: found, archived: archive(s.archived.filter(c => c.id !== id), s.current) })
  return found
}
