/**
 * AI 가 만들고 윤문한 문구의 검사. 통과하지 못하면 캐시에 넣지 않는다.
 * 형식(JSON 스키마)은 모델 호출이 강제하고, 여기서는 글자 수, 금지 문자, 중괄호를 본다.
 */
import type { ProviderInput } from './inputs.ts'

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/
const URL_RE = /https?:\/\/|www\./i
const PHONE = /\d{2,4}-\d{3,4}-\d{4}/
const SLOT = /\{([^{}]*)\}/g

/** 모든 문자열 칸에 공통으로 적용한다 */
function textProblems(path: string, text: string): string[] {
  const out: string[] = []
  if (!text.trim()) out.push(`${path}: 비어 있다`)
  if (text.includes('·')) out.push(`${path}: 가운뎃점`)
  if (EMAIL.test(text)) out.push(`${path}: 메일 주소`)
  if (URL_RE.test(text)) out.push(`${path}: 주소(URL)`)
  if (PHONE.test(text)) out.push(`${path}: 전화번호`)
  for (const m of text.matchAll(SLOT)) out.push(`${path}: 중괄호 ${m[0]}`)
  return out
}

function walk(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'string') out.push(...textProblems(path, value))
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, out))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, out)
}

const tooLong = (path: string, text: string, max: number) => [...text].length > max ? [`${path}: ${max}자 넘음(${[...text].length}자)`] : []

export function validateType(v: { meaning: string }): string[] {
  const out: string[] = []
  walk(v, '', out)
  out.push(...tooLong('meaning', v.meaning ?? '', 40))
  if (/(니다|한다|이다)\.?$/.test(v.meaning ?? '')) out.push('meaning: 문장으로 끝남')
  return out
}

export function validateProvider(v: { name: string; role: string; points: string[] }, input: ProviderInput): string[] {
  const out: string[] = []
  walk(v, '', out)
  out.push(...tooLong('role', v.role ?? '', 20))
  if (!Array.isArray(v.points) || v.points.length < 2 || v.points.length > 4) out.push('points: 2~4개가 아니다')
  for (const [i, p] of (v.points ?? []).entries()) out.push(...tooLong(`points[${i}]`, p, 30))
  if (!v.name?.trim()) out.push(`name: 비어 있다(${input.provider})`)
  return out
}
