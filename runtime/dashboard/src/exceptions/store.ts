import { isThreatException, type ExceptionDataset, type ThreatException } from '../model/exception'

export { isThreatException }

/**
 * 예외 저장소 (1차: 브라우저 localStorage, 데이터셋별).
 *
 * 데이터셋마다 객체 키가 달라 한 곳에 섞지 않는다. 브라우저마다 따로 저장되므로
 * 팀원 사이 공유는 내보내기·가져오기(JSON)로 한다. 2차에 서버(KV·D1)로 바꿀 때는
 * 이 파일의 load/save/subscribe 만 바꾸면 된다.
 */

export const STORAGE_VERSION = 1
const ACTOR_KEY = 'aegi.exceptions.actor'

export function storageKey(dataset: ExceptionDataset): string {
  return `aegi.exceptions.v${STORAGE_VERSION}:${dataset}`
}

interface StoredFile {
  version: number
  items: ThreatException[]
}

export interface LoadResult {
  items: ThreatException[]
  /** 화면에 띄울 경고 (저장 불가, 깨진 기록 옮김 등) */
  warning?: string
}

/** localStorage 를 쓸 수 없을 때(사생활 보호 모드 등) 쓰는 메모리 저장소 */
const memory = new Map<string, ThreatException[]>()

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    const probe = '__aegi_probe__'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    return null
  }
}

export const MEMORY_WARNING = '이 브라우저에서는 예외를 저장할 수 없어, 새로고침하면 사라집니다.'

export function loadExceptions(dataset: ExceptionDataset): LoadResult {
  const store = storage()
  const key = storageKey(dataset)
  if (!store) return { items: memory.get(key) ?? [], warning: MEMORY_WARNING }
  const raw = store.getItem(key)
  if (!raw) return { items: [] }
  try {
    const parsed = JSON.parse(raw) as StoredFile
    if (!parsed || !Array.isArray(parsed.items)) throw new Error('shape')
    return { items: parsed.items.filter(isThreatException) }
  } catch {
    // 깨진 기록은 지우지 않고 옆으로 옮긴 뒤 빈 목록으로 시작한다.
    const moved = `${key}:corrupt-${Date.now()}`
    try {
      store.setItem(moved, raw)
      store.removeItem(key)
    } catch {
      /* 옮기지 못해도 읽기는 계속한다 */
    }
    return { items: [], warning: `저장된 예외 기록을 읽을 수 없어 ${moved} 로 옮기고 빈 목록으로 시작했습니다.` }
  }
}

/** 저장에 성공하면 true. 실패하면 메모리에만 남긴다. */
export function saveExceptions(dataset: ExceptionDataset, items: ThreatException[]): boolean {
  const key = storageKey(dataset)
  memory.set(key, items)
  const store = storage()
  if (!store) return false
  try {
    const file: StoredFile = { version: STORAGE_VERSION, items }
    store.setItem(key, JSON.stringify(file))
    return true
  } catch {
    return false
  }
}

/** 다른 탭에서 바꾼 것을 받는다. */
export function subscribeExceptions(dataset: ExceptionDataset, onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const key = storageKey(dataset)
  const handler = (event: StorageEvent) => {
    if (event.key === key) onChange()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}

export function loadActor(): string {
  try {
    return window.localStorage.getItem(ACTOR_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveActor(actor: string): void {
  try {
    window.localStorage.setItem(ACTOR_KEY, actor)
  } catch {
    /* 기억하지 못해도 된다 */
  }
}

const randomCode = () => {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
  return random.replace(/-/g, '').slice(0, 8).toUpperCase()
}

export function newExceptionId(): string {
  return `EXC-${randomCode()}`
}

/** 한 번에 등록한 예외 묶음(결정)의 ID */
export function newDecisionId(): string {
  return `DEC-${randomCode()}`
}

export interface ExportFile {
  kind: 'aegi-threat-exceptions'
  version: number
  dataset: ExceptionDataset
  exportedAt: string
  items: ThreatException[]
}

export function buildExport(dataset: ExceptionDataset, items: ThreatException[], now: Date): ExportFile {
  return { kind: 'aegi-threat-exceptions', version: STORAGE_VERSION, dataset, exportedAt: now.toISOString(), items }
}

export interface ImportPreview {
  accepted: ThreatException[]
  skipped: Array<{ id?: string; reason: string }>
  error?: string
}

/** 가져오기 미리보기. 합치기 전에 들어갈 것과 무시될 것을 보인다. */
export function previewImport(text: string, dataset: ExceptionDataset, existingIds: Set<string>): ImportPreview {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { accepted: [], skipped: [], error: 'JSON 파일을 읽을 수 없습니다.' }
  }
  const file = parsed as Partial<ExportFile>
  const items: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(file?.items) ? file.items : []
  if (!Array.isArray(parsed) && !Array.isArray(file?.items)) {
    return { accepted: [], skipped: [], error: '예외 내보내기 파일 형식이 아닙니다. items 목록이 없습니다.' }
  }
  const accepted: ThreatException[] = []
  const skipped: ImportPreview['skipped'] = []
  const seen = new Set(existingIds)
  for (const item of items) {
    if (!isThreatException(item)) {
      skipped.push({ id: (item as { id?: string })?.id, reason: '필수 항목이 빠진 기록' })
      continue
    }
    if (item.dataset !== dataset) {
      skipped.push({ id: item.id, reason: `다른 데이터셋 ${item.dataset}의 예외` })
      continue
    }
    if (seen.has(item.id)) {
      skipped.push({ id: item.id, reason: '이미 있는 ID' })
      continue
    }
    seen.add(item.id)
    accepted.push(item)
  }
  return { accepted, skipped }
}
