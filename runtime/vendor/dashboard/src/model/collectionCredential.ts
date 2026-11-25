/**
 * 수집 자격증명·계정 대장 (#adapters 아래 칸, 계획서 V2 4.1절 · T-54).
 *
 * 실측 수집기(`npm run collect`)가 쓰는 읽기 전용 자격증명과, 수집 때문에 만든 계정(DWD 가장 대상 · 수집 봇 사용자)을
 * 한 곳에서 관리한다 — 누가 발급했고, 무슨 권한이 있고, 비밀값은 어디 보관하고, 언제 만료·폐기하는지.
 *
 * **비밀값은 이 대장에 두지 않는다.** 토큰·개인 키는 `.env.collector` · 팀 비밀 보관소에만 있고, 대장에는
 * 보관 위치와 환경 변수 이름만 적는다. 모든 글자 칸은 `secretProblem()` 으로 토큰·키처럼 보이는 값을 거절한다
 * (화면·서버 둘 다). 브라우저 · D1 어디에도 비밀값이 남지 않게 하기 위해서다.
 *
 * 서버(server/credentials.ts)와 화면(src/credentials/)이 같은 규칙을 쓰도록 검사·상태 계산·변경(reduce)을 여기에 둔다.
 */

export type CredentialProvider = 'github' | 'okta' | 'slack' | 'gws' | 'salesforce' | 'atlassian' | 'gcp' | 'onepassword' | 'microsoft' | 'snowflake' | 'aws' | 'worker'

/** 자격증명(토큰·키)인가, 수집 때문에 만들거나 권한을 준 계정인가 */
export type CredentialCategory = 'credential' | 'account'

export type CredentialKind =
  | 'github_app'
  | 'personal_token'
  | 'service_app'
  | 'user_token'
  | 'bot_token'
  | 'config_token'
  | 'service_account'
  | 'api_token'
  | 'admin_account'
  | 'bot_account'
  | 'other'

/**
 * 저장하는 수명 단계. 만료·곧 만료는 날짜로 계산한다 (`credentialState`).
 * - planned: 대장에만 있고 아직 발급 전
 * - active: 발급해 수집에 쓰는 중
 * - revoked: 폐기·scope 회수·계정 삭제 완료 (지우지 않고 이력으로 남긴다)
 */
export type CredentialStatus = 'planned' | 'active' | 'revoked'

export type CredentialState = 'planned' | 'active' | 'expiring' | 'expired' | 'dispose_due' | 'revoked'

export type CredentialAction = 'created' | 'imported' | 'edited' | 'activated' | 'rotated' | 'revoked' | 'restored'

export interface CredentialHistoryEntry {
  at: string
  action: CredentialAction
  actor?: string
  note?: string
}

export interface CollectionCredential {
  /** CRED-GH-01 · CRED-GH-01-ENT · ACCT-GW-01 */
  id: string
  category: CredentialCategory
  provider: CredentialProvider
  kind: CredentialKind
  /** 표시 이름 (예: GitHub App aegi-collector (조직 설치)) */
  name: string
  /** 어떤 계정·주체로 호출하나 (앱 이름, 서비스 계정 이메일, 가장 대상 등). 비밀값 아님 */
  principal: string
  /** 발급·관리 책임 (역할 또는 사람) */
  owner: string
  /** scope · 권한 · 역할 */
  permissions: string[]
  /** `.env.collector` 변수 이름 (값이 아니라 이름) */
  envKeys: string[]
  /** 비밀값 보관 위치 (예: 팀 비밀 보관소, setup-output/secrets/…). 값은 적지 않는다 */
  storage: string
  /** 이 자격증명으로 부르는 수집 호출 ID (예: GH-01, SL-05). 수집기 상태가 있으면 화면이 거기서 채운다 */
  calls: string[]
  /** 같이 관리할 항목 (자격증명 ↔ 계정) */
  related: string[]
  /** 발급(또는 마지막 교체) 날짜 YYYY-MM-DD */
  issuedAt: string | null
  /** 자격증명 자체의 만료일 YYYY-MM-DD (PAT 7일, 평가판 만료 등). 없으면 null */
  expiresAt: string | null
  /** 폐기 예정일 YYYY-MM-DD (계획서 4.1절 폐기 칸, T-54) */
  disposeBy: string | null
  /** 폐기 방법 (App 제거, scope 회수, DWD 해제·키 폐기 …) */
  disposal: string
  notes: string
  status: CredentialStatus
  createdAt: string
  updatedAt: string
  revokedAt?: string
  revokedBy?: string
  history: CredentialHistoryEntry[]
  /**
   * 'registry' 면 aegi-knowledge environments/registry 와 Vault 메타데이터에서 engine `npm run env:ledger` 가 만든 항목이다.
   * 화면과 서버는 고치지 않는다(정의를 고친 뒤 다시 만든다). 없으면 사람이 등록한 항목.
   */
  source?: 'registry'
}

