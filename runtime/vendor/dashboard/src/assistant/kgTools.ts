import type { CollectionContext, InvestigationContext } from './supportTools'
import type { GraphStoreV2 } from '../model/graph'
import type { EvidenceStore } from '../model/evidence'
import type { FindingV2, ThreatAccessGapV2, ThreatGapPersonV2 } from '../model/findingV2'
import type { FixtureObject, Provider } from '../model/object'
import type { ResolvedRelation } from '../model/relation'
import type { EffectiveAccessRow } from '../detection/v2/effectiveAccess/types'
import { blastLevelRank, blastPathTo, computeBlastRadius, credentialOwner, listCredentials, type BlastRadius } from '../detection/v2/blastRadius'
import { objectLabel, identityEvidenceEdges, runAssistantQuery } from './query'
import { principalKind } from '../detection/v2/identity'
import { searchObjects } from '../semantic-graph/investigationQuery'
import { relationLabel } from '../semantic-graph/edgeExplain'
import { objectName, providerLabel } from './lookup'
import { EvidenceBuilder } from './extendedQuery'
import { TOOL_OUTPUT_LIMIT, modelToolJson, parseToolArgs, toolPlan, type KgCall, type KgFact, type KgOutput, type LogToolOutput, type ToolArgs } from './chatProtocol'
import type { AssistantFocus, AssistantPlan } from './plan'
import type { AssistantEvidence, AssistantResult } from './types'
import { DASHBOARD_GUIDES, type WorkspaceContext } from './workspace'
import { RANK, roleRelationCapability } from '../detection/v2/engine/accessModel'
import { eventGraphFromFacts, mergeEventGraphs } from './eventGraph'
import { eaUnknownSteps } from '../findings/eaExplain'
import { principalState } from '../explorer/accountState'
import { keyName } from '../findings/accessGapNames'
import { modelProperties, propertyAt } from './propertyRules'

