/**
 * 피해범위 화면 글자. 계산(src/detection/v2/blastRadius.ts)의 값을 사람이 읽는 말로 옮긴다.
 * 그래프 요약, 목록, 상세가 같은 글자를 쓴다.
 */
import type { GraphStoreV2 } from '../model/graph'
import type { IdentityLink } from '../model/link'
import type { Provider } from '../model/object'
import type { BlastHop, BlastLevel, BlastMode, BlastNode, BlastNote, BlastRadius } from '../detection/v2/blastRadius'
import { providerName } from '../findings/providers'
import { linkLevelCopy } from '../semantic-graph/edgeExplain'
import { josa, objectName, shownKind } from '../utils/objectPhrase'

export const MODE_LABEL: Record<BlastMode, string> = {
  token: '토큰 유출',
  account: '소유 계정 탈취',
}

export const LEVEL_LABEL: Record<BlastLevel, string> = {
  admin: '관리',
  write: '쓰기',
  read: '읽기',
  use: '사용',
}

export const CERTAINTY_LABEL = { confirmed: '확인', inferred: '추정' } as const

/** 닿는 곳이 없을 때. 보안 제품이 피해범위에 쓰는 말(No impact)을 따른다 */
export const NO_REACH_LABEL = '영향 없음'

/** 그래프, 목록에서 SaaS를 늘 같은 순서로 */
export const PROVIDER_ORDER: Provider[] = ['okta', 'gws', 'github', 'slack', 'atlassian', 'aws', 'cloudflare', 'microsoft']

export function providerRank(p: Provider): number {
  const i = PROVIDER_ORDER.indexOf(p)
  return i < 0 ? PROVIDER_ORDER.length : i
}

export function objectLabel(key: string, graph: GraphStoreV2): string {
  const o = graph.objectsByKey.get(key)
  if (!o) return key
  if (!o.fixture_meta?.display_name && o.canonical.properties.label && !o.canonical.properties.name) return String(o.canonical.properties.label)
  return objectName(graph, key)
}

/** 같은 이름의 자격증명을 가르는 식별자 값 (벤더 id) */
export function objectIdLabel(key: string, graph: GraphStoreV2): string {
  const ids = graph.objectsByKey.get(key)?.canonical.identifiers
  const primary = ids?.primary?.[0]
  const value = primary ? (ids?.[primary] as { value?: unknown } | undefined)?.value : undefined
  return value === undefined ? '' : String(value)
}

export function objectTypeLabel(key: string, graph: GraphStoreV2): string {
  const o = graph.objectsByKey.get(key)
  // 표 이름이나 수집기 경로를 바꾼 한글 종류는 SaaS 이름을 붙이고, 읽히는 SaaS 용어는 그대로 둔다
  const noun = shownKind(o)
  if (o && noun && noun !== String(o.catalog_ref?.provider_term ?? o.canonical.object_type)) return `${providerName(o.canonical.provider as Provider)} ${noun}`
  return noun
}

/* 권한 수준을 말할 수 없는 것(로그인, 소속, 봇 동작)은 「사용」 대신 무엇을 얻는지 적는다 */
const USE_LABEL: Partial<Record<BlastHop['kind'], string>> = {
  holder: '로그인',
  owner_app: '앱 제어',
  acts_as: '대리 실행',
  member_of: '구성원',
  sso: '로그인',
  automation_link: '자동화 신원',
  takeover: '계정 탈취',
  effective_access: '접근',
}

/** 획득 권한 이름. use 는 거쳐 온 단계(via 의 앞머리가 단계 종류)에 맞는 말로 */
export function levelLabel(level: BlastLevel, kind?: BlastHop['kind'] | string): string {
  if (level !== 'use') return LEVEL_LABEL[level]
  return (kind && USE_LABEL[kind as BlastHop['kind']]) || LEVEL_LABEL.use
}

/** 노드가 거쳐 온 단계 종류. hop id 는 「종류:from>to」 꼴이다 */
export const viaKind = (node: BlastNode) => node.via?.split(':')[0]

/** 얻은 권한을 한 줄로. 조직 단위 관리면 「Google Workspace 조직 관리」 */
export function reachLabel(node: BlastNode, graph: GraphStoreV2): string {
  if (!node.level) return objectLabel(node.key, graph)
  if (node.tenantWide) return `${providerName(node.provider)} 조직 ${levelLabel(node.level, viaKind(node))}`
  return `${objectLabel(node.key, graph)} ${levelLabel(node.level, viaKind(node))}`
}

/** 결과 요약 한 줄 — 가장 센 권한 */
export function headline(radius: BlastRadius, graph: GraphStoreV2): string {
  const reached = reachedNodes(radius)
  if (!reached.length) return NO_REACH_LABEL
  // 권한 수준을 말할 수 있는 곳이 없으면(로그인, 앱 제어뿐) 처음 닿은 곳과 얻는 것을 적는다. 전에는 「n개 객체 사용」이었다
  if (!radius.highest) return `${reachLabel(reached[0], graph)}${reached.length > 1 ? ` 외 ${reached.length - 1}개` : ''}`
  return reachLabel(radius.highest, graph)
}

/** 시작 자격증명을 뺀, 닿은 객체 (권한을 얻었거나 그 계정으로 행동하는 것) */
export function reachedNodes(radius: BlastRadius): BlastNode[] {
  return radius.nodes.filter(n => n.key !== radius.credentialKey && (n.controlled || n.level !== undefined))
}

