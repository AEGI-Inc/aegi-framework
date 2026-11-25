import type { GraphStoreV2 } from '../model/graph'
import type { FindingV2 } from '../model/findingV2'
import type { EvidenceStore } from '../model/evidence'
import { judgeSamePerson, levelGrade } from '../detection/v2/identity'
import { parseAssistantPlan, type AssistantPlan } from './plan'
import type { AssistantQueryOptions, AssistantEvidence, AssistantResult, EvidenceGraphSelection, IdentityEvidenceEdge } from './types'

export { assistantCandidates, identityEvidenceEdges, objectLabel, providerLabel } from './lookup'
import { assistantCandidates, identityEvidenceEdges, objectLabel, providerLabel } from './lookup'
import { runExtendedQuery } from './extendedQuery'
const blank = (): EvidenceGraphSelection => ({ objectKeys: [], relationKeys: [], linkIds: [], identityEdges: [] })
const empty = (answer: string): AssistantResult => ({ answer, evidence: [], graph: blank() })

export function runAssistantQuery(graph: GraphStoreV2, store: EvidenceStore, findings: FindingV2[], value: AssistantPlan, selectedKey?: string, options: AssistantQueryOptions = {}): AssistantResult {
  const plan = parseAssistantPlan(value)
  if (!plan) return empty('질문 해석 결과가 올바르지 않습니다. 다시 질문해 주세요.')
  if (plan.intent === 'conversation') return empty(plan.answer || '확인할 계정이나 자원을 적어 주세요.')
  if (plan.intent === 'unsupported') return empty('객체 검색, 동일인 연결, 탐지 이유, 권한 분석, 경로 탐색, 조치 추천을 질문할 수 있습니다. 대상이나 탐지 결과를 구체적으로 적어 주세요.')
  if (plan.intent === 'access_analyze' || plan.intent === 'path_lookup' || plan.intent === 'remediation_suggest' || plan.intent === 'credential_risk') {
    return runExtendedQuery(graph, store, findings, plan, selectedKey, options,
      findingId => runAssistantQuery(graph, store, findings, { intent: 'finding_explain', findingId }))
  }
  const evidence: AssistantEvidence[] = []
  const selection = blank()
  const add = (entry: Omit<AssistantEvidence, 'id'>) => evidence.push({ ...entry, id: `E${evidence.length + 1}` })
  const addObject = (key: string) => {
    if (selection.objectKeys.includes(key)) return
    const object = graph.objectsByKey.get(key)
    if (!object) { add({ kind: 'object', ref: key, label: key, state: 'unknown', detail: '관련 객체를 현재 데이터에서 찾을 수 없습니다.' }); return }
    selection.objectKeys.push(key)
    const observations = object.canonical.source.observations ?? []
    add({ kind: 'object', ref: key, label: objectLabel(graph, key), detail: `${providerLabel(object.canonical.provider)}, ${object.canonical.object_type}\n${observations.map(o => `${o.api}, ${o.collected_at}`).join('\n') || '수집 출처가 저장되지 않았습니다.'}` })
  }
  const addIdentity = (edge: IdentityEvidenceEdge) => {
    if (selection.identityEdges.some(e => e.linkId === edge.linkId && e.from === edge.from && e.to === edge.to)) return
    selection.identityEdges.push(edge)
    if (!selection.linkIds.includes(edge.linkId)) selection.linkIds.push(edge.linkId)
    addObject(edge.from); addObject(edge.to)
    const link = graph.linksById.get(edge.linkId)!
    add({ kind: 'identity_link', ref: edge.linkId, label: `${objectLabel(graph, edge.from)} ↔ ${objectLabel(graph, edge.to)}`, state: edge.level === 'different' || levelGrade(edge.level) === 'strong' ? 'confirmed' : 'inferred', detail: `${edge.level}\n${link.source.basis}\n${Array.isArray(link.meta?.edges) ? '간선별 동일인 연결' : '신원 집합의 연결 표현'}` })
  }
  if (plan.intent === 'finding_explain') {
    const finding = findings.find(f => f.id === (plan.findingId ?? options.focus?.findingId))
    if (!finding) return empty('현재 표시하는 탐지 결과에서 이 항목을 찾을 수 없습니다. 탐지 결과에서 항목을 선택해 주세요.')
    add({ kind: 'finding', ref: finding.id, label: finding.title, detail: finding.summary })
    finding.involvedObjectKeys.forEach(addObject)
    for (const key of finding.involvedRelationKeys) {
      const relation = graph.relationsByKey.get(key)
      if (!relation) { add({ kind: 'relation', ref: key, label: key, state: 'unknown', detail: '관련 관계를 현재 데이터에서 찾을 수 없습니다.' }); continue }
      selection.relationKeys.push(key)
      addObject(relation.sourceKey); addObject(relation.targetKey)
      if (relation.roleKey) addObject(relation.roleKey)
      add({ kind: 'relation', ref: key, label: `${objectLabel(graph, relation.sourceKey)} → ${relation.relationType} → ${objectLabel(graph, relation.targetKey)}`, detail: `역할: ${relation.roleName || relation.roleKey || '해당 없음'}\n${JSON.stringify(relation.source)}` })
    }
    for (const id of finding.involvedLinkIds) {
      const link = graph.linksById.get(id)
      if (link) {
        const edges = identityEvidenceEdges(graph, link, 'all')
        edges.forEach(addIdentity)
        if (!edges.length) add({ kind: 'identity_link', ref: id, label: '동일인 연결 근거', state: 'unknown', detail: `${link.source.basis}\n표시할 계정 간선을 확인할 수 없습니다.` })
      } else add({ kind: 'identity_link', ref: id, label: id, state: 'unknown', detail: '관련 동일인 연결을 현재 데이터에서 찾을 수 없습니다.' })
    }
    for (const id of finding.evidenceObservationIds) {
      const observation = store.observationsById.get(id)
      if (observation) add({ kind: 'observation', ref: id, label: observation.title || id, detail: `${observation.occurredAt || '시각 미확인'}\n${observation.provenance.sourceRef}\n${JSON.stringify(observation.attributes, null, 2)}` })
      else add({ kind: 'observation', ref: id, label: id, state: 'unknown', detail: '연결된 증적을 현재 데이터에서 찾을 수 없습니다.' })
    }
    for (const id of finding.evidenceLinkIds) {
      const link = store.evidenceLinksById.get(id)
      if (link) add({ kind: 'evidence_link', ref: id, label: link.label || id, detail: `${link.from.id} → ${link.to.id}\n${link.evidenceType}` })
      else add({ kind: 'evidence_link', ref: id, label: id, state: 'unknown', detail: '연결된 근거를 현재 데이터에서 찾을 수 없습니다.' })
    }
    const states = { confirmed: '확인', inferred: '추정', unknown: '미확인' }
    const checks = finding.checks?.map(c => `[${states[c.state]}] ${c.label}: ${c.detail}`).join('\n') || '저장된 판정 조건이 없습니다.'
    return { answer: `${finding.title}\n${finding.summary}\n\n${checks}\n\n그래프는 이 탐지의 관련 근거를 보여줍니다. 개별 조건과의 직접 연결이 저장되지 않은 항목도 포함합니다.`, evidence, graph: selection, focus: { findingId: finding.id } }
  }
  const candidates = assistantCandidates(graph, plan, options.focus)
  const key = selectedKey ?? (!candidates.truncated && candidates.keys.length === 1 ? candidates.keys[0] : undefined)
  if (!key || !candidates.keys.includes(key)) return empty(candidates.keys.length ? '어떤 객체를 뜻하는지 후보에서 선택해 주세요.' : '현재 수집된 데이터에서 일치하는 객체를 찾을 수 없습니다.')
  addObject(key)
  if (plan.intent === 'object_lookup') return { answer: `${objectLabel(graph, key)}을 찾았습니다.`, evidence, graph: selection, focus: { sourceKey: key } }
  const allEdges = [...graph.linksById.values()].flatMap(link => identityEvidenceEdges(graph, link))
  const reachable = new Set([key])
  for (let changed = true; changed;) {
    changed = false
    for (const edge of allEdges) if (reachable.has(edge.from) || reachable.has(edge.to)) {
      const next = reachable.has(edge.from) ? edge.to : edge.from
      if (!reachable.has(next) && judgeSamePerson(key, next, graph).same) { reachable.add(next); changed = true }
    }
  }
  allEdges.filter(e => reachable.has(e.from) && reachable.has(e.to)).forEach(addIdentity)
  const accounts = [...reachable].filter(k => k !== key).map(k => {
    const grade = judgeSamePerson(key, k, graph).grade
    const obj = graph.objectsByKey.get(k)!
    return `${objectLabel(graph, k)} (${providerLabel(obj.canonical.provider)}, ${grade === 'strong' ? '확인' : '추정'})`
  })
  return { answer: accounts.length ? `${objectLabel(graph, key)}와 연결된 계정:\n${accounts.join('\n')}` : '현재 데이터에서 다른 SaaS 계정과의 동일인 연결을 확인할 수 없습니다.', evidence, graph: selection, focus: { sourceKey: key } }
}