/** 적재 때 계산한 자격증명 피해 범위(D1 snap_blast_radius). 있으면 그래프 전체로 다시 계산하지 않는다. 순서는 listCredentials 순서다 */
export type PrecomputedBlast = ReadonlyMap<string, { provider: string; type?: string; token: BlastRadius; account: BlastRadius }>
/** hiddenDefaults: 기본 보기에서 뺀 플랫폼 기본 객체(아무도 쓰지 않음). 검색이 이 객체와 맞으면 결과에서 뺐다고 알린다 */
export interface KgContext { collection?: CollectionContext; investigation?: InvestigationContext; graph: GraphStoreV2; evidence: EvidenceStore; findings: FindingV2[]; eaRows?: readonly EffectiveAccessRow[]; focus?: AssistantFocus; workspace?: WorkspaceContext; exceptionCounts?: { exceptedFindings: number; review: number }; blastRadii?: PrecomputedBlast; hiddenDefaults?: readonly FixtureObject[] }
/** 서버(D1 스냅샷)에서 실행하는 도구. 그래프 전체가 필요하거나 화면 상태에 묶인 나머지 도구는 브라우저에서 실행한다 */
export const SERVER_KG_TOOLS: ReadonlySet<string> = new Set(['search_objects', 'neighbors', 'kg_schema', 'identity_links', 'accounts', 'relations', 'credential_blast', 'search_events', 'event_connections'])
export interface KgExecution { output: KgOutput; result: AssistantResult; plan?: AssistantPlan }
export const emptyKgResult = (summary: string): AssistantResult => ({ answer: summary, evidence: [], graph: { objectKeys: [], relationKeys: [], linkIds: [], identityEdges: [] } })
const empty = emptyKgResult
const clip = (value: string, length = 512) => value.slice(0, length)
const modeLabel = (mode: unknown) => mode === 'token' ? '토큰 유출' : '소유 계정 탈취'
const levelLabel = (level: unknown) => ({ admin: '관리', write: '쓰기', read: '읽기', use: '사용' })[String(level)] ?? '미확인'
const stateLabel = (state: unknown) => ({ confirmed: '확인', inferred: '추정', unknown: '미확인' })[String(state)] ?? '미확인'
/** 역할 능력 등급 → 권한 수준 코드. 피해 범위(blastRadius roleLevel)와 같은 경계다. 모르면 unknown */
const rankCode = (rank: number | undefined) => rank === undefined ? 'unknown' : rank <= 0 ? 'none' : rank >= RANK.admin ? 'admin' : rank >= RANK.write ? 'write' : 'read'
/** 권한 수준 코드 → 사실과 요약에 쓰는 말 */
export const LEVEL_TEXT: Record<string, string> = { admin: '관리', write: '쓰기', read: '읽기', none: '권한 없음', unknown: '미확인' }
const rankLevel = (rank: number | undefined) => LEVEL_TEXT[rankCode(rank)]
/** 역할 관계(has_role_on)의 권한 수준 코드. 탐지 엔진 간선과 같은 함수로 정한다 */
export const roleLevelCode = (graph: GraphStoreV2, r: ResolvedRelation) => rankCode(roleRelationCapability(graph, r).rank)
/** 위협 판정 V2 위협은 유형, 확정 여부, 발생 여부를 따로 가진다. 없으면 미확인 */
const categoryOf = (f: FindingV2) => String(f.primaryType ?? '기타')
const certaintyOf = (f: FindingV2) => f.threatCertainty ? (f.threatCertainty === '확정' ? '확인' : '추정') : '미확인'
const basisOf = (f: FindingV2) => f.occurrence ? (f.occurrence === '발생' ? '실행 기록' : '구성 기반') : '미확인'
const notes: Record<string, string> = { factor_alone: '인증 요소 하나만으로 로그인할 수 없습니다.', scope_identity_only: '사용자 정보 확인 권한만 수집됐습니다.', scope_unknown: '토큰 권한 범위를 수집하지 못해 계정 권한을 가정했습니다.', scope_read_only: '토큰은 읽기 권한 범위로 제한했습니다.', scope_outside_graph: '일부 권한의 대상이 현재 그래프에 없습니다.', role_permissions_unknown: '일부 역할의 세부 권한을 수집하지 못했습니다.', sso_account_unknown: '일부 SSO 대상 계정을 연결하지 못했습니다.', weak_link_stopped: '추정 동일인 연결 뒤에서는 추가 연결 탐색을 멈췄습니다.', credential_inactive: '활성 상태가 아닌 자격증명입니다.', truncated: '계산 객체 상한에 도달했습니다.' }
function factDetail(graph: GraphStoreV2, fact: KgFact): string {
  if (fact.detail) return fact.detail
  const d = fact.data
  if (!d) return fact.label
  const label = (key: unknown) => typeof key === 'string' ? objectLabel(graph, key) : '미확인'
  if (fact.kind === 'credential' && Array.isArray(d.assessments)) return [`종류: ${d.provider ? providerLabel(String(d.provider)) : '미확인'} ${d.type ?? ''}\n소유 계정: ${d.ownerLabel ?? '미확인'}`, ...d.assessments.map((r: ReturnType<typeof blastSummary>) =>
    `${modeLabel(r.mode)}\n도달 객체: ${r.reached}개\n최고 권한: ${r.highest ? `${r.highest.label}, ${levelLabel(r.highest.level)}, ${stateLabel(r.highest.certainty)}` : r.highestLevel ? levelLabel(r.highestLevel) : '미확인'}\n${r.providers.map(p => `${providerLabel(p.provider)} ${p.count}개, ${levelLabel(p.highest)}`).join('\n')}\n조직 관리: ${r.tenantAdmins.map(n => `${n.label} (${stateLabel(n.certainty)})`).join(', ') || '확인된 대상 없음'}\n${r.incomplete ? '수집 누락이나 탐색 한계가 있습니다.\n' : ''}${r.notes.map(code => notes[code] ?? code).join('\n')}`)].join('\n\n')
  if (fact.kind === 'blast_hop') {
    const kinds: Record<string, string> = { holder: '소유 계정', owner_app: '소유 앱', acts_as: '대리 실행', receives_into: '전달 대상', grant: '역할과 권한', member: '소속', contains: '포함 관계', runs_as: '실행 계정', sso: 'SSO 로그인', automation_link: '같은 자동화의 동일인 연결', takeover: '관리 권한을 통한 계정 탈취', effective_access: '계산된 접근 경로' }
    return `${modeLabel(d.mode)}\n${label(d.from)} → ${label(d.to)}\n연결: ${kinds[String(d.kind)] ?? String(d.kind)}\n권한: ${levelLabel(d.level)}, ${stateLabel(d.certainty)}${d.roleName ? `\n역할: ${d.roleName}` : ''}${d.throughKey ? `\n경유: ${label(d.throughKey)}` : ''}${d.eaRowId ? `\n접근 근거: ${d.eaRowId}` : ''}`
  }
  if (fact.kind === 'object') return `${providerLabel(String(d.provider))}, ${d.type}${d.account ? `\n${accountLine(d.account as AccountFact)}` : ''}\n${Object.entries((d.properties ?? {}) as Record<string, unknown>).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')}`
  if (fact.kind === 'relation') return `${label(d.from)} → ${relationLabel(String(d.type))} → ${label(d.to)}\n역할: ${d.role || (d.roleKey ? label(d.roleKey) : '해당 없음')}${d.level ? `\n권한 수준: ${d.level}` : ''}${Array.isArray(d.permissions) ? `\n세부 권한: ${d.permissions.join(', ')}` : ''}`
  if (fact.kind === 'identity_link' && Array.isArray(d.pairs)) return d.pairs.map((e: { from: string; to: string; level: string }) => `${label(e.from)} ↔ ${label(e.to)}\n연결 근거: ${e.level}`).join('\n\n')
  if (fact.kind === 'finding') return `${d.summary}\n${Array.isArray(d.checks) ? d.checks.map((c: { label: string; detail: string; state: string }) => `${stateLabel(c.state)}: ${c.label}\n${c.detail}`).join('\n\n') : ''}`
  if (fact.kind === 'observation') return `시각: ${d.occurredAt || '미확인'}\n관련 객체: ${Array.isArray(d.objectKeys) ? d.objectKeys.map(label).join(', ') : '미확인'}`
  if (fact.kind === 'schema') return `객체 ${d.objects}개, 관계 ${d.relations}개, 동일인 연결 ${d.identityLinks}개, 표시 범위 탐지 ${d.visibleFindings}개`
  return fact.label
}
type AccountFact = { kind: string } & ReturnType<typeof principalState>
const knownText = (v: boolean | null) => v === null ? '모름' : v ? '예' : '아니오'
const loginText = (v: string | null) => v === null ? '모름' : v === 'never' ? '로그인 기록 없음' : '기록 있음'
const accountLine = (a: AccountFact) => `계정 상태: ${a.status ?? '모름'}, 관리자: ${knownText(a.admin)}, 2단계 인증: ${knownText(a.mfa)}, 마지막 로그인: ${a.lastLogin === null ? '모름' : a.lastLogin === 'never' ? '기록 없음' : a.lastLogin}`
/** 목록 밖 속성을 객체마다 넘기는 최대 수 */
const EXTRA_PROPERTIES = 30
const safeProperties = ['status', 'scopes', 'scope', 'granted_scopes', 'role', 'role_name', 'role_type', 'visibility', 'public', 'is_admin', 'is_owner', 'is_suspended', 'sign_on_mode', 'signOnMode', 'type', 'expires_at', 'is_private', 'perm_ModifyAllData', 'perm_ManageUsers', 'perm_AuthorApex', 'perm_ViewAllData']
function objectData(graph: GraphStoreV2, key: string) {
  const o = graph.objectsByKey.get(key)
  if (!o) return undefined
  const properties: Record<string, unknown> = {}
  for (const key of safeProperties) {
    const v = o.canonical.properties[key]
    if (typeof v === 'boolean' || typeof v === 'number') properties[key] = v
    else if (typeof v === 'string') properties[key] = clip(v)
    else if (Array.isArray(v)) properties[key] = v.filter(x => typeof x === 'string').slice(0, 40).map(x => clip(x))
  }
  // account: 그룹이 아닌 Principal 의 계정 판정과 수집 속성에서 읽은 상태(Explorer 와 같은 규칙). null 은 수집되지 않아 모름
  const account = isAccountPrincipal(o) ? { kind: accountKind(o), ...principalState(o) } : undefined
  // 목록 밖 속성은 규칙으로 넘긴다 (propertyRules.ts). 뺀 값 수는 propertiesOmitted 로 알려 「없음」으로 읽지 않게 한다
  const extra = modelProperties(Object.fromEntries(Object.entries(o.canonical.properties).filter(([k]) => !safeProperties.includes(k))), EXTRA_PROPERTIES)
  return { provider: o.canonical.provider, type: o.canonical.object_type, interfaces: o.canonical.interfaces, properties: { ...properties, ...extra.properties }, ...(extra.omitted ? { propertiesOmitted: extra.omitted } : {}), ...(account ? { account } : {}),
    collectedAt: (o.canonical.source.observations ?? []).map(o => o.collected_at).filter(Boolean).slice(0, 4) }
}
/** 출력 상한용 짧은 객체 사실: 고정 목록 속성과 계정 상태만 남기고 줄인 규칙 속성 수를 propertiesTrimmed 로 적는다. 줄일 것이 없으면 undefined */
function trimObjectFact(f: Omit<KgFact, 'id'>): Omit<KgFact, 'id'> | undefined {
  const properties = f.data?.properties as Record<string, unknown> | undefined
  if (f.kind !== 'object' || !properties) return undefined
  const kept = Object.fromEntries(Object.entries(properties).filter(([k]) => safeProperties.includes(k)))
  const cut = Object.keys(properties).length - Object.keys(kept).length
  return cut ? { ...f, data: { ...f.data, properties: kept, propertiesTrimmed: cut } } : undefined
}
const trimNote = (n: number) => n ? `\n출력 상한 때문에 객체 ${n}개는 고정 속성과 계정 상태만 보냈습니다(propertiesTrimmed). 그 객체의 다른 속성이 필요하면 search_objects에 그 객체 키를 넣어 다시 조회하세요.` : ''
/** Never serialize raw relation sources, request params, observation attributes, identifiers or script bodies. */
function factsFor(context: KgContext, result: AssistantResult): Omit<KgFact, 'id'>[] {
  return result.evidence.map(e => {
    let data: Record<string, unknown> | undefined, detail: string | undefined
    if (e.kind === 'object') data = objectData(context.graph, e.ref)
    else if (e.kind === 'relation') {
      const r = context.graph.relationsByKey.get(e.ref)
      // level: 역할 관계의 권한 수준. 탐지 엔진 간선과 같은 함수(roleRelationCapability)로 정한다. permissions: 역할 칸의 권한 키 묶음
      const permissions = Array.isArray(r?.properties.permissions) ? r.properties.permissions.filter(p => typeof p === 'string').slice(0, 40).map(p => clip(p)) : []
      if (r) data = { from: r.sourceKey, to: r.targetKey, type: r.relationType, role: r.roleName, roleKey: r.roleKey,
        ...(r.relationType === 'has_role_on' ? { level: rankLevel(roleRelationCapability(context.graph, r).rank) } : {}), ...(permissions.length ? { permissions } : {}) }
    } else if (e.kind === 'observation') {
      const o = context.evidence.observationsById.get(e.ref)
      if (o) data = { kind: o.kind, occurredAt: o.occurredAt, objectKeys: o.objectKeys }
    } else if (e.kind === 'identity_link') {
      data = { pairs: result.graph.identityEdges.filter(x => e.ref === x.linkId || e.ref.startsWith(`${x.linkId}:`)).map(x => ({ from: x.from, to: x.to, level: x.level })) }
    } else if (e.kind === 'evidence_link') {
      const link = context.evidence.evidenceLinksById.get(e.ref)
      if (link) data = { from: link.from, to: link.to, type: link.evidenceType }
    } else if (e.kind === 'finding') {
      const f = context.findings.find(f => f.id === e.ref)
      // providers 는 탐지 경로 그림의 SaaS 다(App.tsx withPathProviders)
      // certainty, basis: 위협 판정의 확실도(확인, 추정)와 근거 종류(실행 기록, 구성 기반). 없으면 미확인
      if (f) data = { severity: f.severity, category: categoryOf(f), ...(f.types ? { types: f.types } : {}), certainty: certaintyOf(f), basis: basisOf(f), providers: f.providerSet,
        summary: clip(f.summary, 1500), objectKeys: f.involvedObjectKeys, relationKeys: f.involvedRelationKeys, observationIds: f.evidenceObservationIds,
        checks: (f.checks ?? []).map(c => ({ label: clip(c.label), state: c.state, detail: clip(c.detail, 1000) })) }
    } else if (['access', 'remediation', 'credential', 'reference'].includes(e.kind)) detail = clip(e.detail, 2000)
    return { kind: e.kind, ref: clip(e.ref), label: clip(e.label), ...(e.state ? { state: e.state } : {}), ...(detail ? { detail } : {}), ...(data ? { data } : {}) }
  })
}
const byName = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
/** access_gaps 사람 목록 상한. 위협 하나만 볼 때(gapId)는 더 많이 */
const GAP_PEOPLE_LIST = 15, GAP_PEOPLE_ONE = 60
/** 새로 생긴 권한이 있고 수에서 빼지 않은 사람. 권한 없는 접근자와 권한 초과 접근자다(Access Gaps 화면 isGapPerson 과 같다) */
const isGapPerson = (p: ThreatGapPersonV2) => p.gained.length > 0 && !p.excluded
/** 직접 권한 값. Access Gaps 사람 표 directText 와 같은 글(조직 밖 직접 공유, 승인 범위 안). 누구나 공유는 directVia 로 따로 단다 */
const gapDirect = (p: ThreatGapPersonV2) => p.share && !p.excluded ? `직접 공유 ${p.share}, 조직 밖` : !p.direct ? '없음' : p.share && p.excluded === '승인됨' ? `직접 공유 ${p.direct}, 승인 범위 안` : p.direct
/** 사람 칸 이름. Access Gaps 화면의 두 수와 벤 칸과 같은 말 */
const gapColumn = (p: ThreatGapPersonV2) => p.excluded ? `제외(${p.excluded})` : isGapPerson(p) ? (p.direct ? '권한 초과 접근자' : '권한 없는 접근자') : p.derived ? '직접 권한과 파생 접근' : '직접 권한만'
/** 화면 머리와 같은 수: 직접 권한, 파생 접근, 권한 없는 접근자, 권한 초과 접근자 */
/** 위협 판정 키 이름. 그래프 객체는 다른 도구와 같은 이름, 가상 키(메일함, 조직 밖 주소, 사용자 속성, 누구나)는 화면과 같은 이름 */
const gapKeyLabel = (graph: GraphStoreV2, key: string) => graph.objectsByKey.has(key) ? objectLabel(graph, key) : keyName(key, graph)
const gapCountText = (g: ThreatAccessGapV2) => `직접 권한 ${g.directCount}명, 파생 접근 ${g.derivedCount}명, 권한 없는 접근자 ${g.unauthorized}명, 권한 초과 접근자 ${g.excess}명`
/** 위협 하나의 Access Gap 벤. 칸 이름은 Access Gaps 상세와 같고 인원은 엔진이 센 값이다 */
function gapData(graph: GraphStoreV2, f: FindingV2, limit: number) {
  const g = f.threatAccessGap!, path = f.threatPath
  const people = [...g.people].sort((a, b) => Number(isGapPerson(b)) - Number(isGapPerson(a)) || Number(!!b.excluded) - Number(!!a.excluded) || Number(!!b.derived) - Number(!!a.derived))
  const byColumn = g.people.reduce<Record<string, number>>((n, p) => ({ ...n, [gapColumn(p)]: (n[gapColumn(p)] ?? 0) + 1 }), {})
  return { gapId: f.id, threat: clip(f.title), type: f.primaryType ?? null, severity: f.severity,
    ...(path ? { point: { key: path.point, label: gapKeyLabel(graph, path.point) }, target: { key: path.target, label: gapKeyLabel(graph, path.target) } } : {}),
    directCount: g.directCount, derivedCount: g.derivedCount, unauthorized: g.unauthorized, excess: g.excess, counts: gapCountText(g), peopleByColumn: byColumn,
    people: people.slice(0, limit).map(p => ({ name: gapKeyLabel(graph, p.person), column: gapColumn(p), direct: gapDirect(p), derived: p.derived ?? '없음',
      gained: p.gained.join(', ') || '없음', certainty: p.certainty ?? '확정', ...(p.publicOnly ? { directVia: '누구나 공유' } : {}) })),
    ...(g.people.length > limit ? { peopleOmitted: g.people.length - limit } : {}) }
}
/** 서로 다른 SaaS 객체를 잇는 관계 수. 「출발>도착」 SaaS 쌍마다 센다. 서버 kg_schema 와 순서까지 같다 (수 내림차순, 이름순) */
function crossProviderRelations(graph: GraphStoreV2): Record<string, number> {
  const counts = new Map<string, number>()
  for (const r of graph.relationsByKey.values()) {
    const from = graph.objectsByKey.get(r.sourceKey)?.canonical.provider, to = graph.objectsByKey.get(r.targetKey)?.canonical.provider
    if (from && to && from !== to) counts.set(`${from}>${to}`, (counts.get(`${from}>${to}`) ?? 0) + 1)
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1] || byName(a[0], b[0])))
}
/**
 * search_objects 의 속성 비교(property, value). value 는 true, false 나 글자(대소문자 무시)다.
 * 속성이 없거나 null 이면 missing: 값을 모르므로 일치하지 않는 것과 따로 센다. 서버 searchObjectKeys 와 같은 규칙이다
 */
