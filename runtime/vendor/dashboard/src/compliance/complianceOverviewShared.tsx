import type { Finding, Item, StandardResults } from '../config-findings/standardResultsStore'
import { relatedRequirements } from '../config-findings/IsmsReferences'

import type { UnifiedStatus } from './typeScope'

export type Match = { key: string; f: Finding; item: Item; limit: string }
export type Kind = 'fail' | 'pass' | 'unknown' | 'person'
export const KINDS: { key: Kind; label: string }[] = [{ key: 'fail', label: '위반' }, { key: 'pass', label: '충족' }, { key: 'unknown', label: '판정 불가' }, { key: 'person', label: '직접 확인 필요' }]
export const LABEL: Record<Item['status'], string> = { pass: '충족', fail: '위반', unknown: '판정 불가', not_collected: '미수집', org_policy: '조직 정책 필요', manual: '사람 검토' }
export const SAAS: Record<string, string> = { gws: 'Google Workspace', okta: 'Okta', github: 'GitHub', slack: 'Slack', salesforce: 'Salesforce', atlassian: 'Atlassian' }
const kindOf = (s: Item['status']): Kind => (s === 'org_policy' || s === 'manual' ? 'person' : s === 'not_collected' ? 'unknown' : s)

/** finding 의 수집된 판정(not_collected 제외)만 Match 로 바꾼다 */
export function findingMatches(f: Finding, limit = ''): Match[] {
  return f.items
    .filter(item => item.status !== 'not_collected')
    .map(item => ({
      key: `${f.provider}:${f.id}:${item.standard}:${item.item_id}`,
      f,
      item,
      limit,
    }))
}

/** 같은 점검이 확인사항 여러 개에 이어져도 한 번만 센다 */
export const unique = (ms: Match[]) => [...new Map(ms.map(m => [m.key, m])).values()]
export function countOf(ms: Match[]) {
  const c: Record<Kind, number> = { fail: 0, pass: 0, unknown: 0, person: 0 }
  for (const m of ms) {
    if (m.item.status !== 'not_collected') c[kindOf(m.item.status)]++
  }
  return c
}

/** 공개 기준 확인사항과 결과 점검을 잇는다. */
export function matchRequirements(results: StandardResults | undefined, requirementIds: Iterable<string>) {
  const wanted = new Set(requirementIds), per = new Map<string, Match[]>()
  for (const f of results?.findings ?? []) for (const item of f.items) {
    if (item.status === 'not_collected') continue
    for (const r of relatedRequirements(f.provider, f.id, item)) {
      if (wanted.has(r.id)) per.set(r.id, [...(per.get(r.id) ?? []), { key: `${f.provider}:${f.id}:${item.standard}:${item.item_id}`, f, item, limit: r.mappingLimitation }])
    }
  }
  for (const [id, ms] of per) per.set(id, unique(ms))
  return per
}

export function ResultBar({ ms, size = 'md' }: { ms: Match[]; size?: 'sm' | 'md' | 'lg' }) {
  const c = countOf(ms)
  if (!ms.length) return <span className="comp-bar-none">관련 점검 없음</span>
  return <span className={`comp-bar is-${size}`} role="img" aria-label={KINDS.map(k => `${k.label} ${c[k.key]}`).join(', ')}>
    {KINDS.map(k => c[k.key] ? <i key={k.key} className={`is-${k.key}`} style={{ flexGrow: c[k.key] }} /> : null)}
  </span>
}
export function Legend({ ms }: { ms: Match[] }) {
  const c = countOf(ms)
  return <span className="comp-legend">{KINDS.filter(k => k.key !== 'person' || c.person).map(k => <span key={k.key} className={`is-${k.key}`}><i />{k.label} <b>{c[k.key]}</b></span>)}</span>
}
const AUTO_DONUT_KINDS: { key: 'pass' | 'fail' | 'unknown'; label: string }[] = [
  { key: 'pass', label: '충족' },
  { key: 'fail', label: '위반' },
  { key: 'unknown', label: '판정 불가' },
]

const COVERAGE_DONUT_KINDS: { key: 'auto' | 'person' | 'uninspected'; label: string }[] = [
  { key: 'auto', label: '자동 판정' },
  { key: 'person', label: '직접 확인' },
  { key: 'uninspected', label: '미점검' },
]

/** 대상 고유 객체를 자동 판정, 직접 확인, 미점검으로 나눈 도넛. 가운데 대상 객체 수 */
export function ScopeCoverageDonut({ counts, total }: { counts: Record<UnifiedStatus, number>; total: number }) {
  const auto = counts.fail + counts.unknown + counts.pass
  const values: Record<'auto' | 'person' | 'uninspected', number> = {
    auto,
    person: counts.person,
    uninspected: counts.uninspected,
  }
  const r = 42
  const len = 2 * Math.PI * r
  const gap = COVERAGE_DONUT_KINDS.filter(k => values[k.key] > 0).length > 1 ? 0.8 : 0
  let at = 0
  return (
    <span className="comp-donut">
      <svg viewBox="0 0 100 100" role="img" aria-label={`대상 객체 ${total}, 자동 판정 ${auto}, 직접 확인 ${counts.person}, 미점검 ${counts.uninspected}`}>
        <circle cx="50" cy="50" r={r} className="is-empty" />
        {total > 0 && COVERAGE_DONUT_KINDS.map(k => {
          const part = (values[k.key] / total) * len
          const el = part > 0
            ? <circle key={k.key} cx="50" cy="50" r={r} className={`is-${k.key}`} strokeDasharray={`${Math.max(0, part - gap)} ${len}`} strokeDashoffset={-at} />
            : null
          at += part
          return el
        })}
      </svg>
      <span><b>{total}</b>대상 객체</span>
    </span>
  )
}

/** 자동 판정된 고유 객체만 충족, 위반, 판정 불가로 나눈 도넛. 가운데 자동 판정 수 */
export function AutoResultDonut({ counts }: { counts: Record<UnifiedStatus, number> }) {
  const auto = counts.fail + counts.unknown + counts.pass
  const r = 42
  const len = 2 * Math.PI * r
  const gap = AUTO_DONUT_KINDS.filter(k => counts[k.key] > 0).length > 1 ? 0.8 : 0
  let at = 0
  return (
    <span className="comp-donut">
      <svg viewBox="0 0 100 100" role="img" aria-label={`자동 판정 ${auto}, 충족 ${counts.pass}, 위반 ${counts.fail}, 판정 불가 ${counts.unknown}`}>
        <circle cx="50" cy="50" r={r} className="is-empty" />
        {auto > 0 && AUTO_DONUT_KINDS.map(k => {
          const part = (counts[k.key] / auto) * len
          const el = part > 0
            ? <circle key={k.key} cx="50" cy="50" r={r} className={`is-${k.key}`} strokeDasharray={`${Math.max(0, part - gap)} ${len}`} strokeDashoffset={-at} />
            : null
          at += part
          return el
        })}
      </svg>
      <span><b>{auto}</b>자동 판정</span>
    </span>
  )
}
