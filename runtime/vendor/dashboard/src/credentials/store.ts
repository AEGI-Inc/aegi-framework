import { toCredential, type CollectionCredential } from '../model/collectionCredential'

/**
 * 수집 자격증명 대장 — 브라우저 저장소(localStorage)와 서버(D1) 클라이언트.
 *
 * - 배포본: 팀 공용 D1 (server/credentials.ts). 실측과 같은 팀 비밀번호 세션이 있어야 한다.
 * - dev 서버: 이 브라우저. 팀원과 나누려면 내보내기 · 가져오기(JSON).
 * 어느 쪽이든 비밀값은 들어가지 않는다 (모델의 secretProblem 이 막는다).
 */

const KEY = 'aegi.collectionCredentials.v1'
export const MEMORY_WARNING = '이 브라우저에서는 대장을 저장할 수 없어, 새로고침하면 사라집니다.'

let memory: CollectionCredential[] = []

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    window.localStorage.setItem('__aegi_probe__', '1')
    window.localStorage.removeItem('__aegi_probe__')
    return window.localStorage
  } catch {
    return null
  }
}

export function loadLocal(): { items: CollectionCredential[]; warning?: string } {
  const store = storage()
  if (!store) return { items: memory, warning: MEMORY_WARNING }
  const raw = store.getItem(KEY)
  if (!raw) return { items: [] }
  try {
    const parsed = JSON.parse(raw) as { items?: unknown[] }
    if (!Array.isArray(parsed?.items)) throw new Error('shape')
    const items: CollectionCredential[] = []
    for (const value of parsed.items) {
      const normalized = toCredential(value)
      if ('item' in normalized) items.push(normalized.item)
    }
    const dropped = parsed.items.length - items.length
    return { items, warning: dropped ? `형식이 맞지 않는 기록 ${dropped}건은 건너뛰었습니다.` : undefined }
  } catch {
    store.setItem(`${KEY}:corrupt-${Date.now()}`, raw)
    store.removeItem(KEY)
    return { items: [], warning: '손상된 대장 기록을 별도 보관하고 빈 목록으로 시작했습니다.' }
  }
}

export function saveLocal(items: CollectionCredential[]): boolean {
  const store = storage()
  if (!store) {
    memory = items
    return false
  }
  store.setItem(KEY, JSON.stringify({ version: 1, items }))
  return true
}