export function propertyMatch(o: FixtureObject, property: string, value: string): 'match' | 'other' | 'missing' {
  const v = propertyAt(o.canonical.properties, property)
  if (v === undefined || v === null) return 'missing'
  const want = value.toLowerCase()
  if (want === 'true') return v === true || v === 'true' || v === 1 ? 'match' : 'other'
  if (want === 'false') return v === false || v === 'false' || v === 0 ? 'match' : 'other'
  return typeof v === 'string' && v.toLowerCase() === want ? 'match' : 'other'
}
/**
 * 계정 판정. human, service, group 은 정규화기가 적은 판정이다.
 * 판정이 없거나 unknown 이면 동일인 연결과 같은 principalKind(계정 유형, 봇 표시)로 추정해 likely_human, likely_service 로 적는다
 */
export function accountKind(o: FixtureObject): string {
  const judged = o.canonical.judged?.principal_kind
  if (judged === 'human' || judged === 'service' || judged === 'group') return judged
  const kind = principalKind(o)
  return kind === 'unknown' ? 'unknown' : `likely_${kind}`
}
/**
 * SaaS마다, 종류(object_type)마다 Principal(계정, 봇, 그룹) 객체 수(total)와 계정 판정별 수.
 * 서버 kg_schema 도 Principal 객체를 읽어 같은 함수를 부른다. 순서는 이름순, total 이 맨 앞
 */
export function principalCounts(objects: Iterable<FixtureObject>): Record<string, Record<string, Record<string, number>>> {
  const counts = new Map<string, Map<string, Record<string, number>>>()
  for (const o of objects) {
    if (!o.canonical.interfaces.includes('Principal')) continue
    const types = counts.get(o.canonical.provider) ?? new Map<string, Record<string, number>>()
    counts.set(o.canonical.provider, types)
    const row = types.get(o.canonical.object_type) ?? { total: 0 }
    types.set(o.canonical.object_type, row)
    const kind = accountKind(o)
    row.total++
    row[kind] = (row[kind] ?? 0) + 1
  }
  const kindOrder = (a: [string, number], b: [string, number]) => a[0] === 'total' ? -1 : b[0] === 'total' ? 1 : byName(a[0], b[0])
  return Object.fromEntries([...counts].sort((a, b) => byName(a[0], b[0])).map(([p, types]) =>
    [p, Object.fromEntries([...types].sort((a, b) => byName(a[0], b[0])).map(([t, row]) => [t, Object.fromEntries(Object.entries(row).sort(kindOrder))]))]))
}
/** 계정: 그룹이 아닌 Principal 객체 (사람, 서비스, 봇 계정). accounts 조회와 객체 사실의 account 기준 */
export const isAccountPrincipal = (o: FixtureObject) => o.canonical.interfaces.includes('Principal') && accountKind(o) !== 'group'
/**
 * accounts 조회: 계정을 원래 순서로. provider, kind(계정 판정), status(active, inactive 는 active 가 아닌 기록된 상태, 그 밖은 같은 상태),
 * admin, mfa 로 거른다. 조건 칸의 값이 수집되지 않은 계정은 missing 에 따로 센다. 서버는 계정 객체만 읽은 그래프로 같은 함수를 부른다
 */
export function accountList(graph: GraphStoreV2, args: ToolArgs): { all: FixtureObject[]; missing: number } {
  const all: FixtureObject[] = []
  let missing = 0
  const status = args.status === undefined ? undefined : String(args.status).toLowerCase()
  for (const o of graph.objectsByKey.values()) {
    if (!isAccountPrincipal(o) || args.provider && o.canonical.provider !== args.provider || args.kind && accountKind(o) !== args.kind) continue
    const s = principalState(o)
    const checks = [
      status === undefined ? true : s.status === null ? null : status === 'inactive' ? s.status !== 'active' : s.status === status,
      args.admin === undefined ? true : s.admin === null ? null : s.admin === args.admin,
      args.mfa === undefined ? true : s.mfa === null ? null : s.mfa === args.mfa,
    ]
    if (checks.includes(false)) continue
    if (checks.includes(null)) missing++
    else all.push(o)
  }
  return { all, missing }
}
/** SaaS마다 객체 수. 수 내림차순, 이름순 (서버 kg_schema 와 같다) */
const objectsBySaas = (graph: GraphStoreV2) => Object.fromEntries([...graph.objectsByProvider].map(([p, os]) => [p, os.length] as const).sort((a, b) => b[1] - a[1] || byName(a[0], b[0])))
/** SaaS마다 객체 종류별 수. SaaS 는 전체 수 내림차순, 종류는 수 내림차순, 이름순. 서버 kg_schema 는 SQL 로 센 줄을 같은 함수에 넘긴다 */
export function objectTypeCounts(rows: ReadonlyArray<{ provider: string; type: string; n: number }>): Record<string, Record<string, number>> {
  const bySaas = new Map<string, Array<[string, number]>>()
  for (const r of rows) bySaas.set(r.provider, [...(bySaas.get(r.provider) ?? []), [r.type, r.n]])
  const total = (types: Array<[string, number]>) => types.reduce((n, [, c]) => n + c, 0)
  return Object.fromEntries([...bySaas].sort((a, b) => total(b[1]) - total(a[1]) || byName(a[0], b[0]))
    .map(([p, types]) => [p, Object.fromEntries(types.sort((a, b) => b[1] - a[1] || byName(a[0], b[0])))]))
}
const objectsByType = (graph: GraphStoreV2) => objectTypeCounts([...countEntries([...graph.objectsByKey.values()].map(o => `${o.canonical.provider}\u0000${o.canonical.object_type}`))]
  .map(([k, n]) => { const [provider, type] = k.split('\u0000'); return { provider: provider!, type: type!, n } }))
/** 종류 조건 안내. 서버 search_objects 도 같은 글을 쓴다 */
export const typeNote = (type: string | undefined, total: number) =>
  type ? ` 종류: ${type}.${total ? '' : ' 이 종류의 객체가 없습니다. 종류 이름은 kg_schema objectsByType 에 있는 이름을 그대로 쓰세요.'}` : ''
/** 검색에서 뺀 숨긴 기본 객체 안내. 처음 몇 개만 이름을 적는다. 서버 search_objects 도 같은 글을 쓴다 */
export function hiddenSearchNote(shown: readonly FixtureObject[], total: number): string {
  if (!total) return ''
  const names = shown.map(o => `${providerLabel(o.canonical.provider)} ${o.canonical.object_type} ${objectName(o, o.fixture_key)}`).join(', ')
  return ` 기본 보기에서 숨긴 플랫폼 기본 객체 ${total}개도 조건에 맞습니다(${names}${total > shown.length ? ' 등' : ''}). 아무도 쓰지 않는 기본 객체(배정 0)라 결과에서 뺐습니다.`
}
export const HIDDEN_NOTE_NAMES = 5
/** 속성 조건 안내. 서버 search_objects 도 같은 글을 쓴다 */
export const propertyNote = (property: string | undefined, value: string, missing: number) =>
  property ? ` 조건: ${property} = ${value}.${missing ? ` 같은 검색 범위에서 이 속성이 없는 객체 ${missing}개는 값을 몰라 결과에서 빠졌습니다. 다른 속성으로 기록됐을 수 있습니다.` : ''}` : ''
