/**
 * 규격 대비 수집 범위 — SaaS 하나를 연결했을 때 「무엇을 알고, 무엇을 모르는지」를 종류 단위로 보인다.
 *
 * 규격의 오브젝트 종류(src/objectCatalog.ts, 318개)마다 판정한다.
 * - collected  수집, 정규화하고 객체가 있다
 * - absorbed   다른 객체의 속성, 관계로 받는다 (Gmail 자동 전달 → 사용자 속성)
 * - basic      존재 확인으로 받아 기본 정보(이름, 겉값)만 객체로 둔다. 관계와 권한은 해석하지 않는다
 * - empty      수집, 정규화하는데 이 테넌트에는 0개다 (호출이 끝까지 돌았다)
 * - blocked    수집 호출이 권한, 설정 때문에 실패하거나 일부만 받았다 — 0개라고 말할 수 없다
 * - not_collected  수집하지 않는다 (수집 호출이나 정규화가 없다) — 이 종류가 있어도 보이지 않는다
 * - no_api     규격에 API 출처가 없다 (NOT_IN_SOURCE)
 *
 * 수집 안 하는 종류는 위험이 큰 인터페이스(연동, 엔드포인트, 자동화, 자격증명)부터 보인다.
 */
import { objectCatalog, type CatalogObject, type ObjectInterface } from '../../../src/objectCatalog'
import { CATALOG as NORMALIZED } from '../shared/dataset'
import { readProbeReasons, type ProbeResult } from '../providers/probes'

export type CoverageStatus = 'collected' | 'absorbed' | 'basic' | 'empty' | 'blocked' | 'not_collected' | 'no_api'

export type CollectorProvider = 'github' | 'okta' | 'slack' | 'gws'

export const PROVIDER_OF: Record<CatalogObject['provider'], CollectorProvider | undefined> = {
  GitHub: 'github', Okta: 'okta', Slack: 'slack', 'Google Workspace': 'gws', n8n: undefined, AWS: undefined, Atlassian: undefined,
}

