import type { CoverageFile } from '../detection/v2/engine/types'
import type { FixtureObject, Provider } from '../model/object'
import type { FixtureRelation, ResolvedRelation } from '../model/relation'
import type { BlastRadius } from '../detection/v2/blastRadius'
import { isNameKeyRole } from '../model/relation'
import type { IdentityLink } from '../model/link'
import type { EvidenceObservation, FindingEvidenceLink, EvidenceStore } from '../model/evidence'
import type { FindingV2 } from '../model/findingV2'
import type { GraphStoreV2 } from '../model/graph'
import { pickFindings } from '../findings/threatV2'
import type { EffectiveAccessFile } from '../detection/v2/effectiveAccess/types'
import { isUnusedPlatformDefault, showPlatformDefaults, withoutUnusedPlatformDefaults } from '../model/platformDefaults'
import { setDisplayText } from './displayTextStore'
import { setAccessTable } from './accessTableStore'
import { kstMonthDayTime } from '../utils/time'
import { readableObservationTitle } from '../findings/observationKind'

/** 데이터셋 manifest.json. 화면은 수집 시각과 SaaS 목록만 읽는다 */
export interface DatasetManifest {
  version?: string
  environment_id?: string
  name?: string
  created_at: string
  description?: string
  providers: string[]
}

export interface AegiIncEnvironmentData {
  manifest: DatasetManifest
  objects: FixtureObject[]
  relations: FixtureRelation[]
  links: IdentityLink[]
  observations: EvidenceObservation[]
  evidenceLinks: FindingEvidenceLink[]
  /** 계산된 접근 결론 (관계와 다른 저장소). 데이터셋에 파일이 없으면 undefined — 그 자리에서 계산해 채우지 않는다 */
  effectiveAccess?: EffectiveAccessFile
  /** 수집 완결성 (범용 정규화) */
  coverage?: CoverageFile
  graph: GraphStoreV2
  evidenceStore: EvidenceStore
  /** 기본 보기에서 뺀, 아무도 쓰지 않는 플랫폼 기본 객체 수 (판단표 G4-Q05). 「기본 객체」를 켜면 0 */
  platformDefaultsHidden?: number
  /** 기본 보기에서 뺀 플랫폼 기본 객체. AI 검색이 이름이 맞으면 뺐다고 알린다 */
  hiddenDefaults?: FixtureObject[]
  /** 적재 때 엔진(aegi-adapter-engine)이 계산한 판정 결과. 배포본(D1 스냅샷)에만 있고, 있으면 화면은 다시 판정하지 않는다 */
  derived?: DerivedResults
}

export interface DerivedResults {
  snapshotId: string
  findings: FindingV2[]
  /** 자격증명별 두 가정의 피해 범위. listCredentials 순서 */
  blast: Array<{ key: string; provider: Provider; token: BlastRadius; account: BlastRadius }>
  aggregates: Record<string, unknown>
}

/**
 * 표시 이름의 가운뎃점 구분자를 「›」로 적는다. 엔진은 「정책 · 규칙」, 「토큰 종류 · 앱」처럼 상위 › 하위를 가운뎃점으로
 * 붙여 왔다(aegi-adapter-engine normalize-v2). 화면은 가운뎃점을 쓰지 않으므로, 이미 쌓인 데이터도 불러올 때 한 번 바꿔
 * 그래프, 목록, 상세, 검색이 같은 이름을 쓴다. 객체를 새로 만들거나 값을 추정하지 않고 구분자만 바꾼다.
 */
export const displayNameSeparator = (name: string) => name.replace(/\s*·\s*/g, ' › ')

/**
 * Slack 메시지 표시 이름. 엔진은 「#채널 ts」로 붙이는데 ts 는 epoch 초(1794207157.045679)라 사람이 읽지 못한다.
 * 이름 끝의 ts 를 KST 시각으로 바꿔 「#채널 11월 10일 14:32 메시지」로 적는다. ts 가 없거나 이름 끝이 ts 가 아니면
 * undefined(지금 이름 그대로). 그래프, 목록, 상세, 위협 제목, AI 도구가 모두 이 이름을 읽는다.
 */
export function slackMessageName(obj: FixtureObject): string | undefined {
  if (obj.canonical.provider !== 'slack' || obj.canonical.object_type !== 'Message') return undefined
  const shown = obj.fixture_meta?.display_name
  const idTs = obj.canonical.identifiers?.ts as { value?: unknown } | undefined
  const ts = String(obj.canonical.properties.ts ?? idTs?.value ?? '').trim()
  const seconds = Number(ts)
  if (typeof shown !== 'string' || !ts || !Number.isFinite(seconds) || seconds <= 0 || !shown.endsWith(ts)) return undefined
  const channel = shown.slice(0, shown.length - ts.length).trim()
  const time = `${kstMonthDayTime(seconds * 1000)} 메시지`
  return channel ? `${channel} ${time}` : time
}

