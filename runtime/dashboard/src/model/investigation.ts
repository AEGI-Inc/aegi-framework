import type { ExceptionDataset } from './exception'
import { parseBoardAny } from '../event-board/boardV3'

/**
 * Event Board 조사 기록. 보드(직렬화한 BoardV2), 상태, 담당자, 종결 결론과 이력이다.
 * 배포본 실측은 팀 공용 D1(server/investigations.ts), 그 밖에는 이 브라우저에 둔다.
 * 이력은 상태나 담당자가 바뀔 때만 쌓는다. 보드 내용만 바꾼 저장은 이력을 늘리지 않는다.
 */
export type InvestigationState = 'open' | 'doing' | 'closed'

export const INVESTIGATION_STATES: InvestigationState[] = ['open', 'doing', 'closed']

export const INVESTIGATION_STATE_LABEL: Record<InvestigationState, string> = {
  open: 'New',
  doing: '조사 중',
  closed: '종결',
}

// 서버 본문 상한(1MB) 안에 들어가게, 보드 문자열이 JSON 안에서 이스케이프되어 커지는 몫을 남긴다
export const MAX_INVESTIGATION_BOARD = 800_000
export const MAX_INVESTIGATION_TITLE = 120
export const MAX_INVESTIGATION_ACTOR = 40
export const MAX_INVESTIGATION_OWNER = 40
export const MAX_INVESTIGATION_CONCLUSION = 2000

export interface InvestigationEvent {
  at: string
  state: InvestigationState
  actor?: string
  owner?: string
  note?: string
}

export interface InvestigationRecord {
  dataset: ExceptionDataset
  id: string
  title: string
  state: InvestigationState
  owner?: string
  conclusion?: string
  board: string
  createdAt: string
  updatedAt: string
  updatedBy?: string
  history: InvestigationEvent[]
}

export interface InvestigationChange {
  id: string
  title: string
  state: InvestigationState
  owner?: string
  conclusion?: string
  board: string
  actor: string
  expectedUpdatedAt?: string
}

export function investigationChangeProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '형식'
  const v = value as Record<string, unknown>
  for (const key of ['id', 'title', 'actor', 'board'] as const) {
    if (typeof v[key] !== 'string' || !(v[key] as string).trim()) return `${key} 없음`
  }
  const id = (v.id as string).trim()
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) return 'id 형식'
  const title = (v.title as string).trim()
  if (!title || title.length > MAX_INVESTIGATION_TITLE) return '제목 길이'
  const actor = (v.actor as string).trim()
  if (!actor || actor.length > MAX_INVESTIGATION_ACTOR) return '처리자 이름이 김'
  if (!INVESTIGATION_STATES.includes(v.state as InvestigationState)) return 'state'
  if (v.owner !== undefined && (typeof v.owner !== 'string' || (v.owner as string).trim().length > MAX_INVESTIGATION_OWNER)) return '담당자 이름이 김'
  if (v.conclusion !== undefined && (typeof v.conclusion !== 'string' || (v.conclusion as string).trim().length > MAX_INVESTIGATION_CONCLUSION)) return '결론이 김'
  if (v.state === 'closed' && (typeof v.conclusion !== 'string' || !(v.conclusion as string).trim())) return '종결 결론 필요'
  const boardStr = v.board as string
  if (boardStr.length > MAX_INVESTIGATION_BOARD) return '보드 크기 초과'
  if (!parseBoardAny(boardStr)) return '보드 파싱 실패'
  return null
}

export function applyInvestigationChange(
  previous: InvestigationRecord | undefined,
  change: InvestigationChange,
  dataset: ExceptionDataset,
  at: string,
): InvestigationRecord {
  const actor = change.actor.trim()
  const owner = change.owner?.trim() || undefined
  const conclusion = change.conclusion?.trim() || undefined
  const state = change.state

  const prevOwner = previous?.owner?.trim() || undefined
  const prevExists = previous !== undefined
  const shouldAppend = !prevExists || previous.state !== state || prevOwner !== owner

  let nextHistory = previous?.history ?? []
  if (shouldAppend) {
    const event: InvestigationEvent = {
      at,
      state,
      actor,
      ...(owner ? { owner } : {}),
      ...(state === 'closed' && conclusion ? { note: conclusion } : {}),
    }
    nextHistory = [...nextHistory, event]
  }

  return {
    dataset,
    id: change.id.trim(),
    title: change.title.trim(),
    state,
    owner,
    conclusion,
    board: change.board,
    createdAt: previous?.createdAt ?? at,
    updatedAt: at,
    updatedBy: actor,
    history: nextHistory,
  }
}
