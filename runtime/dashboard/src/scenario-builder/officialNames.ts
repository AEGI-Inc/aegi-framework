import type { ScenarioGraph } from './scenarioGraph'
import { EVERYONE } from '../detection/v2/engine'
import { providerName } from '../findings/providers'

/**
 * 검색 결과 줄에서 객체 이름 위에 굵게 적는 공식 이름. 연동이나 자동화는 객체가 붙인 이름(규칙 이름, 앱 이름) 대신
 * 벤더가 그 기능을 부르는 이름(Okta Workflows, GitHub Actions 워크플로 등)을 먼저 보인다. 표에 없으면 ScenarioGraph.typeLabel.
 * 키는 수집 객체의 (provider, object_type) 이다.
 */
const OFFICIAL: Record<string, string> = {
  'atlassian|AutomationRule': 'Atlassian Automation 규칙',
  'atlassian|AutomationRequestEndpoint': 'Atlassian Automation 수신 웹훅',
  'github|integration': 'GitHub App',
  'github|installation': 'GitHub App 설치',
  'github|workflow': 'GitHub Actions 워크플로',
  'github|actions-secret': 'GitHub Actions 시크릿',
  'github|org-hook': 'GitHub 조직 웹훅',
  'github|webhook-config': 'GitHub 웹훅',
  'github|personal-access-tokens': 'GitHub 개인 액세스 토큰',
  'github|deploy-key': 'GitHub 배포 키',
  'gws|Project': 'Google Apps Script 프로젝트',
  'gws|Deployment': 'Google Apps Script 배포',
  'gws|ScriptProperty': 'Google Apps Script 스크립트 속성',
  'gws|StudioFlow': 'Google Workspace Studio 흐름',
  'gws|MailForwarding': 'Gmail 자동 전달',
  'okta|OAuth2Client': 'Okta OAuth 앱',
  'okta|EventHook': 'Okta 이벤트 훅',
  'okta|ApiToken': 'Okta API 토큰',
  'okta|ProfileMapping': 'Okta 프로필 매핑',
  'okta|GroupRule': 'Okta 그룹 규칙',
  'salesforce|FlowDefinitionView': 'Salesforce Flow',
  'salesforce|FlowRecord': 'Salesforce Flow',
  'salesforce|FlowRecordVersion': 'Salesforce Flow',
  'salesforce|FlowSlackActionEndpoint': 'Salesforce Flow Slack 동작',
  'salesforce|ApexClass': 'Salesforce Apex 클래스',
  'salesforce|NamedCredential': 'Salesforce Named Credential',
  'salesforce|ConnectedApplication': 'Salesforce 연결된 앱',
  'salesforce|ExternalClientApplication': 'Salesforce 외부 클라이언트 앱',
  'salesforce|WebToLead': 'Salesforce Web-to-Lead',
  'slack|defs_app_id': 'Slack 앱',
  'slack|200.bot': 'Slack 봇',
  'slack|credential-row:oauth:url': 'Slack 수신 웹훅',
  'slack|credential-row:oauth:xoxb': 'Slack 봇 토큰',
  'slack|Slash Command Request Endpoint': 'Slack 슬래시 명령',
  'slack|ChannelEmail': 'Slack 채널 이메일',
}

/** Okta 앱 카탈로그 키(Application.name) 중 벤더 기능 이름이 따로 있는 것 */
const OKTA_APP: Record<string, string> = {
  okta_flow_sso: 'Okta Workflows',
  flow: 'Okta Workflows',
  oidc_client: 'Okta OIDC 앱',
  bookmark: 'Okta 북마크 앱',
}

/**
 * 엔진의 가상 객체 「누구나」(EVERYONE: 로그인 없이 쓰는 폼, 공개 웹앱, 회사 밖 메일 주소 등을 부를 수 있는 아무나)를 Explorer 에서 부르는 이름.
 * 엔진과 다른 화면의 이름(「누구나」)은 그대로 둔다
 */
const EVERYONE_OFFICIAL = '외부 익명 사용자'
const EVERYONE_NAME = '로그인 없이 누구나'

export function officialName(sg: ScenarioGraph, key: string): string {
  if (key === EVERYONE) return EVERYONE_OFFICIAL
  const o = sg.graph.objectsByKey.get(key)
  if (!o) return sg.typeLabel(key)
  const { provider, object_type: type } = o.canonical
  const props = (o.canonical as { properties?: Record<string, unknown> }).properties ?? {}
  if (provider === 'okta' && type === 'Application') {
    const app = typeof props.name === 'string' ? props.name : ''
    return OKTA_APP[app] ?? 'Okta 앱'
  }
  // Okta Workflows 가 Okta 에 만든 OAuth 클라이언트와 Workflows 로 보내는 이벤트 훅
  if (provider === 'okta' && type === 'OAuth2Client' && typeof props.client_name === 'string' && props.client_name.startsWith('Okta Workflows')) return 'Okta Workflows'
  if (provider === 'okta' && type === 'EventHook' && JSON.stringify(props.channel ?? '').includes('.workflows.okta.com')) return 'Okta Workflows 이벤트 훅'
  const official = OFFICIAL[`${provider}|${type}`]
  if (official) return official
  // 주체는 수집 타입 이름(Principal, 200.members[*]) 대신 계정, 봇, 그룹, 조직으로
  const ix = sg.engine.ix
  if (o.canonical.interfaces.includes('Principal') || o.canonical.interfaces.includes('Tenant')) {
    const saas = providerName(provider)
    if (ix.isTenant(key)) return `${saas} 조직`
    if (ix.isPerson(key)) return `${saas} 계정`
    if (ix.isGroupLike(key)) return `${saas} 그룹`
    return `${saas} 봇`
  }
  return sg.typeLabel(key)
}

/** 이름으로 쓸 수집 속성 (앞의 것부터) */
const NAME_PROPS = ['Label', 'MasterLabel', 'DeveloperName', 'Name', 'label', 'name']

/**
 * 줄에 적는 객체 이름. ScenarioGraph.name 이 이름을 못 찾아 객체 id 를 그대로 돌려줄 때만(Salesforce Flow, Named Credential 등)
 * 수집 속성의 이름 칸(NAME_PROPS)을 쓴다. 그 밖에는 ScenarioGraph.name 그대로다
 */
export function nameOf(sg: ScenarioGraph, key: string): string {
  if (key === EVERYONE) return EVERYONE_NAME
  const base = sg.name(key)
  const o = sg.graph.objectsByKey.get(key)
  if (!o) return base
  const props = (o.canonical as { properties?: Record<string, unknown> }).properties ?? {}
  const id = key.split(':').pop() ?? ''
  if (base !== id && base !== props.Id) return base
  const found = NAME_PROPS.map(k => props[k]).find((v): v is string => typeof v === 'string' && v.trim() !== '')
  return found ?? base
}