export const PROVIDER_LABELS: Record<CredentialProvider, string> = {
  github: 'GitHub',
  okta: 'Okta',
  slack: 'Slack',
  gws: 'Google Workspace',
  salesforce: 'Salesforce',
  atlassian: 'Atlassian',
  gcp: 'GCP (Gemini Enterprise)',
  onepassword: '1Password',
  microsoft: 'Microsoft 365',
  snowflake: 'Snowflake',
  aws: 'AWS',
  worker: '시나리오 봇 Worker',
}

export const CATEGORY_LABELS: Record<CredentialCategory, string> = { credential: '자격증명', account: '계정' }

export const KIND_LABELS: Record<CredentialKind, string> = {
  github_app: 'GitHub App',
  personal_token: '개인 토큰 PAT',
  service_app: 'API 서비스 앱',
  user_token: '사용자 토큰',
  bot_token: '봇 토큰',
  config_token: '앱 설정 토큰',
  service_account: '서비스 계정 키',
  api_token: 'API 토큰',
  admin_account: '관리자 계정',
  bot_account: '봇 사용자',
  other: '기타',
}

export const STATUS_LABELS: Record<CredentialStatus, string> = { planned: '발급 전', active: '사용 중', revoked: '폐기됨' }

export const STATE_LABELS: Record<CredentialState, string> = {
  planned: '발급 전',
  active: '사용 중',
  expiring: '곧 만료',
  expired: '만료',
  dispose_due: '폐기 기한 초과',
  revoked: '폐기됨',
}

export const ACTION_LABELS: Record<CredentialAction, string> = {
  created: '등록',
  imported: '가져옴',
  edited: '수정',
  activated: '발급',
  rotated: '교체',
  revoked: '폐기',
  restored: '복원',
}

/** 만료·폐기 예정일까지 이 날수 이하면 곧 만료로 본다 */
export const EXPIRING_SOON_DAYS = 7

export const ID_PATTERN = /^(CRED|ACCT)-[A-Z]{2}-\d{2}(-[A-Z0-9]{2,8})?$/
export const MAX_TEXT = 200
export const MAX_NOTES = 1000
export const MAX_LIST = 40
export const MAX_ACTOR = 60
export const MAX_HISTORY = 200

const PROVIDERS = Object.keys(PROVIDER_LABELS) as CredentialProvider[]
const CATEGORIES = Object.keys(CATEGORY_LABELS) as CredentialCategory[]
const KINDS = Object.keys(KIND_LABELS) as CredentialKind[]
const STATUSES = Object.keys(STATUS_LABELS) as CredentialStatus[]
const ACTIONS = Object.keys(ACTION_LABELS) as CredentialAction[]
const DATE = /^\d{4}-\d{2}-\d{2}$/

// ---------------------------------------------------------------------------
// 비밀값 거절
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '개인 키(PEM)'],
  [/"private_key"\s*:/, '서비스 계정 키 JSON'],
  [/\bxox[abposre]-[A-Za-z0-9-]{8,}/, 'Slack 토큰'],
  [/\bxapp-[A-Za-z0-9-]{8,}/, 'Slack 앱 토큰'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/, 'GitHub 토큰'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained PAT'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./, 'JWT'],
  [/\bAIza[0-9A-Za-z_-]{30,}/, 'Google API 키'],
  [/\bSSWS\s+\S{20,}/, 'Okta API 토큰'],
  [/hooks\.slack\.com\/(services|workflows)\/\S+/, 'Slack 웹훅 URL'],
  [/\b(Bearer|DPoP)\s+[A-Za-z0-9._~+/-]{20,}/, 'Authorization 헤더 값'],
]

/** 이웃한 두 글자(영문·숫자만)의 종류(대문자 · 소문자 · 숫자)가 다른 비율. 무작위 문자열은 0.6 안팎, 이름·경로는 0.1 아래 */
function classMixRatio(chunk: string): number {
  const kinds = [...chunk.replace(/[^A-Za-z0-9]/g, '')].map(ch => (ch >= 'a' && ch <= 'z' ? 'l' : ch >= 'A' && ch <= 'Z' ? 'u' : 'd'))
  if (kinds.length < 2) return 0
  let changes = 0
  for (let i = 1; i < kinds.length; i++) if (kinds[i] !== kinds[i - 1]) changes += 1
  return changes / (kinds.length - 1)
}

