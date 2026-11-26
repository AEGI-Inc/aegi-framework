/**
 * EA 규격 「이 파일이 지켜야 할 것」을 검사한다 (적용안 §8). 오류 문자열 목록을 돌려주고, 비면 통과다.
 * 규격보다 넓힌 곳: computed_cross 는 Link 가 없어도 SaaS 교차 stated 관계(x_cross_provider)로 건넜으면 된다 (적용안 §3.4, §10-2).
 */
import type { GraphStoreV2 } from '../../../model/graph'
import { levelGrade } from '../identity'
import { linkViaExists, providerOf, rowIdentity } from './common'
import { schemeLines } from './rules/dynamicHolder'
import { EA_RULES, type EffectiveAccessFile, type EffectiveAccessRow } from './types'

const LEVELS = new Set(['computed', 'computed_cross', 'indeterminate', 'denied'])

function lintRow(row: EffectiveAccessRow, graph: GraphStoreV2): string[] {
  const errors: string[] = []
  const err = (msg: string) => errors.push(`${row.id} (${row.source.rule}): ${msg}`)
  if (!LEVELS.has(row.level)) err(`level ${row.level} 은 네 값 중 하나가 아니다`)
  if (!EA_RULES.includes(row.source.rule)) err(`rule ${row.source.rule} 이 정의되지 않았다`)
  if (typeof row.source.view_version !== 'number' || typeof row.source.inputs_view_version !== 'number') err('view_version, inputs_view_version 이 둘 다 있어야 한다')
  if (row.effect === null && !row.effect_query) err('effect 가 null 이면 effect_query 가 있어야 한다')
  for (const end of [row.references.source, row.references.target]) if (!graph.objectsByKey.has(end)) err(`references 가 없는 객체 ${end} 를 가리킨다`)
  if (row.id !== rowIdentity(row.references.source, row.references.target, row.source.rule, row.via, (row.x_holders ?? []).map(h => h.grant).sort())) err('id 가 동일성 키 (source, target, rule, via, x_holders 권한 줄) 와 맞지 않는다')

  // via
  if (!row.via.length) err('via 가 비었다 — 근거 없는 결론')
  row.via.forEach((v, i) => {
    if (v.kind === 'relation') {
      const rel = graph.relationsByKey.get(v.ref)
      if (!rel) err(`via[${i}] 관계 ${v.ref} 가 없다`)
      else if (rel.sourceKey !== v.source || rel.targetKey !== v.target || rel.relationType !== v.relation_type) err(`via[${i}] 가 관계 ${v.ref} 와 끝점, 어휘가 다르다`)
    } else if (v.kind === 'link') {
      if (!linkViaExists(v, graph)) err(`via[${i}] 링크 간선 ${v.ref} ${v.a}~${v.b} 가 없다`)
    } else err(`via[${i}] kind 는 relation 또는 link 여야 한다`)
  })

  // 약한 동일인 간선 — 한 경로(같은 링크로 이어진 via)에 하나까지, 지난 긍정 행은 indeterminate 를 넘지 않는다
  let runWeak = 0
  row.via.forEach((v, i) => {
    const prev = row.via[i - 1]
    if (v.kind !== 'link' || prev?.kind !== 'link' || prev.ref !== v.ref) runWeak = 0
    if (v.kind !== 'link' || (levelGrade(v.level) === 'strong' && !v.suspected)) return
    if (++runWeak === 2) err(`via[${i}] 약한 간선 ${v.a}~${v.b} 가 같은 경로의 두 번째 약한 간선이다 — 약한 간선은 하나까지`)
    if (row.level === 'denied') return
    if (row.level !== 'indeterminate') err(`via[${i}] 약한 간선 ${v.a}~${v.b} 를 지났는데 ${row.level} 이다 — indeterminate 를 넘지 않는다`)
    else if (!row.undecomposed.some(u => u.at === `via[${i}]` && u.from === 'computation' && (u.reason === 'identity_link_weak' || u.reason === 'identity_weak'))) err(`via[${i}] 약한 간선 ${v.a}~${v.b} 가 undecomposed 에 없다 (identity_link_weak, identity_weak)`)
  })

  // cut · undecomposed
  for (const c of row.cut) {
    const v = row.via[c.via]
    if (!v) { err(`cut via ${c.via} 가 via 범위 밖이다`); continue }
    if (v.kind !== 'relation') err(`cut via ${c.via} 는 관계여야 한다 (링크는 지워서 회수하는 사실이 아니다)`)
    else if (v.basis !== 'stated') err(`cut via ${c.via} (${v.relation_type}) 가 basis ${v.basis} — 벤더가 적어 준 부여만 끊어서 회수된다`)
  }
  for (const u of row.undecomposed) {
    if (u.at === 'x_gap') {
      const [a, b] = u.x_between
      if (!(a >= 0 && b === a + 1 && b < row.via.length)) err(`undecomposed x_gap 의 x_between ${a},${b} 가 이웃한 via 가 아니다`)
    } else {
      const m = /^via\[(\d+)\]$/.exec(u.at)
      if (!m || Number(m[1]) >= row.via.length) err(`undecomposed at ${u.at} 가 via 범위 밖이다`)
    }
  }
  if (row.level === 'denied' && row.cut.length) err('denied 에는 회수할 것이 없다 — cut 이 비어야 한다')
  if (!row.cut.length && !row.undecomposed.length && row.level !== 'denied') err('cut 도 undecomposed 도 비었는데 denied 가 아니다')
  if (row.level === 'indeterminate' && !row.undecomposed.length) err('indeterminate 인데 못 정한 이유(undecomposed)가 없다')

  // 단계
  const hasLink = row.via.some(v => v.kind === 'link')
  const hasCross = row.via.some(v => v.kind === 'relation' && v.x_cross_provider)
  const sameProvider = providerOf(row.references.source, graph) === providerOf(row.references.target, graph)
  if (row.level === 'computed_cross' && !hasLink && !hasCross) err('computed_cross 인데 via 에 링크도 교차 관계도 없다')
  if (row.level === 'computed' && (!sameProvider || hasLink || hasCross)) err('computed 는 양끝 provider 가 같고 링크, 교차 관계가 없어야 한다')
  if (row.source.rule === 'x_dynamic_holder') {
    if (!row.x_holders?.length) err('x_dynamic_holder 는 보유자 근거(x_holders)가 있어야 한다')
    if (row.via.some(v => v.kind !== 'relation' || v.relation_type !== 'applies_to')) err('x_dynamic_holder 의 via 는 권한 스킴 → 프로젝트 applies_to 여야 한다')
    // 권한 줄은 스킴 속성의 줄이다(판단표 G4-Q02). 키는 `스킴 키#줄 id`
    for (const h of row.x_holders ?? []) if (!schemeLines(String(h.grant).split('#')[0], graph).some(l => l.key === h.grant)) err(`x_holders 의 권한 줄 ${h.grant} 가 없다`)
  }
  return errors
}

export function lintEffectiveAccess(file: EffectiveAccessFile, graph: GraphStoreV2): string[] {
  const errors: string[] = []
  if (file.format !== 'aegi-effective-access/v1') errors.push(`format ${file.format} 을 모른다`)
  const ids = new Set<string>()
  for (const row of file.rows) {
    if (ids.has(row.id)) errors.push(`${row.id}: 행 동일성이 겹친다 (한 행 = 한 경로)`)
    ids.add(row.id)
    errors.push(...lintRow(row, graph))
  }
  return errors
}
