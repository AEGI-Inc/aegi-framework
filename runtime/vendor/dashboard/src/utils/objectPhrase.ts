/**
 * 화면 문장에 객체를 넣을 때 쓰는 이름.
 *
 * 「Team Directory 로 #user-c-private 을(를)…」처럼 이름만 쓰면 무엇이 어느 SaaS 의
 * 무엇인지 읽는 사람이 알 수 없다. 문장 안에서는 「Google Workspace의 Team Directory 웹앱」,
 * 「Slack의 #user-c-private 채널」처럼 SaaS, 이름, 종류를 함께 쓴다.
 * 종류 이름이 한글로 끝나므로 조사도 「을(를)」 없이 바로 붙일 수 있다.
 */
import type { GraphStoreV2 } from '../model/graph'
import type { FixtureObject, Provider } from '../model/object'
import { providerName } from '../findings/providers'

const TYPE_NOUN: Record<string, string> = {
  'gws|Customer': '조직',
  'gws|Drive': '공유 드라이브',
  'gws|User': '계정',
  'gws|Group': '그룹',
  'gws|Form': '설문지',
  'gws|Permission': '공유 권한',
  'slack|conversation': '채널',
  'slack|user': '계정',
  'slack|bot': '봇',
  'slack|bot-token': '봇 토큰',
  'slack|Slash Command Request Endpoint': '슬래시 명령',
  'slack|incoming-webhook': '웹훅',
  'slack|Message': '메시지',
  'slack|workspace': '워크스페이스',
  'slack|enterprise': '조직',
  'slack|Slack App Installation Registration': '앱',
  'github|Repository': '저장소',
  'github|User Account': '계정',
  'github|Organization': '조직',
  'github|Enterprise': '엔터프라이즈',
  'github|Commit': '커밋',
  'github|Pull Request': 'PR',
  'github|Workflow': '워크플로',
  'github|Team': '팀',
  'github|Webhook': '웹훅',
  'github|Environment': '환경',
  'github|Repository ruleset': '룰셋',
  'github|GitHub App Installation Registration': '앱',
  'github|Organization Programmatic Access Grant': '토큰',
  'github|Credential Authorization': '토큰 승인',
  'okta|org': '조직',
  'okta|User': '계정',
  'okta|Group': '그룹',
  'okta|GroupRule': '그룹 규칙',
  'okta|Application': '앱',
  'okta|OAuth2Client': 'OAuth 클라이언트',
  'okta|OAuth2RefreshToken': '토큰',
  'okta|ApiToken': 'API 토큰',
  'okta|UserFactor': '인증 수단',
  'okta|IamRole': '관리자 역할',
  'okta|ResourceSet': '리소스 세트',
  'okta|Policy': '정책',
  'okta|PolicyRule': '정책 규칙',
}

/** 객체 종류의 한글 이름. 모르는 종류는 빈 문자열 */
export function typeNoun(obj: FixtureObject | undefined): string {
  if (!obj) return ''
  const { provider, object_type: type, properties: p } = obj.canonical
  if (provider === 'gws' && type === 'Project') {
    const deployments = (p.deployments as Array<{ entryPointType?: string }> | undefined) ?? []
    return deployments.some(d => d.entryPointType === 'WEB_APP') ? '웹앱' : '스크립트'
  }
  if (provider === 'gws' && type === 'File') {
    const mime = String(p.mimeType ?? '')
    if (mime.includes('spreadsheet')) return '시트'
    if (mime.includes('document')) return '문서'
    if (mime.includes('presentation')) return '프레젠테이션'
    if (mime.includes('form')) return '설문지'
    if (mime.includes('folder')) return '폴더'
    return '파일'
  }
  return TYPE_NOUN[`${provider}|${type}`] ?? ''
}

const TYPE_NOUN_LOWER = new Map(Object.entries(TYPE_NOUN).map(([key, noun]) => [key.toLowerCase(), noun]))

/** `im:provider:objectType:id` 모양의 키에서 한국어 종류 이름과 id 부분을 꺼낸다 */
export function kindNounFromKey(key: string): { kind: string; id: string } | undefined {
  const parts = key.split(':')
  if (parts.length < 4) return undefined
  const [, provider, objectType, ...rest] = parts
  const id = rest.join(':')
  const exact = TYPE_NOUN_LOWER.get(`${provider}|${objectType}`.toLowerCase())
  if (exact) return { kind: exact, id }
  for (const [re, noun] of KIND_WORDS) {
    if (re.test(objectType)) return { kind: noun, id }
  }
  return { kind: '', id }
}

