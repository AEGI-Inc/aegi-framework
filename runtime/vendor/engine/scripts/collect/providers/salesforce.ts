/**
 * Salesforce 수집 (SF-01 ~ SF-08, SF-90). 접근 판단에 쓰는 객체만 SOQL 조회(GET /query)로 읽는다.
 *
 * 자격증명: CRED-SF-01 Connected App `aegi-collector` (Client Credentials 흐름).
 * 실행 사용자는 읽기 전용 통합 사용자로 둔다. 수집기는 GET 만 보낸다(토큰 교환 제외).
 * 객체 선택 근거: 오브젝트 모델 v1 연구 묶음의 Salesforce 타입 중 접근, 피해 범위 판단에 쓰는 것
 * (aegi-knowledge schema/im-model/model/AEGI_OBJECT_MODEL_V1.md 3절). 상태 값, 현지화, 분석 지표는 v1 에서 뺐다.
 */
import { buildUrl, type CallApi, type CallDef } from '../lib/runner'
import { normalizeSalesforceUrl, oauthRefreshTokenAuth, salesforceClientCredentialsAuth } from '../lib/auth'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import { maxIso, streamStart, type ProviderContext } from './common'
import { maskExternalConfigUrls, summarizeFlowMetadata, summarizeApexDefinitions, summarizeOutboundDefinition } from '../lib/external-definition'

const salesforceAuthCache = new WeakMap<object, Auth>()

/**
 * Salesforce 손코드 호출과 수집 API 목록 호출이 함께 쓰는 인증 선택.
 * SALESFORCE_COLLECTOR_REFRESH_TOKEN 이 있으면 사람 동의형 OAuth(PKCE 등) 갱신 토큰으로, 없으면 Client Credentials 로 받는다.
 * 같은 ctx(creds) 당 하나의 Auth 인스턴스를 공유해 Refresh Token Rotation 시 중복 갱신(invalid_grant)을 막는다.
 */
export function salesforceAuth(ctx: Pick<ProviderContext, 'creds' | 'transport'>): Auth {
  const cached = salesforceAuthCache.get(ctx.creds)
  if (cached) return cached
  const { creds, transport } = ctx
  const instanceUrl = normalizeSalesforceUrl(creds.get('SALESFORCE_INSTANCE_URL') ?? '')
  const created = creds.get('SALESFORCE_COLLECTOR_REFRESH_TOKEN')
    ? oauthRefreshTokenAuth({
        ref: 'CRED-SF-01',
        tokenUrl: `${instanceUrl}/services/oauth2/token`,
        clientId: creds.get('SALESFORCE_COLLECTOR_CLIENT_ID')!,
        clientSecret: creds.get('SALESFORCE_COLLECTOR_CLIENT_SECRET'),
        refreshToken: creds.get('SALESFORCE_COLLECTOR_REFRESH_TOKEN')!,
        transport,
        onRotate: ({ refreshToken }) => creds.set('SALESFORCE_COLLECTOR_REFRESH_TOKEN', refreshToken),
      })
    : salesforceClientCredentialsAuth({ ref: 'CRED-SF-01', instanceUrl, clientId: creds.get('SALESFORCE_COLLECTOR_CLIENT_ID')!, clientSecret: creds.get('SALESFORCE_COLLECTOR_CLIENT_SECRET')!, transport })
  salesforceAuthCache.set(ctx.creds, created)
  return created
}