/**
 * SaaS마다 동일인 연결 수. 사람 연결(meta.kind 가 없거나 person)과 그 밖의 연결(자동화 등)을 나누고, 사람 연결의 계정 쌍을 연결 수준별로 센다.
 * 보이는 구성원이 둘 이상인 연결만 센다. 서버는 연결과 구성원만 읽은 그래프로 같은 함수를 부른다.
 * providers 에 준 SaaS 는 연결이 없어도 0건으로 넣는다 (빠진 SaaS 를 「모름」으로 읽지 않게)
 */
export function identityLinksBySaas(graph: GraphStoreV2, providers: Iterable<string> = []): Record<string, { person: number; other: number; personPairsByLevel: Record<string, number> }> {
  const counts = new Map<string, { person: number; other: number; personPairsByLevel: Record<string, number> }>()
  for (const provider of providers) counts.set(provider, { person: 0, other: 0, personPairsByLevel: {} })
  const entry = (provider: string) => {
    const found = counts.get(provider) ?? { person: 0, other: 0, personPairsByLevel: {} }
    counts.set(provider, found)
    return found
  }
  const providerOf = (key: string) => graph.objectsByKey.get(key)!.canonical.provider
  for (const link of graph.linksById.values()) {
    const members = link.set.filter(m => graph.objectsByKey.has(m.object_key)).map(m => m.object_key)
    if (members.length < 2) continue
    const person = !link.meta?.kind || link.meta.kind === 'person'
    for (const provider of new Set(members.map(providerOf))) entry(provider)[person ? 'person' : 'other']++
    if (!person) continue
    for (const e of identityEvidenceEdges(graph, link, 'all')) for (const provider of new Set([e.from, e.to].map(providerOf))) {
      const levels = entry(provider).personPairsByLevel
      levels[e.level] = (levels[e.level] ?? 0) + 1
    }
  }
  return Object.fromEntries([...counts].sort((a, b) => b[1].person - a[1].person || byName(a[0], b[0]))
    .map(([p, c]) => [p, { ...c, personPairsByLevel: Object.fromEntries(Object.entries(c.personPairsByLevel).sort((a, b) => byName(a[0], b[0]))) }]))
}
/**
 * identity_links 조회: 동일인 연결의 계정 쌍을 연결 원래 순서로. provider 는 한쪽 끝, otherProvider 는 다른 쪽 끝의 SaaS.
 * kind 는 사람 연결(meta.kind 가 없거나 person)과 그 밖의 연결(자동화 등). identityLinksBySaas 와 같은 기준이다
 */
export function identityLinkPairs(graph: GraphStoreV2, args: ToolArgs) {
  const providerOf = (key: string) => graph.objectsByKey.get(key)?.canonical.provider
  const ends = (a: string, b: string) => (!args.provider || providerOf(a) === args.provider) && (!args.otherProvider || providerOf(b) === args.otherProvider)
  return [...graph.linksById.values()].flatMap(link => {
    const kind = !link.meta?.kind || link.meta.kind === 'person' ? 'person' : String(link.meta.kind)
    if (args.kind === 'person' && kind !== 'person' || args.kind === 'other' && kind === 'person') return []
    return identityEvidenceEdges(graph, link, 'all').filter(e => (!args.level || e.level === args.level) && (ends(e.from, e.to) || ends(e.to, e.from))).map(edge => ({ edge, kind }))
  })
}
/**
 * 계정마다 같은 사람으로 묶인 다른 계정의 SaaS (사람 연결 묶음 set 의 구성원 기준, 이름순).
 * identity_links 쌍은 두 끝만 보여 「이 SaaS 하고만 묶인 사람」을 모델이 고르다 틀렸다 (R4 2026-11-02). 고르는 일은 코드가 한다
 */
export function linkedSaasByAccount(graph: GraphStoreV2): Map<string, string[]> {
  const out = new Map<string, Set<string>>()
  for (const link of graph.linksById.values()) {
    if (link.meta?.kind && link.meta.kind !== 'person') continue
    const members = [...new Set(link.set.map(m => m.object_key).filter(k => graph.objectsByKey.has(k)))]
    for (const key of members) for (const other of members) if (other !== key) {
      const saas = out.get(key) ?? new Set<string>()
      saas.add(graph.objectsByKey.get(other)!.canonical.provider)
      out.set(key, saas)
    }
  }
  return new Map([...out].map(([key, saas]) => [key, [...saas].sort(byName)]))
}
/** 값마다 수. 수 내림차순, 이름순 (서버 SQL 의 ORDER BY n DESC, v 와 같다) */
export function countEntries(values: Iterable<string>): Array<[string, number]> {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1] || byName(a[0], b[0]))
}
const entriesText = (entries: Array<[string, number]>) => entries.map(([v, n]) => `${v} ${n}`).join(', ') || '없음'
/**
 * relations 조회: 구조 관계를 원래 순서로. relationType, 출발 끝 SaaS(fromProvider), 도착 끝 SaaS(toProvider)로 거르고,
 * level 을 주면 역할 관계(has_role_on) 중 그 권한 수준인 것만 남긴다. 서버는 같은 조건을 SQL 과 같은 함수로 계산한다
 */
export function relationList(graph: GraphStoreV2, args: ToolArgs): ResolvedRelation[] {
  const providerOf = (key: string) => graph.objectsByKey.get(key)?.canonical.provider
  return [...graph.relationsByKey.values()].filter(r => (!args.relationType || r.relationType === args.relationType)
    && (!args.fromProvider || providerOf(r.sourceKey) === args.fromProvider) && (!args.toProvider || providerOf(r.targetKey) === args.toProvider)
    && (!args.level || r.relationType === 'has_role_on' && roleLevelCode(graph, r) === args.level))
}
/** relations 요약. 수는 조회 전체 기준이고 역할 관계 권한 수준은 역할 관계가 있을 때만 적는다. 서버도 같은 글을 쓴다 */
export function relationListSummary(total: number, offset: number, limit: number, byType: Array<[string, number]>, byPair: Array<[string, number]>, byLevel: Array<[string, number]>): string {
  const shown = Math.min(limit, Math.max(0, total - offset))
  return `관계 ${total}개, offset ${offset}, ${shown}개 표시. 아래 수는 이 조회 전체 ${total}개 기준입니다.\n종류별: ${entriesText(byType)}\nSaaS 쌍별(출발>도착): ${entriesText(byPair)}${byLevel.length ? `\n역할 관계 권한 수준별: ${entriesText(byLevel)}` : ''}${offset + limit < total ? '\n다음 페이지가 있습니다.' : ''}`
}
/** 동일인 연결 쌍을 맞춘 규칙 (개념 사전 crosswalk.yaml 의 연결 규칙). 모델에 코드와 같이 넘기는 말 */
const LINK_RULE: Record<string, string> = { vendor_foreign_key: 'SaaS가 밝힌 외래 키', federated_subject: 'SSO 연동 식별자', natural_key: '메일 일치', log_correlation: '실행 로그에서 함께 나타남' }
/** 연결 쌍의 규칙. 연결에 쌍별 기록(meta.edges)이 없으면 unknown */
function edgeRule(graph: GraphStoreV2, edge: { linkId: string; from: string; to: string }): string {
  const raw = graph.linksById.get(edge.linkId)?.meta?.edges
  const found = Array.isArray(raw) ? raw.find(e => !!e && typeof e === 'object' && (((e as { a?: unknown }).a === edge.from && (e as { b?: unknown }).b === edge.to) || ((e as { a?: unknown }).a === edge.to && (e as { b?: unknown }).b === edge.from))) as { rule?: unknown } | undefined : undefined
  return typeof found?.rule === 'string' ? found.rule : 'unknown'
}
const blastCache = new WeakMap<GraphStoreV2, Map<readonly EffectiveAccessRow[] | undefined, Map<string, BlastRadius>>>()
function blast(context: KgContext, key: string, mode: 'token' | 'account') {
  const precomputed = context.blastRadii?.get(key)?.[mode]
  if (precomputed) return precomputed
  let cache = blastCache.get(context.graph)
  if (!cache) { cache = new Map(); blastCache.set(context.graph, cache) }
  let rows = cache.get(context.eaRows)
  if (!rows) { rows = new Map(); cache.set(context.eaRows, rows) }
  const id = `${mode}:${key}`
  let result = rows.get(id)
  if (!result) { result = computeBlastRadius(key, mode, { graph: context.graph, eaRows: context.eaRows }); rows.set(id, result) }
  return result
}
const risk = (r: BlastRadius) => (blastLevelRank(r.highest?.level) + 1) * 100 + (r.tenantAdmins.length ? 50 : 0) + (r.certainty === 'confirmed' ? 10 : 0) + (r.crossProvider ? 5 : 0)
/** 최고 권한. 읽기 이상이 없으면 SaaS별 최고 수준(사용)을 쓴다. 둘 다 없으면 undefined */
const topLevel = (r: BlastRadius) => r.highest?.level ?? (r.providers.some(p => p.highest === 'use') ? 'use' : undefined)
function blastSummary(context: KgContext, r: BlastRadius) {
  return { mode: r.mode, ownerKey: r.ownerKey, reached: r.providers.reduce((sum, p) => sum + p.count, 0), evidenceOnlyObjects: r.nodes.filter(n => n.key !== r.credentialKey && !n.controlled && n.level === undefined).length, providers: r.providers,
    highest: r.highest ? { key: r.highest.key, label: objectLabel(context.graph, r.highest.key), level: r.highest.level, certainty: r.highest.certainty } : null, highestLevel: topLevel(r) ?? null,
    tenantAdmins: r.tenantAdmins.map(n => ({ key: n.key, label: objectLabel(context.graph, n.key), certainty: n.certainty })), crossProvider: r.crossProvider, certainty: r.certainty, incomplete: r.incomplete, notes: [...new Set(r.notes.map(n => n.code))] }
}
/** 더 위험한 피해 범위가 앞(음수). 최고 권한, 조직 관리, 확인 여부, 다른 SaaS 도달, 도달 수 순 */
const byRisk = (a: BlastRadius, b: BlastRadius) => risk(b) - risk(a) || b.nodes.length - a.nodes.length
/**
 * credential_blast 의 순위. 미리 계산한 피해 범위가 있으면 그래프 없이 정한다 (서버가 필요한 객체만 읽을 때 쓴다).
 * both 모드는 자격증명마다 토큰 유출과 소유 계정 탈취 중 더 위험한 쪽으로 순위를 정한다. 단일 모드는 그 모드 하나로 정한다
 */
