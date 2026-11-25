// 위협 판정 V2(엔진 docs/spec/AEGI_THREAT_JUDGMENT_V2.md) 위협을 화면의 위협 모델로 옮긴다
//
// 화면의 위협은 엔진이 snap_findings 에 실은 새 위협 행(rule_id threat-v2)뿐이다. 없으면 위협은 0건이다.
// 경로(path.hops)와 사람(subjects)은 탐지 경로 그림(threatPathModel buildThreatV2Path)이 쓰도록 그대로 싣는다.
// 차단 지점(cuts)은 조치 목록과 탐지 경로 그래프 번호로, 판정 이유(reasons)는 판정 근거 확인 항목으로 옮긴다.
import { objectLabel } from '../detection/v2/scope'
import { kindNounFromKey } from '../utils/objectPhrase'
import type { EvidenceStore } from '../model/evidence'
import type { GraphStoreV2 } from '../model/graph'
import type { AccessLevelV2, FindingV2, ThreatAccessGapV2, ThreatHeadcountV2, ThreatPathV2, ThreatSubjectV2, ThreatTypeNameV2 } from '../model/findingV2'
import { headcountText, subjectParticle } from './headcount'
import type { Provider } from '../model/object'

export type ThreatTypeV2 = ThreatTypeNameV2

export interface ThreatV2 {
  id: string
  fingerprint: string
  point: string
  target: string
  targets: string[]
  primaryType: ThreatTypeV2
  types: ThreatTypeV2[]
  /** 확정 위협 안에서 미확정 경로에서만 나온 유형 */
  unconfirmedTypes?: ThreatTypeV2[]
  /** 확정 위협 안에서 어느 사람에게서도 확정되지 않은 수준(엔진 contract.ts, 2026-11-19). 유형 이름이 같아도 미확정 읽기, 쓰기가 보이게 한다 */
  unconfirmedLevels?: AccessLevelV2[]
  occurrence: '발생 가능' | '발생'
  certainty: '확정' | '미확정'
  reasons: string[]
  path?: { hops: ThreatPathV2['hops'] }
  subjects: ThreatSubjectV2[]
  /** 화면 인원(엔진 contract.ts, 2026-11-20). 누구나를 뺀 사람 수와 누구나 여부. 옛 게시 행과 추적성 상실에는 없다 */
  headcount?: ThreatHeadcountV2
  /** 엔진이 OWASP Risk Rating 으로 정한 등급(엔진 assemble severityOf, 2026-11-18, 2026-11-19 값 재조정). 확실성은 쓰지 않는다. 화면은 등급만 보인다 */
  severity: 'critical' | 'high' | 'medium' | 'low'
  /**
   * 등급을 정한 사람(추적성 상실은 길)의 요소 점수 0~9 와 평균 score(엔진 contract.ts).
   * people 은 사람 수(같은 등급 안 정렬, 추적성 상실은 0). 영향은 해당하는 요소만 있고 책임 추적성은 추적성 상실에만 있다
   */
  severityFactors: {
    people: number
    likelihood: { size: number; opportunity: number; exploit: number; detection: number; score: number }
    impact: { confidentiality?: number; integrity?: number; availability?: number; accountability?: number; score: number }
  }
  /**
   * 차단 지점(엔진 cuts.ts). 지운 그래프를 다시 판정해 닫힌 사람 수가 closes, 모두 닫히면 verified.
   * with 는 함께 끊어야 닫히는 간선, remainVia 는 다 안 닫힐 때 남은 사람이 닿는 다른 연동 지점
   */
  cuts?: ThreatCutV2[]
  /** Access Gap 벤(엔진 threatGap.ts). 비인가 접근, 권한 상승, 데이터 반출 위협에만 */
  accessGap?: ThreatAccessGapV2
}

type Hop = { kind: string; from: string; to: string }
export interface ThreatCutV2 {
  at: Hop
  action: string
  with?: { at: Hop; action: string }[]
  closes?: number
  of?: number
  /** 닫힌 사람을 headcount 와 같은 셈으로(엔진 contract.ts, 2026-11-20) */
  closed?: ThreatHeadcountV2
  verified: boolean
  remainVia?: string[]
  alsoCloses?: number
}