export function linkLevelLabel(level: string | undefined): string {
  if (!level) return ''
  return linkLevelCopy(level as IdentityLink['level']).label
}

const HOP_VERB: Record<BlastHop['kind'], string> = {
  holder: '소유 계정',
  owner_app: '소유 앱',
  acts_as: '대리 실행',
  delivers_to: '메시지 전송',
  member_of: '소속',
  role: '역할',
  contains: '하위 항목',
  runs_as: '실행 계정',
  sso: 'SSO 로그인',
  automation_link: '자동화 신원',
  takeover: '계정 탈취',
  effective_access: 'Effective Access',
  delegated_write: '위임 쓰기',
}

export function hopKindLabel(kind: BlastHop['kind']): string {
  return HOP_VERB[kind]
}

/** 홉 한 줄 설명 */
export function hopSentence(hop: BlastHop, graph: GraphStoreV2): string {
  const from = objectLabel(hop.from, graph)
  const to = objectLabel(hop.to, graph)
  const through = hop.throughKey ? objectLabel(hop.throughKey, graph) : ''
  const toProvider = graph.objectsByKey.get(hop.to)?.canonical.provider
  const level = hop.level ? levelLabel(hop.level, hop.kind) : ''
  switch (hop.kind) {
    case 'holder':
      return `${josa(from, '으로/로')} ${to} 계정 로그인`
    case 'owner_app':
      return `${to} 앱의 토큰 ${from}`
    case 'acts_as':
      return `${from} 앱의 ${to} 계정 권한 동작`
    case 'delivers_to':
      return `${josa(from, '으로/로')} ${to}에 메시지 전송`
    case 'member_of':
      return `${josa(from, '이/가')} ${to} 소속${level ? `, ${level}` : ''}`
    case 'role':
      return `${josa(from, '이/가')} ${to}에서 ${hop.roleName ?? level} 역할 보유${level && hop.roleName ? `, ${level}` : ''}`
    case 'contains':
      return `${josa(to, '은/는')} ${from} 하위 항목${level ? `, ${level}` : ''}`
    case 'runs_as':
      return `${from} 권한으로 ${to} 실행`
    case 'sso':
      return `${through} 앱으로 ${toProvider ? providerName(toProvider) : ''} ${to} 계정 로그인, 동일인 연결 ${linkLevelLabel(hop.linkLevel)}`
    case 'takeover':
      return `${through} 관리자 역할로 ${to} 계정의 비밀번호와 인증 수단 초기화`
    case 'automation_link':
      return `같은 자동화의 ${toProvider ? providerName(toProvider) : ''} 계정 ${to}, 동일인 연결 ${linkLevelLabel(hop.linkLevel)}`
    case 'effective_access':
      return `${from}에서 ${to}까지 접근 경로${hop.roleName ? `, ${hop.roleName}` : ''}`
    case 'delegated_write':
      return `${from} 앱이 ${through ? josa(through, '으로/로') : '쓰는 자격증명으로'} ${to}에 ${level}`
  }
}

/**
 * 경로 한 단계를 두 끝과 덧붙일 말로. 목록에는 문장(hopSentence) 대신 이것을 적고, 문장은 커서를 올리면 뜬다.
 * 문장은 두 끝 이름을 조사와 함께 되풀이해 한 단계가 두세 줄로 늘어졌다.
 */
export function hopEnds(hop: BlastHop, graph: GraphStoreV2): { from: string; to: string; note: string } {
  const through = hop.throughKey ? objectLabel(hop.throughKey, graph) : ''
  const level = hop.level ? levelLabel(hop.level, hop.kind) : ''
  const note = hop.kind === 'sso' ? `${through} 앱, 연결 ${linkLevelLabel(hop.linkLevel)}`
    : hop.kind === 'takeover' ? `${through} 관리 역할`
    : hop.kind === 'automation_link' ? `연결 ${linkLevelLabel(hop.linkLevel)}`
    : hop.kind === 'role' ? [hop.roleName, level].filter(Boolean).join(', ')
    : hop.kind === 'effective_access' ? hop.roleName ?? ''
    : hop.kind === 'delegated_write' ? [through, level].filter(Boolean).join(', ')
    : level
  return { from: objectLabel(hop.from, graph), to: objectLabel(hop.to, graph), note }
}

/**
 * 결과를 읽는 데 필요한 참고 한 줄. 계산 방식을 해명하는 말(권한 목록을 몰라 짐작했다, 계산을 멈췄다 등)은
 * 화면에 쓰지 않고 빈 문자열을 돌려준다.
 */
export function noteSentence(note: BlastNote, graph: GraphStoreV2): string {
  const name = note.objectKey ? objectLabel(note.objectKey, graph) : ''
  switch (note.code) {
    case 'factor_alone':
      return '인증 수단 하나로는 로그인 불가'
    case 'scope_identity_only':
      return '토큰 권한이 사용자 정보 확인뿐이라 다른 리소스 접근 불가'
    case 'scope_read_only':
      return '읽기 전용 토큰이라 읽기까지만 가능'
    case 'sso_account_unknown':
      return `${name} 앱으로 ${note.detail ? providerName(note.detail as Provider) : ''}에 로그인하지만 대상 계정 미확인`
    case 'credential_inactive':
      return '미사용 토큰'
    case 'scope_unknown':
    case 'scope_outside_graph':
    case 'role_permissions_unknown':
    case 'weak_link_stopped':
    case 'truncated':
      return ''
  }
}