export function rankCredentials(context: KgContext, args: ToolArgs): Array<{ key: string; radii: BlastRadius[] }> {
  const modes = args.mode === 'token' ? ['token'] as const : args.mode === 'account' ? ['account'] as const : ['token', 'account'] as const
  const candidates = context.blastRadii
    ? [...context.blastRadii].filter(([key, b]) => (!args.provider || b.provider === args.provider) && (!args.type || b.type === args.type) && (!args.key || key === args.key || b.token.ownerKey === args.key)).map(([key]) => key)
    : listCredentials(context.graph).filter(o => (!args.provider || o.canonical.provider === args.provider) && (!args.type || o.canonical.object_type === args.type) && (!args.key || o.fixture_key === args.key || credentialOwner(o.fixture_key, context.graph)?.key === args.key)).map(o => o.fixture_key)
  return candidates.map(key => ({ key, radii: modes.map(m => blast(context, key, m)) }))
    .map(row => ({ row, worst: row.radii.reduce((w, r) => byRisk(r, w) < 0 ? r : w) }))
    .sort((a, b) => byRisk(a.worst, b.worst) || a.row.key.localeCompare(b.row.key))
    .map(({ row }) => row)
}
/**
 * credential_blast 조회 전체의 집계. 페이지만 받은 모델이 직접 세다 틀리지 않게 코드가 센다.
 * 서버는 집계를 위해 조회된 자격증명 객체를 모두 읽는다
 */
const OWNER_NAMES = 5
function credentialTally(graph: GraphStoreV2, all: ReadonlyArray<{ key: string; radii: BlastRadius[] }>, modes: readonly ('token' | 'account')[]): string {
  const tally = (values: string[]) => entriesText(countEntries(values))
  const type = (key: string) => { const o = graph.objectsByKey.get(key)?.canonical; return o ? `${o.provider} ${o.object_type}` : '미확인' }
  const lines = [`아래 수는 이 조회 전체 ${all.length}개 기준입니다.`, `종류별: ${tally(all.map(row => type(row.key)))}`,
    `소유 계정: ${tally(all.map(row => row.radii[0]?.ownerKey ? '있음' : '확인 안 됨'))}`]
  // 소유 계정별 수. 상위만 이름을 적는다
  const owners = countEntries(all.flatMap(row => row.radii[0]?.ownerKey ? [objectLabel(graph, row.radii[0].ownerKey)] : []))
  if (owners.length) lines.push(`소유 계정별 상위: ${entriesText(owners.slice(0, OWNER_NAMES))}${owners.length > OWNER_NAMES ? ` 외 ${owners.length - OWNER_NAMES}개 계정` : ''}`)
  for (const [i, mode] of modes.entries()) {
    const radii = all.map(row => row.radii[i])
    lines.push(`${modeLabel(mode)} 최고 권한별: ${tally(radii.map(r => levelLabel(topLevel(r))))}. 조직 관리 도달 ${radii.filter(r => r.tenantAdmins.length).length}개, 다른 SaaS 도달 ${radii.filter(r => r.crossProvider).length}개, 수집 누락이나 탐색 한계 ${radii.filter(r => r.incomplete).length}개`)
    lines.push(`${modeLabel(mode)} 계산 메모별: ${tally(radii.flatMap(r => [...new Set(r.notes.map(n => notes[n.code] ?? n.code))]))}`)
  }
  return lines.join('\n')
}
function credentialTool(context: KgContext, args: ToolArgs) {
  const { graph, evidence } = context
  const builder = new EvidenceBuilder(graph, evidence)
  const modes = args.mode === 'token' ? ['token'] as const : args.mode === 'account' ? ['account'] as const : ['token', 'account'] as const
  const all = rankCredentials(context, args)
  const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 10), rows = all.slice(offset, offset + limit)
  // 위험 점수가 같은 자격증명 수. 도달 수는 같은 점수 안의 순서만 정하므로, 한 페이지만 받아도 1위가 단독인지 알 수 있게 넘긴다.
  // 순위 기준(위험 점수, 도달 범위 크기)이 모두 같은 완전 동점은 따로 센다. 그 안의 순서는 키 이름순이라 순위로 말할 수 없다
  const worstOf = (row: { radii: BlastRadius[] }) => row.radii.reduce((w, r) => byRisk(r, w) < 0 ? r : w)
  const scoreOf = (row: { radii: BlastRadius[] }) => risk(worstOf(row))
  const tieOf = (row: { radii: BlastRadius[] }) => `${scoreOf(row)}:${worstOf(row).nodes.length}`
  const sameScore = new Map<number, number>(), sameRank = new Map<string, number>()
  for (const row of all) {
    sameScore.set(scoreOf(row), (sameScore.get(scoreOf(row)) ?? 0) + 1)
    sameRank.set(tieOf(row), (sameRank.get(tieOf(row)) ?? 0) + 1)
  }
  const facts: Omit<KgFact, 'id'>[] = []
  for (const [i, row] of rows.entries()) {
    builder.object(row.key)
    const data = row.radii.map(r => blastSummary(context, r))
    const credential = graph.objectsByKey.get(row.key)?.canonical
    facts.push({ kind: 'credential', ref: row.key, label: objectLabel(graph, row.key), data: { rank: offset + i + 1, type: credential?.object_type ?? null, provider: credential?.provider ?? null, riskScore: scoreOf(row), sameRiskScoreCount: sameScore.get(scoreOf(row)), fullTieCount: sameRank.get(tieOf(row)), ownerLabel: data[0]?.ownerKey ? objectLabel(graph, data[0].ownerKey) : null, assessments: data } })
    builder.add('credential', row.key, objectLabel(graph, row.key), JSON.stringify(data, null, 2))
    if ((args.key && row.key === args.key) || (!args.key && row === rows[0])) {
      for (const r of row.radii) {
        const target = String(args.targetKey || r.highest?.key || '')
        const path = blastPathTo(r, target)
        for (const hop of path) {
          builder.object(hop.from); builder.object(hop.to)
          if (hop.throughKey) builder.object(hop.throughKey)
          hop.relationKeys.forEach(key => builder.relation(key))
          if (hop.linkId) {
            const link = graph.linksById.get(hop.linkId)
            if (link) identityEvidenceEdges(graph, link, 'all').filter(e => (e.from === hop.from && e.to === hop.to) || (e.to === hop.from && e.from === hop.to)).forEach(e => builder.identity(e))
          }
          builder.add('credential', `${r.mode}:${hop.id}`, `${objectLabel(graph, hop.from)} → ${objectLabel(graph, hop.to)}`, `${r.mode}, ${hop.kind}, ${hop.level ?? 'use'}${hop.eaRowId ? `, Effective Access ${hop.eaRowId}` : ''}`, hop.certainty)
          facts.push({ kind: 'blast_hop', ref: `${r.mode}:${hop.id}`, label: `${objectLabel(graph, hop.from)} → ${objectLabel(graph, hop.to)}`, state: hop.certainty, data: { ...hop, mode: r.mode } })
        }
        if (args.targetKey && !r.nodes.some(n => n.key === args.targetKey)) facts.push({ kind: 'blast_limit', ref: `${r.mode}:${args.targetKey}`, label: '수집된 데이터에서 해당 대상에 닿는 경로를 확인하지 못했습니다.', state: 'unknown' })
      }
    }
  }
  const result = builder.result(`자격증명 ${all.length}개 전체를 계산해 정렬한 결과 중 offset ${offset}부터 ${rows.length}개. ${modes.join(', ')} 시나리오입니다. 순위는 ${modes.length > 1 ? '토큰 유출과 소유 계정 탈취 중 더 위험한 쪽의 ' : ''}최고 권한, 조직 관리, 확인 여부, 다른 SaaS 도달, 도달 수 순입니다. 이 페이지의 상위 항목은 전체 순위의 상위 항목입니다.${all.length ? ` 1위와 위험 점수(riskScore)가 같은 자격증명은 ${sameScore.get(scoreOf(all[0]))}개입니다. 도달 수는 같은 점수 안의 순서만 정합니다. 1위와 도달 범위 크기까지 같은 완전 동점(fullTieCount)은 ${sameRank.get(tieOf(all[0]))}개이고, 완전 동점끼리의 순서는 키 이름순이라 순위로 말할 수 없습니다.` : ''}${offset + limit < all.length ? ` 나머지 목록의 다음 offset은 ${offset + limit}입니다. 전체 목록 요청이 아니면 추가 페이지는 필요하지 않습니다.` : ''}${all.length ? `\n${credentialTally(graph, all, modes)}` : ''}`, args.key && graph.objectsByKey.has(String(args.key)) ? { sourceKey: String(args.key) } : undefined)
  result.credentials = rows.map(row => ({ key: row.key, label: objectLabel(graph, row.key), summary: row.radii.map(r => `${r.mode === 'token' ? '토큰 유출' : '소유 계정 탈취'}: ${r.providers.reduce((sum, p) => sum + p.count, 0)}개, ${levelLabel(r.highest?.level)}`).join(', ') }))
  return { result, facts, truncated: offset + limit < all.length }
}

