/**
 * 엔진 결과 · EA 줄 대조 → 사람이 읽는 보고서 (markdown) 와 콘솔 요약.
 * 실데이터 검증 절차에서 이 보고서를 한 줄씩 확인한다 (설계서 §7).
 */
import { reasonLabel } from './accessModel'
import type { ParityReport } from './parity'
import type { EngineResult } from './types'

const LEVEL_LABEL: Record<string, string> = { computed: '성립', computed_cross: '성립, SaaS 교차', indeterminate: '판정 보류', denied: '없음' }

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function markdownReport(result: EngineResult, parity: ParityReport, meta: { title: string; generatedAt: string }): string {
  const L: string[] = []
  L.push(`# 범용 접근 엔진 검증 보고서 — ${esc(meta.title)}`)
  L.push('')
  L.push(`생성 ${meta.generatedAt}, 모델 판 ${result.model_version}, 데이터셋 ${result.dataset.record ?? '-'} (${result.dataset.created_at ?? '-'})`)
  L.push('')
  L.push('> 확인 절차는 `docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md` §7.')
  L.push('')
  L.push('## 1. 요약')
  L.push('')
  L.push(`- EA 대조: **${parity.ok ? '통과' : '어긋남 있음'}** — ${parity.summary.join(' / ')}`)
  L.push(`- 수집 완결성: ${result.coverage.source === 'file' ? `coverage.json, 열린 묶음 ${result.coverage.open.length}` : '**없음 — 모든 목록을 닫힌 것으로 봤다**'}`)
  L.push(`- overrides: ${result.overrides.source === 'file' ? `${result.overrides.entries}건` : '없음'}`)
  for (const w of result.warnings) L.push(`- ⚠ ${esc(w.message)} (\`${w.code}\`)`)
  L.push('')
  L.push('| 간선 | 확실 | 불확실 |')
  L.push('| --- | --- | --- |')
  const names: Record<string, string> = { M: 'M 소속', U: 'U 범위', G: 'G 권한', T: 'T 호출, 입력', A: 'A 대행', F: 'F 사본', E: 'E 효과' }
  for (const [k, v] of Object.entries(result.edges)) L.push(`| ${names[k]} | ${v.certain} | ${v.uncertain} |`)
  L.push('')
  if (result.coverage.open.length) {
    L.push('열린 수집 묶음 (이 종류 객체의 목록에 없는 사람은 「없음」이 아니라 「모름」):')
    L.push('')
    for (const o of result.coverage.open) L.push(`- \`${o.family}\` — ${reasonLabel(o.reason)}`)
    L.push('')
  }

  L.push('## 2. EA 줄 대조 (effective_access.json)')
  L.push('')
  if (!parity.ea.length) L.push('EA 파일이 없거나 줄이 없다.')
  else {
    L.push('| 규칙 | 주체 → 대상 | 질문 | EA | 엔진 | 결과 | 엔진 사유 |')
    L.push('| --- | --- | --- | --- | --- | --- | --- |')
    for (const e of parity.ea) L.push(`| ${e.rule} | \`${e.source}\` → \`${e.target}\` | ${e.question} | ${LEVEL_LABEL[e.ea]} | ${e.engine}${e.engineLevel ? ` (${LEVEL_LABEL[e.engineLevel]})` : ''} | ${e.status} | ${esc(e.reasons.map(reasonLabel).join('; '))} |`)
  }
  L.push('')
  return L.join('\n')
}

export function consoleSummary(result: EngineResult, parity: ParityReport): string[] {
  const out: string[] = []
  out.push(`범용 접근 엔진: EA 대조 ${parity.ok ? '통과' : '어긋남'} — ${parity.summary.join(' / ')}`)
  for (const e of parity.ea.filter(x => x.status === 'conflict')) out.push(`  ✗ EA ${e.rule} ${e.source}→${e.target}: EA ${e.ea} vs 엔진 ${e.engine}`)
  for (const w of result.warnings) out.push(`  ⚠ ${w.message}`)
  return out
}
