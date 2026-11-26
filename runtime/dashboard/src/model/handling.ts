import type { ExceptionDataset } from './exception'

/**
 * 위협 처리 상태. 예외(가림)와 다르게, 위협은 그대로 보이면서 팀이 어디까지 손댔는지를 남긴다.
 *
 * - new: New. 기록이 없으면 이 상태다
 * - ack: Confirmed. 누군가 읽고 맡았다
 * - doing: In Progress
 * - done: Solved. 사람이 고를 때는 검증자 이름을 반드시 남긴다.
 *   이 상태와 별개로, 처리하던 위협이 다음 수집에서 사라지면 화면은 자동으로 Solved 로 본다
 *
 * 위협 지문(fingerprintOf)에 붙여 두므로, 수집을 다시 해 위협 ID 가 바뀌어도 같은 구성의 위협이면 이어진다.
 */
export type HandlingState = 'new' | 'ack' | 'doing' | 'done'

export const HANDLING_STATES: HandlingState[] = ['new', 'ack', 'doing', 'done']

export const HANDLING_LABEL: Record<HandlingState, string> = {
  new: 'New',
  ack: 'Confirmed',
  doing: 'In Progress',
  done: 'Solved',
}

export const MAX_HANDLING_ACTOR = 40
export const MAX_HANDLING_OWNER = 40
export const MAX_HANDLING_NOTE = 300

export interface HandlingEvent {
  at: string
  state: HandlingState
  actor?: string
  owner?: string
  note?: string
}

export interface ThreatHandling {
  dataset: ExceptionDataset
  fingerprint: string
  /** 마지막으로 바꿀 때의 위협 ID 와 제목. 위협이 사라진 뒤에도 무엇이었는지 보이게 남긴다 */
  findingId: string
  title: string
  state: HandlingState
  owner?: string
  note?: string
  /** state 가 done 일 때 검증한 사람과 시각 */
  verifiedBy?: string
  verifiedAt?: string
  updatedAt: string
  updatedBy?: string
  history: HandlingEvent[]
}

/** 처리 상태를 바꾸는 요청 (화면에서 서버나 브라우저 저장소로) */
export interface HandlingChange {
  fingerprint: string
  findingId: string
  title: string
  state: HandlingState
  owner?: string
  note?: string
  /** 바꾼 사람. 해결됨이면 검증자다 */
  actor: string
  /** 마지막으로 본 기록의 updatedAt. 그사이 다른 사람이 바꿨으면 거절한다 */
  expectedUpdatedAt?: string
}

/** 바꾸는 요청이 규칙에 맞는지. 맞으면 null */
export function handlingChangeProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '형식'
  const v = value as Record<string, unknown>
  for (const key of ['fingerprint', 'findingId', 'title', 'actor'] as const) {
    if (typeof v[key] !== 'string' || !(v[key] as string).trim()) return `${key} 없음`
  }
  if (!HANDLING_STATES.includes(v.state as HandlingState)) return 'state'
  if ((v.actor as string).trim().length > MAX_HANDLING_ACTOR) return '처리자 이름이 김'
  if (v.owner !== undefined && (typeof v.owner !== 'string' || v.owner.trim().length > MAX_HANDLING_OWNER)) return '담당자 이름이 김'
  if (v.note !== undefined && (typeof v.note !== 'string' || v.note.trim().length > MAX_HANDLING_NOTE)) return '메모가 김'
  if ((v.fingerprint as string).length > 600 || (v.title as string).length > 400) return '길이'
  return null
}

/** 요청을 적용한 새 기록. 처음이면 previous 없이 만든다 */
export function applyHandlingChange(previous: ThreatHandling | undefined, change: HandlingChange, dataset: ExceptionDataset, at: string): ThreatHandling {
  const actor = change.actor.trim()
  const owner = change.owner?.trim() || undefined
  const note = change.note?.trim() || undefined
  const done = change.state === 'done'
  return {
    dataset,
    fingerprint: change.fingerprint,
    findingId: change.findingId,
    title: change.title,
    state: change.state,
    owner,
    note,
    verifiedBy: done ? actor : undefined,
    verifiedAt: done ? at : undefined,
    updatedAt: at,
    updatedBy: actor,
    history: [...(previous?.history ?? []), { at, state: change.state, actor, ...(owner ? { owner } : {}), ...(note ? { note } : {}) }],
  }
}