export function isThreatV2(x: unknown): x is ThreatV2 {
  return !!x && typeof x === 'object' && typeof (x as ThreatV2).primaryType === 'string' && Array.isArray((x as ThreatV2).subjects)
}

/** 가상 노드(mail:계정, outside:주소)를 화면 객체로. 메일 내용은 계정으로 보여 준다 */
function objectKeyOf(key: string): string | undefined {
  if (key.startsWith('mail:')) return key.slice('mail:'.length)
  if (key.startsWith('outside') || key.startsWith('attr:')) return undefined
  return key
}

/** 차단 지점을 조치 문장으로. 조치 종류는 엔진이 간선 종류로 정한다(cuts.ts). 다시 판정으로 해결을 확인한 조치가 앞 */
const CUT_TITLE: Record<string, (at: { from: string; to: string }, name: (k: string) => string) => string> = {
  'remove-member': (at, n) => `${n(at.to)} 구성원에서 ${n(at.from)} 제외`,
  'reduce-grant': (at, n) => `${n(at.from)}의 ${n(at.to)} 권한 축소`,
  'caller-identity': (at, n) => `${n(at.from)} 실행 신원을 호출자 권한으로 변경`,
  'stop-flow': (at, n) => `${n(at.from)}에서 ${n(at.to)}로 가는 데이터 흐름 중단`,
  'remove-credential': (at, n) => `${n(at.from)}에 보관한 자격증명 제거와 교체`,
  'limit-effect': (at, n) => `${n(at.from)}에서 ${n(at.to)}로 가는 자동 반영 중단`,
  'limit-condition': (at, n) => `${n(at.to)} 규칙 조건에서 본인이 고칠 수 있는 값 제외`,
}

/**
 * 엔진 판정 이유(reasons) 를 판정 근거 칸의 확인 항목으로. 모르는 값 때문에 생긴 사유는 미확인, 약한 근거는 추정.
 * group 은 판정 근거 표의 행: 권한을 얻는 경로, 얻는 권한 수준, 미수집, 추정
 */
type Check = NonNullable<FindingV2['checks']>[number]
const REASON: Record<string, Pick<Check, 'label' | 'state' | 'group'>> = {
  '실행 신원': { label: '고정 실행 신원의 권한을 빌림', state: 'confirmed', group: 'route' },
  '자동화 편집': { label: '자동화를 고쳐 실행 신원 권한을 얻음', state: 'confirmed', group: 'route' },
  '자격 보관': { label: '보관된 자격증명을 읽을 수 있음', state: 'confirmed', group: 'route' },
  '데이터 흐름': { label: '데이터 흐름으로 사본을 봄', state: 'confirmed', group: 'route' },
  효과: { label: '자동 반영으로 대상을 바꿈', state: 'confirmed', group: 'route' },
  조건: { label: '규칙 조건으로 그룹을 얻음', state: 'confirmed', group: 'route' },
  '직접 공유': { label: '조직 밖 계정에 직접 공유', state: 'confirmed', group: 'route' },
  '쓰기 이상': { label: '실행 신원에 수정 권한 있음', state: 'confirmed', group: 'level' },
  '게시 전용': { label: '게시만 할 수 있는 권한으로 얻음', state: 'confirmed', group: 'level' },
  관리: { label: '관리 권한을 새로 얻음', state: 'confirmed', group: 'level' },
  // 제어 객체 관리로 그 아래 못 읽던 내용을 읽게 됨(엔진 판정 사유, 2026-11-19)
  '아래 내용 읽기': { label: '관리 권한으로 아래 내용을 새로 읽음', state: 'confirmed', group: 'level' },
  읽기: { label: '실행 신원이 읽기만 가짐', state: 'confirmed', group: 'level' },
  '호출자 모름': { label: '호출할 수 있는 사람 미수집', state: 'unknown', group: 'unknown' },
  '능력 범위 모름': { label: '자동화 동작 범위 미수집', state: 'unknown', group: 'unknown' },
  '결과 반환 모름': { label: '자동화 결과가 호출자에게 돌아가는지 미수집', state: 'unknown', group: 'unknown' },
  '직접 수준 모름': { label: '기존 권한 수준 미수집', state: 'unknown', group: 'unknown' },
  '조직 경계 모름': { label: '받는 쪽 조직 경계 미수집', state: 'unknown', group: 'unknown' },
  '실행 기록 없음': { label: '실행 기록 없음', state: 'inferred', group: 'inferred' },
  '같은 사람 연결 약함': { label: '같은 사람 계정 연결이 약함', state: 'inferred', group: 'inferred' },
  // 연결 없는 계정이 다른 직원과 같은 사람일 수 있어 그 직원 권한과 합치면 사라지는 유형(엔진 demote)
  '같은 사람 연결 없음': { label: '같은 사람 계정 연결 없음', state: 'inferred', group: 'inferred' },
}

