/**
 * 수집 완결성 → coverage.json (범용 접근 엔진 입력, docs/spec/AEGI_GENERIC_ACCESS_ENGINE_V1.md §3-3).
 *
 * 수집 실행 기록(collected/runs/*.json)의 호출마다 최근 완결성(full · partial · best_effort · failed · skipped)을 적는다.
 * 엔진은 목록 호출이 full 이 아니면 그 종류 객체의 소속·권한 목록을 「열림」으로 보고, 목록에 없는 사람을 「없음」이 아니라 「모름」으로 답한다.
 */
import type { CoverageFile } from '../../../src/detection/v2/engine/types'
import type { RawSet } from './raw'

export function buildCoverage(raw: RawSet, generatedAt: string | null): CoverageFile {
  const calls = new Map<string, { provider: string; call_id: string }>()
  for (const r of raw.runs) for (const c of r.record.calls) calls.set(`${c.provider}|${c.call_id}`, { provider: c.provider, call_id: c.call_id })
  return {
    format: 'aegi-coverage/v1',
    generated_at: generatedAt,
    calls: [...calls.values()]
      .sort((a, b) => a.call_id.localeCompare(b.call_id))
      .map(c => {
        const st = raw.status(c.provider as never, c.call_id)
        return { provider: c.provider, call_id: c.call_id, completeness: st?.completeness ?? 'unknown', reasons: st?.reasons ?? [], run_id: st?.run_id }
      }),
  }
}
