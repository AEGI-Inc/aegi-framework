import type { ExceptionDataset } from './exception'
import type { RemediationStatus } from '../domain/remediation'

/**
 * 조치 진행 상태. 위협(지문) 하나와 조치 하나의 짝마다 한 기록이다.
 *
 * 전에는 브라우저에 조치 ID 하나로만 적어, 한 위협에서 바꾼 상태가 같은 조치를 쓰는 다른 위협에도 그대로 보였고
 * 팀이 함께 볼 수 없었으며 담당자와 기한이 없었다. 검증 완료는 검증자 이름을 반드시 남긴다.
 */
export const REMEDIATION_STATUSES: RemediationStatus[] = ['not_started', 'in_progress', 'completed', 'verified']

export const REMEDIATION_STATUS_LABEL: Record<RemediationStatus, string> = {
  not_started: '미착수',
  in_progress: '진행 중',
  completed: '조치 완료',
  verified: '검증 완료',
}

export const MAX_PROGRESS_ACTOR = 40
export const MAX_PROGRESS_OWNER = 40

export interface RemediationProgressEvent {
  at: string
  status: RemediationStatus
  actor?: string
  owner?: string
  due?: string
}

export interface RemediationProgressRecord {
  dataset: ExceptionDataset
  fingerprint: string
  remediationId: string
  /** 마지막으로 바꿀 때의 위협 ID 와 조치 제목 */
  findingId: string
  title: string
  status: RemediationStatus
  owner?: string
  /** 기한 YYYY-MM-DD */
  due?: string
  /** 완료한 검증 항목 ID */
  completedSteps: string[]
  verifiedBy?: string
  verifiedAt?: string
  updatedAt: string
  updatedBy?: string
  history: RemediationProgressEvent[]
}

export interface RemediationProgressChange {
  fingerprint: string
  remediationId: string
  findingId: string
  title: string
  status: RemediationStatus
  owner?: string
  due?: string
  completedSteps: string[]
  /** 바꾼 사람. 검증 완료면 검증자다 */
  actor: string
  expectedUpdatedAt?: string
}

export const progressKey = (fingerprint: string, remediationId: string) => `${fingerprint}#${remediationId}`

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function progressChangeProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '형식'
  const v = value as Record<string, unknown>
  for (const key of ['fingerprint', 'remediationId', 'findingId', 'title', 'actor'] as const) {
    if (typeof v[key] !== 'string' || !(v[key] as string).trim()) return `${key} 없음`
  }
  if (!REMEDIATION_STATUSES.includes(v.status as RemediationStatus)) return 'status'
  if ((v.actor as string).trim().length > MAX_PROGRESS_ACTOR) return '처리자 이름이 김'
  if (v.owner !== undefined && (typeof v.owner !== 'string' || v.owner.trim().length > MAX_PROGRESS_OWNER)) return '담당자 이름이 김'
  if (v.due !== undefined && v.due !== '' && (typeof v.due !== 'string' || !DATE.test(v.due))) return '기한 형식'
  if (!Array.isArray(v.completedSteps) || v.completedSteps.length > 50 || v.completedSteps.some(s => typeof s !== 'string' || s.length > 80)) return '검증 항목'
  if ((v.fingerprint as string).length > 600 || (v.title as string).length > 400 || (v.remediationId as string).length > 80) return '길이'
  return null
}

export function applyProgressChange(
  previous: RemediationProgressRecord | undefined,
  change: RemediationProgressChange,
  dataset: ExceptionDataset,
  at: string
): RemediationProgressRecord {
  const actor = change.actor.trim()
  const owner = change.owner?.trim() || undefined
  const due = change.due || undefined
  const verified = change.status === 'verified'
  return {
    dataset,
    fingerprint: change.fingerprint,
    remediationId: change.remediationId,
    findingId: change.findingId,
    title: change.title,
    status: change.status,
    owner,
    due,
    completedSteps: [...new Set(change.completedSteps)],
    verifiedBy: verified ? actor : undefined,
    verifiedAt: verified ? at : undefined,
    updatedAt: at,
    updatedBy: actor,
    history: [...(previous?.history ?? []), { at, status: change.status, actor, ...(owner ? { owner } : {}), ...(due ? { due } : {}) }],
  }
}