/**
 * 토큰·키처럼 보이면 그 종류를, 아니면 null.
 * 알려진 형식 말고도, 공백 없이 32자 넘게 이어지고 영문 대·소문자·숫자가 모두 든 덩어리 중 글자 종류가 자주 바뀌는 것
 * (이웃한 글자 셋 중 하나 넘게)을 무작위 비밀값으로 본다. scope 이름 · 환경 변수 이름 · 문서 경로
 * (`docs/spec/AEGI_REAL_DATA_COLLECTION_PLAN_V2`)는 대문자·소문자가 길게 이어져 걸리지 않는다 —
 * 전에는 세 종류가 섞이기만 하면 걸려, 메모에 문서 경로를 적어도 저장을 거절했다.
 */
export function secretProblem(text: string): string | null {
  for (const [pattern, label] of SECRET_PATTERNS) if (pattern.test(text)) return label
  for (const chunk of text.match(/[A-Za-z0-9+/=_-]{32,}/g) ?? []) {
    if (/[a-z]/.test(chunk) && /[A-Z]/.test(chunk) && /\d/.test(chunk) && classMixRatio(chunk) >= 0.35) return '무작위 비밀값'
  }
  return null
}

// ---------------------------------------------------------------------------
// 검사
// ---------------------------------------------------------------------------

const isStr = (v: unknown): v is string => typeof v === 'string'
const isDateOrNull = (v: unknown) => v === null || (isStr(v) && DATE.test(v) && !Number.isNaN(Date.parse(v)))
/** 기록 시각 (ISO). 길이를 막아 둔다 — 시각 칸에 긴 글(비밀값)을 숨기지 못하게 */
const isStamp = (v: unknown): v is string => isStr(v) && v.length <= 40 && !Number.isNaN(Date.parse(v))
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 사람이 고칠 수 있는 칸 */
export type CredentialFields = Pick<
  CollectionCredential,
  | 'category'
  | 'provider'
  | 'kind'
  | 'name'
  | 'principal'
  | 'owner'
  | 'permissions'
  | 'envKeys'
  | 'storage'
  | 'calls'
  | 'related'
  | 'issuedAt'
  | 'expiresAt'
  | 'disposeBy'
  | 'disposal'
  | 'notes'
>

export const EDITABLE_FIELDS: Array<keyof CredentialFields> = [
  'category',
  'provider',
  'kind',
  'name',
  'principal',
  'owner',
  'permissions',
  'envKeys',
  'storage',
  'calls',
  'related',
  'issuedAt',
  'expiresAt',
  'disposeBy',
  'disposal',
  'notes',
]

/** 고칠 수 있는 칸의 문제. 없으면 null */
export function fieldsProblem(f: Partial<CredentialFields>): string | null {
  if (f.category !== undefined && !CATEGORIES.includes(f.category)) return '분류가 올바르지 않습니다'
  if (f.provider !== undefined && !PROVIDERS.includes(f.provider)) return 'SaaS 가 올바르지 않습니다'
  if (f.kind !== undefined && !KINDS.includes(f.kind)) return '유형이 올바르지 않습니다'
  if (f.name !== undefined && (!isStr(f.name) || !f.name.trim())) return '이름을 적어 주세요'
  for (const key of ['name', 'principal', 'owner', 'storage', 'disposal'] as const) {
    const v = f[key]
    if (v === undefined) continue
    if (!isStr(v) || v.length > MAX_TEXT) return `${key} 는 ${MAX_TEXT}자 이하 글자여야 합니다`
  }
  if (f.notes !== undefined && (!isStr(f.notes) || f.notes.length > MAX_NOTES)) return `메모는 ${MAX_NOTES}자 이하여야 합니다`
  for (const key of ['permissions', 'envKeys', 'calls', 'related'] as const) {
    const v = f[key]
    if (v === undefined) continue
    if (!Array.isArray(v) || v.length > MAX_LIST || !v.every(s => isStr(s) && s.trim() && s.length <= 120)) return `${key} 목록이 올바르지 않습니다`
  }
  if (f.envKeys?.some(k => !/^[A-Z][A-Z0-9_]*$/.test(k))) return '환경 변수 칸에는 값이 아닌 이름을 대문자, 숫자, 밑줄로 적어 주세요'
  for (const key of ['issuedAt', 'expiresAt', 'disposeBy'] as const) {
    if (f[key] !== undefined && !isDateOrNull(f[key])) return `${key} 날짜 형식은 YYYY-MM-DD 입니다`
  }
  const texts = [f.name, f.principal, f.owner, f.storage, f.disposal, f.notes, ...(f.permissions ?? []), ...(f.envKeys ?? []), ...(f.calls ?? []), ...(f.related ?? [])]
  for (const t of texts) {
    const secret = isStr(t) ? secretProblem(t) : null
    if (secret) return `비밀값(${secret})처럼 보이는 글자가 있습니다. 대장에는 보관 위치, 이름만 적고 값은 넣지 않습니다`
  }
  return null
}