/** 정규화가 만드는 종류마다 그 객체를 받는 수집 호출. 객체가 0개일 때도 어느 호출이 봤는지 알기 위한 표다 */
export const TYPE_CALLS: Record<string, string[]> = {
  'github|Enterprise': ['GH-23'], 'github|Organization': ['GH-01'], 'github|User Account': ['GH-02', 'GH-03'], 'github|Repository': ['GH-05'],
  'github|Team': ['GH-04'], 'github|Organization Custom Repository Role': ['GH-07'], 'github|GitHub App Installation Registration': ['GH-14'],
  'github|Organization Programmatic Access Grant': ['GH-13'], 'github|Credential Authorization': ['GH-22'], 'github|ExternalIdentity': ['GH-20'],
  'github|Repository ruleset': ['GH-08'], 'github|Branch Protection Rule': ['GH-09'], 'github|Workflow': ['GH-10'], 'github|Webhook': ['GH-15'],
  'github|Commit': ['GH-11'], 'github|Pull Request': ['GH-12'],
  'github|Environment': ['GH-24'], 'github|Actions Secret': ['GH-25'], 'github|Organization Actions Secret': ['GH-25'], 'github|Dependabot Secret': ['GH-25'],
  'github|Organization Dependabot Secret': ['GH-25'], 'github|Deploy Key': ['GH-26'], 'github|Organization Role': ['GH-27'], 'github|ExternalGroup': ['GH-28'],
  'github|Organization Invitation': ['GH-29'], 'github|Deployment branch policy': ['GH-30'], 'github|Deployment protection rule (custom/app)': ['GH-30'],
  'github|IpAllowListEntry': ['GH-31'], 'github|OrganizationIdentityProvider': ['GH-31'], 'github|VerifiableDomain': ['GH-31'],
  'github|Runner Group': ['GH-32'], 'github|Self hosted runners': ['GH-32'], 'github|Package': ['GH-33'],
  'okta|org': ['OK-01'], 'okta|User': ['OK-02'], 'okta|Group': ['OK-03'], 'okta|UserFactor': ['OK-04'], 'okta|IamRole': ['OK-05'], 'okta|ResourceSet': ['OK-05'],
  'okta|Application': ['OK-07'], 'okta|AppUser': ['OK-07'], 'okta|ApplicationGroupAssignment': ['OK-07'], 'okta|OAuth2Client': ['OK-08'],
  'okta|OAuth2RefreshToken': ['OK-09'], 'okta|GroupRule': ['OK-11'], 'okta|Policy': ['OK-10'], 'okta|PolicyRule': ['OK-10'],
  'okta|APIServiceIntegrationInstance': ['OK-15'], 'okta|APIServiceIntegrationInstanceSecret': ['OK-15'],
  'okta|ApiToken': ['OK-16'],
  'okta|EventHook': ['OK-17'], 'okta|InlineHook': ['OK-17'], 'okta|LogStream': ['OK-17'],
  'okta|IdentityProvider': ['OK-18'],
  'okta|ProfileMapping': ['OK-19'], 'okta|IdPKeyCredential': ['OK-20'], 'okta|SecurityEventsProvider': ['OK-21'], 'okta|SsfStream': ['OK-21'], 'okta|EmailServer': ['OK-21'], 'okta|AuthenticatorBase': ['OK-22'], 'okta|TrustedOrigin': ['OK-22'], 'okta|device-assurances': ['OK-22'], 'okta|zones': ['OK-22'], 'okta|AgentPool': ['OK-23'],
  'slack|enterprise': ['SL-00'], 'slack|workspace': ['SL-00'], 'slack|user': ['SL-01', 'SL-02'], 'slack|bot': ['SL-07'], 'slack|bot-token': ['SL-10'],
  'slack|conversation': ['SL-03'], 'slack|usergroup': ['SL-06'], 'slack|Message': ['SL-05'], 'slack|Slack App Installation Registration': ['SL-07', 'SL-08', 'SL-10'],
  'slack|Slash Command Request Endpoint': ['SL-10'], 'slack|incoming-webhook': ['SL-09', 'D-21'],
  'slack|workflow': ['SL-17'], 'slack|workflow-collaborator': ['SL-17'], 'slack|barrier': ['SL-18'],
  'gws|Customer': ['GW-01'], 'gws|User': ['GW-03'], 'gws|Group': ['GW-04'], 'gws|Member': ['GW-04'], 'gws|Role': ['GW-06'], 'gws|RoleAssignment': ['GW-06'],
  'gws|Token': ['GW-05'], 'gws|Delegate': ['GW-15'], 'gws|File': ['GW-07'], 'gws|Permission': ['GW-07'], 'gws|Form': ['GW-08'], 'gws|Project': ['GW-09', 'GW-16'],
  'gws|InboundSamlSsoProfile': ['GW-17'], 'gws|InboundOidcSsoProfile': ['GW-17'], 'gws|IdpCredential': ['GW-17'], 'gws|InboundSsoAssignment': ['GW-17'],
  'gws|Asp': ['GW-18'], 'gws|Drive': ['GW-19'], 'gws|OrgUnit': ['GW-20'],
  'gws|AclRule': ['GW-22'], 'gws|AllowlistedDomain': ['GW-23'], 'gws|Policy': ['GW-24'],
}

/**
 * 따로 객체로 만들지 않고 다른 객체의 속성, 관계로 받는 종류. 수집은 하므로 빈칸으로 세지 않는다.
 * 호출이 끝까지 돌았으면 absorbed, 아니면 blocked.
 */