export function executeKgTool(context: KgContext, call: KgCall, index: number): KgExecution {
  let args: ToolArgs | null = null
  try { args = parseToolArgs(call.function.name, JSON.parse(call.function.arguments)) } catch { /* return bounded failure */ }
  let result = empty('조회 조건이 올바르지 않습니다.'), facts: Omit<KgFact, 'id'>[] | undefined, truncated = false
  let plan: AssistantPlan | undefined
  if (args) {
    const name = call.function.name, { graph, evidence, findings } = context
    const builder = new EvidenceBuilder(graph, evidence)
    const offset = Number(args.offset ?? 0), limit = Number(args.limit ?? 20)
    const parsedPlan = toolPlan(name, args)
    if (name === 'dashboard_help') {
      const guides = DASHBOARD_GUIDES.filter(g => !args.page || g.page === args.page)
      result = empty('대시보드 기능과 조사 흐름 안내입니다.')
      facts = guides.map(g => ({ kind: 'reference', ref: `guide:${g.page}`, label: g.title, detail: g.detail }))
      result.navigation = guides.map(g => ({ page: g.page, label: `${g.title} 열기` }))
    } else if (name === 'dashboard_summary') {
      result = empty('현재 수집 스냅샷의 요약입니다. 실시간 SaaS 상태가 아닙니다.')
      facts = [{ kind: 'reference', ref: 'dashboard:summary', label: '수집 현황', detail: `객체 ${graph.objectsByKey.size}개, 관계 ${graph.relationsByKey.size}개, 동일인 연결 ${graph.linksById.size}개, 표시 탐지 ${findings.length}개, Access Gap 이 있는 위협 ${findings.filter(f => f.threatAccessGap).length}개. 예외 적용 탐지 ${context.exceptionCounts?.exceptedFindings ?? 0}개, 예외 재검토 ${context.exceptionCounts?.review ?? 0}개. 수집되지 않은 사실과 대장 상세는 이 조회로 확인할 수 없습니다.` }]
      result.navigation = [{ page: 'Adapters', label: '수집 상태 보기' }, { page: 'Threat', label: '탐지 목록 보기' }]
    } else if (name === 'selection_context') {
      const s = context.workspace?.selection
      const packets: Array<() => void> = []
      s?.relationKeys.forEach(key => packets.push(() => builder.relation(key)))
      s?.linkIds.forEach(id => packets.push(() => { const link = graph.linksById.get(id); if (link) identityEvidenceEdges(graph, link, 'all').forEach(e => builder.identity(e)) }))
      s?.objectKeys.forEach(key => packets.push(() => builder.object(key)))
      s?.findingIds.forEach(id => packets.push(() => { const f = findings.find(f => f.id === id); if (f) { f.involvedObjectKeys.slice(0, 20).forEach(k => builder.object(k)); builder.add('finding', f.id, f.title, f.summary) } }))
      s?.eaRowIds.forEach(id => packets.push(() => {
        const row = context.eaRows?.find(r => r.id === id); if (!row) return
        const certainty = row.level === 'indeterminate' || row.undecomposed.length ? 'unknown' : row.via.some(v => v.kind === 'link' && !['resolved', 'disclosed_relation', 'different'].includes(v.level)) ? 'inferred' : 'confirmed'
        builder.object(row.references.source); builder.object(row.references.target)
        row.via.forEach(v => { if (v.kind === 'relation') builder.relation(v.ref); else { const link = graph.linksById.get(v.ref); if (link) identityEvidenceEdges(graph, link, 'all').filter(e => e.from === v.a && e.to === v.b || e.from === v.b && e.to === v.a).forEach(e => builder.identity(e)) } })
        builder.add('access', row.id, '선택한 Effective Access 결과', `${objectLabel(graph, row.references.source)} → ${objectLabel(graph, row.references.target)}\n접근 질문: ${clip(row.effect_query, 1000)}\n결론: ${{ computed: '계산됨', computed_cross: 'SaaS를 넘는 접근 계산됨', indeterminate: '판정 불충분', denied: '해당 접근 질문에서 거부됨' }[row.level]}\n동일인 연결이나 미해석 구간에 따른 판정: ${stateLabel(certainty)}\n미해석 구간 ${eaUnknownSteps(row)}개. 이 행은 지정된 질문에 대한 결론이며 다른 모든 접근을 대표하지 않습니다.`, certainty)
      }))
      packets.slice(offset, offset + limit).forEach(add => add()); truncated = offset + limit < packets.length
      result = builder.result(`명시적으로 선택한 항목 ${packets.length}개, offset ${offset}.${packets.length ? ' 선택은 조사 범위이며 보안 결론이 아닙니다.' : ' 선택된 항목이 없습니다. 화면에서 항목을 선택하거나 대상 이름을 질문해 주세요.'}`, context.focus)
      result.navigation = (s?.objectKeys ?? []).filter(k => graph.objectsByKey.has(k)).slice(0, 3).map(objectKey => ({ page: 'Graph', objectKey, label: `${objectLabel(graph, objectKey)} 보기` }))
    } else if (name === 'access_gaps') {
      // 위협마다 Access Gap 벤(엔진 accessGap). 화면에 보이는 위협만 본다
      const key = args.key ? String(args.key) : ''
      const touches = (f: FindingV2) => !key || f.threatPath?.point === key || f.threatPath?.target === key || !!f.threatTargets?.includes(key)
      const gaps = findings.filter(f => f.threatAccessGap && (!args.gapId || f.id === args.gapId) && touches(f))
      gaps.slice(offset, offset + limit).forEach(f => {
        const path = f.threatPath
        if (path) [path.point, path.target].forEach(k => { if (graph.objectsByKey.has(k)) builder.object(k) })
        builder.add('reference', `gap:${f.id}`, path ? `${gapKeyLabel(graph, path.point)} → ${gapKeyLabel(graph, path.target)}` : f.title,
          `위협: ${clip(f.title)}\n인원: ${gapCountText(f.threatAccessGap!)}\n권한 없는 접근자는 직접 권한 없이 새로 권한이 생긴 사람, 권한 초과 접근자는 직접 권한보다 높은 권한이 생긴 사람입니다. 관리자와 승인된 사람은 수에서 뺍니다.`,
          f.threatCertainty === '미확정' ? 'inferred' : 'confirmed')
      })
      result = builder.result(`Access Gap 이 있는 위협 ${gaps.length}개, offset ${offset}. 인원은 사람 단위이고 엔진이 센 값입니다. 칸 이름은 직접 권한, 파생 접근, 권한 없는 접근자, 권한 초과 접근자입니다. 인원은 counts 처럼 네 수를 같이 말하세요.${args.gapId ? '' : ` 위협마다 사람은 권한 없는 접근자와 권한 초과 접근자부터 ${GAP_PEOPLE_LIST}명까지 적습니다. 전부 보려면 gapId로 위협 하나만 조회하세요.`}`); truncated = offset + limit < gaps.length
      const byId = new Map(gaps.map(f => [`gap:${f.id}`, f]))
      facts = factsFor(context, result).map(fact => { const f = byId.get(fact.ref); return f ? { ...fact, data: gapData(graph, f, args.gapId ? GAP_PEOPLE_ONE : GAP_PEOPLE_LIST) } : fact })
      result.navigation = gaps.slice(offset, offset + limit).map(f => ({ page: 'Gaps', gapId: f.id, label: `${f.threatPath ? gapKeyLabel(graph, f.threatPath.target) : f.title} Access Gap 보기` }))
    } else if (name === 'kg_schema') {
      result = empty('현재 데이터의 그래프 구조입니다.')
      facts = [{ kind: 'schema', ref: 'current-kg', label: '현재 KG 구조', data: { objects: graph.objectsByKey.size, relations: graph.relationsByKey.size, identityLinks: graph.linksById.size, providers: [...graph.objectsByProvider.keys()], objectsBySaas: objectsBySaas(graph), objectsByType: objectsByType(graph), interfaces: [...graph.objectsByInterface.keys()], relationTypes: Object.fromEntries([...graph.relationsByType].map(([type, rs]) => [type, rs.length])), crossProviderRelations: crossProviderRelations(graph), principalsBySaas: principalCounts(graph.objectsByInterface.get('Principal') ?? []), identityLinksBySaas: identityLinksBySaas(graph, graph.objectsByProvider.keys()), visibleFindings: findings.length } }]
    } else if (name === 'identity_links') {
      const all = identityLinkPairs(graph, args)
      const shown = all.slice(offset, offset + limit)
      shown.forEach(({ edge }) => builder.identity(edge))
      const linked = linkedSaasByAccount(graph)
      const end = (key: string) => { const o = graph.objectsByKey.get(key)!; return { key, label: objectLabel(graph, key), provider: o.canonical.provider, type: o.canonical.object_type, account: accountKind(o), linkedSaas: linked.get(key) ?? [] } }
      // provider 와 otherProvider 를 같이 주면 provider 쪽 계정 중 otherProvider 하고만 묶인 계정을 조회 전체에서 센다
      let onlyWith = ''
      if (args.provider && args.otherProvider && args.kind !== 'other') {
        const accounts = [...new Set(all.filter(x => x.kind === 'person').flatMap(({ edge }) => [edge.from, edge.to]).filter(k => graph.objectsByKey.get(k)?.canonical.provider === args.provider))]
        const only = accounts.filter(k => (linked.get(k) ?? []).join() === String(args.otherProvider)).sort((x, y) => byName(objectLabel(graph, x), objectLabel(graph, y)))
        onlyWith = ` ${args.provider} 쪽 계정 ${accounts.length}개 중 ${args.otherProvider} 하고만 같은 사람으로 묶인 계정 ${only.length}개${only.length ? `: ${only.slice(0, 20).map(k => objectLabel(graph, k)).join(', ')}` : ''}. 나머지 ${accounts.length - only.length}개는 다른 SaaS 계정도 묶여 있습니다(계정마다 linkedSaas).`
      }
      const levels = all.reduce<Record<string, number>>((n, { edge }) => ({ ...n, [edge.level]: (n[edge.level] ?? 0) + 1 }), {})
      const rules = countEntries(all.map(({ edge }) => edgeRule(graph, edge)))
      facts = shown.map(({ edge, kind }) => {
        const from = end(edge.from), to = end(edge.to)
        return { kind: 'identity_link', ref: `${edge.linkId}:${edge.from}:${edge.to}`, label: `${from.label} ↔ ${to.label}`,
          state: ['resolved', 'disclosed_relation', 'different'].includes(edge.level) ? 'confirmed' : 'inferred',
          detail: `${providerLabel(from.provider)} ${from.label} ↔ ${providerLabel(to.provider)} ${to.label}
연결 근거: ${edge.level}
연결 종류: ${kind === 'person' ? '사람' : kind}
맞춘 규칙: ${LINK_RULE[edgeRule(graph, edge)] ?? edgeRule(graph, edge)}`,
          data: { linkId: edge.linkId, linkKind: kind, level: edge.level, rule: edgeRule(graph, edge), from, to } }
      })
      truncated = offset + limit < all.length
      result = builder.result(`동일인 연결 계정 쌍 ${all.length}개(연결 ${new Set(all.map(x => x.edge.linkId)).size}개), offset ${offset}, 최대 ${limit}개 표시. 연결 근거별: ${Object.entries(levels).map(([level, n]) => `${level} ${n}`).join(', ') || '없음'}. 맞춘 규칙별: ${entriesText(rules)}. resolved, disclosed_relation 은 확인된 연결이고 possibly_same 은 추정입니다. 규칙은 ${Object.entries(LINK_RULE).map(([code, label]) => `${code} ${label}`).join(', ')} 입니다. linkedSaas 는 그 계정과 같은 사람으로 묶인 다른 계정의 SaaS 전부입니다.${onlyWith}${truncated ? ' 다음 페이지가 있습니다.' : ''}`)
    } else if (name === 'accounts') {
      const { all, missing } = accountList(graph, args)
      all.slice(offset, offset + limit).forEach(o => builder.object(o.fixture_key))
      truncated = offset + limit < all.length
      const states = all.map(principalState)
      const tally = (values: string[]) => entriesText(countEntries(values))
      result = builder.result(`계정 ${all.length}개(그룹 제외), offset ${offset}, ${Math.min(limit, Math.max(0, all.length - offset))}개 표시.${truncated ? ' 다음 페이지가 있습니다.' : ''} 아래 수는 이 조회 전체 ${all.length}개 기준입니다. 값은 수집된 계정 속성에서 읽었고, 모름은 그 속성이 수집되지 않은 계정입니다.${missing ? ` 조건 칸의 값을 몰라 결과에서 빠진 계정 ${missing}개가 있습니다.` : ''}\nSaaS별: ${tally(all.map(o => o.canonical.provider))}\n계정 판정별: ${tally(all.map(accountKind))}\n상태별: ${tally(states.map(s => s.status ?? '모름'))}\n관리자: ${tally(states.map(s => knownText(s.admin)))}\n2단계 인증: ${tally(states.map(s => knownText(s.mfa)))}\n마지막 로그인: ${tally(states.map(s => loginText(s.lastLogin)))}`)
    } else if (name === 'relations') {
      const all = relationList(graph, args)
      all.slice(offset, offset + limit).forEach(r => builder.relation(r.relationKey))
      truncated = offset + limit < all.length
      const providerOf = (key: string) => graph.objectsByKey.get(key)?.canonical.provider ?? '미확인'
      result = builder.result(relationListSummary(all.length, offset, limit, countEntries(all.map(r => r.relationType)), countEntries(all.map(r => `${providerOf(r.sourceKey)}>${providerOf(r.targetKey)}`)),
        countEntries(all.filter(r => r.relationType === 'has_role_on').map(r => LEVEL_TEXT[roleLevelCode(graph, r)]))))
    } else if (name === 'credential_blast') {
      const response = credentialTool(context, args); result = response.result; facts = response.facts; truncated = response.truncated
    } else if (name === 'search_objects') {
      const needle = String(args.text ?? '').trim()
      const exact = graph.objectsByKey.get(String(args.text ?? ''))
      const keys = exact ? [exact.fixture_key] : needle ? searchObjects(graph, needle, graph.objectsByKey.size) : [...graph.objectsByKey.keys()]
      const property = args.property ? String(args.property) : undefined, value = String(args.value ?? 'true')
      const scoped = (o: FixtureObject) => (!args.provider || o.canonical.provider === args.provider) && (!args.interface || o.canonical.interfaces.some(i => i === args.interface)) && (!args.type || o.canonical.object_type === args.type)
      const fits = (o: FixtureObject) => scoped(o) && (!property || propertyMatch(o, property, value) === 'match')
      const all = keys.map(key => graph.objectsByKey.get(key)!).filter(fits)
      // 속성이 없는 객체는 값을 몰라 빠진다. 「0개」를 「없음」으로 읽지 않게 수를 알린다
      const missing = property ? keys.map(key => graph.objectsByKey.get(key)!).filter(o => scoped(o) && propertyMatch(o, property, value) === 'missing').length : 0
      all.slice(offset, offset + limit).forEach(o => builder.object(o.fixture_key))
      truncated = offset + limit < all.length
      // 정확한 키로 찾았으면 숨긴 객체와 겹칠 수 없다. 이름 검색은 숨긴 객체에도 같은 칸으로 맞춰 본다
      const hiddenPool = exact ? [] : context.hiddenDefaults ?? []
      const hiddenKeys = needle ? new Set(searchObjects({ objectsByKey: new Map(hiddenPool.map(o => [o.fixture_key, o])) } as unknown as GraphStoreV2, needle, hiddenPool.length)) : undefined
      const hidden = hiddenPool.filter(o => (!hiddenKeys || hiddenKeys.has(o.fixture_key)) && fits(o))
      result = builder.result(`검색 ${all.length}개, 표시 ${Math.min(limit, Math.max(0, all.length - offset))}개, offset ${offset}.${truncated ? ' 다음 페이지가 있습니다.' : ''}${typeNote(args.type ? String(args.type) : undefined, all.length)}${propertyNote(property, value, missing)}${hiddenSearchNote(hidden.slice(0, HIDDEN_NOTE_NAMES), hidden.length)}`, all.length === 1 ? { sourceKey: all[0].fixture_key } : undefined)
    } else if (name === 'neighbors') {
      const key = String(args.key)
      if (graph.objectsByKey.has(key)) {
        builder.object(key)
        const outgoing = args.direction === 'in' ? [] : graph.outgoingRelationsByObject.get(key) ?? []
        const incoming = args.direction === 'out' ? [] : graph.incomingRelationsByObject.get(key) ?? []
        // 이 객체를 역할로 쓰는 관계 (프로필, 권한 세트, 프로젝트 역할을 가진 계정). 끝점이 아니라 들어오는 쪽으로 본다
        const roleUses = args.direction === 'out' ? [] : [...graph.relationsByKey.values()].filter(r => r.roleKey === key)
        const relations = [...new Map([...outgoing, ...incoming, ...roleUses].map(r => [r.relationKey, r])).values()].filter(r => !args.relationType || r.relationType === args.relationType)
        const asRole = relations.filter(r => r.roleKey === key).length
        const identities = [...graph.linksById.values()].flatMap(l => identityEvidenceEdges(graph, l, 'all')).filter(e => e.from === key || e.to === key)
        const packets = [...relations.map(r => () => builder.relation(r.relationKey)), ...(!args.relationType ? identities.map(e => () => builder.identity(e)) : [])]
        packets.slice(offset, offset + limit).forEach(add => add())
        truncated = offset + limit < packets.length
        result = builder.result(`관계와 연결 ${packets.length}개${asRole ? `(이 객체를 역할로 쓰는 관계 ${asRole}개 포함)` : ''}, offset ${offset}, 최대 ${limit}개 표시.${truncated ? ' 다음 페이지가 있습니다.' : ''}`, { sourceKey: key })
      } else result = empty('현재 KG에 해당 객체 키가 없습니다. search_objects로 실제 키를 조회하세요.')
    } else if (name === 'findings' && !args.findingId) {
      // 조건으로 고르는 일은 코드가 한다. 관련 SaaS 는 탐지 경로 그림의 SaaS
      const all = findings.filter(f => (!args.key || f.involvedObjectKeys.includes(String(args.key))) && (!args.severity || f.severity === args.severity)
        && (!args.category || categoryOf(f) === args.category || !!f.types?.includes(args.category as never)) && (!args.provider || f.providerSet.includes(args.provider as Provider)))
      all.slice(offset, offset + limit).forEach(f => builder.add('finding', f.id, f.title, f.summary))
      truncated = offset + limit < all.length
      // 목록 전체를 코드가 센다. 모델이 페이지를 직접 세다 틀리지 않게
      const tally = (values: string[]) => entriesText(countEntries(values))
      const conditions = [args.severity && `심각도 ${args.severity}`, args.category && `종류 ${args.category}`, args.provider && `관련 SaaS ${args.provider}`].filter(Boolean)
      const scope = conditions.length ? `조건(${conditions.join(', ')})에 맞는 탐지 ${all.length}개(현재 표시 범위 전체 ${findings.length}개 중)` : `현재 표시 범위의 탐지 ${all.length}개`
      result = builder.result(`${scope}, offset ${offset}, 최대 ${limit}개 표시. 아래 수는 이 조회 전체 ${all.length}개 기준입니다.\n심각도별: ${tally(all.map(f => f.severity))}\n종류별: ${tally(all.map(categoryOf))}\n확실도별: ${tally(all.map(certaintyOf))}\n근거별: ${tally(all.map(basisOf))}\n관련 SaaS별(탐지에 걸린 객체의 SaaS, 한 탐지가 여러 SaaS에 들어감): ${tally(all.flatMap(f => [...new Set(f.providerSet)]))}`)
    } else if (parsedPlan) {
      if (args.key && !graph.objectsByKey.has(String(args.key)) || args.targetKey && !graph.objectsByKey.has(String(args.targetKey))) result = empty('현재 KG에 해당 객체 키가 없습니다. search_objects로 실제 키를 조회하세요.')
      // 동일인 연결은 사람 계정에만 계산한다. 봇, 그룹, 서비스 계정을 「객체 없음」으로 답하지 않는다
      else if (name === 'identity' && principalKind(graph.objectsByKey.get(String(args.key))) !== 'human') result = empty('사람 계정이 아닌 객체입니다. 동일인 계정 연결은 사람 계정에만 계산합니다. 이 객체의 관계는 neighbors로 조회하세요.')
      else { plan = parsedPlan; result = runAssistantQuery(graph, evidence, findings, parsedPlan, undefined, { focus: context.focus }) }
      if (result.paths?.length) {
        const packets = result.paths.map((_, pathIndex) => runAssistantQuery(graph, evidence, findings, parsedPlan, undefined, { pathIndex, focus: context.focus }))
        result = { ...mergeKgResults(packets), answer: result.answer, paths: result.paths, pathsTruncated: result.pathsTruncated, focus: result.focus }
      }
      truncated = !!result.pathsTruncated || /40개를 표시/.test(result.answer)
    }
  }
  return finishKgExecution(context, call.function.name, args, index, result, facts, truncated, plan)
}