/** 레코드가 가질 수 있는 칸. 이것 말고는 저장하지 않는다 — 모르는 칸에 비밀값이 섞여 들어오지 않게 */
const RECORD_KEYS: ReadonlyArray<string> = [...EDITABLE_FIELDS, 'id', 'status', 'createdAt', 'updatedAt', 'revokedAt', 'revokedBy', 'history', 'source']
const HISTORY_KEYS: ReadonlyArray<string> = ['at', 'action', 'actor', 'note']

/**
 * 레코드 전체 형식 검사 (가져오기 · 서버 · 브라우저 저장소). 없으면 null.
 * 글자가 들어가는 칸은 모두 비밀값 검사를 거친다 — 고칠 수 있는 칸, 폐기한 사람, 이력의 처리자 · 메모.
 * 모르는 칸이 있으면 거절한다(들여올 때는 `toCredential` 이 먼저 뺀다).
 */
export function credentialProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return '객체가 아님'
  const extra = Object.keys(value).filter(key => !RECORD_KEYS.includes(key))
  if (extra.length) return `모르는 칸: ${extra.slice(0, 3).join(', ')}`
  const c = value as Partial<CollectionCredential>
  if (!isStr(c.id) || !ID_PATTERN.test(c.id)) return 'ID 형식: CRED-XX-00, ACCT-XX-00'
  if (!STATUSES.includes(c.status as CredentialStatus)) return '상태'
  if (!isStamp(c.createdAt) || !isStamp(c.updatedAt)) return '시각'
  if (c.revokedAt !== undefined && !isStamp(c.revokedAt)) return '폐기 시각'
  if (c.revokedBy !== undefined && actorProblem(c.revokedBy)) return '폐기한 사람'
  if (c.source !== undefined && c.source !== 'registry') return '출처'
  if (!Array.isArray(c.history) || c.history.length === 0 || c.history.length > MAX_HISTORY) return '이력'
  for (const h of c.history as unknown[]) {
    if (!isPlainObject(h) || Object.keys(h).some(key => !HISTORY_KEYS.includes(key))) return '이력 항목'
    if (!isStamp(h.at) || !ACTIONS.includes(h.action as CredentialAction)) return '이력 항목'
    if (h.actor !== undefined && actorProblem(h.actor)) return '이력 처리자'
    if (h.note !== undefined && (!isStr(h.note) || h.note.length > MAX_NOTES || secretProblem(h.note))) return '이력 메모'
  }
  for (const key of EDITABLE_FIELDS) if (c[key] === undefined) return `${key} 없음`
  return fieldsProblem(c as CredentialFields)
}

/** 고칠 수 있는 칸만 골라 낸다 (등록 요청 · 새 항목) */
export function pickFields(value: unknown): Partial<CredentialFields> {
  if (!isPlainObject(value)) return {}
  const out: Record<string, unknown> = {}
  for (const key of EDITABLE_FIELDS) if (value[key] !== undefined) out[key] = value[key]
  return out as Partial<CredentialFields>
}

/**
 * 들여온 값(가져오기 파일 · 브라우저 저장소 · 서버 가져오기 요청)을 알려진 칸만 남긴 레코드로 바꾸고 검사한다.
 * `dropped` 는 뺀 모르는 칸 이름 — 가져오기 미리보기가 알려 준다.
 */
export function toCredential(value: unknown): { item: CollectionCredential; dropped: string[] } | { problem: string } {
  if (!isPlainObject(value)) return { problem: '객체가 아님' }
  const out: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, v] of Object.entries(value)) {
    if (RECORD_KEYS.includes(key)) out[key] = v
    else dropped.push(key)
  }
  if (Array.isArray(out.history)) {
    out.history = out.history.map(entry => {
      if (!isPlainObject(entry)) return entry
      const kept: Record<string, unknown> = {}
      for (const key of HISTORY_KEYS) if (entry[key] !== undefined) kept[key] = entry[key]
      for (const key of Object.keys(entry)) if (!HISTORY_KEYS.includes(key)) dropped.push(`history.${key}`)
      return kept
    })
  }
  const problem = credentialProblem(out)
  return problem ? { problem } : { item: out as unknown as CollectionCredential, dropped: [...new Set(dropped)] }
}

/** 환경 정의에서 자동으로 만든 항목인가. 이런 항목은 화면, 서버에서 고치거나 지우지 않는다 */
export const isGenerated = (c: Pick<CollectionCredential, 'source'>): boolean => c.source === 'registry'
export const GENERATED_PROBLEM = '자동 생성 항목입니다. aegi-knowledge environments/registry 를 고친 뒤 engine npm run env:ledger 로 다시 만듭니다'