export const ABSORBED: Record<string, { calls: string[]; as: string }> = {
  'gws|AutoForwarding': { calls: ['GW-15'], as: 'GWS 사용자 속성 gmail_forwarding' },
  'gws|ForwardingAddress': { calls: ['GW-15'], as: 'GWS 사용자 속성 gmail_forwarding' },
  'gws|Domains': { calls: ['GW-02'], as: '도메인 목록 (테넌트 도메인 판단)' },
  'gws|Membership': { calls: ['GW-04'], as: 'GWS 그룹 멤버(Member)' },
  'slack|Conversation Membership Assignment': { calls: ['SL-04'], as: '채널 member_of 관계' },
  'slack|Workspace Membership Assignment': { calls: ['SL-01', 'SL-02'], as: '워크스페이스 member_of 관계' },
  'slack|Workspace Admin Assignment': { calls: ['SL-01'], as: 'Slack 사용자 관리자 표시' },
  'slack|Workspace Owner Assignment': { calls: ['SL-01'], as: 'Slack 사용자 소유자 표시' },
  'slack|Org Admin Assignment': { calls: ['SL-01'], as: 'Slack 사용자 관리자 표시' },
  'slack|Org Owner Assignment': { calls: ['SL-01'], as: 'Slack 사용자 소유자 표시' },
  'slack|role-assignment': { calls: ['SL-16'], as: 'Slack 관리 역할 has_role_on 관계' },
  'slack|role': { calls: ['SL-16'], as: 'Slack 관리 역할 배정의 이름 역할(role_id)' },
  'slack|function': { calls: ['SL-17'], as: 'Slack 워크플로 속성 functions' },
  'slack|workflow-step': { calls: ['SL-17'], as: 'Slack 워크플로 속성 steps' },
  'gws|Groups': { calls: ['GW-21'], as: 'GWS 그룹 속성 settings' },
  'github|Installation': { calls: ['GH-14'], as: 'GitHub App 설치(연동) 객체' },
  'okta|GroupPushMapping': { calls: ['OK-13'], as: 'Identity Link 의 그룹 대응' },
  'okta|Permission': { calls: ['OK-05'], as: '사용자 정의 역할(IamRole)의 권한 목록' },
  'okta|AuthenticatorEnrollment': { calls: ['OK-04'], as: '사용자 인증 수단(UserFactor)' },
  'okta|OAuth2 Client Registration': { calls: ['OK-08'], as: 'OAuth 클라이언트(OAuth2Client)' },
}

/** 수집 안 할 때 위험이 큰 순서 */
export const INTERFACE_PRIORITY: ObjectInterface[] = ['Integration', 'Endpoint', 'Automation', 'Credential', 'Assignment', 'Policy', 'Principal', 'Tenant', 'Resource']

export interface CallState {
  call_id: string
  completeness: 'full' | 'partial' | 'failed' | 'skipped' | string
  reasons?: string[]
}

export interface TypeCoverage {
  catalogId: string
  provider: CollectorProvider
  name: string
  interfaces: ObjectInterface[]
  domain: string
  status: CoverageStatus
  count: number
  calls: Array<{ call_id: string; completeness: string; reasons: string[] }>
  /** 다른 객체의 속성, 관계로 받을 때 어디에 담는지 */
  absorbedAs?: string
  /** 정규화 키 (provider|object_type). 수집하지 않는 종류는 없다 */
  normalizedAs?: string
  /** 존재 확인(XX-90) 결과: 수집하지 않는 종류가 이 테넌트에 있는지 */
  probe?: ProbeResult
}

export interface ProviderCoverage {
  provider: CollectorProvider
  tenant?: string
  catalogTypes: number
  counts: Record<CoverageStatus, number>
  objects: number
  byInterface: Record<string, { types: number; collected: number; objects: number }>
  types: TypeCoverage[]
}

const priority = (t: { interfaces: ObjectInterface[] }) => Math.min(...t.interfaces.map(i => (INTERFACE_PRIORITY.indexOf(i) + 1) || 99))