/** 표에 없는 사유는 문구 그대로 확인 항목으로 두고 경로 행에 넣는다 */
const reasonCheck = (r: string): Pick<Check, 'label' | 'state' | 'group'> => REASON[r] ?? { label: r, state: 'confirmed', group: 'route' }

function reasonChecks(t: ThreatV2): Check[] {
  return [
    ...t.reasons.map((r, i) => ({ id: `reason-${i}`, ...reasonCheck(r), detail: '' })),
    // 확정 위협이어도 미확정 경로에서만 나온 유형은 「추정」, 미확인으로 보인다
    ...(t.unconfirmedTypes ?? []).map((ty, i) => ({ id: `unconfirmed-${i}`, label: `${ty} 추정`, state: 'unknown' as const, group: 'inferred' as const, detail: '' })),
    // 유형 이름이 같아도(쓰기는 확정 비인가 접근, 읽기는 미확정 비인가 접근) 미확정 판정 줄에서만 얻은 수준은 「읽기 추정」
    ...(t.unconfirmedLevels ?? []).map((lv, i) => ({ id: `unconfirmed-level-${i}`, label: `${lv} 추정`, state: 'unknown' as const, group: 'inferred' as const, detail: '' })),
  ]
}

/** 엔진 순서 그대로: 모두 막는 조합, 많이 막는 것 순. 권장 조치와 그래프 번호가 같은 순서를 쓴다 */
const sortedCuts = (t: ThreatV2) => [...(t.cuts ?? [])].sort((a, b) => Number(b.verified) - Number(a.verified))
/** 차단 지점 조치 이름. 목록에서 누구에게 하는 조치인지와 따로 보인다 */
const CUT_ACTION: Record<string, string> = {
  'remove-member': '구성원 제외',
  'reduce-grant': '권한 축소',
  'caller-identity': '호출자 권한으로 실행',
  'stop-flow': '데이터 흐름 중단',
  'remove-credential': '자격증명 제거',
  'limit-effect': '자동 반영 중단',
  'limit-condition': '규칙 조건 수정',
  'limit-callers': '호출 허용 범위 축소',
}

const hopTitle = (at: Hop, action: string, name: (k: string) => string) =>
  action === 'limit-callers' ? `${name(at.to)} 호출 허용 범위 축소` : (CUT_TITLE[action] ?? CUT_TITLE['reduce-grant'])(at, name)

/** 차단 인원 문장. 「14명 중 8명 차단 가능」, 「8명과 누구나 중 5명 차단 가능」. 다른 경유는 cutVia 로 따로. 인원을 세지 않은 옛 게시 행은 적지 않는다 */
export function cutOutcome(c: { closes?: number; of: number; closedText?: string; ofText?: string }): string {
  return c.closes === undefined ? '' : `${c.ofText ?? `${c.of}명`} 중 ${c.closedText ?? `${c.closes}명`} 차단 가능`
}

/** 남은 사람이 같은 대상에 닿는 다른 연동 지점 */
export function cutVia(c: { remainVia?: string[] }): string {
  return c.remainVia?.length ? `다른 경유: ${c.remainVia.join(', ')}` : ''
}

