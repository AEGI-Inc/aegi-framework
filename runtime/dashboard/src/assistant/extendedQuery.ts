import { listCredentials, credentialOwner, computeBlastRadius, blastLevelRank, blastPathTo } from '../detection/v2/blastRadius'
import { reachedNodes } from '../blast-radius/blastLabels'
import { publishedBlastFor } from '../blast-radius/useBlastRadii'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'
import type { FindingV2 } from '../model/findingV2'
import { NEED_LEVEL, accountsOf, hasAccessTable, levelName, personOf, pointOf, reaches, rowsOfPerson } from '../data/accessTableStore'
import { findBoundedInvestigationPaths } from '../semantic-graph/investigationQuery'
import { relationLabel } from '../semantic-graph/edgeExplain'
import { remediationGuide } from '../findings/remediationGuide'
import { sortByPriority } from '../findings/remediationMeta'
import { assistantCandidates, identityEvidenceEdges, objectLabel, providerLabel } from './lookup'
import type { AssistantPlan, EntitySelector, AssistantFocus } from './plan'
import type { AssistantEvidence, AssistantResult, AssistantQueryOptions, EvidenceGraphSelection, IdentityEvidenceEdge } from './types'

export function selectorCandidates(graph: GraphStoreV2, selector: EntitySelector, focus: AssistantFocus = {}) {
  return assistantCandidates(graph, { intent: 'object_lookup', entity: selector }, focus)
}

export function resolveSelector(graph: GraphStoreV2, selector: EntitySelector, focus: AssistantFocus, selected?: string): string | undefined {
  const candidates = selectorCandidates(graph, selector, focus)
  if (selected && candidates.keys.includes(selected)) return selected
  return !candidates.truncated && candidates.keys.length === 1 ? candidates.keys[0] : undefined
}

export class EvidenceBuilder {
  readonly evidence: AssistantEvidence[] = []
  readonly graph: EvidenceGraphSelection = { objectKeys: [], relationKeys: [], linkIds: [], identityEdges: [] }
  private readonly added = new Set<string>()
  constructor(readonly source: GraphStoreV2, readonly store: EvidenceStore) {}
  add(kind: AssistantEvidence['kind'], ref: string, label: string, detail: string, state?: AssistantEvidence['state']) {
    const id = `${kind}:${ref}`
    if (this.added.has(id)) return
    this.added.add(id)
    this.evidence.push({ id: `E${this.evidence.length + 1}`, kind, ref, label, detail, ...(state ? { state } : {}) })
  }
  object(key: string) {
    const o = this.source.objectsByKey.get(key)
    if (!o) return
    if (!this.graph.objectKeys.includes(key)) this.graph.objectKeys.push(key)
    this.add('object', key, objectLabel(this.source, key), `${providerLabel(o.canonical.provider)}, ${o.canonical.object_type}\n${(o.canonical.source.observations ?? []).map(x => `${x.api}, ${x.collected_at}`).join('\n') || '수집 출처가 저장되지 않았습니다.'}`)
  }
  relation(key: string) {
    const r = this.source.relationsByKey.get(key)
    if (!r) return
    if (!this.graph.relationKeys.includes(key)) this.graph.relationKeys.push(key)
    this.object(r.sourceKey); this.object(r.targetKey)
    if (r.roleKey) this.object(r.roleKey)
    this.add('relation', key, `${objectLabel(this.source, r.sourceKey)} → ${relationLabel(r.relationType)} → ${objectLabel(this.source, r.targetKey)}`, `역할: ${r.roleName || r.roleKey || '해당 없음'}\n${JSON.stringify(r.source)}`)
  }
  identity(edge: IdentityEvidenceEdge) {
    if (this.graph.identityEdges.some(e => e.linkId === edge.linkId && e.from === edge.from && e.to === edge.to)) return
    this.graph.identityEdges.push(edge)
    if (!this.graph.linkIds.includes(edge.linkId)) this.graph.linkIds.push(edge.linkId)
    this.object(edge.from); this.object(edge.to)
    this.add('identity_link', `${edge.linkId}:${edge.from}:${edge.to}`, `${objectLabel(this.source, edge.from)} ↔ ${objectLabel(this.source, edge.to)}`,
      `${edge.level}\n${this.source.linksById.get(edge.linkId)?.source.basis ?? ''}`, ['resolved', 'disclosed_relation', 'different'].includes(edge.level) ? 'confirmed' : 'inferred')
  }
  result(answer: string, focus?: AssistantFocus): AssistantResult { return { answer, evidence: this.evidence, graph: this.graph, focus } }
}

