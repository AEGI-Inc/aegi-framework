import type { ExceptionDataset, ExceptionReasonCategory, ThreatException } from '../model/exception'

/**
 * 서버(D1) 예외 저장소 클라이언트 — server/exceptions.ts 의 API 를 부른다.
 * 실측 데이터셋을 배포본에서 볼 때만 쓴다 (합성은 공개라 브라우저에만 저장한다). 세션은 실측 번들과 같은 팀 비밀번호 쿠키다.
 */

const BASE = '/api/measured/exceptions'

export type RemoteProblem = 'not_configured' | 'login_required' | 'conflict' | 'rejected' | 'network' | 'server'

export class RemoteError extends Error {
  constructor(
    readonly problem: RemoteProblem,
    message: string,
    readonly status = 0,
    readonly body: Record<string, unknown> = {}
  ) {
    super(message)
  }
}

const MESSAGES: Record<RemoteProblem, string> = {
  not_configured: '팀 공용 예외 저장소가 아직 설정되지 않았습니다.',
  login_required: '로그인 시간이 끝났습니다. 새로고침한 뒤 팀 비밀번호로 다시 로그인해 주세요.',
  conflict: '다른 사람이 먼저 이 예외를 바꿨습니다. 최신 목록을 다시 불러왔습니다 — 확인하고 다시 시도해 주세요.',
  rejected: '서버가 요청을 받지 않았습니다.',
  network: '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  server: '서버에서 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.',
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new RemoteError('network', MESSAGES.network)
  }
  // Function 이 없는 배포본은 index.html 이 온다
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new RemoteError('not_configured', MESSAGES.not_configured, res.status)
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) return data as T
  const code = typeof data.error === 'string' ? data.error : ''
  if (res.status === 401) throw new RemoteError('login_required', MESSAGES.login_required, 401, data)
  if (res.status === 503) throw new RemoteError('not_configured', MESSAGES.not_configured, 503, data)
  if (res.status === 409) {
    const text =
      code === 'undo_expired'
        ? '등록한 지 10분이 지나 되돌릴 수 없습니다. 예외 관리 화면에서 취소해 주세요.'
        : code === 'already_reapplied'
          ? '이미 다시 적용한 예외입니다.'
          : code === 'still_active'
            ? '아직 적용 중인 예외는 다시 적용할 수 없습니다.'
            : MESSAGES.conflict
    throw new RemoteError('conflict', text, 409, data)
  }
  if (res.status === 400) {
    const skipped = Array.isArray(data.skipped) ? (data.skipped as Array<{ reason?: string }>).map(s => s.reason).filter(Boolean) : []
    const detail = typeof data.message === 'string' ? data.message : skipped.join(', ')
    throw new RemoteError('rejected', `${MESSAGES.rejected}${detail ? ` (${detail})` : ''}`, 400, data)
  }
  throw new RemoteError('server', MESSAGES.server, res.status, data)
}

export interface InsertResult {
  inserted: string[]
  skipped: Array<{ id?: string; reason: string }>
  items: ThreatException[]
}

export const remote = {
  list: (dataset: ExceptionDataset) =>
    request<{ items: ThreatException[]; serverTime: string }>('GET', `?dataset=${encodeURIComponent(dataset)}`),
  insert: (dataset: ExceptionDataset, mode: 'create' | 'import', items: ThreatException[]) =>
    request<InsertResult>('POST', '', { dataset, mode, items }),
  revoke: (dataset: ExceptionDataset, id: string, actor: string, note?: string) =>
    request<{ item: ThreatException }>('POST', `/${id}/revoke`, { dataset, actor, note }),
  extend: (dataset: ExceptionDataset, id: string, expiresAt: string | null, actor: string, updatedAt?: string) =>
    request<{ item: ThreatException }>('POST', `/${id}/extend`, { dataset, actor, expiresAt, updatedAt }),
  edit: (
    dataset: ExceptionDataset,
    id: string,
    patch: { reasonCategory?: ExceptionReasonCategory; reason?: string; reference?: string },
    actor: string,
    updatedAt?: string
  ) => request<{ item: ThreatException }>('POST', `/${id}/edit`, { dataset, actor, ...patch, updatedAt }),
  reapply: (dataset: ExceptionDataset, id: string, item: ThreatException, actor: string) =>
    request<{ item: ThreatException; old: ThreatException }>('POST', `/${id}/reapply`, { dataset, actor, item }),
  undo: (dataset: ExceptionDataset, id: string) => request<{ removed: string }>('POST', `/${id}/undo`, { dataset }),
}