/**
 * 도구 결과를 모델에 보낼 사실(facts)과 화면 근거로 마무리한다. 브라우저와 서버(server/graphTools.ts)가 같이 쓴다.
 * context.graph 에는 결과가 가리키는 객체, 관계, 연결이 모두 있어야 한다 (서버는 그만큼만 읽는다).
 */
export function finishKgExecution(context: KgContext, name: string, args: ToolArgs | null, index: number, resultIn: AssistantResult,
  factsIn: Omit<KgFact, 'id'>[] | undefined, truncated: boolean, plan?: AssistantPlan): KgExecution {
  let result = resultIn
  const facts = [...(factsIn ?? factsFor(context, result))]
  if (!facts.length && args && (name === 'search_objects' || name === 'identity_links' || name === 'accounts' || name === 'relations' || name === 'access_gaps' || name === 'credential_blast' || name === 'findings' && !args.findingId)) facts.push({ kind: 'reference', ref: `lookup:${name}`, label: '조회 범위와 결과', detail: clip(result.answer, 2000) })
  if (name === 'remediation') facts.sort((a, b) => Number(b.kind === 'remediation') - Number(a.kind === 'remediation'))
  // 상한을 넘으면 근거를 버리기 전에 조회 중심이 아닌 객체의 규칙 속성부터 뒤에서 줄인다. 관계와 연결 근거가 속성에 밀려 빠지지 않게
  let trimmed = 0
  const size = () => modelToolJson({ summary: clip(result.answer + trimNote(trimmed), 8000), facts: facts.slice(0, 60).map((f, i) => ({ ...f, id: `T${index}-E${i + 1}` })), truncated: true }).length
  for (let i = Math.min(facts.length, 60) - 1; i >= 0 && size() > TOOL_OUTPUT_LIMIT; i--) {
    const small = facts[i]!.ref === result.focus?.sourceKey ? undefined : trimObjectFact(facts[i]!)
    if (small) { facts[i] = small; trimmed++ }
  }
  const answer = result.answer + trimNote(trimmed)
  const output: KgOutput = { summary: clip(answer, 8000), facts: [], truncated: truncated || facts.length > 60 || answer.length > 8000 }
  for (const f of facts.slice(0, 60)) {
    const fact = { ...f, id: `T${index}-E${output.facts.length + 1}` }
    output.facts.push(fact)
    if (modelToolJson(output).length > TOOL_OUTPUT_LIMIT) { output.facts.pop(); output.truncated = true; break }
  }
  // 요약의 개수와 offset은 자르기 전 기준이다. 빠진 근거를 모델이 「전부 받았다」고 읽지 않게 요약에 적는다
  let omitted = facts.length - output.facts.length
  if (omitted) {
    const base = clip(answer, 7600)
    const note = () => `\n출력 상한인 근거 60개나 ${TOOL_OUTPUT_LIMIT}자에 걸려 근거 ${omitted}개를 보내지 못했습니다. 위 개수와 offset은 생략 전 기준입니다. 목록이면 받은 항목 수만큼 offset을 옮기고, 아니면 범위나 limit을 줄여 다시 조회하세요.`
    output.summary = base + note()
    while (modelToolJson(output).length > TOOL_OUTPUT_LIMIT && output.facts.length) { output.facts.pop(); omitted++; output.summary = base + note() }
  }
  // Evidence IDs match exactly what the model received. Raw source details remain only in the existing inspectors.
  result = { ...result, evidence: output.facts.map(f => ({ id: f.id, kind: f.kind === 'blast_hop' || f.kind === 'blast_limit' ? 'credential' : f.kind === 'schema' ? 'reference' : f.kind as AssistantEvidence['kind'], ref: f.ref, label: f.label, detail: factDetail(context.graph, f), state: f.state as AssistantEvidence['state'], data: f.data })) }
  if (result.focus?.sourceKey && context.graph.objectsByKey.has(result.focus.sourceKey)) result.navigation = [...(result.navigation ?? []), { page: 'Graph', objectKey: result.focus.sourceKey, label: '대상을 그래프에서 보기' }]
  if (result.focus?.findingId && context.findings.some(f => f.id === result.focus?.findingId)) result.navigation = [...(result.navigation ?? []), { page: 'Threat', findingId: result.focus.findingId, label: '탐지 상세 보기' }]
  return { output, result, plan }
}