type ExtendedPlan = Extract<AssistantPlan, { intent: 'path_lookup' | 'access_analyze' | 'remediation_suggest' | 'credential_risk' }>
export function runExtendedQuery(graph: GraphStoreV2, store: EvidenceStore, findings: FindingV2[], plan: ExtendedPlan,
  selectedKey: string | undefined, options: AssistantQueryOptions, explain: (findingId: string) => AssistantResult): AssistantResult {
  const builder = new EvidenceBuilder(graph, store)
  if (plan.intent === 'credential_risk') return credentialRisk(graph, store, findings, plan, selectedKey, options, builder)
  if (plan.intent === 'remediation_suggest') {
    const finding = findings.find(f => f.id === (plan.findingId ?? options.focus?.findingId))
    if (!finding) return builder.result('조치를 추천할 탐지 결과를 선택하거나 FND 식별자를 적어 주세요.')
    const base = explain(finding.id)
    const actions = sortByPriority(finding.remediation).map(item => {
      const hasDetail = !!remediationGuide(item)
      return { id: item.id, findingId: finding.id, title: item.title, description: item.description, hasDetail }
    })
    const answer = actions.length ? `${finding.title}\n\n${actions.map((a, i) => `${i + 1}. ${a.title}\n${a.description}`).join('\n\n')}\n\n조치를 적용한 뒤 관련 설정을 다시 수집하고 탐지 결과를 확인하세요.`
      : `${finding.title}\n현재 탐지 결과에 등록된 조치가 없습니다. 판정 근거와 관련 설정을 확인해 주세요.`
    return { ...base, answer, actions, evidence: [...base.evidence, ...actions.map((a, i): AssistantEvidence => ({ id: `E${base.evidence.length + i + 1}`, kind: 'remediation', ref: `${finding.id}:${a.id}`, label: a.title, detail: a.description }))], focus: { findingId: finding.id } }
  }
  const focus = options.focus ?? {}
  const source = resolveSelector(graph, plan.entity, focus, selectedKey)
  if (!source) return builder.result('출발 객체를 찾거나 후보에서 선택해 주세요.')
  const target = plan.target ? resolveSelector(graph, plan.target, focus, options.targetKey) : undefined
  if (plan.target && !target) return builder.result('대상 객체를 찾거나 후보에서 선택해 주세요.')
  builder.object(source)
  if (target) builder.object(target)
  const nextFocus = { sourceKey: source, ...(target ? { targetKey: target } : {}) }
  if (plan.intent === 'path_lookup' && target) {
    const identity = plan.identity ?? 'all'
    const edges = identity === 'none' ? [] : [...graph.linksById.values()].flatMap(link => identityEvidenceEdges(graph, link, identity === 'person' ? 'person' : 'all'))
    const maxHops = plan.maxHops ?? 6
    const result = findBoundedInvestigationPaths(graph, source, target, { maxHops, directed: plan.directed ?? false,
      relationTypes: plan.relationTypes ? new Set(plan.relationTypes) : undefined, includeIdentityLinks: identity !== 'none',
      identityPairs: edges.map(e => ({ from: e.from, to: e.to, edgeId: e.linkId })) }, 8)
    const index = Math.max(0, Math.min(options.pathIndex ?? 0, result.paths.length - 1))
    const path = result.paths[index]
    if (path) {
      path.objects.forEach(k => builder.object(k))
      for (const step of path.steps) {
        if (step.kind === 'relation') builder.relation(step.edgeId)
        else edges.filter(e => e.linkId === step.edgeId && ((e.from === step.from && e.to === step.to) || (e.to === step.from && e.from === step.to))).forEach(e => builder.identity(e))
      }
    }
    const lines = path?.steps.map(s => `${objectLabel(graph, s.from)} ${s.kind === 'identity_link' ? '↔ 동일인 연결 ↔' : `${s.forward ? '→' : '←'} ${relationLabel(s.relationType ?? '관계')} ${s.forward ? '→' : '←'}`} ${objectLabel(graph, s.to)}`)
    const answer = path ? `${objectLabel(graph, source)}에서 ${objectLabel(graph, target)}까지 ${path.steps.length}홉 경로입니다.\n${lines?.join('\n') || '출발 객체와 대상 객체가 같습니다.'}\n\n이 경로는 저장된 구조적 연결입니다. 접근 권한이나 실제 실행을 증명하지 않습니다.`
      : `${maxHops}홉 이내에서 조건에 맞는 경로를 찾지 못했습니다. 연결이 없다고 확정할 수는 없습니다.`
    return { ...builder.result(answer + (result.truncated ? '\n경로 8개 또는 탐색 상태 5,000개 상한에 도달했습니다. 대상을 좁히거나 관계 조건을 지정해 주세요.' : ''), nextFocus), paths: result.paths, pathsTruncated: result.truncated }
  }
  if (plan.intent !== 'access_analyze') return builder.result('대상 객체를 선택해 주세요.')
  const actor = graph.objectsByKey.get(source)!
  if (!actor.canonical.interfaces.some(i => i === 'Principal' || i === 'Automation')) return builder.result('권한 분석의 출발 객체는 사람 계정이어야 합니다.')
  const minimum = plan.minimum ?? 'read'
  const mode = plan.mode ?? 'all'
  const modes = mode === 'all' ? ['direct', 'derived'] as const : [mode]
  const labels = { direct: '직접 권한', derived: '파생 접근' }
  const levels = { read: '읽기', write: '쓰기', admin: '관리' }
  const isResource = (k: string) => !!graph.objectsByKey.get(k)?.canonical.interfaces.some(i => i === 'Resource' || i === 'Tenant')
  const rows: string[] = []
  let count = 0

  // 엔진이 게시한 접근 표(derived.access_table)만 읽는다. 화면은 접근을 계산하지 않는다.
  // 표의 사람 키는 같은 사람 계정 묶음의 대표 계정이고, 묶음도 엔진이 정한다(accounts). 그룹, 자동화는 표에 줄이 없다
  if (!hasAccessTable()) return builder.result('이 데이터셋에는 엔진 접근 표가 없어 권한을 분석할 수 없습니다. 엔진이 게시한 스냅샷이나 derived.json 이 있는 데이터셋에서 다시 물어 주세요.', nextFocus)
  const person = personOf(source)
  const owned = rowsOfPerson(person)
  if (!owned.length) return builder.result(`엔진 접근 표에 ${objectLabel(graph, source)}의 줄이 없습니다. 접근 표는 사람 계정만 싣습니다. 그룹, 자동화는 분석하지 않고, 사람 계정이면 권한이 닿는 대상이 없습니다.`, nextFocus)
  const level = NEED_LEVEL[minimum]
  const found = owned.filter(x => (target ? x.target === target : isResource(x.target)))
  // 다른 계정의 줄을 쓰면 같은 사람 연결(게시된 Link)을 근거로 단다
  if (person !== source && found.length) {
    const same = new Set(accountsOf(person))
    for (const link of graph.linksById.values()) for (const e of identityEvidenceEdges(graph, link)) if (same.has(e.from) && same.has(e.to)) builder.identity(e)
  }
  for (const { target: resource, row } of found) {
    const parts: string[] = []
    const hit = modes.some(m => reaches(m === 'direct' ? row.direct : row.derived, minimum))
    if (!target && !hit) continue
    count++
    if (!target && count > 40) continue
    builder.object(resource)
    for (const m of modes) {
      const all = m === 'direct' ? row.direct : row.derived
      const sure = m === 'direct' ? row.directSure : row.derivedSure
      const positive = reaches(sure, minimum)
      const state = positive ? 'confirmed' : reaches(all, minimum) ? 'inferred' : 'unknown'
      const verdict = positive ? '계산으로 확인' : state === 'inferred' ? '추정' : '미확인'
      const gain = m === 'derived' ? row.gained?.[level] : undefined
      const point = m === 'derived' ? pointOf(row, minimum) : undefined
      const reasons = [
        ...(m === 'direct' && state === 'inferred' ? ['수준을 모르는 권한 간선이 있습니다.'] : []),
        ...(gain ? [gain.share ? `조직 밖 직접 공유로 생긴 권한입니다(${gain.certainty}).` : `직접 권한보다 높아진 권한입니다(${gain.certainty}).`, ...(gain.reasons ?? [])] : []),
        ...(point ? [`연동 지점: ${objectLabel(graph, point)}`] : []),
      ]
      if (point) builder.object(point)
      const lv = levelName(all)
      parts.push(`${labels[m]}: ${verdict}${lv ? ` (${lv})` : ''}${reasons.length ? `\n${[...new Set(reasons)].join('\n')}` : ''}`)
      builder.add('access', `${resource}:${m}:${minimum}`, `${objectLabel(graph, resource)}, ${labels[m]}`, `${levels[minimum]}: ${verdict}\n${[...new Set(reasons)].join('\n')}`, state)
    }
    rows.push(`${objectLabel(graph, resource)}\n${parts.join('\n')}`)
  }
  if (target && !found.length) rows.push(`${objectLabel(graph, target)}\n${modes.map(m => `${labels[m]}: 미확인`).join('\n')}`)
  const answer = `${objectLabel(graph, source)}의 ${levels[minimum]} 권한 분석\n\n${rows.join('\n\n') || '현재 수집된 데이터에서 권한을 뒷받침하는 경로를 찾지 못했습니다.'}\n\n미확인은 접근 불가를 뜻하지 않습니다. 직접 권한과 파생 접근(자동화, 앱, 토큰을 거쳐 닿는 곳)은 서로 다른 결과입니다.${count > 40 ? `\n대상 ${count}개 중 40개를 표시합니다. 특정 자원을 지정해 주세요.` : ''}`
  return builder.result(answer, nextFocus)
}

