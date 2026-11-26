import { THREAT_TITLE_CHECK } from '../ontology/generated'

/**
 * 위협 목록에 오르는 제목의 규칙 검사. 규칙 원본은 aegi-knowledge policies.yaml title_check(사람이 읽는 규칙은 title_rules).
 * 엔진 위협 제목 틀은 aegi-knowledge 테스트가, Config Findings 판정 문장은 scripts/standards 의 작성 검사와 게시 검사가 이 함수로 본다.
 * 새 출처의 제목을 위협 목록에 올릴 때도 이 함수를 거친다. 빈 배열이면 통과다.
 */
export function titleProblems(title: string): string[] {
  const t = title.trim()
  const problems: string[] = []
  if (!t) problems.push('빈 제목')
  const ending = THREAT_TITLE_CHECK.forbidden_endings.find(e => t.endsWith(e))
  if (ending) problems.push(`「${ending}」로 끝남(명사형으로 끝내야 함)`)
  for (const c of THREAT_TITLE_CHECK.forbidden_chars) if (t.includes(c)) problems.push(`「${c}」 포함`)
  return problems
}