/* 표에 없는 종류의 낱말. 위에서부터 먼저 맞는 것을 쓴다(「Organization Custom Repository Role」은 저장소가 아니라 권한) */
const KIND_WORDS: Array<[RegExp, string]> = [
  [/pull.?request/i, 'PR'],
  [/commit/i, '커밋'],
  [/message/i, '메시지'],
  [/role|permission|grant/i, '권한'],
  [/slash/i, '슬래시 명령'],
  [/webhook/i, '웹훅'],
  [/token|credential|secret|key/i, '토큰'],
  [/repo/i, '저장소'],
  [/conversation|channel/i, '채널'],
  [/group|team/i, '그룹'],
  [/workspace/i, '워크스페이스'],
  [/workflow|automation/i, '자동화'],
  [/org|tenant|customer|enterprise/i, '조직'],
  [/app|integration|installation/i, '앱'],
  [/user|member|account|principal/i, '계정'],
  [/file|document|sheet/i, '파일'],
  [/project|script/i, '스크립트'],
]

const INTERFACE_NOUN: Partial<Record<string, string>> = {
  Tenant: '조직',
  Principal: '계정',
  Resource: '자원',
  Policy: '정책',
  Integration: '연동',
  Credential: '자격증명',
  Endpoint: '엔드포인트',
  Assignment: '배정',
  Automation: '자동화',
}

/**
 * 화면에 적을 종류 이름. 늘 한글이다.
 *
 * typeNoun 은 표에 있는 종류만 안다. IM 모델 데이터는 종류가 「commit」, 「200.members[*]」,
 * 「simple-user」처럼 소문자나 수집기 경로로 들어와 표에서 빠지고, 그 값이 화면에 그대로 나왔다.
 * 표(대소문자 무시) → 종류, SaaS 용어의 낱말 → 인터페이스 순으로 찾고, 모르면 빈 문자열이다.
 */
export function kindNoun(obj: FixtureObject | undefined): string {
  const exact = typeNoun(obj)
  if (exact || !obj) return exact
  const { provider, object_type: type, interfaces } = obj.canonical
  const lower = TYPE_NOUN_LOWER.get(`${provider}|${type}`.toLowerCase())
  if (lower) return lower
  for (const text of [type, obj.catalog_ref?.provider_term]) {
    if (!text) continue
    const word = KIND_WORDS.find(([pattern]) => pattern.test(text))
    if (word) return word[1]
  }
  for (const face of interfaces ?? []) {
    const noun = INTERFACE_NOUN[face]
    if (noun) return noun
  }
  return ''
}

/* 수집기 경로로 들어오는 종류. 낱말 맞추기가 틀리는 것(「200.profile」이 file, 「org-hook」이 org, 「GoogleApps…Device」가 app 에 맞음)은 여기 둔다 */
const COLLECTOR_KIND: Record<string, string> = {
  'slack|defs_app_id': '앱',
  'slack|200.members[*]': '계정',
  'slack|200.profile': '계정',
  'slack|200.bot': '봇',
  'slack|200.team': '워크스페이스',
  'slack|200.team_2': '워크스페이스',
  'github|org-hook': '웹훅',
  'github|repository-ruleset': '룰셋',
  'github|credential-authorizations': '토큰 승인',
  'gws|GoogleAppsCloudidentityDevicesV1Device': '기기',
  'gws|GoogleAppsCloudidentityDevicesV1DeviceUser': '기기 사용자',
}

/**
 * 객체 상세와 관계 묶음 머리에 적을 종류 이름. 표에 있으면 표 이름(typeNoun)이고, 없으면 SaaS 용어를 그대로 쓴다.
 * 다만 SaaS 용어가 수집기 경로(「defs_app_id」, 「200.members[*]」, 「credential-row:oauth:url」)처럼 사람이 읽는 말이 아니면
 * kindNoun 의 낱말로 바꾼다. 「Conversation Membership Assignment」, 「Member」처럼 읽히는 용어는 낱말 맞추기로 뭉개지 않는다
 */
export function shownKind(obj: FixtureObject | undefined): string {
  const exact = typeNoun(obj)
  if (exact || !obj) return exact
  const key = `${obj.canonical.provider}|${obj.canonical.object_type}`
  const known = COLLECTOR_KIND[key] ?? TYPE_NOUN_LOWER.get(key.toLowerCase())
  if (known) return known
  const term = String(obj.catalog_ref?.provider_term ?? obj.canonical.object_type ?? '')
  return /^[A-Za-z][A-Za-z ]*$/.test(term) ? term : kindNoun(obj) || term
}