/**
 * Legacy fixture route uses the same blast engine as KG tools.
 * 엔진이 게시한 피해 범위(Credentials 화면과 같은 값)를 쓰고, 없을 때(옛 스냅숏, 데모)만 브라우저에서 세어 「브라우저 추정」을 붙인다.
 * 닿는 수는 Credentials 화면처럼 권한을 얻었거나 그 계정으로 행동하는 객체만 센다(reachedNodes)
 */
function credentialRisk(graph: GraphStoreV2, _store: EvidenceStore, _findings: FindingV2[], plan: Extract<AssistantPlan, { intent: 'credential_risk' }>,
  selectedKey: string | undefined, options: AssistantQueryOptions, builder: EvidenceBuilder): AssistantResult {
  const source = plan.entity ? resolveSelector(graph, plan.entity, options.focus ?? {}, selectedKey) : undefined
  if (plan.entity && !source) return builder.result('계정이나 자격증명을 선택해 주세요.')
  const rows = listCredentials(graph).filter(o => (!plan.provider || o.canonical.provider === plan.provider) && (!source || source === o.fixture_key || credentialOwner(o.fixture_key, graph)?.key === source))
    .map(o => {
      const published = publishedBlastFor(graph, o.fixture_key)?.account
      const radius = published ?? computeBlastRadius(o.fixture_key, 'account', { graph })
      return { key: o.fixture_key, radius, reached: reachedNodes(radius).length, estimate: published ? '' : ', 브라우저 추정' }
    })
    .sort((a, b) => blastLevelRank(b.radius.highest?.level) - blastLevelRank(a.radius.highest?.level) || b.reached - a.reached).slice(0, 10)
  const chosen = rows.find(r => r.key === options.credentialKey) ?? rows[0]
  rows.forEach(row => { builder.object(row.key); builder.add('credential', row.key, objectLabel(graph, row.key), `소유 계정 탈취: ${row.reached}개, ${row.radius.highest?.level ?? '미확인'}, ${row.radius.certainty}${row.estimate}`) })
  if (chosen?.radius.highest) blastPathTo(chosen.radius, chosen.radius.highest.key).forEach(hop => {
    builder.object(hop.from); builder.object(hop.to); hop.relationKeys.forEach(k => builder.relation(k))
  })
  return { ...builder.result(rows.length ? '소유 계정 탈취 시나리오의 피해범위입니다. 토큰 단독 유출과 다릅니다.' : '현재 KG에서 해당 자격증명을 찾지 못했습니다.', source ? { sourceKey: source } : undefined),
    credentials: rows.map(r => ({ key: r.key, label: objectLabel(graph, r.key), summary: `소유 계정 탈취: ${r.reached}개${r.estimate}` })), credentialKey: chosen?.key }
}