export function actorProblem(actor: unknown): string | null {
  if (!isStr(actor) || !actor.trim()) return '처리자 이름을 적어 주세요'
  if (actor.trim().length > MAX_ACTOR) return `처리자 이름은 ${MAX_ACTOR}자 이하입니다`
  if (secretProblem(actor)) return '처리자 칸에 비밀값처럼 보이는 글자가 있습니다'
  return null
}

// ---------------------------------------------------------------------------
// 상태
// ---------------------------------------------------------------------------

const DAY = 864e5

/**
 * 오늘부터 date(YYYY-MM-DD)까지 남은 날수. date 당일이면 0, 지났으면 음수.
 * 만료일은 시각이 없는 날짜라 보는 사람의 달력(이 기기의 시간대)으로 센다 — 전에는 UTC 로 세어,
 * 한국에서는 오전 9시 전까지 하루 늦게(만료 당일에 D-1) 보였다.
 */
export function daysLeft(date: string | null, now: Date): number | null {
  if (!date || !DATE.test(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((new Date(y, m - 1, d).getTime() - today) / DAY)
}

/** 이 기기의 오늘 날짜 YYYY-MM-DD (발급일 기본값). toISOString 은 UTC 라 한국 오전에는 어제가 된다 */
export function todayString(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** 날짜까지 반영한 지금 상태. 만료가 폐기 기한보다 먼저 보인다 */
export function credentialState(c: CollectionCredential, now: Date): CredentialState {
  if (c.status === 'revoked') return 'revoked'
  if (c.status === 'planned') return 'planned'
  const exp = daysLeft(c.expiresAt, now)
  if (exp !== null && exp < 0) return 'expired'
  const dispose = daysLeft(c.disposeBy, now)
  if (dispose !== null && dispose < 0) return 'dispose_due'
  if ((exp !== null && exp <= EXPIRING_SOON_DAYS) || (dispose !== null && dispose <= EXPIRING_SOON_DAYS)) return 'expiring'
  return 'active'
}

/** 먼저 봐야 하는 순서 */
export const STATE_ORDER: CredentialState[] = ['expired', 'dispose_due', 'expiring', 'active', 'planned', 'revoked']

// ---------------------------------------------------------------------------
// 변경 — 화면(로컬 저장)과 서버가 같은 함수를 쓴다
// ---------------------------------------------------------------------------

export type CredentialChange =
  | { type: 'edit'; fields: Partial<CredentialFields> }
  | { type: 'activate'; issuedAt: string | null; expiresAt: string | null; note?: string }
  | { type: 'rotate'; issuedAt: string; expiresAt: string | null; note?: string }
  | { type: 'revoke'; note?: string }
  | { type: 'restore'; note?: string }

const trimList = (list: string[]) => [...new Set(list.map(s => s.trim()).filter(Boolean))]

/** 칸 값을 다듬는다 (앞뒤 공백, 목록 중복·빈 칸) */
export function cleanFields<T extends Partial<CredentialFields>>(f: T): T {
  const out: Partial<CredentialFields> = { ...f }
  for (const key of ['name', 'principal', 'owner', 'storage', 'disposal', 'notes'] as const) {
    const v = out[key]
    if (isStr(v)) out[key] = v.trim()
  }
  for (const key of ['permissions', 'envKeys', 'calls', 'related'] as const) {
    const v = out[key]
    if (Array.isArray(v)) out[key] = trimList(v)
  }
  for (const key of ['issuedAt', 'expiresAt', 'disposeBy'] as const) {
    if (out[key] === '') out[key] = null
  }
  if (out.calls) out.calls = out.calls.map(s => s.toUpperCase())
  return out as T
}

/**
 * 변경 하나를 적용한 새 레코드, 또는 거절 사유. at 은 기록 시각(서버는 서버 시각).
 * - 폐기된 항목은 다시 사용(restore) 말고는 바꾸지 않는다.
 * - 교체(rotate)는 발급일·만료일을 새로 적고 사용 중으로 둔다 — 비밀값 자체는 대장 밖에서 바꾼다.
 */
export function applyChange(
  current: CollectionCredential,
  change: CredentialChange,
  actor: string,
  at: string
): { item: CollectionCredential } | { problem: string } {
  const who = actorProblem(actor)
  if (who) return { problem: who }
  const note = isStr((change as { note?: unknown }).note) ? (change as { note: string }).note.trim().slice(0, MAX_NOTES) : undefined
  if (note && secretProblem(note)) return { problem: '메모에 비밀값처럼 보이는 글자가 있습니다' }
  if (isGenerated(current)) return { problem: GENERATED_PROBLEM }
  if (current.status === 'revoked' && change.type !== 'restore') return { problem: '폐기된 항목입니다. 복원한 뒤 바꿔 주세요' }
  const log = (action: CredentialAction, text?: string): CredentialHistoryEntry[] =>
    [...current.history, { at, action, actor: actor.trim(), ...(text ? { note: text } : {}) }].slice(-MAX_HISTORY)

  switch (change.type) {
    case 'edit': {
      if (!isPlainObject(change.fields)) return { problem: '고칠 칸이 없습니다' }
      const fields = cleanFields(pickFields(change.fields))
      const problem = fieldsProblem(fields)
      if (problem) return { problem }
      const changed = (Object.keys(fields) as Array<keyof CredentialFields>).filter(k => JSON.stringify(fields[k]) !== JSON.stringify(current[k]))
      if (!changed.length) return { problem: '바뀐 칸이 없습니다' }
      return { item: { ...current, ...fields, updatedAt: at, history: log('edited', changed.join(', ')) } }
    }
    case 'activate': {
      if (current.status !== 'planned') return { problem: '발급 전 항목만 발급 처리할 수 있습니다' }
      // 빠진 날짜는 「없음」(null) 으로 — undefined 로 두면 레코드가 깨져 다음에 불러올 때 버려진다
      const issuedAt = change.issuedAt || null
      const expiresAt = change.expiresAt || null
      const problem = fieldsProblem({ issuedAt, expiresAt })
      if (problem) return { problem }
      return { item: { ...current, status: 'active', issuedAt, expiresAt, updatedAt: at, history: log('activated', note) } }
    }
    case 'rotate': {
      if (!isStr(change.issuedAt) || !change.issuedAt) return { problem: '새 발급일을 적어 주세요' }
      const expiresAt = change.expiresAt || null
      const problem = fieldsProblem({ issuedAt: change.issuedAt, expiresAt })
      if (problem) return { problem }
      const text = [`발급 ${change.issuedAt}${expiresAt ? `, 만료 ${expiresAt}` : ''}`, note].filter(Boolean).join(' — ')
      return { item: { ...current, status: 'active', issuedAt: change.issuedAt, expiresAt, updatedAt: at, history: log('rotated', text) } }
    }
    case 'revoke': {
      if (!note) return { problem: '폐기 내용(무엇을 지웠는지)을 적어 주세요' }
      return { item: { ...current, status: 'revoked', revokedAt: at, revokedBy: actor.trim(), updatedAt: at, history: log('revoked', note) } }
    }
    case 'restore': {
      if (current.status !== 'revoked') return { problem: '폐기된 항목만 복원할 수 있습니다' }
      const { revokedAt: _a, revokedBy: _b, ...rest } = current
      return { item: { ...rest, status: 'active', updatedAt: at, history: log('restored', note) } }
    }
    default:
      return { problem: '모르는 변경입니다' }
  }
}

/** 새 항목 (등록 창 · 기본 목록 · 서버 등록). 고칠 수 있는 칸만 담는다 — 요청에 다른 칸이 섞여 있어도 저장하지 않는다 */
export function newCredential(fields: CredentialFields & { id: string; status: CredentialStatus }, actor: string, at: string, action: 'created' | 'imported' = 'created', note?: string): CollectionCredential {
  const clean = cleanFields(pickFields(fields)) as CredentialFields
  return {
    ...clean,
    id: fields.id.trim().toUpperCase(),
    status: fields.status,
    createdAt: at,
    updatedAt: at,
    history: [{ at, action, actor: actor.trim(), ...(note ? { note } : {}) }],
  }
}

// ---------------------------------------------------------------------------
// 기본 목록 — 계획서 V2 4.1절 (수집용 읽기 전용). 비밀값·테넌트 식별값은 넣지 않는다.
// ---------------------------------------------------------------------------

type Seed = CredentialFields & { id: string; status: CredentialStatus }

const seed = (s: Omit<Seed, 'calls' | 'related' | 'notes' | 'issuedAt' | 'expiresAt'> & Partial<Pick<Seed, 'calls' | 'related' | 'notes' | 'issuedAt' | 'expiresAt'>>): Seed => ({
  calls: [],
  related: [],
  notes: '',
  issuedAt: null,
  expiresAt: null,
  ...s,
})

export const PLAN_CATALOG: Seed[] = [
  seed({
    id: 'CRED-GH-01',
    category: 'credential',
    provider: 'github',
    kind: 'github_app',
    name: 'GitHub App aegi-collector 조직 설치',
    principal: 'GitHub App aegi-collector',
    owner: '엔터프라이즈 소유자',
    permissions: [
      '저장소 read: Metadata, Contents, Pull requests, Administration, Actions, Webhooks',
      '조직 read: Members, Administration, Personal access tokens, Custom repository roles, Webhooks',
    ],
    envKeys: ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY_FILE'],
    storage: 'GitHub App 개인 키(Manifest 생성 시 자동 저장 또는 .env GITHUB_APP_PRIVATE_KEY 설정)',
    related: ['CRED-GH-01-ENT'],
    disposeBy: '2026-10-31',
    disposal: 'App 제거',
    status: 'active',
    notes: '설치 토큰은 1시간마다 새로 받는다.',
  }),
  seed({
    id: 'CRED-GH-01-ENT',
    category: 'credential',
    provider: 'github',
    kind: 'github_app',
    name: 'GitHub App aegi-collector 엔터프라이즈 설치',
    principal: 'GitHub App aegi-collector',
    owner: '엔터프라이즈 소유자',
    permissions: ['엔터프라이즈 read: Enterprise administration'],
    envKeys: ['GITHUB_APP_ID', 'GITHUB_APP_ENTERPRISE_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY_FILE'],
    storage: 'CRED-GH-01 과 같은 개인 키',
    calls: ['GH-19'],
    related: ['CRED-GH-01'],
    disposeBy: '2026-10-31',
    disposal: '엔터프라이즈 설치 App 제거',
    status: 'active',
  }),
  seed({
    id: 'CRED-GH-02',
    category: 'credential',
    provider: 'github',
    kind: 'personal_token',
    name: '엔터프라이즈 소유자 보조 classic PAT',
    principal: '엔터프라이즈 소유자 계정',
    owner: '엔터프라이즈 소유자',
    permissions: ['read:enterprise', 'read:org', 'read:audit_log', 'SAML SSO 승인'],
    envKeys: ['GITHUB_OWNER_TOKEN'],
    storage: '.env.collector',
    calls: ['GH-20', 'GH-22', 'GH-23'],
    disposeBy: null,
    disposal: '발급 후 7일 안에 삭제 — 수집 주간에만 쓴다',
    status: 'active',
    notes: '만료일을 발급일 + 7일로 적어 둔다. GH-20 은 SAML 해제 전에 수집.',
  }),
  seed({
    id: 'CRED-OK-01',
    category: 'credential',
    provider: 'okta',
    kind: 'service_app',
    name: 'Okta API Service 앱 aegi-collector',
    principal: 'API Service 앱 aegi-collector, private_key_jwt + DPoP',
    owner: 'Okta 관리자',
    permissions: [
      'okta.users.read',
      'okta.groups.read',
      'okta.apps.read',
      'okta.roles.read',
      'okta.logs.read',
      'okta.clients.read',
      'okta.policies.read',
      'okta.orgs.read',
      '앱 역할: Read-only Administrator',
    ],
    envKeys: ['OKTA_ORG_URL', 'OKTA_COLLECTOR_CLIENT_ID', 'OKTA_COLLECTOR_KEY_ID', 'OKTA_COLLECTOR_PRIVATE_KEY_FILE'],
    storage: '개인 키 → 팀 비밀 보관소 setup-output/secrets/okta-collector-private-key.pem',
    expiresAt: '2026-10-17',
    disposeBy: null,
    disposal: '평가판과 함께 소멸',
    status: 'active',
    notes: '평가판 만료 약 10-17. 최종 수집은 10-15 까지.',
  }),
  seed({
    id: 'CRED-SL-01',
    category: 'credential',
    provider: 'slack',
    kind: 'user_token',
    name: 'SLACK-API-TESTER 조직 설치 사용자 토큰',
    principal: '앱 SLACK-API-TESTER — 조직 재설치한 Org Owner',
    owner: 'Org Owner',
    permissions: ['auditlogs:read', 'admin.teams:read', 'admin.users:read', 'admin.conversations:read', 'admin.apps:read', 'admin.usergroups:read'],
    envKeys: ['SLACK_COLLECTOR_USER_TOKEN'],
    storage: '.env.collector',
    disposeBy: '2026-10-31',
    disposal: 'scope 회수',
    status: 'active',
    notes: 'SL-09 team.integrationLogs 호출에서만 admin scope 추가.',
  }),
  seed({
    id: 'CRED-SL-02',
    category: 'credential',
    provider: 'slack',
    kind: 'bot_token',
    name: 'SLACK-API-TESTER 봇 토큰',
    principal: '앱 SLACK-API-TESTER 봇 사용자',
    owner: 'Org Owner',
    permissions: ['team:read', 'users:read', 'users:read.email', 'channels:read', 'groups:read', 'channels:history', 'groups:history', 'usergroups:read', 'files:read'],
    envKeys: ['SLACK_COLLECTOR_BOT_TOKEN'],
    storage: '.env.collector',
    related: ['ACCT-SL-01'],
    disposeBy: '2026-10-31',
    disposal: '봇 토큰 폐기, 쓰기 scope 없이 유지 확인',
    status: 'active',
  }),
  seed({
    id: 'CRED-SL-03',
    category: 'credential',
    provider: 'slack',
    kind: 'config_token',
    name: 'Slack 앱 설정 토큰',
    principal: '앱 소유자',
    owner: '앱 소유자',
    permissions: ['apps.manifest.export, 자체 앱 3개만'],
    envKeys: ['SLACK_CONFIG_TOKEN'],
    storage: '매번 새로 발급, 12시간 유효',
    calls: ['SL-10'],
    disposeBy: null,
    disposal: '자동 만료',
    status: 'active',
    notes: '12시간이면 끝난다. 수집 직전에 새로 받는다.',
  }),
  seed({
    id: 'CRED-GW-01',
    category: 'credential',
    provider: 'gws',
    kind: 'service_account',
    name: 'GCP 서비스 계정 collector@aegi-collector + DWD',
    principal: '서비스 계정 collector@aegi-collector, DWD 가장',
    owner: 'GWS 슈퍼 관리자',
    permissions: [
      'admin.directory.customer.readonly',
      'admin.directory.domain.readonly',
      'admin.directory.user.readonly',
      'admin.directory.group.readonly',
      'admin.directory.group.member.readonly',
      'admin.directory.rolemanagement.readonly',
      'admin.directory.user.security',
      'admin.reports.audit.readonly',
      'drive.metadata.readonly',
      'forms.body.readonly',
      'script.projects.readonly',
      'script.processes',
    ],
    envKeys: ['GWS_COLLECTOR_SA_KEY_FILE'],
    storage: '팀 비밀 보관소',
    related: ['ACCT-GW-01'],
    disposeBy: '2026-10-31',
    disposal: 'DWD 해제, 키 폐기',
    status: 'active',
    notes: '키가 막히면 signJwt. script.deployments.readonly 는 collector.config 의 gws.grantedScopes 에 적었을 때만 GW-11 호출에 쓴다.',
  }),
  seed({
    id: 'CRED-WK-01',
    category: 'credential',
    provider: 'worker',
    kind: 'api_token',
    name: '시나리오 봇 Worker 로그 API 토큰',
    principal: 'Worker Secret COLLECTOR_API_TOKEN (GET /api/logs/*)',
    owner: '수집기 개발',
    permissions: ['SL-12, GH-18, D-21 호출용 D1 읽기 전용 조회'],
    envKeys: ['WORKER_COLLECTOR_TOKEN_FILE'],
    storage: 'setup-output/secrets/worker-collector-api-token.txt, git 제외',
    disposeBy: '2026-10-31',
    disposal: 'Worker Secret 교체',
    status: 'active',
  }),
  seed({
    id: 'ACCT-GW-01',
    category: 'account',
    provider: 'gws',
    kind: 'admin_account',
    name: 'DWD 가장 대상 관리자 svc.collector',
    principal: 'GWS 사용자 svc.collector',
    owner: 'GWS 슈퍼 관리자',
    permissions: ['읽기 전용 관리자 역할'],
    envKeys: [],
    storage: '비밀번호 없이 DWD 가장만, collector.config 의 gws.adminSubject',
    related: ['CRED-GW-01'],
    disposeBy: '2026-10-31',
    disposal: '계정 정지, 삭제',
    status: 'active',
    notes: '2026-10-01 까지의 GWS에서는 collector-admin 이었고 테스트용 쓰기 권한이 있었다. 새 GWS 부터는 조직 단위 /Service Accounts 의 svc.collector 가 읽기 전용 역할만 받는다.',
  }),
  seed({
    id: 'ACCT-SL-01',
    category: 'account',
    provider: 'slack',
    kind: 'bot_account',
    name: 'Slack 수집 봇 사용자',
    principal: 'SLACK-API-TESTER 봇 사용자, 시나리오 채널 멤버',
    owner: 'Org Owner',
    permissions: ['시나리오 채널 4개 멤버십'],
    envKeys: [],
    storage: 'CRED-SL-02로 호출',
    related: ['CRED-SL-02'],
    disposeBy: '2026-10-31',
    disposal: '시나리오 채널에서 내보내기',
    status: 'active',
    notes: '채널 멤버십은 normalize.measurementPrincipals 로 그래프 판정에서 뺀다.',
  }),
]