/** 호출별 SOQL. 필드는 표준 객체 참조의 필드만 쓴다 */
export const SALESFORCE_QUERIES = {
  org: 'SELECT Id, Name, OrganizationType, InstanceName, IsSandbox, CreatedDate FROM Organization',
  users: 'SELECT Id, Username, Email, Name, IsActive, UserType, ProfileId, UserRoleId, LastLoginDate, CreatedDate FROM User',
  profiles: 'SELECT Id, Name, UserType, UserLicenseId, PermissionsModifyAllData, PermissionsViewAllData, PermissionsManageUsers, PermissionsAuthorApex, PermissionsApiEnabled FROM Profile',
  permissionSets: 'SELECT Id, Name, Label, Type, IsOwnedByProfile, ProfileId, IsCustom, PermissionsModifyAllData, PermissionsViewAllData, PermissionsManageUsers, PermissionsAuthorApex, PermissionsApiEnabled FROM PermissionSet',
  permissionSetAssignments: 'SELECT Id, AssigneeId, PermissionSetId, PermissionSetGroupId, ExpirationDate, SystemModstamp FROM PermissionSetAssignment WHERE PermissionSet.IsOwnedByProfile = false',
  roles: 'SELECT Id, Name, DeveloperName, ParentRoleId FROM UserRole',
  groups: "SELECT Id, Name, DeveloperName, Type FROM Group WHERE Type IN ('Regular', 'Queue')",
  groupMembers: 'SELECT Id, GroupId, UserOrGroupId FROM GroupMember',
  connectedApps: 'SELECT Id, Name, OptionsAllowAdminApprovedUsersOnly, CreatedDate FROM ConnectedApplication',
  oauthTokens: 'SELECT Id, AppName, UserId, AppMenuItemId, LastUsedDate, UseCount, CreatedDate FROM OauthToken',
  // 사용자별 등록된 MFA 방식 (V2-R3). 읽는 권한이 없으면 SF-02 가 partial 로 남는다
  twoFactorMethods: 'SELECT Id, UserId, HasBuiltInAuthenticator, HasSalesforceAuthenticator, HasSecurityKey, HasTempCode, HasTotp, HasU2F, HasUserVerifiedEmailAddress, HasUserVerifiedMobileNumber, HasVerifiedMobileNumber FROM TwoFactorMethodsInfo',
  // SAML 로그인 이름. 사용자 목록과 따로 읽어 이 칸을 못 읽어도 사용자 목록은 남는다. Okta Salesforce 앱 배정 username 과 맞춘다
  federationIds: 'SELECT Id, FederationIdentifier FROM User WHERE FederationIdentifier != null',
  // SAML SSO 설정. IdentityMapping 이 Username, FederationId, UserId 중 어느 값으로 로그인시키는지 정한다 (View Setup and Configuration)
  samlSsoConfigs: 'SELECT Id, DeveloperName, Issuer, IdentityMapping, IdentityLocation, LoginUrl FROM SamlSsoConfig',
} as const

/** New Profile routes; these are not inputs to the retired catalog normalizer. */
export const SALESFORCE_EXTERNAL_QUERIES = {
  authProviders: 'SELECT Id, DeveloperName, ProviderType, ConsumerKey, AuthorizeUrl, TokenUrl, UserInfoUrl FROM AuthProvider',
  flowDefinitions: 'SELECT Id, ApiName, Label, IsActive, ActiveVersionId, LatestVersionId FROM FlowDefinitionView',
  namedCredentials: 'SELECT Id, DeveloperName, MasterLabel, Endpoint FROM NamedCredential',
} as const

/** IN 조건 하나에 넣는 부모 id 수 (2026-11-19 실측: 50개까지 확인) */
const PARENT_IDS_PER_QUERY = 50