export function catalogCoverage(objects: Array<{ fixture_key: string; catalog_ref?: { id?: string }; canonical: { provider: string; object_type: string; interfaces: string[]; properties: Record<string, unknown> }; fixture_meta?: { display_name?: string } }>, calls: CallState[]): ProviderCoverage[] {
  const callState = new Map(calls.map(c => [c.call_id, c]))
  const PROBE_CALL: Record<CollectorProvider, string> = { okta: 'OK-90', github: 'GH-90', slack: 'SL-90', gws: 'GW-90' }
  const probesOf = (provider: CollectorProvider) => readProbeReasons(callState.get(PROBE_CALL[provider])?.reasons ?? [])
  const countByCatalog = new Map<string, number>()
  for (const o of objects) {
    const id = o.catalog_ref?.id
    if (id) countByCatalog.set(id, (countByCatalog.get(id) ?? 0) + 1)
  }
  const normalizedByCatalog = new Map(Object.entries(NORMALIZED).map(([key, v]) => [v.id, key]))
  const out: ProviderCoverage[] = []
  for (const provider of ['okta', 'gws', 'slack', 'github'] as CollectorProvider[]) {
    const types: TypeCoverage[] = []
    for (const c of objectCatalog.filter(x => PROVIDER_OF[x.provider] === provider)) {
      const normalizedAs = normalizedByCatalog.get(c.id)
      const absorbed = !normalizedAs ? ABSORBED[`${provider}|${c.name}`] : undefined
      const count = countByCatalog.get(c.id) ?? 0
      const callIds = normalizedAs ? TYPE_CALLS[normalizedAs] ?? [] : absorbed?.calls ?? []
      const states = callIds.map(id => ({ call_id: id, completeness: callState.get(id)?.completeness ?? 'not_run', reasons: callState.get(id)?.reasons ?? [] }))
      let status: CoverageStatus
      if (absorbed) status = states.every(s => s.completeness === 'full' || s.completeness === 'partial') ? 'absorbed' : 'blocked'
      // 존재 확인으로 받아 기본 정보만 담은 객체가 있으면 「있다」는 안다 (관계, 권한은 해석하지 않음)
      else if (!normalizedAs && count > 0) status = 'basic'
      else if (!normalizedAs) status = c.domain.startsWith('NOT_IN_SOURCE') ? 'no_api' : 'not_collected'
      else if (count > 0) status = 'collected'
      else status = states.length && states.every(s => s.completeness === 'full') ? 'empty' : 'blocked'
      const probe = status === 'not_collected' || status === 'no_api' || status === 'basic' ? probesOf(provider).find(p => p.catalogName === c.name) : undefined
      types.push({ catalogId: c.id, provider, name: c.name, interfaces: c.interfaces, domain: c.domain, status, count, calls: states, normalizedAs, absorbedAs: absorbed?.as, probe })
    }
    // 정규화 표에는 있는데 규격 목록에 없는 확장 종류 (예: 슬래시 명령 엔드포인트 gap 항목)
    for (const [key, v] of Object.entries(NORMALIZED)) {
      if (!key.startsWith(`${provider}|`) || types.some(t => t.catalogId === v.id)) continue
      const count = countByCatalog.get(v.id) ?? 0
      const states = (TYPE_CALLS[key] ?? []).map(id => ({ call_id: id, completeness: callState.get(id)?.completeness ?? 'not_run', reasons: callState.get(id)?.reasons ?? [] }))
      types.push({ catalogId: v.id, provider, name: key.split('|')[1], interfaces: v.interfaces as ObjectInterface[], domain: '확장 (규격 목록 밖)', status: count ? 'collected' : states.every(s => s.completeness === 'full') ? 'empty' : 'blocked', count, calls: states, normalizedAs: key })
    }
    types.sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name))
    const counts = { collected: 0, absorbed: 0, basic: 0, empty: 0, blocked: 0, not_collected: 0, no_api: 0 } as Record<CoverageStatus, number>
    for (const t of types) counts[t.status]++
    const byInterface: ProviderCoverage['byInterface'] = {}
    for (const t of types) for (const i of t.interfaces) {
      const row = (byInterface[i] ??= { types: 0, collected: 0, objects: 0 })
      row.types++
      if (t.status === 'collected' || t.status === 'absorbed' || t.status === 'basic' || t.status === 'empty') row.collected++
      row.objects += t.count
    }
    const tenant = objects.find(o => o.canonical.provider === provider && o.canonical.interfaces.includes('Tenant'))
    out.push({
      provider,
      tenant: tenant ? String(tenant.fixture_meta?.display_name ?? tenant.canonical.properties.name ?? tenant.fixture_key) : undefined,
      catalogTypes: types.length,
      counts,
      objects: objects.filter(o => o.canonical.provider === provider).length,
      byInterface,
      types,
    })
  }
  return out
}