export function buildGraphStoreV2(
  objects: FixtureObject[],
  relations: FixtureRelation[],
  links: IdentityLink[]
): GraphStoreV2 {
  const objectsByKey = new Map<string, FixtureObject>()
  const objectsByProvider = new Map<string, FixtureObject[]>()
  const objectsByInterface = new Map<string, FixtureObject[]>()

  for (const obj of objects) {
    const shown = obj.fixture_meta?.display_name
    if (typeof shown === 'string' && shown.includes('·')) obj.fixture_meta!.display_name = displayNameSeparator(shown)
    const messageName = slackMessageName(obj)
    if (messageName) obj.fixture_meta!.display_name = messageName
    objectsByKey.set(obj.fixture_key, obj)

    const p = obj.canonical.provider
    if (!objectsByProvider.has(p)) objectsByProvider.set(p, [])
    objectsByProvider.get(p)!.push(obj)

    for (const iface of obj.canonical.interfaces || []) {
      if (!objectsByInterface.has(iface)) objectsByInterface.set(iface, [])
      objectsByInterface.get(iface)!.push(obj)
    }
  }

  const relationsByKey = new Map<string, ResolvedRelation>()
  const relationsByType = new Map<string, ResolvedRelation[]>()
  const outgoingRelationsByObject = new Map<string, ResolvedRelation[]>()
  const incomingRelationsByObject = new Map<string, ResolvedRelation[]>()

  let unresolvedRelationCount = 0

  for (const rel of relations) {
    const srcKey = String(rel.canonical.references.source.value)
    const tgtKey = String(rel.canonical.references.target.value)
    const roleRef = rel.canonical.references.role
    // 기본 제공 역할은 이름만 있고 객체가 없다. 객체로 풀지 않는다.
    const roleKey = roleRef && !isNameKeyRole(roleRef) ? String(roleRef.value) : undefined
    const roleObject = roleKey ? objectsByKey.get(roleKey) : undefined
    // A reviewed named-role Policy retains the exact source role name. Existing
    // access readers can use it while the ternary relation keeps its Policy key.
    const roleName = isNameKeyRole(roleRef) ? String(roleRef.value)
      : roleObject?.canonical.properties.definition_kind === 'vendor_named_role' && typeof roleObject.canonical.properties.role_name === 'string'
        ? roleObject.canonical.properties.role_name : undefined

    if (!objectsByKey.has(srcKey) || !objectsByKey.has(tgtKey) || (roleKey && !objectsByKey.has(roleKey))) {
      unresolvedRelationCount++
    }

    const resolved: ResolvedRelation = {
      relationKey: rel.fixture_key,
      relationType: rel.canonical.relation_type,
      provider: rel.canonical.provider,
      template: rel.canonical.template,
      sourceKey: srcKey,
      targetKey: tgtKey,
      roleKey,
      roleName,
      properties: rel.canonical.properties,
      source: rel.canonical.source,
      raw: rel,
    }

    relationsByKey.set(resolved.relationKey, resolved)

    if (!relationsByType.has(resolved.relationType)) relationsByType.set(resolved.relationType, [])
    relationsByType.get(resolved.relationType)!.push(resolved)

    if (!outgoingRelationsByObject.has(srcKey)) outgoingRelationsByObject.set(srcKey, [])
    outgoingRelationsByObject.get(srcKey)!.push(resolved)

    if (!incomingRelationsByObject.has(tgtKey)) incomingRelationsByObject.set(tgtKey, [])
    incomingRelationsByObject.get(tgtKey)!.push(resolved)
  }

  const linksById = new Map<string, IdentityLink>()
  const linkIdsByObject = new Map<string, string[]>()

  for (const link of links) {
    linksById.set(link.link_id, link)
    for (const member of link.set) {
      if (!linkIdsByObject.has(member.object_key)) {
        linkIdsByObject.set(member.object_key, [])
      }
      linkIdsByObject.get(member.object_key)!.push(link.link_id)
    }
  }

  return {
    objectsByKey,
    objectsByProvider,
    objectsByInterface,
    relationsByKey,
    relationsByType,
    outgoingRelationsByObject,
    incomingRelationsByObject,
    resolutionsById: new Map(),
    resolutionsByMemberObject: new Map(),
    linksById,
    linkIdsByObject,
    unresolvedRelationCount,
  }
}

export function buildEvidenceStore(
  observations: EvidenceObservation[],
  evidenceLinks: FindingEvidenceLink[]
): EvidenceStore {
  const observationsById = new Map<string, EvidenceObservation>()
  for (const obs of observations) observationsById.set(obs.id, obs)

  const evidenceLinksById = new Map<string, FindingEvidenceLink>()
  for (const link of evidenceLinks) evidenceLinksById.set(link.id, link)

  return { observationsById, evidenceLinksById }
}

