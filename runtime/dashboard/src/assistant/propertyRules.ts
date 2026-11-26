/**
 * AI 도구가 모델에 넘기는 객체 속성 규칙 (2026-11-02 결정: 손으로 고른 목록 대신 규칙).
 * 비밀값으로 보이는 이름과 값, 긴 글(스크립트 본문 등)은 빼고, URL 은 호스트만 넘긴다.
 * 참, 거짓과 숫자는 이름과 상관없이 넘긴다 (is_private, token_expired 같은 상태 값은 비밀이 아니다).
 * 브라우저와 서버(server/graphTools.ts)가 같은 함수를 쓴다.
 */

/** 글자 값을 빼는 속성 이름: 비밀값, 서명, 세션, 키 자체와 개인 연락처 */
const SECRET_NAME = /secret|password|passwd|signature|private_?key|cookie|session_?id|phone|mobile|(^|_)(key|token|hash)$/i
/** 뜻을 읽을 수 없는 식별자 칸 (캐시 태그, 내부 노드 id) */
const NOISE_NAME = /(^|_)(etag|node_id|gravatar_id)$/i
/**
 * 본문 칸 이름 (수집기 sanitize.ts 의 contentKeys). 프레임워크는 권한 문제로 문서, 메시지, 스크립트 본문을 모델에 보이지 않는다 (2026-11-02 결정).
 * 수집기는 이 칸을 지문 묶음({ $fp, len, urls })으로 바꾸지만 이름 대소문자가 다르면 원문이 남는다(Salesforce ApexClass.Body).
 * 글자 값이면 넘기지 않고 세지도 않는다. 지문($로 시작하는 칸)은 뜻을 읽을 수 없어 뺀다.
 * 본문에서 뽑은 참조(정의 속 secret 이름, 링크 호스트, 설문 질문 제목, 스크립트가 부르는 서비스)는 대시보드 객체 상세에도 보이는 메타데이터라 넘긴다
 */
const BODY_NAME = /^(message|body|text|plain_text|preview|fallback|payload)$/i
/**
 * 정의가 참조하는 이름 목록(secret_refs, variable_refs, property_refs). 값이 아니라 비밀값, 변수의 이름이라 비밀값 이름 규칙에서 뺀다.
 * 같은 이름은 Actions 비밀값 객체 이름으로도 보인다
 */
const REF_NAMES = /_refs$/
/** 링크 참조 묶음 { host, sha256 }. 수집기가 주소를 host 와 지문으로 줄인 값이라 host 만 넘긴다 */
const isLinkRef = (x: unknown): x is { host: string } => !!x && typeof x === 'object' && !Array.isArray(x) && typeof (x as { host?: unknown }).host === 'string' && 'sha256' in x
/** 비밀값 모양: Slack, GitHub, AWS, OpenAI 토큰, JWT, PEM */
const SECRET_VALUE = /^(xox[a-z]-|gh[pousr]_|github_pat_|eyJ[\w-]+\.[\w-]+|-----BEGIN|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{8,})/
/** 띄어쓰기 없는 긴 값(해시, base64 덩어리, 커밋 sha). 뜻을 읽을 수 없어 뺀다 */
const OPAQUE = /^[A-Za-z0-9+/=_-]{40,}$/
const URL_VALUE = /^[a-z][a-z0-9+.-]*:\/\//i
/** 넘기는 글자 값 최대 길이. 더 길면 긴 글로 보고 뺀다 */
export const MAX_TEXT = 200
/** 목록 값에서 넘기는 항목 수 */
const MAX_ITEMS = 40
/** 묶음 속성을 펼치는 깊이 (permissions.contents 처럼 두 단계까지) */
const MAX_DEPTH = 2

export const isSecretName = (name: string) => SECRET_NAME.test(name)

/** search_objects property 로 고를 수 있는 이름: 글자, 숫자, 밑줄과 두 단계까지의 점. 비밀값 이름과 본문 칸은 안 된다 */
export function filterablePropertyName(path: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$/.test(path) && !path.split('.').some(isSecretName) && !BODY_NAME.test(path.slice(path.lastIndexOf('.') + 1))
}

/** 점으로 이은 이름의 값 (permissions.contents). 중간이 묶음이 아니면 undefined */
export function propertyAt(properties: Record<string, unknown>, path: string): unknown {
  let value: unknown = properties
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

type Leaf = { value: unknown; host: boolean } | null

function leaf(name: string, v: unknown): Leaf {
  if (typeof v === 'boolean' || typeof v === 'number') return { value: v, host: false }
  if (typeof v !== 'string' || !v) return null
  if (isSecretName(name) && !REF_NAMES.test(name) || SECRET_VALUE.test(v) || OPAQUE.test(v)) return null
  if (URL_VALUE.test(v)) {
    try { return { value: new URL(v).host || null, host: true } } catch { return null }
  }
  return v.length > MAX_TEXT ? null : { value: v, host: false }
}

/**
 * 모델에 넘길 속성. 원래 순서로 두되 URL 호스트는 뒤로 미룬다(링크 칸이 많아 앞을 가리지 않게).
 * 묶음은 점으로 이은 이름으로 두 단계까지 펼치고, 목록은 글자, 숫자 항목과 링크 참조의 host 만 넘긴다. limit 를 넘거나 규칙으로 뺀 값은 omitted 로 센다
 */
export function modelProperties(properties: Record<string, unknown>, limit: number): { properties: Record<string, unknown>; omitted: number } {
  const plain: Array<[string, unknown]> = [], hosts: Array<[string, unknown]> = []
  let omitted = 0
  const visit = (path: string, name: string, v: unknown, depth: number) => {
    if (name.startsWith('_') || name.startsWith('$') || BODY_NAME.test(name) && typeof v === 'string' || v === null || v === undefined) return
    if (NOISE_NAME.test(name)) { omitted++; return }
    if (Array.isArray(v)) {
      const leaves = v.flatMap(x => isLinkRef(x) ? [{ value: x.host, host: true }] : x === null || typeof x !== 'object' ? [leaf(name, x)] : []).filter((x): x is NonNullable<Leaf> => !!x && x.value !== null)
      if (!leaves.length) { if (v.length) omitted++; return }
      const bucket = leaves.every(x => x.host) ? hosts : plain
      bucket.push([path, [...new Set(leaves.slice(0, MAX_ITEMS).map(x => x.value))]])
      return
    }
    if (typeof v === 'object') {
      if (depth >= MAX_DEPTH) { omitted++; return }
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) visit(`${path}.${k}`, k, child, depth + 1)
      return
    }
    const l = leaf(name, v)
    if (!l || l.value === null) { omitted++; return }
    const bucket = l.host ? hosts : plain
    bucket.push([path, l.value])
  }
  for (const [k, v] of Object.entries(properties)) visit(k, k, v, 0)
  const all = [...plain, ...hosts]
  return { properties: Object.fromEntries(all.slice(0, limit)), omitted: omitted + Math.max(0, all.length - limit) }
}