export function salesforceCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds, transport } = ctx
  const instance = () => normalizeSalesforceUrl(creds.get('SALESFORCE_INSTANCE_URL') ?? '')
  const version = () => config.salesforce?.apiVersion ?? '61.0'
  let auth: Auth | null = null
  const sf = (): Auth => {
    auth ??= salesforceAuth(ctx)
    return auth
  }
  const query = (api: CallApi, soql: string, params: Record<string, unknown> = {}) =>
    api.list({ url: buildUrl(`${instance()}/services/data/v${version()}/query`, { q: soql }), auth: sf(), paginate: { kind: 'salesforce' }, items: b => (Array.isArray(b?.records) ? b.records : []), params: { soql_object: soql.split(/\s+FROM\s+/i)[1]?.split(/\s/)[0], ...params } })

  /**
   * 부모 id 를 조건에 직접 적어야 조회되는 객체. 조건이 없으면 MALFORMED_QUERY "구체적 열에서 필터 필수"이고,
   * 하위 질의(IN (SELECT …))도 같은 오류다. 부모 DurableId 를 받아 묶음으로 IN 에 넣는다 (2026-11-19 실측)
   */
  const queryByParent = async (api: CallApi, child: string, column: string, parent: string) => {
    const parents = await query(api, `SELECT DurableId FROM ${parent}`)
    const ids = [...new Set<string>(parents.map((r: any) => r?.DurableId).filter((id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9._-]+$/.test(id)))]
    for (let i = 0; i < ids.length; i += PARENT_IDS_PER_QUERY) {
      await query(api, `SELECT FIELDS(STANDARD) FROM ${child} WHERE ${column} IN (${ids.slice(i, i + PARENT_IDS_PER_QUERY).map(id => `'${id}'`).join(',')})`, { parent, parent_offset: i })
    }
  }

  const call = (id: string, title: string, run: (api: CallApi) => Promise<void>): CallDef => ({
    id, provider: 'salesforce', title, credential: 'CRED-SF-01',
    unavailable: () => (config.salesforce ? missingCredential(creds, 'CRED-SF-01') : 'not_configured:salesforce'),
    run,
  })

  return [
    call('SF-08', 'Auth Provider 외부 인증 설정', async api => {
      await api.list({ url: buildUrl(`${instance()}/services/data/v${version()}/query`, { q: SALESFORCE_EXTERNAL_QUERIES.authProviders }), auth: sf(), paginate: { kind: 'salesforce' }, items: b => b?.records ?? [], params: { soql_object: 'AuthProvider' }, transform: maskExternalConfigUrls })
    }),
    call('SF-09', 'Flow 정의와 활성 버전 참조', async api => {
      const flows = await query(api, SALESFORCE_EXTERNAL_QUERIES.flowDefinitions)
      for (const id of new Set(flows.map((f: any) => f.ActiveVersionId).filter((id: unknown) => typeof id === 'string' && /^301[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(id)))) {
        const detail = await api.optional(`flow_metadata:${id}`, () => api.get({ url: `${instance()}/services/data/v${version()}/tooling/sobjects/Flow/${encodeURIComponent(String(id))}`, auth: sf(), params: { active_version: id, kind: 'flow_metadata' }, transform: summarizeFlowMetadata }))
        const names = new Set<string>((detail?.flow_definition?.actions ?? []).filter((a: any) => a.action_type === 'apex').map((a: any) => a.action_name))
        for (const name of names) {
          // Namespaced and dynamic references require explicit resolution; never interpolate arbitrary SOQL.
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { api.partial(`apex_reference_unresolved:${id}`); continue }
          await api.optional(`apex_definition:${id}:${name}`, () => api.list({ url: buildUrl(`${instance()}/services/data/v${version()}/tooling/query`, { q: `SELECT Id,Name,NamespacePrefix,Body FROM ApexClass WHERE Name = '${name}' AND NamespacePrefix = null` }), auth: sf(), paginate: { kind: 'salesforce' }, items: b => b?.records ?? [], params: { active_version: id, kind: 'flow_apex_definition', action_name: name }, transform: summarizeApexDefinitions }))
        }
        const outbound = new Set<string>((detail?.flow_definition?.actions ?? []).filter((a: any) => a.action_type === 'outboundMessage').map((a: any) => a.action_name))
        for (const name of outbound) {
          const parts = name.match(/^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/)
          if (!parts) { api.partial(`outbound_reference_unresolved:${id}`); continue }
          await api.optional(`outbound_definition:${id}:${name}`, async () => {
            // Name is a label, not necessarily the developer name in the Flow action.
            // Resolve FullName from bounded metadata reads instead of guessing from labels.
            const candidates = await api.list({ url: buildUrl(`${instance()}/services/data/v${version()}/tooling/query`, { q: 'SELECT Id,Name FROM WorkflowOutboundMessage WHERE NamespacePrefix = null' }), auth: sf(), paginate: { kind: 'salesforce' }, maxPages: 2, items: b => b?.records ?? [], params: { active_version: id, kind: 'flow_outbound_lookup', action_name: name } })
            if (candidates.length > 200) api.partial('outbound_candidate_limit:200')
            let matched = false
            for (const candidate of candidates.slice(0, 200)) {
              if (typeof candidate.Id !== 'string' || !/^[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?$/.test(candidate.Id)) continue
              const result = await api.get({ url: `${instance()}/services/data/v${version()}/tooling/sobjects/WorkflowOutboundMessage/${candidate.Id}`, auth: sf(), params: { active_version: id, kind: 'flow_outbound_definition', action_name: name }, transform: body => summarizeOutboundDefinition(body, name) })
              matched ||= result?.matched === true
            }
            if (!matched) api.partial(`outbound_definition_unresolved:${id}`)
          })
        }
      }
    }),
    call('SF-11', '앱별 탭 구성', api => queryByParent(api, 'AppTabMember', 'AppDefinitionId', 'AppDefinition')),
    call('SF-12', 'Flow 버전', api => queryByParent(api, 'FlowVersionView', 'FlowDefinitionViewId', 'FlowDefinitionView')),
    call('SF-10', 'Named Credential 외부 목적지', async api => {
      await api.list({ url: buildUrl(`${instance()}/services/data/v${version()}/tooling/query`, { q: SALESFORCE_EXTERNAL_QUERIES.namedCredentials }), auth: sf(), paginate: { kind: 'salesforce' }, items: b => b?.records ?? [], params: { soql_object: 'NamedCredential' }, transform: maskExternalConfigUrls })
    }),
    call('SF-01', '조직과 SAML SSO 설정', async api => {
      await query(api, SALESFORCE_QUERIES.org)
      await api.optional('saml_sso_configs', () => query(api, SALESFORCE_QUERIES.samlSsoConfigs))
    }),
    // 기준별 설정 판정(scripts/standards)이 읽는 호출. 두 번째 파일이 항목별 위험 등급이다
    call('SFS-01', 'Health Check 점수와 항목별 위험 등급 (Tooling API)', async api => {
      const tooling = (soql: string, params: Record<string, unknown>) =>
        api.list({ url: buildUrl(`${instance()}/services/data/v${version()}/tooling/query`, { q: soql }), auth: sf(), paginate: { kind: 'salesforce' }, items: b => (Array.isArray(b?.records) ? b.records : []), params })
      await tooling('SELECT Score FROM SecurityHealthCheck', { part: 'score' })
      await tooling('SELECT DurableId, RiskType, Setting, SettingGroup, SettingRiskCategory, OrgValue, StandardValue FROM SecurityHealthCheckRisks', { part: 'risks' })
    }),
    call('SF-02', '사용자, SAML 로그인 이름, MFA 방식', async api => {
      await query(api, SALESFORCE_QUERIES.users)
      await api.optional('federation_ids', () => query(api, SALESFORCE_QUERIES.federationIds, { part: 'federation_id' }))
      await api.optional('two_factor_methods', () => query(api, SALESFORCE_QUERIES.twoFactorMethods))
    }),
    call('SF-03', '프로필', async api => { await query(api, SALESFORCE_QUERIES.profiles) }),
    call('SF-04', '권한 집합과 배정', async api => {
      await query(api, SALESFORCE_QUERIES.permissionSets)
      await query(api, SALESFORCE_QUERIES.permissionSetAssignments)
    }),
    call('SF-05', '역할 계층', async api => { await query(api, SALESFORCE_QUERIES.roles) }),
    call('SF-06', '공개 그룹, 큐와 회원', async api => {
      await query(api, SALESFORCE_QUERIES.groups)
      await query(api, SALESFORCE_QUERIES.groupMembers)
    }),
    // ConnectedApplication 은 관리자 권한이 없으면 막힌다. 사용자 승인(OauthToken)은 따로 시도한다
    call('SF-07', 'Connected App 과 사용자 OAuth 승인', async api => {
      await api.optional('connected_apps', () => query(api, SALESFORCE_QUERIES.connectedApps))
      await query(api, SALESFORCE_QUERIES.oauthTokens)
    }),
    call('SF-90', '설정 감사 기록', async api => {
      const stream = 'salesforce.setup_audit_trail'
      const days = config.salesforce?.auditDays ?? 180
      const floor = new Date(Date.parse(api.period.until) - days * 86_400_000).toISOString()
      const since = [streamStart(api, stream, config.since), floor].sort().pop()!
      const rows = await query(api, `SELECT Id, Action, Section, Display, CreatedDate, CreatedById, DelegateUser FROM SetupAuditTrail WHERE CreatedDate >= ${since.replace(/\.\d{3}Z$/, 'Z')} ORDER BY CreatedDate`, { since })
      api.setCursor(stream, { cursor: null, last_event_at: maxIso(rows.map((r: any) => r.CreatedDate)) ?? api.cursor(stream)?.last_event_at ?? null })
    }),
  ]
}