export function subscribeLocal(onChange: () => void): () => void {
  const listener = (e: StorageEvent) => {
    if (e.key === KEY) onChange()
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}

// ---------------------------------------------------------------------------
// 내보내기 · 가져오기
// ---------------------------------------------------------------------------

export const EXPORT_KIND = 'aegi.collectionCredentials'

export function buildExport(items: CollectionCredential[], now: Date) {
  return { kind: EXPORT_KIND, version: 1, exportedAt: now.toISOString(), note: '비밀값 없음 — 발급자, 권한, 보관 위치, 만료, 폐기 계획만', items }
}

export interface ImportPreview {
  accepted: CollectionCredential[]
  skipped: Array<{ id?: string; reason: string }>
  /** 들여오면서 뺀 모르는 칸 이름 (다른 판이 더했거나 덧붙인 칸 — 저장하지 않는다) */
  droppedFields: string[]
  error?: string
}

export function previewImport(text: string, existing: Set<string>): ImportPreview {
  let parsed: { kind?: string; items?: unknown[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    return { accepted: [], skipped: [], droppedFields: [], error: 'JSON 파일이 아닙니다.' }
  }
  if (parsed?.kind !== EXPORT_KIND || !Array.isArray(parsed.items)) return { accepted: [], skipped: [], droppedFields: [], error: '수집 자격증명 대장에서 내보낸 파일이 아닙니다.' }
  const accepted: CollectionCredential[] = []
  const skipped: ImportPreview['skipped'] = []
  const droppedFields = new Set<string>()
  for (const value of parsed.items) {
    const rawId = (value as { id?: unknown } | null)?.id
    const id = typeof rawId === 'string' ? rawId.slice(0, 40) : undefined
    const normalized = toCredential(value)
    if ('problem' in normalized) skipped.push({ id, reason: `형식 오류: ${normalized.problem}` })
    else if (existing.has(normalized.item.id) || accepted.some(a => a.id === normalized.item.id)) skipped.push({ id, reason: '이미 있는 ID' })
    else {
      accepted.push(normalized.item)
      for (const key of normalized.dropped) droppedFields.add(key)
    }
  }
  return { accepted, skipped, droppedFields: [...droppedFields] }
}

// ---------------------------------------------------------------------------
// 서버
// ---------------------------------------------------------------------------

const BASE = '/api/measured/credentials'

export type RemoteProblem = 'not_configured' | 'login_required' | 'conflict' | 'rejected' | 'network' | 'server'

export class RemoteError extends Error {
  constructor(
    readonly problem: RemoteProblem,
    message: string,
    readonly body: Record<string, unknown> = {}
  ) {
    super(message)
  }
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
    throw new RemoteError('network', '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.')
  }
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new RemoteError('not_configured', '팀 공용 저장소가 아직 설정되지 않았습니다.')
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (res.ok) return data as T
  if (res.status === 401) throw new RemoteError('login_required', '팀 비밀번호로 로그인해야 합니다.', data)
  if (res.status === 503) throw new RemoteError('not_configured', '팀 공용 저장소가 아직 설정되지 않았습니다. 담당자는 aegi-adapter-engine에서 npm run measured -- exceptions-setup을 실행합니다.', data)
  if (res.status === 409) {
    const text =
      data.error === 'duplicate_id'
        ? '같은 ID 가 이미 있습니다.'
        : data.error === 'not_deletable'
          ? '발급 전 항목만 지울 수 있습니다. 사용한 항목은 폐기 처리하세요.'
          : '다른 사람이 먼저 이 항목을 바꿨습니다. 최신 내용을 다시 불러왔습니다 — 확인하고 다시 시도해 주세요.'
    throw new RemoteError('conflict', text, data)
  }
  if (res.status === 400) throw new RemoteError('rejected', `서버가 받지 않았습니다${typeof data.message === 'string' ? ` (${data.message})` : ''}.`, data)
  throw new RemoteError('server', '서버에서 오류가 났습니다. 잠시 뒤 다시 시도해 주세요.', data)
}

export const remote = {
  list: () => request<{ items: CollectionCredential[]; serverTime: string }>('GET', ''),
  create: (item: unknown, actor: string) => request<{ item: CollectionCredential }>('POST', '', { mode: 'create', actor, item }),
  importItems: (items: CollectionCredential[]) =>
    request<{ inserted: string[]; skipped: Array<{ id?: string; reason: string }>; items: CollectionCredential[] }>('POST', '', { mode: 'import', items }),
  change: (id: string, updatedAt: string, actor: string, change: unknown) =>
    request<{ item: CollectionCredential }>('POST', `/${encodeURIComponent(id)}/change`, { actor, updatedAt, change }),
  remove: (id: string, updatedAt: string) => request<{ removed: string }>('POST', `/${encodeURIComponent(id)}/delete`, { updatedAt }),
}

// ---------------------------------------------------------------------------
// 수집기 준비 상태 (dev 서버 전용, vite.config.ts → aegi-adapter-engine scripts/collect/credentialStatus.ts)
// ---------------------------------------------------------------------------

export interface CollectorStatus {
  generatedAt: string
  envFile: boolean
  configFile: boolean
  callsProblem: string | null
  runs: number
  lastRun: { runId: string; at: string } | null
  credentials: Array<{
    id: string
    keys: Array<{ name: string; set: boolean; source: 'value' | 'file' | 'file_unreadable' | 'missing' }>
    ready: boolean
    calls: Array<{ id: string; provider: string; title: string; unavailable: string | null; last?: { runId: string; at: string; completeness: string; reasons: string[] } }>
    lastUsedAt: string | null
  }>
}

/**
 * 개발 서버(vite.config.ts)나 이 경로를 직접 내주는 서버(aegi-demo)만 읽는다.
 * 후자는 빌드할 때 VITE_AEGI_COLLECTOR_STATUS=on 을 준다. 운영 Pages 빌드는 주지 않아 요청하지 않는다.
 */
export function isCollectorStatusConfigured(): boolean {
  return typeof import.meta !== 'undefined' && import.meta.env?.VITE_AEGI_COLLECTOR_STATUS === 'on'
}

export async function fetchCollectorStatus(): Promise<CollectorStatus | null> {
  if (!import.meta.env.DEV && !isCollectorStatusConfigured()) return null
  try {
    const res = await fetch('/__aegi/collector-status', { cache: 'no-store' })
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return null
    return (await res.json()) as CollectorStatus
  } catch {
    return null
  }
}
