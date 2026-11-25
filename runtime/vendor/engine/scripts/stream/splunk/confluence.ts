import { sha256 } from './transport'

/** REST /wiki/rest/api/audit 는 id 없이 반환되기도 한다. JSON 키 순서에 무관한 원본 해시를 쓴다. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function confluenceId(raw: Record<string, unknown>): string {
  if (typeof raw.id === 'string' && raw.id || typeof raw.id === 'number' && Number.isFinite(raw.id)) return String(raw.id)
  return `sha256:${sha256(canonical(raw))}`
}

export function confluenceTime(raw: Record<string, unknown>): number | null {
  const value = raw.creationDate
  const ms = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? ms / 1000 : null
}

/** 조직 Guard 웹훅과 제품 REST 감사 기록을 혼동하지 않는다. */
export function isConfluenceAudit(raw: unknown): raw is Record<string, any> {
  return !!raw && typeof raw === 'object' && !Array.isArray(raw)
    && typeof (raw as any).summary === 'string' && !!(raw as any).summary
    && confluenceTime(raw as Record<string, unknown>) !== null
}
