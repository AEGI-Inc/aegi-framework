import type { AssistantEvidence } from './types'

/** 답변 본문에 처음 나온 순서로 인용에 1부터 번호를 매긴다. 근거 목록에 없는 번호는 뺀다 */
export function citationNumbers(answer: string, evidenceIds: readonly string[]): Map<string, number> {
  const known = new Set(evidenceIds)
  const order = [...new Set(answer.match(/T\d+-E\d+/g) ?? [])].filter(id => known.has(id))
  return new Map(order.map((id, i) => [id, i + 1]))
}

/**
 * 첫 줄이 굵은 결론 한 줄이면 떼어 낸다. 결론 아래에 요약 줄과 그래프를 끼우려고 쓴다.
 * 결론이 없으면(인사, 짧은 답, 규칙을 안 지킨 답) null 이라 본문을 그대로 보인다.
 */
export function splitLead(answer: string): { lead: string; rest: string } | null {
  const match = answer.match(/^\s*(\*\*[^\n]+?\*\*[^\n*]*)(?:\n\s*\n([\s\S]*))?$/)
  if (!match) return null
  return { lead: match[1].trim(), rest: (match[2] ?? '').trim() }
}

/** 답변 본문에 인용한 근거. 처음 나온 순서 */
export function citedEvidence(answer: string | undefined, evidence: readonly AssistantEvidence[]) {
  const byId = new Map(evidence.map(item => [item.id, item]))
  return [...new Set(answer?.match(/T\d+-E\d+/g) ?? [])].flatMap(id => byId.get(id) ?? [])
}