/** A server tool result is usable only with both the model output and the screen result. */
export const usableExecution = (execution: KgExecution | undefined | null): execution is KgExecution => !!execution?.output && !!execution.result

/**
 * Turns a log tool output the server computed (server/assistant/logTools.ts) into a numbered execution.
 * The browser and the server's tool loop both use it, so the facts the model reads match the panel. A missing output is a failure, never an empty result.
 */
export function logToolExecution(context: KgContext, name: string, index: number, out: LogToolOutput | undefined): KgExecution {
  const output = out ?? { summary: '로그 검색 결과를 받지 못했습니다. 다른 저장소의 결과로 대신하지 않았습니다.', truncated: false,
    facts: [{ kind: 'reference', ref: 'logs:error:missing', label: '로그 검색 실패', state: 'unknown', detail: '로그 검색 결과를 받지 못했습니다.' }] }
  const execution = finishKgExecution(context, name, null, index, emptyKgResult(output.summary), output.facts, output.truncated)
  execution.result.eventGraph = eventGraphFromFacts(execution.output.facts, execution.output.truncated)
  return execution
}

export function mergeKgResults(results: AssistantResult[]): AssistantResult {
  const base = empty('')
  for (const r of results) {
    base.evidence.push(...r.evidence)
    base.graph.objectKeys.push(...r.graph.objectKeys); base.graph.relationKeys.push(...r.graph.relationKeys); base.graph.linkIds.push(...r.graph.linkIds)
    base.graph.identityEdges.push(...r.graph.identityEdges)
    base.focus = { ...base.focus, ...r.focus }
    if (r.paths) { base.paths = r.paths; base.pathsTruncated = r.pathsTruncated }
    if (r.actions) base.actions = [...(base.actions ?? []), ...r.actions]
    if (r.credentials) base.credentials = r.credentials
    if (r.navigation) base.navigation = [...(base.navigation ?? []), ...r.navigation]
  }
  base.graph.objectKeys = [...new Set(base.graph.objectKeys)]; base.graph.relationKeys = [...new Set(base.graph.relationKeys)]; base.graph.linkIds = [...new Set(base.graph.linkIds)]
  base.graph.identityEdges = [...new Map(base.graph.identityEdges.map(e => [`${e.linkId}:${e.from}:${e.to}`, e])).values()]
  if (base.navigation) base.navigation = [...new Map(base.navigation.map(n => [JSON.stringify(n), n])).values()]
  const eventGraphs = results.flatMap(r => r.eventGraph ? [r.eventGraph] : [])
  if (eventGraphs.length) base.eventGraph = mergeEventGraphs(eventGraphs)
  return base
}