const FACTOR_NAME: Record<string, string> = {
  signed_nonce: 'Okta Verify',
  push: 'Okta Verify 푸시',
  'token:software:totp': 'OTP 앱',
  sms: 'SMS',
  call: '전화',
  email: '이메일',
  webauthn: '보안 키',
  password: '비밀번호',
}

/** 자격증명은 수집기 이름(「refresh token (0oa17…)」, 「signed_nonce (…)」) 대신 무엇의 토큰인지로 부른다 */
function credentialName(graph: GraphStoreV2, o: FixtureObject): string | undefined {
  const p = o.canonical.properties
  const display = String(o.fixture_meta?.display_name ?? '')
  const client = o.canonical.references?.client?.targets?.[0]?.value
  if (client && graph.objectsByKey.has(String(client))) return `${objectName(graph, String(client))} 앱 토큰`
  if (o.canonical.object_type === 'UserFactor') {
    const owner = o.canonical.references?.parent?.targets?.[0]?.value
    // 수집 데이터에 종류(factorType)가 없으면 「undefined」가 찍혔다. 종류를 모르면 「인증 수단」으로 부른다
    const factor = FACTOR_NAME[String(p.factorType)] ?? (p.factorType ? String(p.factorType) : '인증 수단')
    const who = owner && graph.objectsByKey.has(String(owner)) ? objectName(graph, String(owner)) : display.match(/\((.+)\)$/)?.[1]
    return who ? `${who}의 ${factor}` : factor
  }
  const bot = display.match(/^bot token \((.+)\)$/)
  if (bot) return `${bot[1]} 봇 토큰`
  return undefined
}

/** 객체의 보이는 이름. 수집기가 붙인 설명 괄호(「(목록에 없는 스크립트)」)는 뺀다 */
export function objectName(graph: GraphStoreV2, key: string): string {
  const o = graph.objectsByKey.get(key)
  const p = o?.canonical.properties ?? {}
  if (o?.canonical.object_type === 'Project' && p.title) return String(p.title)
  if (o?.canonical.interfaces.includes('Credential')) {
    const name = credentialName(graph, o)
    if (name) return name
  }
  // 수집하지 못하고 id 만 아는 객체: 「(목록에 없음)」 대신 앞에 「미수집」
  return String(o?.fixture_meta?.display_name ?? p.primaryEmail ?? p.login ?? p.email ?? p.name ?? p.title ?? key).replace(/^(.*) \(목록에 없음\)$/, '미수집 $1')
}

/** 「Google Workspace의 Team Directory 웹앱」. withSaas=false 면 「Team Directory 웹앱」 */
export function objectPhrase(graph: GraphStoreV2, key: string, withSaas = true): string {
  const o = graph.objectsByKey.get(key)
  const name = objectName(graph, key)
  const noun = typeNoun(o)
  const body = noun && !name.endsWith(noun) ? `${name} ${noun}` : name
  if (!withSaas || !o) return body
  return `${providerName(o.canonical.provider as Provider)}의 ${body}`
}

/* ---------------------------------------------------------------- 조사 */

const DIGIT_BATCHIM: Record<string, boolean> = { '0': true, '1': true, '2': false, '3': true, '4': false, '5': false, '6': true, '7': true, '8': true, '9': false }

/** 마지막 글자의 받침. ㄹ 받침은 'rieul' */
function batchim(word: string): 'none' | 'rieul' | 'other' {
  const text = word.replace(/[)\]}'"」』\s]+$/, '')
  const ch = text[text.length - 1] ?? ''
  const code = ch.charCodeAt(0)
  if (code >= 0xac00 && code <= 0xd7a3) {
    const final = (code - 0xac00) % 28
    return final === 0 ? 'none' : final === 8 ? 'rieul' : 'other'
  }
  if (ch in DIGIT_BATCHIM) return ch === '1' || ch === '7' || ch === '8' ? 'rieul' : DIGIT_BATCHIM[ch] ? 'other' : 'none'
  const lower = text.toLowerCase()
  if (lower.endsWith('l')) return 'rieul'
  // 영어 끝소리: m, n, ng 와 받침으로 읽는 k, t, p, c (Slack → 슬랙, bot → 봇)
  if (/(m|n|ng|k|t|p|c)$/.test(lower)) return 'other'
  return 'none'
}

type JosaPair = '을/를' | '이/가' | '은/는' | '과/와' | '으로/로'

/** 단어 뒤에 맞는 조사를 붙인다. josa('채널', '을/를') → '채널을' */
export function josa(word: string, pair: JosaPair): string {
  const b = batchim(word)
  const [withFinal, withoutFinal] = pair.split('/')
  if (pair === '으로/로') return word + (b === 'other' ? '으로' : '로')
  return word + (b === 'none' ? withoutFinal : withFinal)
}