let cachedData: AegiIncEnvironmentData | null = null

export interface RawDataset {
  manifest: unknown
  objects: unknown
  relations: unknown
  links: unknown
  observations: unknown
  evidence_links: unknown
  /** 선택. 없으면 Effective Access 기록이 없는 데이터셋이다 */
  effective_access?: unknown
  /** 선택. 수집 완결성 — 범용 판정이 「없음」과 「모름」을 가른다 */
  coverage?: unknown
  /** 과거 번들의 호환 필드. Config Findings는 별도 이력 API를 읽고 이 필드는 사용하지 않는다. */
  standard_results?: unknown
  /** 선택. 서버 번들(server/snapshotBundle.ts)의 판정 결과 */
  derived?: unknown
  /** 선택. 화면 설명 문구(aegi-adapter-engine npm run display-text -- --write). 배포본은 derived.display_text 로 온다 */
  display_text?: unknown
  /** 선택. Splunk 에서 읽은 정규 이벤트 (adapter-engine `npm run splunk -- pull`). Event Timeline 이 쓴다 */
  events?: unknown
  /** 선택. 이벤트 연결 (adapter-engine `npm run events:link`). Event Timeline 행위 흐름이 쓴다 */
  event_links?: unknown
}

let datasetOverride: RawDataset | null = null

/**
 * 현재 실측을 등록한다. App 모듈을 불러오기 전에 호출해야 한다.
 * 등록되지 않은 상태에서는 화면에 사용할 데이터를 제공하지 않는다.
 */
export function registerDatasetOverride(raw: RawDataset): void {
  if (cachedData) throw new Error('registerDatasetOverride 는 loadAegiIncData() 보다 먼저 불러야 한다')
  datasetOverride = raw
}

/** 서버 번들 또는 데이터셋 폴더 derived.json 의 판정 결과. 모양이 맞지 않으면 없는 것으로 보고 화면에 위협을 싣지 않는다 */
function readDerived(raw: unknown, graph: GraphStoreV2, evidenceStore: EvidenceStore): DerivedResults | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const d = raw as Record<string, unknown>
  if (typeof d.snapshot_id !== 'string' || !Array.isArray(d.findings) || !Array.isArray(d.blast_radius)) return undefined
  return {
    snapshotId: d.snapshot_id,
    findings: pickFindings(d.findings as unknown[], graph, evidenceStore),
    blast: d.blast_radius as DerivedResults['blast'],
    aggregates: (d.aggregates && typeof d.aggregates === 'object' ? d.aggregates : {}) as Record<string, unknown>,
  }
}

export function loadAegiIncData(): AegiIncEnvironmentData {
  if (cachedData) return cachedData

  const src = datasetOverride
  if (!src) throw new Error("최신 실측 데이터를 먼저 불러와야 합니다.")
  // 아무도 쓰지 않는 플랫폼 기본 객체는 기본 보기에서 뺀다(판단표 G4-Q05). 화면의 모든 집계가 이 그래프를 쓴다
  const all = { objects: src.objects as unknown as FixtureObject[], relations: src.relations as unknown as FixtureRelation[], links: src.links as unknown as IdentityLink[] }
  const shown = showPlatformDefaults() ? { ...all, hidden: 0 } : withoutUnusedPlatformDefaults(all.objects, all.relations, all.links)
  const { objects, relations, links } = shown
  const observations = (src.observations as unknown as EvidenceObservation[])
    .map(obs => obs.title ? { ...obs, title: readableObservationTitle(obs.title) } : obs)
  const evidenceLinks = src.evidence_links as unknown as FindingEvidenceLink[]
  const coverage = src.coverage as CoverageFile | undefined
  // 덮어쓴 데이터셋이면 그 데이터셋의 파일만 쓴다 — 합성 결론을 실측 그래프에 붙이지 않는다
  const effectiveAccess = src.effective_access as EffectiveAccessFile | undefined

  const derivedRaw = src.derived && typeof src.derived === 'object' ? (src.derived as Record<string, unknown>) : undefined
  setDisplayText(derivedRaw?.display_text ?? src.display_text)
  setAccessTable(derivedRaw?.access_table)
  const graph = buildGraphStoreV2(objects, relations, links)
  const evidenceStore = buildEvidenceStore(observations, evidenceLinks)

  cachedData = {
    manifest: src.manifest as AegiIncEnvironmentData["manifest"],
    objects,
    relations,
    links,
    observations,
    evidenceLinks,
    effectiveAccess,
    coverage,
    graph,
    evidenceStore,
    platformDefaultsHidden: shown.hidden,
    hiddenDefaults: shown.hidden ? all.objects.filter(isUnusedPlatformDefault) : [],
    derived: readDerived(src.derived, graph, evidenceStore),
  }

  return cachedData
}