function cutViews(t: ThreatV2, name: (k: string) => string): NonNullable<FindingV2['threatCuts']> {
  const of = t.subjects.length
  return sortedCuts(t).map(c => ({
    at: { kind: c.at.kind, from: c.at.from, to: c.at.to },
    ...(c.with?.length ? { with: c.with.map(w => ({ kind: w.at.kind, from: w.at.from, to: w.at.to })), withTitles: c.with.map(w => hopTitle(w.at, w.action, name)) } : {}),
    verified: c.verified,
    ...(c.closes !== undefined ? { closes: c.closes } : c.verified ? { closes: of } : {}),
    of: c.of ?? of,
    ...(c.closed && t.headcount ? { closedText: headcountText(c.closed), ofText: headcountText(t.headcount) } : {}),
    title: hopTitle(c.at, c.action, name),
    action: CUT_ACTION[c.action] ?? CUT_ACTION['reduce-grant'],
    // 호출 허용 범위 축소는 호출받는 쪽(to)을 고친다. 나머지는 간선의 시작(from)이 조치할 곳, 끝(to)이 범위
    target: name(c.action === 'limit-callers' ? c.at.to : c.at.from),
    scope: name(c.action === 'limit-callers' ? c.at.from : c.at.to),
    ...(c.remainVia?.length ? { remainVia: c.remainVia.map(name) } : {}),
    ...(c.alsoCloses ? { alsoCloses: c.alsoCloses } : {}),
  }))
}

function cutItems(views: NonNullable<FindingV2['threatCuts']>): FindingV2['remediation'] {
  return views.map((c, i) => ({
    id: `cut-${i}`,
    title: [c.title, ...(c.withTitles ?? [])].join(', '),
    description: [cutOutcome(c), cutVia(c)].filter(Boolean).join(', '),
  }))
}

/**
 * 위협 증적. 연동 지점(point) 객체에 걸린 관측과, 그 객체나 그 관측을 잇는 증적 연결.
 * 접근 기록처럼 경로 전체에 걸친 간접 기록은 넣지 않는다
 */
function threatEvidence(t: ThreatV2, evidenceStore?: EvidenceStore): Pick<FindingV2, 'evidenceObservationIds' | 'evidenceLinkIds'> {
  const point = objectKeyOf(t.point)
  if (!evidenceStore || !point) return { evidenceObservationIds: [], evidenceLinkIds: [] }
  const obsIds = new Set<string>()
  for (const obs of evidenceStore.observationsById.values()) if (obs.objectKeys.includes(point)) obsIds.add(obs.id)
  const touches = (end: { kind: string; id: string }) => end.kind === 'object' ? end.id === point : obsIds.has(end.id)
  const linkIds: string[] = []
  for (const link of evidenceStore.evidenceLinksById.values()) if (touches(link.from) || touches(link.to)) linkIds.push(link.id)
  return { evidenceObservationIds: [...obsIds], evidenceLinkIds: linkIds }
}

