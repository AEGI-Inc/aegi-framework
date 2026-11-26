/**
 * Answer shape rules the prompt asks for, enforced in code.
 *
 * The model writes the body first and the conclusion as the last line (**결론:** ...). A conclusion written after the
 * table and list agrees with them; one written first contradicted its own table in preview answers. The server moves
 * it to the top, where the answer panel shows it large.
 *
 * answerShapeProblems lists rule breaks that code can see. createAssistantChat asks for one rewrite when there are any.
 * It cannot see whether the conclusion means the same as the body; writing the conclusion last is what covers that.
 */

import { KG_TOOLS } from '../../src/assistant/chatProtocol'

const CITATION = /\s*\[[^\]\n]*T\d+-E\d+[^\]\n]*\]/g
const CONCLUSION_LINE = /^\s*\*\*\s*결론\s*[:：]\s*\*\*\s*(.+?)\s*$|^\s*\*\*\s*결론\s*[:：]\s*(.+?)\s*\*\*(.*)$/
const LEAD = /^\s*\*\*([^\n]+?)\*\*([^\n*]*)$/
const META_OPENING = /^(이번에는|이번 답변|확인 결과|조회 결과|질문하신|요청하신)/
const EARLIER_ANSWER = /(앞선|이전|지난|위의?) 답변/
const UNVERIFIED_IN_BODY = /(확인|확정|조회)하지 (못했|않았)|(확인|조회)되지 않았/
const LIMIT_LINE = /^\s*\*\*확인 못 함[:：]?\*\*|^\s*확인 못 함[:：]/
/** Tool names a reader should never see. Plain words such as access or identity are left out: Access Gap is a required term. */
const TOOL_NAMES = KG_TOOLS.map(t => t.function.name).filter(name => name.includes('_') || name === 'remediation')
const TOOL_WORD = new RegExp(`(?<![\\w-])(${TOOL_NAMES.join('|')})(?![\\w-])`)

const plain = (text: string) => text.replace(CITATION, '').replace(/\*\*/g, '').trim()
const sentences = (text: string) => plain(text).split(/(?<=[.!?。])\s+/).filter(s => s.trim()).length

/** Moves the **결론:** line, last as asked or first as models sometimes write it, to the top as the bold lead line without the label. Citations stay after the bold span. */
export function moveConclusion(answer: string): string {
  const lines = answer.replace(/\s+$/, '').split('\n')
  const filled = lines.flatMap((line, i) => line.trim() ? [i] : [])
  const index = [filled.at(-1), filled[0]].find(i => i !== undefined && CONCLUSION_LINE.test(lines[i]!))
  const match = index === undefined ? null : lines[index]!.match(CONCLUSION_LINE)
  if (index === undefined || !match) return answer
  const raw = `${match[1] ?? match[2] ?? ''} ${match[3] ?? ''}`
  const cites = (raw.match(CITATION) ?? []).map(c => c.trim())
  const text = raw.replace(CITATION, '').replace(/\*\*/g, '').trim()
  if (!text) return answer
  const body = lines.filter((_, i) => i !== index).join('\n').trim()
  const lead = `**${text}**${cites.length ? ` ${cites.join(' ')}` : ''}`
  return body ? `${lead}\n\n${body}` : lead
}

/** Rule breaks in an answer that cites evidence. A greeting or a one-line reply without citations is not checked. */
export function answerShapeProblems(answer: string): string[] {
  const text = answer.replace(/```[\s\S]*?```/g, '')
  if (!/T\d+-E\d+/.test(text)) return []
  const problems: string[] = []
  const lines = text.trim().split('\n')
  const lead = lines[0]!.match(LEAD)
  if (!lead || lines[1]?.trim()) problems.push('the conclusion must be one bold line followed by a blank line, written last as **결론:** and moved to the top by the server')
  else {
    const conclusion = lead[1]!
    if (sentences(conclusion) > 1) problems.push(`the conclusion has ${sentences(conclusion)} sentences; keep one and move the rest into the body`)
    if (plain(conclusion).length > 60) problems.push(`the conclusion is ${plain(conclusion).length} characters; keep it under 50`)
    if (META_OPENING.test(plain(conclusion))) problems.push('the conclusion opens with a meta phrase; state the finding itself')
  }
  if (EARLIER_ANSWER.test(text)) problems.push('the answer refers to an earlier answer; state current facts with citations from this question instead')
  const body = lines.slice(1).filter(line => !LIMIT_LINE.test(line))
  const unverified = body.filter(line => UNVERIFIED_IN_BODY.test(line)).length
  if (unverified) problems.push(`${unverified} body line(s) say something was not verified; move every such point into the single final **확인 못 함:** line`)
  // The prompt asks for at most four; a rewrite only when emphasis has clearly stopped standing out
  const bold = body.join('\n').replace(/^\s*\*\*(조치|확인 못 함)[:：]?\*\*/gm, '').match(/\*\*[^*\n]+\*\*/g)?.length ?? 0
  if (bold > 6) problems.push(`${bold} bold spans in the body; keep at most four key facts bold`)
  const tool = text.match(TOOL_WORD)
  if (tool) problems.push(`the answer names the internal tool ${tool[1]}; describe the screen or the information in Korean instead`)
  return problems
}
