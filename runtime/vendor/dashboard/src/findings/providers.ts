import type { Provider } from '../model/object'
import type { ProviderId } from '../providerOverviewData'

/**
 * Finding의 providerSet에 들어가는 Provider 코드를 화면 표기로 옮긴다.
 *
 * 로고 컴포넌트가 쓰는 ProviderId와 Finding 데이터의 Provider가 'gws' /
 * 'google-workspace'처럼 한 군데서만 어긋나 있어서, 화면마다 삼항식으로
 * 따로 처리하고 있었다. 한 곳에 모아 둔다.
 */
const LOGO_IDS: Partial<Record<Provider, ProviderId>> = {
  gws: 'google-workspace',
  microsoft: 'microsoft-365',
}

const NAMES: Record<Provider, string> = {
  okta: 'Okta',
  github: 'GitHub',
  slack: 'Slack',
  gws: 'Google Workspace',
  atlassian: 'Atlassian',
  salesforce: 'Salesforce',
  aws: 'AWS',
  cloudflare: 'Cloudflare',
  microsoft: 'Microsoft 365',
  gcp: 'Google Cloud',
  onepassword: '1Password',
  snowflake: 'Snowflake',
}

export function providerLogoId(provider: Provider | string): ProviderId {
  return LOGO_IDS[provider as Provider] ?? (provider as ProviderId)
}

/** service(canonical.service) 표시 이름. 조직 단계의 service 원이 쓴다. 표에 없는 service 는 값 그대로 보이고 SaaS 로고를 쓴다 */
const SERVICE_NAMES: Record<string, string> = {
  'gcp:discoveryengine': 'Discovery Engine',
  'gcp:iam': 'IAM',
  'gcp:cloudresourcemanager': 'Resource Manager',
  'atlassian:jira': 'Jira',
  'atlassian:confluence': 'Confluence',
  'gws:drive': 'Google Drive',
  'gws:admin': 'Admin',
}
/**
 * 같은 service 를 여러 제품이 쓸 때 제품 이름과 로고를 가르는 규칙. 그 원에 든 type 객체가 하나 이상이고 모두 property 값이 value 일 때만 맞는다.
 * Discovery Engine API 는 Gemini Enterprise 말고 Vertex AI Search 등도 쓴다. Discovery 문서 Engine.appType
 * 「APP_TYPE_INTRANET: App type for intranet search and Agentspace」(Agentspace 는 Gemini Enterprise 의 옛 이름)로 가른다
 */
const SERVICE_PRODUCTS: Record<string, { type: string; property: string; value: string; name: string; logo: ProviderId }> = {
  'gcp:discoveryengine': { type: 'Engine', property: 'appType', value: 'APP_TYPE_INTRANET', name: 'Gemini Enterprise', logo: 'gemini' },
}

/** service 원의 이름과 로고. members 는 그 원에 든 객체의 종류와 속성 */
export function serviceDisplay(provider: Provider | string, service: string, members: Iterable<{ object_type: string; properties?: Record<string, unknown> }>): { name: string; logo?: ProviderId } {
  const key = `${provider}:${service}`
  const product = SERVICE_PRODUCTS[key]
  if (product) {
    const marks = [...members].filter(m => m.object_type === product.type)
    if (marks.length && marks.every(m => m.properties?.[product.property] === product.value)) return { name: product.name, logo: product.logo }
  }
  return { name: SERVICE_NAMES[key] ?? service }
}

export function providerName(provider: Provider | string): string {
  return NAMES[provider as Provider] ?? provider
}

/** 처음부터 연동한 네 SaaS. 그래프 SaaS 요약은 데이터가 없어도 이 네 자리는 늘 둔다 */
export const BASE_PROVIDERS: readonly Provider[] = ['slack', 'github', 'okta', 'gws']

/** AEGI가 수집·연결을 지원하는 SaaS 목록 (#adapters SaaS 연결 카드 기본 목록) */
export const SUPPORTED_PROVIDERS: readonly Provider[] = ['slack', 'github', 'okta', 'gws', 'atlassian', 'salesforce']

/**
 * 지식 그래프에는 존재하지만 자체 감사 로그를 남기는 SaaS가 아닌 내부·중계 식별자.
 * WorkerScript(worker)는 Slack 봇·웹훅 등을 중계하는 Cloudflare 시나리오 봇 객체로,
 * 감사 로그 SaaS 목록, 타임라인 레인/필터 칩, 수집 정상 집계에서 제외한다.
 */
export const NON_SAAS_PROVIDERS: ReadonlySet<string> = new Set(['worker'])

export function isSaaSProvider(provider: string | null | undefined): provider is Provider {
  return Boolean(provider) && !NON_SAAS_PROVIDERS.has(provider!)
}

/** 화면에 늘어놓는 SaaS 순서: 기본 네 SaaS, 그 뒤에 새로 들어온 SaaS 이름순 (비-SaaS 제외) */
export function sortProviders(providers: Iterable<string>): Provider[] {
  const rank = (provider: string) => {
    const index = BASE_PROVIDERS.indexOf(provider as Provider)
    return index < 0 ? BASE_PROVIDERS.length : index
  }
  return [...new Set(providers)]
    .filter(isSaaSProvider)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)) as Provider[]
}

/** 그림 로고가 있는 SaaS. 나머지는 이름 글자로 그린다(ProviderLogo). 로고를 더하면 여기에도 더한다 */
export const PROVIDERS_WITH_LOGO: ReadonlySet<string> = new Set(['okta', 'slack', 'github', 'gws', 'atlassian', 'salesforce', 'gcp', 'microsoft', 'onepassword', 'snowflake'])