export function threatV2ToFinding(t: ThreatV2, graph: GraphStoreV2, evidenceStore?: EvidenceStore): FindingV2 {
  const keys = [...new Set([t.point, t.target, ...t.targets].map(objectKeyOf).filter((k): k is string => !!k && graph.objectsByKey.has(k)))]
  const people = t.subjects.map(s => s.person).filter(k => graph.objectsByKey.has(k))
  const providers = [...new Set(keys.map(k => graph.objectsByKey.get(k)!.canonical.provider))] as Provider[]
  const name = (k: string) => {
    // 사용자 속성(attr:계정:속성)은 그 계정의 속성 이름으로
    if (k.startsWith('attr:')) {
      const rest = k.slice('attr:'.length)
      const owner = rest.replace(/:[^:]*$/, '')
      const attr = rest.slice(owner.length + 1)
      return `${graph.objectsByKey.has(owner) ? objectLabel(owner, graph) : owner} ${attr} 속성`
    }
    const key = objectKeyOf(k)
    if (key && graph.objectsByKey.has(key)) {
      if (k.startsWith('mail:')) return `${objectLabel(key, graph)} 메일함`
      return driveRootLabel(key, t.targets, graph) ?? objectLabel(key, graph)
    }
    if (k.startsWith('outside')) return '조직 밖 주소'
    const parsed = kindNounFromKey(key ?? k)
    if (parsed) {
      const shortId = parsed.id.length > 8 ? `${parsed.id.slice(0, 8)}…` : parsed.id
      return parsed.kind ? `${parsed.kind} ${shortId}` : shortId
    }
    return k.length > 8 && !k.includes(' ') ? `${k.slice(0, 8)}…` : k
  }
  const target = t.targets.length > 1 ? `${name(t.target)} 아래 ${t.targets.length}개` : name(t.target)
  // 화면 인원은 엔진 headcount. 그 칸이 없는 옛 게시 행만 정렬용 사람 수를 적는다
  const count = t.headcount ? headcountText(t.headcount) : `${t.severityFactors.people}명`
  const title = t.primaryType === '추적성 상실'
    ? `${name(t.point)} 실행 기록에 호출자 없음`
    : `${name(t.point)} 경유 ${target} ${t.primaryType}`
  return {
    // 화면 주소와 AI 계획이 받는 위협 번호 모양(FND-영문3-16진수8)에 맞춘다
    id: `FND-THR-${t.id.replace(/^threat:/, '').slice(0, 8).toUpperCase()}`,
    ruleId: 'threat-v2',
    primaryType: t.primaryType,
    types: t.types,
    occurrence: t.occurrence,
    threatCertainty: t.certainty,
    threatPath: { point: t.point, target: t.target, hops: t.path?.hops ?? [] },
    threatTargets: t.targets,
    threatSubjects: t.subjects,
    ...(t.headcount ? { threatHeadcount: t.headcount } : {}),
    title,
    severity: t.severity,
    status: 'open',
    summary: t.primaryType === '추적성 상실'
      ? '여러 사람이 같은 고정 신원으로 실행해 대상 기록에 실제 요청자가 남지 않을 수 있음'
      // 미확정 유형은 판정 근거에 따로 보이고 요약에는 확정 유형만 쓴다
      : `${count}${subjectParticle(count)} ${name(t.point)}을 거쳐 ${target}에 ${t.types.filter(ty => !t.unconfirmedTypes?.includes(ty)).join(', ')}`,
    impact: '',
    involvedObjectKeys: keys,
    involvedRelationKeys: [],
    involvedLinkIds: [],
    ...threatEvidence(t, evidenceStore),
    affectedIdentityKeys: people,
    providerSet: providers,
    remediation: cutItems(cutViews(t, name)),
    ...(t.primaryType === '추적성 상실' ? {} : { threatHeadline: { people: t.severityFactors.people, count, point: name(t.point), target, types: t.types.filter(ty => !t.unconfirmedTypes?.includes(ty)) } }),
    threatCuts: cutViews(t, name),
    ...(t.accessGap ? { threatAccessGap: t.accessGap } : {}),
    fingerprint: t.fingerprint,
    checks: reasonChecks(t),
    controls: [],
  }
}

/** 서버 번들 위협 목록. 새 위협 행만 쓰고, 없으면 0건이다 */
export function pickFindings(details: unknown[], graph: GraphStoreV2, evidenceStore?: EvidenceStore): FindingV2[] {
  return details.filter(isThreatV2).map(t => threatV2ToFinding(t, graph, evidenceStore))
}

/* 드라이브 루트 폴더(id 가 0A 로 시작해 Uk9PVA 로 끝남)는 파일 목록의 parents 로만 들어와 이름이 없다.
   공유 드라이브면 그 드라이브 이름, 아니면 아래 파일 소유자의 「내 드라이브」로 부른다 */
const DRIVE_ROOT = /^im:gws:File:(0A[\w-]+Uk9PVA)$/
export function driveRootLabel(key: string, children: readonly string[], graph: GraphStoreV2): string | undefined {
  const id = DRIVE_ROOT.exec(key)?.[1]
  if (!id || objectLabel(key, graph) !== id) return undefined
  const drive = graph.objectsByKey.get(`im:gws:Drive:${id}`)
  if (drive) return objectLabel(`im:gws:Drive:${id}`, graph)
  for (const child of children) {
    const refs = graph.objectsByKey.get(child)?.canonical.references
    if (!refs?.parent?.targets?.some(r => r.value === key)) continue
    const owner = String(refs.owner?.targets?.[0]?.value ?? '')
    if (owner && graph.objectsByKey.has(owner)) return `${objectLabel(owner, graph)} 내 드라이브`
  }
  return '내 드라이브 루트 폴더'
}
