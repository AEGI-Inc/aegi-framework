/**
 * 자동 생성 파일이다. 손으로 고치지 않는다.
 * 원본: AEGI-Inc/aegi-knowledge schema/ontology/ @ 44173fc (사본은 aegi-adapter-engine ontology/)
 * 다시 만들기: aegi-adapter-engine 에서 npm run ontology:gen 뒤 src/ontology/generated.ts 를 이 파일로 복사한다
 */
import type { CoverageFamily } from '../detection/v2/engine/accessModel'

export const ONTOLOGY_SOURCE = { repo: 'AEGI-Inc/aegi-knowledge', commit: '44173fca0a5753f29ce3264fdc70308af26a008d', path: 'schema/ontology/' } as const

// ---- 개념 타입, 관계 타입 (interfaces.yaml, relation_types.yaml)

export const INTERFACE_TYPES = ['Tenant', 'Principal', 'Integration', 'Credential', 'Assignment', 'Policy', 'Endpoint', 'Resource', 'Automation'] as const
export type InterfaceType =
  | 'Tenant'
  | 'Principal'
  | 'Integration'
  | 'Credential'
  | 'Assignment'
  | 'Policy'
  | 'Endpoint'
  | 'Resource'
  | 'Automation'

/** 행(judged)에서 판정하는 계약 필드와 허용값. null 은 값 형식만 본다(ISO 시각) */
export const INTERFACE_CONTRACT_VALUES: Record<string, readonly string[] | null> = {
  principal_kind: ['human', 'service', 'group', 'unknown'],
  operational_state: ['active', 'suspended', 'inactive', 'unknown'],
  material_location: ['tenant_side', 'counterparty_side', 'both', 'third_party', 'none'],
  endpoint_owner: ['provider_hosted', 'customer_hosted', 'third_party_hosted'],
  blocking: ['none', 'blocking_fail_open', 'blocking_fail_closed'],
  run_as_resolution: ['static_principal', 'caller', 'platform_superuser', 'per_step', 'unknown'],
  direction: ['in', 'out', 'both'],
  credential_kind: ['bearer_token', 'bearer_url', 'key_pair', 'certificate', 'federation'],
  expires_at: null,
  account_kind: ['human', 'app', 'system', 'unknown'],
  activation: ['standing', 'session'],
  origin: ['platform_builtin', 'platform_default', 'tenant_custom'],
  assignment_count: null,
}

export const RELATION_TYPES = ['has_role_on', 'permits', 'member_of', 'owned_by', 'registered_in', 'registered_by', 'acts_as', 'authenticates_with', 'runs_as', 'triggered_by', 'receives_into', 'shared_with', 'applies_to', 'excludes', 'evaluates', 'trusts', 'contained_in'] as const
export type RelationType =
  | 'has_role_on'
  | 'permits'
  | 'member_of'
  | 'owned_by'
  | 'registered_in'
  | 'registered_by'
  | 'acts_as'
  | 'authenticates_with'
  | 'runs_as'
  | 'triggered_by'
  | 'receives_into'
  | 'shared_with'
  | 'applies_to'
  | 'excludes'
  | 'evaluates'
  | 'trusts'
  | 'contained_in'

// ---- 간선 종류 (effects.yaml)

export const EDGE_KINDS = ['M', 'U', 'G', 'T', 'A', 'F', 'E'] as const
export type EdgeKind =
  | 'M'
  | 'U'
  | 'G'
  | 'T'
  | 'A'
  | 'F'
  | 'E'
export const NATIVE_EDGE_KINDS: readonly EdgeKind[] = ['M', 'U', 'G']

// ---- 능력 (capabilities.yaml)

export const RANK = { read: 1, write: 3, admin: 5 } as const
export const ROLE_RANK: Record<string, number> = {
  none: 0,
  read: 1,
  pull: 1,
  triage: 2,
  write: 3,
  push: 3,
  maintain: 4,
  admin: 5,
  reader: 1,
  commenter: 1,
  writer: 3,
  fileorganizer: 4,
  organizer: 4,
  owner: 5,
  read_only_admin: 1,
}
export const OKTA_STANDARD_ROLES: Record<string, { rank: number; applies_to?: string[] }> = {
  super_admin: { rank: 5 },
  org_admin: { rank: 5 },
  app_admin: { rank: 3, applies_to: ['application'] },
  user_admin: { rank: 3, applies_to: ['user', 'userfactor', 'group'] },
  group_membership_admin: { rank: 3, applies_to: ['group'] },
  help_desk_admin: { rank: 3, applies_to: ['user', 'userfactor'] },
  mobile_admin: { rank: 3, applies_to: ['device'] },
  api_access_management_admin: { rank: 3, applies_to: ['authorizationserver'] },
  read_only_admin: { rank: 1 },
  report_admin: { rank: 1, applies_to: ['log'] },
  workflows_admin: { rank: 5, applies_to: ['workflow'] },
}
export const OKTA_PERMISSION_TYPES: Array<[string, string[]]> = [
  ['okta.users.', ['user', 'userfactor']],
  ['okta.groups.', ['group']],
  ['okta.apps.', ['application']],
  ['okta.authzServers.', ['authorizationserver']],
  ['okta.devices.', ['device']],
]
/** 이름 없는 역할 객체의 scope → 세기. 맞는 줄 가운데 가장 센 rank, 하나도 안 맞으면 0 */
export const SCOPE_RANK: Record<string, Array<{ match: string; rank: number }>> = {
  slack: [
    { match: '^admin', rank: 5 },
    { match: '^chat:write(\\.public)?$', rank: 3 },
    { match: '^(channels|groups|im|mpim):(history|read)$', rank: 1 },
  ],
}
/** 토큰 객체에서 scope 목록을 읽는 칸. 위에서부터 처음 값이 있는 칸 */
export const TOKEN_SCOPE_FROM: readonly string[] = ['properties.scopes', 'properties.scope']
/** 토큰 scope → 무엇에(자원 마디 → 객체 종류) 무엇을(능력 마디 → 세기). grammar 의 첫 묶음이 자원 마디, 둘째 묶음이 능력 마디. through 는 scope 를 쓰는 G 간선을 낸 관계의 도착 interface */
export const TOKEN_SCOPES: Record<string, { grammar: string; identity?: string; abilities: Record<string, number>; through?: string[]; resources: Record<string, { object_types: string[]; ranks?: Record<string, number> }> }> = { okta: { grammar: '^okta\\.([A-Za-z]+(?:\\.[A-Za-z]+)*?)\\.(read|manage|register)$', identity: '^(openid|profile|email|address|phone|groups|offline_access|online_access|device_sso|okta\\.internal\\..+|okta\\.[A-Za-z]+\\.(read|manage)\\.self|okta\\.(myAccount|personal|enduser)\\..+)$', abilities: { read: 1, manage: 3, register: 3 }, through: ['Tenant'], resources: { users: { object_types: ['User', 'UserFactor'] }, groups: { object_types: ['Group', 'GroupRule'] }, apps: { object_types: ['Application', 'AppUser', 'ApplicationGroupAssignment'] }, clients: { object_types: ['OAuth2Client'] }, appGrants: { object_types: ['OAuth2ScopeConsentGrant'] }, authorizationServers: { object_types: ['AuthorizationServer', 'OAuth2Scope', 'OAuth2Claim'] }, eventHooks: { object_types: ['EventHook'] }, devices: { object_types: ['DeviceWithProviders'] }, apiTokens: { object_types: ['ApiToken'] }, roles: { object_types: [], ranks: { manage: 5 } }, orgs: { object_types: [] }, logs: { object_types: [] }, schemas: { object_types: [] }, policies: { object_types: [] }, authenticators: { object_types: [] }, idps: { object_types: [] }, inlineHooks: { object_types: [] }, logStreams: { object_types: [] }, networkZones: { object_types: [] }, trustedOrigins: { object_types: [] }, profileMappings: { object_types: [] }, userTypes: { object_types: [] }, linkedObjects: { object_types: [] }, brands: { object_types: [] }, templates: { object_types: [] }, domains: { object_types: [] }, emailDomains: { object_types: [] }, emailServers: { object_types: [] }, behaviors: { object_types: [] }, threatInsights: { object_types: [] }, captchas: { object_types: [] }, agentPools: { object_types: [] }, pushProviders: { object_types: [] }, deviceAssurance: { object_types: [] }, devicePostureChecks: { object_types: [] }, oauthIntegrations: { object_types: [] }, uischemas: { object_types: [] }, principalRateLimits: { object_types: [] }, rateLimits: { object_types: [] }, securityEventsProviders: { object_types: [] }, customTelephonyProvider: { object_types: [] }, sessions: { object_types: [] } } }, gws: { grammar: '^https://www\\.googleapis\\.com/auth/([A-Za-z0-9._-]+?)(\\.readonly|)$', identity: '^(openid|profile|email|https://www\\.google\\.com/accounts/OAuthLogin|https://www\\.googleapis\\.com/auth/(userinfo\\.email|userinfo\\.profile|script\\.locale|script\\.container\\.ui|workspace\\.linkpreview))$', abilities: { '': 3, '.readonly': 1 }, through: ['Tenant'], resources: { drive: { object_types: ['Drive', 'File'] }, 'drive.activity': { object_types: ['Drive', 'File'] }, activity: { object_types: ['Drive', 'File'], ranks: { '': 1 } }, spreadsheets: { object_types: ['File'] }, 'spreadsheets.currentonly': { object_types: ['File'] }, 'admin.directory.orgunit': { object_types: ['OrgUnit'] }, 'admin.directory.user': { object_types: ['User'], ranks: { '': 5 } }, 'admin.directory.user.alias': { object_types: ['User'] }, 'admin.directory.user.security': { object_types: ['User', 'Token', 'Asp'] }, 'admin.directory.rolemanagement': { object_types: ['Role', 'RoleAssignment'], ranks: { '': 5 } }, 'admin.directory.group': { object_types: ['Group', 'Member'] }, 'admin.directory.group.member': { object_types: ['Group', 'Member'] }, 'admin.directory.device.mobile': { object_types: ['GoogleAppsCloudidentityDevicesV1Device', 'GoogleAppsCloudidentityDevicesV1DeviceUser'] }, 'admin.directory.device.mobile.action': { object_types: ['GoogleAppsCloudidentityDevicesV1Device', 'GoogleAppsCloudidentityDevicesV1DeviceUser'] }, 'admin.directory.device.chromeos': { object_types: ['ChromeOsDevice'] }, 'admin.directory.domain': { object_types: ['Domains'] }, 'admin.directory.customer': { object_types: ['Customer'] }, 'admin.directory.resource.calendar': { object_types: ['CalendarResource'] }, 'admin.directory.userschema': { object_types: [] }, 'apps.licensing': { object_types: ['User'] }, 'apps.groups.settings': { object_types: ['Group'] }, 'admin.datatransfer': { object_types: ['User', 'File'] }, ediscovery: { object_types: ['Drive', 'File'], ranks: { '': 1 } }, 'gmail.settings.sharing': { object_types: ['User', 'SendAs'] }, 'script.external_request': { object_types: ['Project'] }, 'script.scriptapp': { object_types: ['Project'] }, 'gmail.addons.current.message': { object_types: [] }, 'gmail.addons.current.message.metadata': { object_types: [], ranks: { '': 1 } }, 'gmail.addons.current.message.action': { object_types: [] }, 'gmail.addons.current.action.compose': { object_types: [] }, 'gmail.addons.execute': { object_types: [] }, 'chat.messages': { object_types: [] }, 'chat.memberships': { object_types: [] } } } }
/** 역할 객체의 권한 이름(serviceId:privilegeName) → 세기. 이름마다 위에서부터 처음 맞는 줄, 그 가운데 가장 센 값. 맞는 이름이 없으면 모름 */
export const PRIVILEGE_RANK: Record<string, Array<{ match: string; rank: number }>> = {
  gws: [
    { match: ':(SUPER_ADMIN|ROOT_APP_ADMIN)$', rank: 5 },
    { match: ':([A-Z_]+_(RETRIEVE|READ|READ_ONLY)|[A-Z_]+_READ_[A-Z_]+|RETRIEVE_[A-Z_]+|(SIT_)?VIEW_[A-Z_]+|TELEMETRY_API(_[A-Z_]+)?|ADMIN_DASHBOARD|ADMIN_REPORTING_ACCESS|REPORTS_ACCESS)$', rank: 1 },
    { match: ':([A-Z_]+_(ALL|CREATE|UPDATE|DELETE|MOVE|ALIAS|SUSPEND|ADD_NICKNAME|RESET_PASSWORD|FORCE_PASSWORD_CHANGE|READWRITE|FULL_ACCESS|ADMIN)|[A-Z_]*MANAGE_[A-Z_]+|REVIEW_ALL_SENSITIVE_ACTIONS)$', rank: 3 },
  ],
}
/** 역할 세기를 정하는 방법의 순서. 앞 방법이 못 정하면 다음 방법 */
export const ROLE_RANK_ORDER = ['permissions', 'name', 'scopes', 'privileges', 'flags', 'object_type', 'grants', 'base_role'] as const
/** provider 별 역할 이름 → 세기. 이름 전체에 맞추고 위에서부터 처음 맞는 줄. 안 맞으면 모름 */
export const ROLE_NAME_RANK: Record<string, Array<{ match: string; rank: number }>> = {
  atlassian: [
    { match: '^ADMINISTER_PROJECTS$', rank: 5 },
    { match: '^(EDIT_WORKFLOW|EDIT_ISSUE_LAYOUT)$', rank: 3 },
    { match: '^(BROWSE_PROJECTS|VIEW_DEV_TOOLS|VIEW_READONLY_WORKFLOW|VIEW_VOTERS_AND_WATCHERS)$', rank: 1 },
    { match: '^ASSIGNABLE_USER$', rank: 0 },
    { match: '^(MANAGE_SPRINTS_PERMISSION|SERVICEDESK_AGENT)$', rank: 3 },
    { match: '^(ASSIGN_ISSUES|CLOSE_ISSUES|CREATE_ISSUES|DELETE_ISSUES|EDIT_ISSUES|LINK_ISSUES|MODIFY_REPORTER|MOVE_ISSUES|RESOLVE_ISSUES|SCHEDULE_ISSUES|SET_ISSUE_SECURITY|TRANSITION_ISSUES)$', rank: 3 },
    { match: '^(MANAGE_WATCHERS|ADD_COMMENTS|DELETE_ALL_COMMENTS|DELETE_OWN_COMMENTS|EDIT_ALL_COMMENTS|EDIT_OWN_COMMENTS|CREATE_ATTACHMENTS|DELETE_ALL_ATTACHMENTS|DELETE_OWN_ATTACHMENTS|DELETE_ALL_WORKLOGS|DELETE_OWN_WORKLOGS|EDIT_ALL_WORKLOGS|EDIT_OWN_WORKLOGS|WORK_ON_ISSUES)$', rank: 3 },
    { match: '^view$', rank: 1 },
    { match: '^edit$', rank: 3 },
    { match: '^administer:space$', rank: 5 },
    { match: '^(read|export):space$', rank: 1 },
    { match: '^(create|update|delete|copy|move|archive|restore|purge|purge_version|restrict_content):[A-Za-z]+$', rank: 3 },
    { match: '^atlassian/org-admin$', rank: 5 },
  ],
  salesforce: [
    { match: '^authorized$', rank: 1 },
  ],
  slack: [
    { match: '^primary_owner$', rank: 5 },
    { match: '^collaborator$', rank: 3 },
    { match: '^Rl02$', rank: 5 },
    { match: '^(Rl01|Rl0A)$', rank: 3 },
    { match: '^(Rl03|Rl0J)$', rank: 3 },
    { match: '^(Rl0D|Rl0K)$', rank: 3 },
    { match: '^(Rl09|Rl04|Rl0F|Rl0G)$', rank: 3 },
    { match: '^(Rl0C|Rl0L|Rl0E)$', rank: 1 },
  ],
  github: [
    { match: '^(security_manager|Security manager)$', rank: 3 },
    { match: '^(ci_cd_admin|CI/CD admin)$', rank: 3 },
    { match: '^(app_manager|App Manager|App manager)$', rank: 3 },
    { match: '^(moderator|Moderator)$', rank: 1 },
  ],
}
/** 역할 객체의 권한 칸(참, 거짓) → 세기. 참인 칸 가운데 가장 센 값, 칸은 있는데 참이 없으면 0 */
export const ROLE_FLAG_RANK: Record<string, Array<{ field: string; rank: number }>> = {
  salesforce: [
    { field: 'properties.perm_ModifyAllData', rank: 5 },
    { field: 'properties.perm_ManageUsers', rank: 5 },
    { field: 'properties.perm_AuthorApex', rank: 5 },
    { field: 'properties.perm_ViewAllData', rank: 1 },
    { field: 'properties.perm_ApiEnabled', rank: 0 },
  ],
}
/** 권한 칸마다 테넌트 아래 닿는 객체 종류와 수준 (providers.yaml tenant_scope 의 flag 예외) */
export const ROLE_FLAG_REACH: Record<string, Array<{ field: string; content?: DirectLevel; config?: DirectLevel; account?: DirectLevel }>> = {
  salesforce: [
    { field: 'properties.perm_ModifyAllData', content: 'write', config: 'admin' },
    { field: 'properties.perm_ViewAllData', content: 'read' },
    { field: 'properties.perm_ManageUsers', config: 'admin', account: 'admin' },
    { field: 'properties.perm_AuthorApex', config: 'write' },
  ],
}
/** 능력 → 직접 권한 수준. none 은 수준에 넣지 않는다 */
export const CAPABILITY_LEVELS: Record<string, DirectLevel | 'none'> = { authenticate: 'none', read: 'read', write: 'write', create: 'write', delete: 'write', share: 'write', send: 'write', execute: 'write', configure: 'admin', grant: 'none' }
/** 역할 객체 종류 → 세기 */
export const ROLE_TYPE_RANK: Record<string, Record<string, number>> = {
  salesforce: { UserRole: 0, PermissionSetLicense: 0 },
}
/** 같은 대상에 받은 권한 줄로 세기를 정하는 역할 객체 종류 */
export const ROLE_RANK_FROM_GRANTS: Record<string, string[]> = {
  atlassian: ['ProjectRole'],
}

// ---- provider 권한 모델 (providers.yaml)

export const MODEL_VERSION = 1
export const TENANT_GRANTS_INHERIT: Record<string, boolean | 'members'> = { okta: true, github: true, slack: false, gws: 'members', salesforce: 'members' }
export const INHERIT_CAPS: Array<{ provider: string; parent: string; child: string; cap: number }> = [
  { provider: 'slack', parent: 'conversation', child: 'message', cap: 1 },
]
export type DirectLevel = 'read' | 'write' | 'admin'
export type ObjectClass = 'content' | 'config' | 'account'
export type TenantReach = Partial<Record<ObjectClass, 'level' | 'none' | DirectLevel>>
export interface TenantScope { classes: ReadonlyArray<{ class: ObjectClass; interfaces: readonly string[]; group?: boolean }>; kinds: ReadonlyArray<{ kind: string; from: { relation?: readonly string[]; record?: string } }>; reach: Record<string, TenantReach>; exceptions: ReadonlyArray<{ provider: string; kind: string; when: { caps?: readonly string[]; flag?: string; policy?: string }; reach?: TenantReach }> }
/** 테넌트 권한이 테넌트 아래로 내려가는 범위 (직접 권한, engine/directAccess.ts 가 읽는다) */
export const TENANT_SCOPE: TenantScope = { classes: [{ class: 'config', interfaces: ['Automation', 'Credential', 'Policy', 'Assignment', 'Integration', 'Endpoint'] }, { class: 'config', interfaces: ['Principal'], group: true }, { class: 'account', interfaces: ['Principal'] }, { class: 'content', interfaces: ['Resource'] }], kinds: [{ kind: 'membership', from: { relation: ['member_of'] } }, { kind: 'console_role', from: { relation: ['has_role_on'] } }, { kind: 'console_role', from: { record: 'console_role' } }, { kind: 'product_use', from: { record: 'product_use' } }, { kind: 'base_permission', from: { record: 'base_permission' } }], reach: { membership: { content: 'none', config: 'none', account: 'none' }, product_use: { content: 'none', config: 'none', account: 'none' }, console_role: { content: 'none', config: 'level', account: 'level' }, base_permission: { content: 'level', config: 'none', account: 'none' } }, exceptions: [{ provider: 'github', kind: 'console_role', when: { caps: ['configure'] }, reach: { content: 'level' } }, { provider: 'salesforce', kind: 'console_role', when: { flag: 'role_flag_reach' } }, { provider: 'aws', kind: 'console_role', when: { policy: '*:*' }, reach: { content: 'level' } }] }
export const ENTRY_POINTS: Array<{ provider: string; objectType: string; invokers: 'tenant_members'; reason: string }> = [
  { provider: 'slack', objectType: 'slash command request endpoint', invokers: 'tenant_members', reason: 'invoker_gate_not_stored' },
]
export const CONTAINER_BOUND_AUTOMATIONS: Array<{ provider: string; objectType: string }> = [
  { provider: 'gws', objectType: 'project' },
  { provider: 'github', objectType: 'workflow' },
]
export const OPEN_RESPONDENT_RESOURCES: Array<{ provider: string; objectType: string; reason: string }> = [
  { provider: 'gws', objectType: 'form', reason: 'form_responders_unknown' },
]
export const VISIBILITY_SCOPED: Array<{ provider: string; objectType: string; property: string }> = [
  { provider: 'slack', objectType: 'conversation', property: 'is_private' },
]
/** 리소스 세트가 덮는 대상. 효과 표의 간선 끝 resource_set 을 relationEffects.ts resourceSetCovers 가 이 표로 펴고, org_wide 로 판정 때 범위(resource_set_scope)를 정한다 */
export const RESOURCE_SET_COVERAGE: Array<{ provider: string; orn: string; covers: 'members' | 'object' | 'kind' | 'service'; object_types: string[]; member_types?: string[]; org_wide?: boolean }> = [
  { provider: 'okta', orn: 'orn:okta:directory:{org}:groups:{id}:contained_resources', covers: 'members', object_types: ['Group'], member_types: ['User'] },
  { provider: 'okta', orn: 'orn:okta:directory:{org}:groups:{id}', covers: 'object', object_types: ['Group'] },
  { provider: 'okta', orn: 'orn:okta:directory:{org}:users:{id}', covers: 'object', object_types: ['User'] },
  { provider: 'okta', orn: 'orn:okta:directory:{org}:users', covers: 'kind', object_types: ['User'], org_wide: true },
  { provider: 'okta', orn: 'orn:okta:directory:{org}:groups', covers: 'kind', object_types: ['Group'], org_wide: true },
  { provider: 'okta', orn: 'orn:okta:idp:{org}:apps:{app}:{id}', covers: 'object', object_types: ['Application'] },
  { provider: 'okta', orn: 'orn:okta:idp:{org}:apps', covers: 'kind', object_types: ['Application'], org_wide: true },
  { provider: 'okta', orn: 'orn:okta:idp:{org}:authorization_servers', covers: 'kind', object_types: ['AuthorizationServer'] },
  { provider: 'okta', orn: 'orn:okta:hooks:{org}:eventhooks', covers: 'kind', object_types: ['EventHook'] },
  { provider: 'okta', orn: 'orn:okta:iam:{org}:contained_resources', covers: 'service', object_types: [], org_wide: true },
  { provider: 'okta', orn: 'orn:okta:workflow:{org}:contained_resources', covers: 'service', object_types: [] },
  { provider: 'okta', orn: 'orn:okta:workflow:{org}:flows', covers: 'kind', object_types: [] },
]
export const COVERAGE_CALLS: Record<string, Array<{ family: CoverageFamily; provider: string; objectTypes: string[] }>> = {
  'SL-01': [{ family: 'members', provider: 'slack', objectTypes: ['workspace', 'enterprise'] }],
  'SL-02': [{ family: 'members', provider: 'slack', objectTypes: ['workspace', 'enterprise'] }],
  'SL-04': [{ family: 'grants', provider: 'slack', objectTypes: ['conversation'] }],
  'SL-06': [{ family: 'members', provider: 'slack', objectTypes: ['usergroup'] }],
  'SL-15': [{ family: 'members', provider: 'slack', objectTypes: ['usergroup'] }],
  'GH-02': [{ family: 'members', provider: 'github', objectTypes: ['organization'] }],
  'GH-04': [
    { family: 'members', provider: 'github', objectTypes: ['team'] },
    { family: 'grants', provider: 'github', objectTypes: ['repository'] },
  ],
  'GH-06': [{ family: 'grants', provider: 'github', objectTypes: ['repository'] }],
  'OK-02': [{ family: 'members', provider: 'okta', objectTypes: ['org'] }],
  'OK-03': [{ family: 'members', provider: 'okta', objectTypes: ['group'] }],
  'OK-06': [{ family: 'grants', provider: 'okta', objectTypes: ['org'] }],
  'OK-07': [{ family: 'grants', provider: 'okta', objectTypes: ['application'] }],
  'GW-03': [{ family: 'members', provider: 'gws', objectTypes: ['customer'] }],
  'GW-04': [{ family: 'members', provider: 'gws', objectTypes: ['group'] }],
  'GW-07': [{ family: 'grants', provider: 'gws', objectTypes: ['file'] }],
}

// ---- 불확실, 열림 사유 (uncertainty.yaml 의 engine_reasons)

export const REASON_LABELS: Record<string, { label: string; resolve: string }> = {
  role_rank_unknown: { label: '역할 이름으로 권한 수준을 모름', resolve: '역할 권한 목록을 수집하거나(Okta iam_role.permissions) access_engine_overrides.json role_capabilities 에 적는다' },
  resource_set_not_expanded: { label: 'Okta 리소스 세트 범위를 펼치지 않음', resolve: 'resource_set.resources 로 대상이 들어 있는지 확인하고 confirmed_resource_sets 에 적는다' },
  resource_set_partial: { label: 'Okta 역할이 조직의 일부(리소스 세트가 덮는 대상)만 덮음 — 조직 전체에 대한 권한은 아님', resolve: '덮는 대상은 따로 펴서 간선을 냈다(providers.yaml resource_set_coverage). 조직을 건드리는 연동이 실제로 어느 대상을 건드리는지 확인한다' },
  input_inferred: { label: '자동화의 입력을 트리거 종류와 소유 관계로 추정함', resolve: '스크립트 id 를 알면(설정 힌트 gws.scripts) 코드와 parentId 로 확정한다' },
  invoker_gate_not_stored: { label: '자동화가 호출자를 어떻게 거르는지 저장되지 않음', resolve: '입구를 받는 코드(Cloudflare Worker 배포본, WK-01)를 수집하면 정규화가 채널 거름을 읽어 입구의 invoker_gate 에 적는다. 코드가 없거나 모양을 못 읽으면 끊어 보기(시험 계정을 채널에서 빼고 호출) 후 entry_point_gates 에 적는다' },
  channel_visibility_unknown: { label: '채널 공개 여부를 모름', resolve: 'conversations.info 의 is_private 를 수집한다' },
  channel_in_other_workspace: { label: '다른 Slack 워크스페이스의 채널 — 그 워크스페이스 멤버는 수집 범위 밖', resolve: '그 워크스페이스를 수집 대상에 더하거나 연동이 그 채널로 보내지 않게 고친다' },
  flow_not_observed: { label: '구조상 흐름 — 전송 기록 없음', resolve: '전송 관측(delivery, SL-09, D-21)으로 확인한다' },
  derived_content_unverified: { label: '실행 결과물에 입력 내용이 들어갔는지 확인 못 함', resolve: '결과물 내용 비교(content_change)로 확인한다' },
  automation_behavior_unknown: { label: '자동화가 그 권한을 어디까지 쓰는지 모름 (코드 미확인)', resolve: '자동화 코드, 실행 기록으로 실제 동작을 확인한다' },
  runs_as_computed: { label: '실행 신원이 벤더가 합친 값', resolve: '설치형 트리거 실행, 배포 executeAs 를 수집한다 (GW-09, GW-11)' },
  identity_link_weak: { label: '자동화 계정 연결이 추정(possibly_same)', resolve: '벤더가 준 연결(앱 client_id 등)로 확정한다' },
  form_responders_unknown: { label: '폼 응답자를 알 수 없음 (누구나일 수 있음)', resolve: '폼 응답 제한(도메인 한정) 설정을 수집한다' },
  session_activation: { label: '세션에서 켤 때만 효력인 권한인데 켜진 세션이 관측되지 않음', resolve: '지금 켜진 세션 권한(Salesforce SessionPermSetActivation)을 수집한다. 관측이 없어도 사용자가 켤 수 있어 확정은 못 한다' },
  token_scope_limited: { label: '토큰이 받은 scope 만큼만 그 사람을 대신함 (scope 를 간선에 펴지 않음)', resolve: '토큰 scope 표(capabilities.yaml token_scopes)에 그 SaaS 를 더한다. 접근 규칙 x_token_scoped 의 scopes_of 홉이 그 표로 scope 를 펴면 이 사유는 풀린다(2026-11-10). 피해 범위(blastRadius.ts tokenCapability)는 이미 scope 로 센다' },
  token_scope_unmapped: { label: '토큰 scope 가 scope 표에 없어 무엇에 무엇을 하는지 모름', resolve: '그 scope 의 벤더 문서를 확인해 capabilities.yaml token_scopes 의 resources(자원 마디), abilities(능력 마디), identity 가운데 하나에 더한다' },
  credential_link_by_scope: { label: '자격증명 사용을 같은 범위, 같은 주인으로만 이음', resolve: '자격증명 사용 기록에 커밋, 요청 id 를 남긴다' },
  delivery_without_source_data: { label: '전송 기록이 원본 내용을 담았는지 모름', resolve: '전송 관측의 contains_source_data 를 확인한다' },
  identity_weak: { label: '같은 사람인지 판단이 약함 (추정 연결뿐 — 로그 상관, 이메일 칸이 아닌 주소 칸(Salesforce Username 등), 공용 주소 의심. 이메일 칸끼리 일치는 확정이다)', resolve: 'IdP(Okta) 기준 강한 링크 — SAML NameID, 앱 배정 userName — 를 만든다' },
  group_members_empty: { label: '그룹 멤버를 수집하지 못함', resolve: '그룹 멤버 호출(OK-03, GH-04, GW-04, SL-15)을 확인한다' },
  grantee_unresolved: { label: '권한 배정의 받는 쪽이 객체가 아님 (외부 이메일 등)', resolve: '외부 공유 대상을 목록으로 올린다' },
  ext_shared: { label: '외부 조직과 공유된 채널 — 상대 조직 멤버를 셀 수 없음', resolve: 'Slack Connect 상대 조직 멤버는 수집 범위 밖이다' },
  coverage: { label: '수집 호출이 완결되지 않음', resolve: '해당 호출을 다시 수집한다 (aegi-adapter-engine 의 npm run collect)' },
  not_collected: { label: '이 사실을 목록으로 가져오는 호출이 수집되지 않음', resolve: '해당 호출을 켜고 수집한다' },
  setting_not_collected: { label: '테넌트 설정을 수집하지 않아 벤더 기본값으로 계산함 — 조직이 바꿨으면 틀림', resolve: 'semantic_mapping.yaml settings 줄의 collect 에 적은 설정을 수집하고 그 줄의 property 칸으로 정규화한다' },
  native_holders_missing: { label: '원래 권한자를 한 명도 찾지 못함 (수집이나 정규화 공백)', resolve: '대상의 권한 목록 호출을 확인하고, 권한자 계정이 사람(Principal)으로 정규화됐는지, 관리자 역할이 대상까지 펼쳐졌는지 본다' },
  enforcement_unknown: { label: '이 단계를 끊어도 막히는지 확인되지 않음', resolve: '끊어 보기(시험 계정을 그룹이나 채널에서 빼고 접근)로 확인한다. 그룹이 받은 부여면 그 부여를 만드는 Profile 관계 선언에 membership_enforced 로 적는다' },
  public_channel: { label: '공개 채널이라 내보내도 다시 들어와 읽을 수 있음', resolve: '채널 멤버십은 회수 지점이 아니다. 채널을 비공개로 바꾸면 풀린다' },
  script_webhook_by_url_fingerprint: { label: '스크립트 코드 속 웹훅 주소로만 이어짐', resolve: '스크립트와 웹훅을 잇는 관계(crosswalk secret_fingerprint)를 만든다' },
  dynamic_holder_unresolved: { label: '보고자, 담당자처럼 이슈마다 정해지거나 제품 접근으로 정해지는 보유자라 확정할 수 없음', resolve: '제품 접근 그룹을 수집하거나 이슈 단위로 묻는다' },
}

// ---- 활동 (activities.yaml)

export const OBSERVATION_KINDS = ['agent_run', 'slash_request', 'audit_event', 'credential_use', 'content_change', 'delivery', 'request_log', 'access_snapshot', 'correlation'] as const
export type ObservationKind =
  | 'agent_run'
  | 'slash_request'
  | 'audit_event'
  | 'credential_use'
  | 'content_change'
  | 'delivery'
  | 'request_log'
  | 'access_snapshot'
  | 'correlation'
export const EVIDENCE_LINK_TYPES = ['context_used_by', 'produced', 'correlates_by', 'delivered_to', 'attributed_as', 'requested_via', 'observed_as'] as const
export type EvidenceLinkType =
  | 'context_used_by'
  | 'produced'
  | 'correlates_by'
  | 'delivered_to'
  | 'attributed_as'
  | 'requested_via'
  | 'observed_as'

// ---- 위협 제목 검사 (policies.yaml)

/** 위협 목록에 오르는 모든 제목의 코드 검사 (src/detection/titleCheck.ts). 엔진 위협 제목과 Config Findings 판정 문장이 같이 쓴다 */
export const THREAT_TITLE_CHECK = {"forbidden_endings":["다","됨","가능"],"forbidden_chars":["·","?"]} as const

// ---- 조치 동사 (cut_actions.yaml). 끊는 곳에 붙이는 동사, SaaS 빈칸의 짝짓는 칸과 화면 경로, EA 회수 지점 설명 문장틀 (src/detection/cutActions.ts)

export const CUT_ACTIONS: ReadonlyArray<CutActionVerb> = [
  { id: 'remove_group_member', name: '그룹에서 빼기', status: 'adopted', saas: [{ provider: 'okta', relation: 'member_of', pair: 'Principal>Principal', ui: 'Directory > Groups > 그룹 > People 에서 뺀다', checked: 'doc' }, { provider: 'github', relation: 'member_of', pair: 'Principal>Principal', ui: 'Org > Teams > 팀 > Members > Remove from team', checked: 'doc' }, { provider: 'slack', relation: 'member_of', pair: 'Principal>Principal', ui: '워크스페이스 설정 Permissions > User Groups 가 누가 고칠 수 있는지 정한다', checked: 'doc' }, { provider: 'gws', relation: 'member_of', pair: 'Principal>Principal', ui: 'Directory > Groups > 그룹 > Members 에서 뺀다', checked: 'doc' }, { provider: 'atlassian', relation: 'member_of', pair: 'Principal>Principal', ui: 'Atlassian Administration > Directory > Groups > 그룹 > Members > Remove', checked: 'doc' }] },
  { id: 'remove_resource_member', name: '자원 멤버에서 빼기', status: 'adopted', saas: [{ provider: 'slack', relation: 'member_of', pair: 'Principal>Resource', ui: '채널 > 멤버 목록 > Remove from channel', checked: 'doc' }] },
  { id: 'revoke_role', name: '역할 회수', status: 'adopted', saas: [{ provider: 'github', relation: 'has_role_on', pair: 'Principal>Resource', ui: '저장소 Settings > Collaborators and teams > Remove', checked: 'doc' }, { provider: 'okta', relation: 'has_role_on', pair: 'Principal>Tenant', checked: 'doc' }, { provider: 'okta', relation: 'has_role_on', pair: 'Integration>Tenant', checked: 'doc' }, { provider: 'atlassian', relation: 'has_role_on', pair: 'Principal>Resource', ui: 'Project settings > People 에서 역할을 뺀다', checked: 'doc' }] },
  { id: 'unassign_app', name: '앱 배정 지우기', status: 'open', saas: [{ provider: 'okta', relation: 'has_role_on', pair: 'Principal>Integration', ui: 'Directory > People > 사람 > 앱 옆 X > Unassign Application', checked: 'doc' }] },
  { id: 'remove_share', name: '공유 끊기', status: 'adopted', saas: [{ provider: 'gws', relation: 'has_role_on', pair: 'Principal>Resource', ui: '파일 > 공유 > 사람 옆 권한 > 삭제', checked: 'doc' }, { provider: 'gws', relation: 'shared_with', pair: 'Resource>Tenant', ui: '파일 > 공유 > 일반 액세스를 제한됨으로', checked: 'doc' }] },
  { id: 'transfer_ownership', name: '소유권 넘기기', status: 'adopted', saas: [{ provider: 'gws', relation: 'has_role_on', pair: 'Principal>Resource', role: 'owner', ui: '관리 콘솔 Apps > Google Workspace > Drive and Docs > Transfer ownership', checked: 'doc', follow_with: ['remove_share'] }, { provider: 'gws', relation: 'owned_by', pair: 'Resource>Principal', ui: '관리 콘솔 Apps > Google Workspace > Drive and Docs > Transfer ownership', checked: 'doc', follow_with: ['remove_share'] }] },
  { id: 'change_run_as', name: '실행 신원 바꾸기', status: 'adopted', saas: [{ provider: 'gws', relation: 'runs_as', pair: 'Automation>Principal', ui: 'Deploy > Manage deployments > 배포 > Edit', checked: 'inferred' }] },
  { id: 'restrict_invokers', name: '호출 권한 제한', status: 'adopted', saas: [{ provider: 'gws', rule: 'deployments', ui: 'Deploy > Manage deployments > 배포 > Edit > Who has access', checked: 'inferred' }, { provider: 'slack', rule: 'entry_points', ui: 'Organization settings > Integrations > Installed apps > 앱 > Member Permissions > Who has permission to initiate interaction with this app(Everyone, No one, Specific people and groups)', checked: 'inferred' }] },
  { id: 'uninstall_app', name: '앱 설치 지우기', status: 'adopted', saas: [{ provider: 'slack', relation: 'acts_as', pair: 'Integration>Principal', ui: 'Tools & settings > Manage apps > Installed Apps > App Details > Configuration > Remove App', checked: 'doc' }, { provider: 'github', object: 'Integration', type: 'GitHub App 설치', ui: 'Org Settings > Third-party Access > GitHub Apps > Configure > Suspend 또는 Uninstall', checked: 'doc' }] },
  { id: 'revoke_token', name: '토큰 폐기', status: 'adopted', saas: [{ provider: 'okta', object: 'Credential', type: 'API 토큰', ui: 'Security > API > Tokens > Revoke token', checked: 'doc' }, { provider: 'github', object: 'Credential', type: 'fine-grained 개인 토큰', ui: 'Org Settings > Personal access tokens > Active tokens > Revoke', checked: 'doc' }, { provider: 'slack', object: 'Credential', type: '토큰', checked: 'doc' }, { provider: 'gws', object: 'Credential', type: 'OAuth 승인', ui: 'Directory > Users > 사람 > Security > Connected applications > Remove', checked: 'doc' }, { provider: 'gws', object: 'Credential', type: '도메인 전체 위임', ui: 'Security > Access and data control > API controls > Manage Domain Wide Delegation > Delete', checked: 'doc' }] },
  { id: 'narrow_scope', name: '권한 범위 줄이기', status: 'adopted', saas: [{ provider: 'okta', setting: 'Integration', type: '서비스 앱 scope 승인', ui: 'Applications > 앱 > Okta API Scopes > Revoke', checked: 'doc' }] },
  { id: 'disable_webhook', name: '웹훅 끄기', status: 'adopted', saas: [{ provider: 'github', rule: 'outbound_hooks', ui: '저장소 Settings > Webhooks > Edit > Active 해제 또는 Delete', checked: 'doc' }, { provider: 'atlassian', rule: 'outbound_hooks', ui: 'Settings > System > Advanced > WebHooks > 웹훅 > 끄기 또는 지우기', checked: 'doc' }, { provider: 'slack', relation: 'receives_into', pair: 'Endpoint>Resource', ui: 'Manage apps > 앱 > Configuration > Authorizations > Revoke (그 사람이 한 설치 단위)', checked: 'doc' }] },
  { id: 'stop_mail_forwarding', name: '메일 자동 전달 끄기', status: 'adopted', saas: [{ provider: 'gws', setting: 'Principal', property: 'gmail_forwarding', ui: '조직: Apps > Google Workspace > Gmail > End User Access > Automatic forwarding 해제(조직 단위마다)', checked: 'doc' }] },
  { id: 'lock_condition_attribute', name: '조건 속성 잠그기', status: 'adopted', saas: [{ provider: 'okta', setting: 'Principal', property: 'profile_attribute_permissions', ui: 'Directory > Profile Editor > 사용자 프로필 > 속성 > User permission: Read Only', checked: 'doc' }, { provider: 'okta', setting: 'Policy', type: 'GroupRule', ui: 'Directory > Groups > Rules > 규칙 > Deactivate', checked: 'doc' }] },
  { id: 'change_permission_scheme', name: '권한 스킴 바꾸기', status: 'open', saas: [{ provider: 'atlassian', relation: 'applies_to', pair: 'Policy>Resource', ui: 'More actions > Space settings > Permissions > Actions > Use a different scheme > Associate', checked: 'doc' }] },
  { id: 'narrow_visibility', name: '공개 범위 줄이기', status: 'open', saas: [{ provider: 'slack', rule: 'visibility_scoped', ui: '채널 이름 > Settings > Change to a private channel', checked: 'doc' }] },
]
/** EA 회수 지점 설명 문장틀(phrases.ea_cut) */
export const CUT_PHRASES = {
  ea_cut: { 'runs_as_inherits.r': '실행 신원을 바꾸면 이 자동화만 영향', 'runs_as_inherits.h': '{주체} 본인과 그 신원으로 도는 자동화 모두 영향', 'x_member_grant.m': '{주체} 만 영향 ({그룹} 에서 제외)', 'x_member_grant.h': '{그룹} 멤버 {인원}명 모두 영향', 'x_dynamic_holder.s': '{프로젝트} 에 {스킴} 대신 다른 권한 스킴을 쓰면 이 스킴으로 권한을 받은 전체 호출자 영향', 'x_acts_as_inherits.r': '앱을 지우면 이 앱만 영향', 'x_acts_as_inherits.h': '{주체|과/와} 그 주체로 동작하는 앱 모두 영향', 'x_token_inherits.t': '토큰을 거두면 이 토큰만 영향', 'x_token_inherits.h': '{주체} 본인과 그 사람의 토큰 모두 영향', 'x_token_scoped.t': '토큰을 거두면 이 토큰만 영향', 'x_token_scoped.h': '{주체} 본인과 그 사람이 앱에 준 토큰 모두 영향' },
} as const
export interface CutActionVerb { id: string; name: string; status: 'open' | 'adopted'; saas: ReadonlyArray<CutActionRow> }
export interface CutActionRow { provider: string; relation?: string; pair?: string; role?: string; rule?: string; object?: string; setting?: string; type?: string; property?: string; ui?: string; checked: string; follow_with?: readonly string[] }

// ---- 판정 어휘 (judgments.yaml)

export type Verdict =
  | 'yes'
  | 'unknown'
  | 'no'
export type TriggerMode =
  | 'invoke'
  | 'input'
  | 'modify'
export type GrantSource =
  | 'config'
  | 'observed'
  | 'author'
  | 'model'
export type WitnessLevel =
  | 'computed'
  | 'computed_cross'
  | 'indeterminate'
  | 'denied'
export type PersonSide =
  | 'gap'
  | 'gap_inferred'
  | 'both'
  | 'native_only'

// ---- 신원 연결 (identity.yaml 의 engine_level_grades)

export const LINK_LEVELS = ['resolved', 'candidate', 'inferred', 'disclosed_relation', 'possibly_same', 'possibly_related', 'different'] as const
export type LinkLevel =
  | 'resolved'
  | 'candidate'
  | 'inferred'
  | 'disclosed_relation'
  | 'possibly_same'
  | 'possibly_related'
  | 'different'
export const STRONG_LINK_LEVELS: readonly string[] = ['resolved', 'disclosed_relation']

// ---- 이름 바꾸기 검사의 어휘 (vocabulary.yaml)

export const SCRAMBLE_NAME_FIELDS: readonly string[] = [
  'name',
  'label',
  'title',
  'display_name',
  'displayName',
  'real_name',
  'fullName',
  'firstName',
  'lastName',
  'givenName',
  'familyName',
  'documentTitle',
  'email',
  'primaryEmail',
  'login',
  'secondEmail',
  'emailAddress',
  'owner',
  'creator',
  'run_as_user',
  'user',
  'actor_email',
  'requester_email',
  'owner_login',
  'author_login',
  'user_login',
  'name_id',
  'username',
  'native_github_login',
  'app_slug',
  'token_name',
  'client_name',
  'application_name',
  'channel_name',
  'request_channel_name',
  'app_name',
  'command',
  'description',
  'text',
  'url',
  'url_host',
  'url_path',
  'html_url',
  'configuration_url',
  'redirect_url',
  'domain',
  'customerDomain',
  'slug',
  'slackDomain',
  'googleDomain',
  'githubOrg',
  'githubEnterprise',
  'bookmarkUrl',
  'full_name',
  'path',
  'functionName',
  'projectName',
  'linkedSheetId',
  'subdomain',
  'enterprise_name',
  'team_name',
  'mobilePhone',
  'department',
  'organization',
]
export const SCRAMBLE_STRUCTURAL: readonly string[] = [
  'provider',
  'object_type',
  'relation_type',
  'template',
  'kind',
  'identifier_type',
  'interfaces',
  'interface',
  'basis',
  'stability',
  'evidenceType',
  'record',
  'primary',
  'provider_term',
  'schema_version',
]

// ---- 관계의 뜻 (relation_semantics.yaml relations)

export const RELATION_SEMANTICS: Record<RelationType, { forward: string; reverse: string; description: string; inverse: string; characteristics: readonly string[]; roleInGraph: string }> = {
  has_role_on: { forward: '역할이 있는 대상', reverse: '역할 보유자', description: 'A 는 B 에 역할 R 을 가진다', inverse: 'role_held_by', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  permits: { forward: '허용 대상', reverse: '허용하는 정책', description: 'A 가 B 에 대한 접근을 허용한다', inverse: 'permitted_by', characteristics: [], roleInGraph: 'info' },
  member_of: { forward: '소속', reverse: '멤버', description: 'A 는 B 의 멤버다', inverse: 'has_member', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  owned_by: { forward: '소유자', reverse: '소유물', description: 'A 의 주인은 B 다', inverse: 'owns', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  registered_in: { forward: '등록된 테넌트', reverse: '등록된 앱', description: '앱 A 가 테넌트 B 에 등록, 설치돼 있다', inverse: 'has_registered', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  registered_by: { forward: '등록한 주체', reverse: '등록한 앱', description: '앱 A 를 B 가 등록했다', inverse: 'registered', characteristics: [], roleInGraph: 'info' },
  acts_as: { forward: '동작 신원', reverse: '이 신원으로 동작하는 앱', description: '앱 A 는 B 로서 동작한다', inverse: 'acted_by', characteristics: [], roleInGraph: 'path' },
  authenticates_with: { forward: '자격증명', reverse: '이 자격증명을 쓰는 쪽', description: 'A 는 B 로 인증한다', inverse: 'authenticates', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  runs_as: { forward: '실행 신원', reverse: '이 신원으로 도는 자동화', description: '자동화 A 는 B 의 권한으로 실행된다', inverse: 'runs', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  triggered_by: { forward: '시작시키는 것', reverse: '시작되는 자동화', description: '자동화 A 는 B 에 의해 시작된다', inverse: 'triggers', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  receives_into: { forward: '전달 목적지', reverse: '들어오는 통로', description: '통로 A 로 들어온 데이터가 B 에 쌓인다', inverse: 'receives_from', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  shared_with: { forward: '공유 범위', reverse: '공유받은 자원', description: '자원 A 가 B 전체에 공유돼 있다', inverse: 'has_shared', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
  applies_to: { forward: '적용 대상', reverse: '적용되는 정책', description: '정책 A 가 B 에 적용된다', inverse: 'subject_to', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'info' },
  excludes: { forward: '제외 대상', reverse: '제외하는 정책', description: '정책 A 가 B 를 제외한다', inverse: 'excluded_by', characteristics: [], roleInGraph: 'ingredient' },
  evaluates: { forward: '평가하는 조건', reverse: '이 조건을 쓰는 정책', description: '정책 A 가 조건 B 를 평가한다', inverse: 'evaluated_by', characteristics: [], roleInGraph: 'info' },
  trusts: { forward: '신뢰하는 테넌트', reverse: '신뢰하는 쪽', description: '테넌트 A 가 B 를 신뢰한다', inverse: 'trusted_by', characteristics: [], roleInGraph: 'info' },
  contained_in: { forward: '상위', reverse: '하위', description: 'A 는 B 안에 있다', inverse: 'contains', characteristics: ['irreflexive', 'asymmetric'], roleInGraph: 'path' },
}

// ---- 관계 행이 만드는 간선 (relation_semantics.yaml relations 의 effects, conditions). 위협 판정 간선(edges.ts)이 이 표로 관계 행을 읽는다
//      읽는 법은 src/detection/v2/engine/relationEffects.ts 머리말. when, decided 같은 사람이 읽는 칸은 옮기지 않는다

export interface EffectEmit { kind: EdgeKind; from: EffectEnd; to: EffectEnd; rank?: number | 'role' | 'membership'; mode?: string; uncertain?: readonly string[] }
/** 간선 끝: 관계 양 끝, 누구나, via_grant 의 자격증명, 출발의 테넌트(RELATION_RESOLVERS.tenant_of), 리소스 세트가 덮는 객체 전부(RESOURCE_SET_COVERAGE), 펴지 못한 대상이 있으면 관계 도착 */
export type EffectEnd = 'source' | 'target' | 'everyone' | 'grant' | 'tenant' | 'resource_set' | 'resource_set_unexpanded'
export interface RelationEffects { effects: ReadonlyArray<{ pairs: readonly string[]; emits: readonly EffectEmit[] }>; conditions: ReadonlyArray<{ name: string; match?: Record<string, unknown>; override?: string; cases: ReadonlyArray<{ pair: string; emits: readonly EffectEmit[] }> }> }
export const RELATION_EFFECTS: Record<string, RelationEffects> = {
  has_role_on: { effects: [{ pairs: ['Principal>Resource', 'Principal>Tenant', 'Principal>Integration', 'Principal>Automation', 'Policy>Resource', 'Policy>Tenant', 'Policy>Integration', 'Policy>Automation', 'Credential>Resource', 'Credential>Tenant', 'Credential>Integration', 'Credential>Automation', 'Integration>Resource', 'Integration>Tenant', 'Integration>Integration', 'Integration>Automation'], emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }], conditions: [{ name: 'has_role_on.inactive_account', match: { source: { judged_or_property: { account_state: ['deleted', 'deprovisioned', 'suspended'] } } }, cases: [{ pair: 'Principal>Resource', emits: [] }, { pair: 'Principal>Tenant', emits: [] }, { pair: 'Principal>Integration', emits: [] }, { pair: 'Principal>Automation', emits: [] }] }, { name: 'has_role_on.deleted_assignment', match: { via_assignment: { property: { deleted: true } } }, cases: [{ pair: 'Principal>Resource', emits: [] }, { pair: 'Principal>Tenant', emits: [] }, { pair: 'Principal>Integration', emits: [] }, { pair: 'Principal>Automation', emits: [] }, { pair: 'Policy>Resource', emits: [] }, { pair: 'Policy>Tenant', emits: [] }, { pair: 'Policy>Integration', emits: [] }, { pair: 'Policy>Automation', emits: [] }, { pair: 'Credential>Resource', emits: [] }, { pair: 'Credential>Tenant', emits: [] }, { pair: 'Credential>Integration', emits: [] }, { pair: 'Credential>Automation', emits: [] }, { pair: 'Integration>Resource', emits: [] }, { pair: 'Integration>Tenant', emits: [] }, { pair: 'Integration>Integration', emits: [] }, { pair: 'Integration>Automation', emits: [] }] }, { name: 'has_role_on.excluded', match: { exists_relation: { type: 'excludes', source: '$role', target: '$source' } }, cases: [{ pair: 'Principal>Resource', emits: [] }, { pair: 'Principal>Tenant', emits: [] }, { pair: 'Principal>Integration', emits: [] }, { pair: 'Principal>Automation', emits: [] }, { pair: 'Policy>Resource', emits: [] }, { pair: 'Policy>Tenant', emits: [] }, { pair: 'Policy>Integration', emits: [] }, { pair: 'Policy>Automation', emits: [] }, { pair: 'Credential>Resource', emits: [] }, { pair: 'Credential>Tenant', emits: [] }, { pair: 'Credential>Integration', emits: [] }, { pair: 'Credential>Automation', emits: [] }, { pair: 'Integration>Resource', emits: [] }, { pair: 'Integration>Tenant', emits: [] }, { pair: 'Integration>Integration', emits: [] }, { pair: 'Integration>Automation', emits: [] }] }, { name: 'has_role_on.via_grant', match: { relation: { property: { via_grant: 'present' } } }, cases: [{ pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Principal>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Principal>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Policy>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Policy>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Policy>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Policy>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Credential>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Credential>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Credential>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Credential>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Integration>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Integration>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Integration>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }, { pair: 'Integration>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }, { kind: 'G', from: 'grant', to: 'target', rank: 'role' }] }] }, { name: 'has_role_on.okta_resource_set_partial', match: { relation: { provider: 'okta', property: { resource_set_scope: 'partial' } } }, cases: [{ pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'source', to: 'resource_set', rank: 'role' }, { kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_partial'] }, { kind: 'G', from: 'source', to: 'resource_set_unexpanded', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Tenant', emits: [{ kind: 'G', from: 'source', to: 'resource_set', rank: 'role' }, { kind: 'G', from: 'source', to: 'resource_set_unexpanded', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Tenant', emits: [{ kind: 'G', from: 'source', to: 'resource_set', rank: 'role' }, { kind: 'G', from: 'source', to: 'resource_set_unexpanded', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Tenant', emits: [{ kind: 'G', from: 'source', to: 'resource_set', rank: 'role' }, { kind: 'G', from: 'source', to: 'resource_set_unexpanded', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }] }, { name: 'has_role_on.okta_resource_set_org', match: { relation: { provider: 'okta', property: { resource_set_scope: 'org' } } }, cases: [{ pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Principal>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Principal>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Policy>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Policy>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Policy>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Policy>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Credential>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Credential>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Credential>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Credential>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Integration>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Integration>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Integration>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Integration>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }] }, { name: 'has_role_on.okta_resource_set', match: { relation: { provider: 'okta', property: { resource_set: 'present' } } }, override: 'confirmed_resource_sets', cases: [{ pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Principal>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Principal>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Integration', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Automation', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['resource_set_not_expanded'] }] }] }, { name: 'has_role_on.session_active', match: { all: [{ relation: { property: { activation: 'session' } } }, { relation: { property: { session_active: true } } }] }, cases: [{ pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }, { pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role' }] }] }, { name: 'has_role_on.session_activation', match: { relation: { property: { activation: 'session' } } }, cases: [{ pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['session_activation'] }] }, { pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['session_activation'] }] }] }, { name: 'has_role_on.special_principal.public', match: { all: [{ source: { provider: 'atlassian', object_type: 'SpecialPrincipal' } }, { source: { property: { access_class: 'ANONYMOUS_USERS' } } }] }, cases: [{ pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'everyone', to: 'target', rank: 'role' }] }, { pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'everyone', to: 'target', rank: 'role' }] }] }, { name: 'has_role_on.special_principal.tenant_members', match: { all: [{ source: { provider: 'atlassian', object_type: 'SpecialPrincipal' } }, { source: { property: { access_class: 'ALL_LICENSED_USERS' } } }, { relation: { property: { via_scheme: 'missing' } } }] }, cases: [{ pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'tenant', to: 'target', rank: 'role' }] }, { pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'tenant', to: 'target', rank: 'role' }] }] }, { name: 'has_role_on.special_principal.role_bundle', match: { source: { provider: 'atlassian', object_type: 'SpecialPrincipal' } }, cases: [{ pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['dynamic_holder_unresolved'] }] }, { pair: 'Principal>Tenant', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'role', uncertain: ['dynamic_holder_unresolved'] }] }] }] },
  permits: { effects: [], conditions: [] },
  member_of: { effects: [{ pairs: ['Principal>Tenant', 'Principal>Principal'], emits: [{ kind: 'M', from: 'source', to: 'target' }] }, { pairs: ['Principal>Resource'], emits: [{ kind: 'G', from: 'source', to: 'target', rank: 'membership' }] }], conditions: [{ name: 'member_of.inactive_account', match: { source: { judged_or_property: { account_state: ['deleted', 'deprovisioned', 'suspended'] } } }, cases: [{ pair: 'Principal>Tenant', emits: [] }, { pair: 'Principal>Principal', emits: [] }, { pair: 'Principal>Resource', emits: [] }] }, { name: 'member_of.measurement_membership', match: { relation: { property: { measurement_principal: true } } }, cases: [{ pair: 'Principal>Tenant', emits: [] }, { pair: 'Principal>Resource', emits: [] }] }, { name: 'member_of.measurement_principal', match: { source: { meta: { demo_role: 'measurement_principal' } } }, cases: [{ pair: 'Principal>Tenant', emits: [] }] }, { name: 'member_of.gws_org_unit', match: { all: [{ relation: { provider: 'gws' } }, { target: { object_type: 'OrgUnit' } }] }, cases: [{ pair: 'Principal>Resource', emits: [{ kind: 'M', from: 'source', to: 'target' }] }] }, { name: 'member_of.slack_conversation', match: { all: [{ relation: { provider: 'slack' } }, { target: { object_type: 'conversation' } }] }, cases: [{ pair: 'Principal>Resource', emits: [{ kind: 'G', from: 'source', to: 'target', rank: 3 }] }] }] },
  owned_by: { effects: [{ pairs: ['Endpoint>Integration', 'Endpoint>Tenant', 'Automation>Integration', 'Automation>Tenant', 'Credential>Integration', 'Credential>Tenant'], emits: [{ kind: 'A', from: 'source', to: 'target' }] }, { pairs: ['Resource>Principal'], emits: [{ kind: 'G', from: 'target', to: 'source', rank: 5 }] }, { pairs: ['Principal>Integration'], emits: [{ kind: 'A', from: 'target', to: 'source' }] }], conditions: [{ name: 'owned_by.inactive_account', match: { target: { judged_or_property: { account_state: ['deleted', 'deprovisioned', 'suspended'] } } }, cases: [{ pair: 'Resource>Principal', emits: [] }] }, { name: 'owned_by.caller', match: { source: { judged_or_property: { run_as_resolution: 'caller' } } }, cases: [{ pair: 'Automation>Integration', emits: [] }, { pair: 'Automation>Tenant', emits: [] }] }, { name: 'owned_by.delivery_endpoint', match: { all: [{ source: { interface: 'Endpoint' } }, { exists_relation: { type: 'receives_into', source: '$source' } }] }, cases: [{ pair: 'Endpoint>Integration', emits: [] }, { pair: 'Endpoint>Tenant', emits: [] }, { pair: 'Credential>Integration', emits: [] }, { pair: 'Credential>Tenant', emits: [] }] }, { name: 'owned_by.outbound_endpoint', match: { all: [{ source: { interface: 'Endpoint' } }, { source: { judged_or_property: { direction: 'out' } } }] }, cases: [{ pair: 'Endpoint>Tenant', emits: [] }] }, { name: 'owned_by.app_refresh_token', match: { all: [{ source: { judged_or_property: { credential_kind: 'bearer_token' } } }, { exists_relation: { type: 'authenticates_with', target: '$source' } }] }, cases: [{ pair: 'Credential>Integration', emits: [] }] }, { name: 'owned_by.org_bearer_token', match: { source: { judged_or_property: { credential_kind: 'bearer_token' } } }, cases: [{ pair: 'Credential>Tenant', emits: [] }] }, { name: 'owned_by.public_certificate', match: { source: { judged_or_property: { credential_kind: 'certificate' } } }, cases: [{ pair: 'Credential>Tenant', emits: [] }] }, { name: 'owned_by.unknown_runner_tenant', match: { source: { judged_or_property: { run_as_resolution: 'unknown' } } }, cases: [{ pair: 'Automation>Tenant', emits: [] }] }, { name: 'owned_by.registered_device', match: { source: { provider: 'gws', object_type: 'GoogleAppsCloudidentityDevicesV1Device' } }, cases: [{ pair: 'Resource>Principal', emits: [] }] }] },
  registered_in: { effects: [{ pairs: ['Integration>Tenant'], emits: [{ kind: 'U', from: 'source', to: 'target' }] }], conditions: [] },
  registered_by: { effects: [], conditions: [] },
  acts_as: { effects: [{ pairs: ['Integration>Principal'], emits: [{ kind: 'A', from: 'source', to: 'target' }] }], conditions: [{ name: 'acts_as.inactive_account', match: { target: { judged_or_property: { account_state: ['deleted', 'deprovisioned', 'suspended'] } } }, cases: [{ pair: 'Integration>Principal', emits: [] }] }] },
  authenticates_with: { effects: [{ pairs: ['Principal>Credential', 'Integration>Credential', 'Endpoint>Credential'], emits: [] }], conditions: [{ name: 'authenticates_with.inactive_account', match: { source: { judged_or_property: { account_state: ['deleted', 'deprovisioned', 'suspended'] } } }, cases: [{ pair: 'Principal>Credential', emits: [] }] }, { name: 'authenticates_with.org_bearer_token', match: { all: [{ target: { judged_or_property: { credential_kind: 'bearer_token' } } }, { exists_relation: { type: 'owned_by', source: '$target', target_interface: 'Tenant' } }] }, cases: [{ pair: 'Principal>Credential', emits: [{ kind: 'A', from: 'target', to: 'source' }] }] }, { name: 'authenticates_with.app_refresh_token', match: { all: [{ target: { judged_or_property: { credential_kind: 'bearer_token' } } }, { exists_relation: { type: 'owned_by', source: '$target', target_interface: 'Integration' } }] }, cases: [{ pair: 'Principal>Credential', emits: [{ kind: 'A', from: 'target', to: 'source', uncertain: ['token_scope_limited'] }] }] }] },
  runs_as: { effects: [{ pairs: ['Automation>Principal'], emits: [{ kind: 'A', from: 'source', to: 'target' }] }, { pairs: ['Automation>Credential'], emits: [{ kind: 'A', from: 'source', to: 'target' }, { kind: 'F', from: 'source', to: 'target', uncertain: ['flow_not_observed'] }] }], conditions: [{ name: 'runs_as.inactive_account', match: { target: { judged_or_property: { account_state: ['deleted', 'deprovisioned', 'suspended'] } } }, cases: [{ pair: 'Automation>Principal', emits: [] }] }, { name: 'runs_as.computed_caller', match: { all: [{ relation: { property: { basis: 'computed' } } }, { source: { judged_or_property: { run_as_resolution: 'caller' } } }] }, cases: [{ pair: 'Automation>Principal', emits: [] }] }, { name: 'runs_as.computed', match: { relation: { property: { basis: 'computed' } } }, cases: [{ pair: 'Automation>Principal', emits: [{ kind: 'A', from: 'source', to: 'target', uncertain: ['runs_as_computed'] }] }, { pair: 'Automation>Credential', emits: [{ kind: 'A', from: 'source', to: 'target' }, { kind: 'F', from: 'source', to: 'target', uncertain: ['flow_not_observed'] }] }] }] },
  triggered_by: { effects: [{ pairs: ['Automation>Principal'], emits: [{ kind: 'T', from: 'target', to: 'source', mode: 'invoke' }] }, { pairs: ['Automation>Endpoint', 'Automation>Resource', 'Automation>Integration'], emits: [{ kind: 'T', from: 'target', to: 'source', mode: 'input' }] }], conditions: [{ name: 'triggered_by.inactive_account', match: { target: { judged_or_property: { account_state: ['deleted', 'deprovisioned', 'suspended'] } } }, cases: [{ pair: 'Automation>Principal', emits: [] }] }, { name: 'triggered_by.input_carried', match: { exists_relation: { type: 'runs_as', source: '$source', target_interface: 'Credential' } }, cases: [{ pair: 'Automation>Resource', emits: [{ kind: 'T', from: 'target', to: 'source', mode: 'input' }, { kind: 'F', from: 'target', to: 'source', uncertain: ['flow_not_observed'] }] }] }] },
  receives_into: { effects: [{ pairs: ['Endpoint>Tenant', 'Endpoint>Resource'], emits: [{ kind: 'G', from: 'source', to: 'target', rank: 3 }, { kind: 'F', from: 'source', to: 'target' }] }], conditions: [] },
  shared_with: { effects: [{ pairs: ['Resource>Tenant'], emits: [{ kind: 'G', from: 'target', to: 'source', rank: 'membership' }] }], conditions: [{ name: 'shared_with.anyone', match: { relation: { property: { permission_type: 'anyone' } } }, cases: [{ pair: 'Resource>Tenant', emits: [{ kind: 'G', from: 'everyone', to: 'source', rank: 1 }] }] }, { name: 'shared_with.set', match: { relation: { property: { target_kind: 'set' } } }, cases: [{ pair: 'Resource>Tenant', emits: [{ kind: 'G', from: 'everyone', to: 'source', rank: 1 }] }] }, { name: 'shared_with.role', match: { relation: { property: { role: 'writer' } } }, cases: [{ pair: 'Resource>Tenant', emits: [{ kind: 'G', from: 'target', to: 'source', rank: 3 }] }] }, { name: 'shared_with.slack_conversation.is_private_false', match: { source: { provider: 'slack', object_type: 'conversation', property: { is_private: false } } }, cases: [{ pair: 'Resource>Tenant', emits: [] }] }, { name: 'shared_with.slack_conversation.is_private_true', match: { source: { provider: 'slack', object_type: 'conversation', property: { is_private: true } } }, cases: [{ pair: 'Resource>Tenant', emits: [] }] }, { name: 'shared_with.slack_conversation.is_private_unknown', match: { source: { provider: 'slack', object_type: 'conversation', property: { is_private: 'missing' } } }, cases: [{ pair: 'Resource>Tenant', emits: [] }] }] },
  applies_to: { effects: [], conditions: [] },
  excludes: { effects: [], conditions: [] },
  evaluates: { effects: [], conditions: [] },
  trusts: { effects: [], conditions: [] },
  contained_in: { effects: [{ pairs: ['Tenant>Tenant'], emits: [{ kind: 'M', from: 'source', to: 'target' }, { kind: 'U', from: 'source', to: 'target' }] }, { pairs: ['Tenant>Principal', 'Tenant>Integration', 'Tenant>Credential', 'Tenant>Assignment', 'Tenant>Policy', 'Tenant>Endpoint', 'Tenant>Resource', 'Tenant>Automation', 'Principal>Principal', 'Principal>Integration', 'Principal>Credential', 'Principal>Assignment', 'Principal>Policy', 'Principal>Endpoint', 'Principal>Resource', 'Principal>Automation', 'Integration>Tenant', 'Integration>Principal', 'Integration>Integration', 'Integration>Credential', 'Integration>Assignment', 'Integration>Policy', 'Integration>Endpoint', 'Integration>Resource', 'Integration>Automation', 'Credential>Tenant', 'Credential>Principal', 'Credential>Integration', 'Credential>Credential', 'Credential>Assignment', 'Credential>Policy', 'Credential>Endpoint', 'Credential>Resource', 'Credential>Automation', 'Assignment>Tenant', 'Assignment>Principal', 'Assignment>Integration', 'Assignment>Credential', 'Assignment>Assignment', 'Assignment>Policy', 'Assignment>Endpoint', 'Assignment>Resource', 'Assignment>Automation', 'Policy>Tenant', 'Policy>Principal', 'Policy>Integration', 'Policy>Credential', 'Policy>Assignment', 'Policy>Policy', 'Policy>Endpoint', 'Policy>Resource', 'Policy>Automation', 'Endpoint>Tenant', 'Endpoint>Principal', 'Endpoint>Credential', 'Endpoint>Assignment', 'Endpoint>Policy', 'Endpoint>Endpoint', 'Endpoint>Resource', 'Endpoint>Automation', 'Resource>Tenant', 'Resource>Principal', 'Resource>Integration', 'Resource>Credential', 'Resource>Assignment', 'Resource>Policy', 'Resource>Endpoint', 'Resource>Resource', 'Resource>Automation', 'Automation>Tenant'], emits: [{ kind: 'U', from: 'source', to: 'target' }] }, { pairs: ['Principal>Tenant'], emits: [{ kind: 'M', from: 'source', to: 'target' }] }, { pairs: ['Endpoint>Integration'], emits: [{ kind: 'A', from: 'source', to: 'target' }] }, { pairs: ['Automation>Principal', 'Automation>Integration', 'Automation>Credential', 'Automation>Assignment', 'Automation>Policy', 'Automation>Endpoint', 'Automation>Resource', 'Automation>Automation'], emits: [{ kind: 'F', from: 'target', to: 'source', uncertain: ['flow_not_observed'] }] }], conditions: [{ name: 'contained_in.group_tenant', match: { any: [{ source: { judged_or_property: { principal_kind: 'group' } } }, { source: { object_type: ['group', 'usergroup', 'team'] } }, { exists_relation: { type: 'member_of', target: '$source' } }] }, cases: [{ pair: 'Principal>Tenant', emits: [{ kind: 'U', from: 'source', to: 'target' }] }] }, { name: 'contained_in.automation_resource', match: { source: { interface: 'Automation' } }, cases: [{ pair: 'Resource>Principal', emits: [] }, { pair: 'Resource>Integration', emits: [] }, { pair: 'Resource>Credential', emits: [] }, { pair: 'Resource>Assignment', emits: [] }, { pair: 'Resource>Policy', emits: [] }, { pair: 'Resource>Endpoint', emits: [] }, { pair: 'Resource>Resource', emits: [] }, { pair: 'Resource>Automation', emits: [] }] }, { name: 'contained_in.slack_conversation.is_private_false', match: { source: { provider: 'slack', object_type: 'conversation', property: { is_private: false } } }, cases: [{ pair: 'Resource>Tenant', emits: [{ kind: 'U', from: 'source', to: 'target' }] }] }, { name: 'contained_in.gws_project', match: { source: { in_table: 'container_bound_automations' } }, cases: [{ pair: 'Automation>Resource', emits: [{ kind: 'F', from: 'target', to: 'source', uncertain: ['flow_not_observed'] }, { kind: 'T', from: 'target', to: 'source', mode: 'modify' }] }] }] },
}

// ---- 끝 찾기 (relation_semantics.yaml resolvers). 효과 표의 간선 끝 tenant 는 tenant_of 로 찾는다

export const RELATION_RESOLVERS: Record<string, Record<string, unknown>> = {
  tenant_of: { refs: ['tenant', 'parent'], relations: ['registered_in', 'owned_by', 'contained_in'], depth: 5, want: 'Tenant', take: 'first' },
  tenants_of: { refs: ['parent', 'tenant'], relations: ['contained_in', 'shared_with'], depth: 1, want: 'Tenant', take: 'all' },
  owner: { relations: ['owned_by'], depth: 1, want: 'Principal', take: 'all' },
  scope: { refs: ['parent', 'tenant'], depth: 1, want: 'any', take: 'first' },
}

// ---- 관계 의미 층 (semantic_mapping.yaml, capabilities.yaml 능력 목록). 명세 Relation_Semantic_Layer_v1. 엔진 engine/semantic/ 이 AEGI_REL_MODEL=semantic 일 때 읽는다

export const SEMANTIC_FACT_TYPES = ['member_of', 'contained_in', 'grants', 'holds', 'acts_as', 'triggers', 'flows_to', 'conditions', 'trusts'] as const
export type SemanticFactType =
  | 'member_of'
  | 'contained_in'
  | 'grants'
  | 'holds'
  | 'acts_as'
  | 'triggers'
  | 'flows_to'
  | 'conditions'
  | 'trusts'
/** 사실 → 간선. reverse 는 끝을 뒤집어 낸다(holds: 보유자 → 자격증명 사실이 자격증명 → 보유자 A 간선) */
export const SEMANTIC_FACT_EDGES: Record<SemanticFactType, { edge: EdgeKind | 'none'; reverse?: boolean }> = {
  member_of: { edge: 'M' },
  contained_in: { edge: 'U' },
  grants: { edge: 'G' },
  holds: { edge: 'A', reverse: true },
  acts_as: { edge: 'A' },
  triggers: { edge: 'T' },
  flows_to: { edge: 'F' },
  conditions: { edge: 'none' },
  trusts: { edge: 'none' },
}
export const SEMANTIC_BASIS = ['stated', 'computed', 'flag', 'vendor_default', 'logged'] as const
export interface SemanticEmit { p: SemanticFactType; from: string; to: string; caps?: string | readonly string[]; basis?: string; mode?: string; polarity?: 'include' | 'exclude' | 'requires'; uncertain?: readonly string[]; impersonate?: boolean; identity?: 'own' | 'caller'; tenant_grant?: string }
export interface SemanticEffects { effects: ReadonlyArray<{ pairs: readonly string[]; emits: readonly SemanticEmit[] }>; conditions: ReadonlyArray<{ name: string; match?: Record<string, unknown>; override?: string; cases: ReadonlyArray<{ pair: string; emits: readonly SemanticEmit[] }> }> }
/** 관계 종류마다 갈래(routes_first + aliases − drop_routes). 읽는 법은 효과 표(RELATION_EFFECTS)와 같다 */
export const SEMANTIC_EFFECTS: Record<string, SemanticEffects> = {
  has_role_on: { effects: [{ pairs: ['Principal>Resource', 'Principal>Tenant', 'Principal>Integration', 'Principal>Automation', 'Policy>Resource', 'Policy>Tenant', 'Policy>Integration', 'Policy>Automation', 'Credential>Resource', 'Credential>Tenant', 'Credential>Integration', 'Credential>Automation', 'Integration>Resource', 'Integration>Tenant', 'Integration>Integration', 'Integration>Automation'], emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }], conditions: [{ name: 'has_role_on.deleted_assignment', match: { via_assignment: { property: { deleted: true } } }, cases: [{ pair: 'Principal>Resource', emits: [] }, { pair: 'Principal>Tenant', emits: [] }, { pair: 'Principal>Integration', emits: [] }, { pair: 'Principal>Automation', emits: [] }, { pair: 'Policy>Resource', emits: [] }, { pair: 'Policy>Tenant', emits: [] }, { pair: 'Policy>Integration', emits: [] }, { pair: 'Policy>Automation', emits: [] }, { pair: 'Credential>Resource', emits: [] }, { pair: 'Credential>Tenant', emits: [] }, { pair: 'Credential>Integration', emits: [] }, { pair: 'Credential>Automation', emits: [] }, { pair: 'Integration>Resource', emits: [] }, { pair: 'Integration>Tenant', emits: [] }, { pair: 'Integration>Integration', emits: [] }, { pair: 'Integration>Automation', emits: [] }] }, { name: 'has_role_on.excluded', match: { exists_relation: { type: 'excludes', source: '$role', target: '$source' } }, cases: [{ pair: 'Principal>Resource', emits: [] }, { pair: 'Principal>Tenant', emits: [] }, { pair: 'Principal>Integration', emits: [] }, { pair: 'Principal>Automation', emits: [] }, { pair: 'Policy>Resource', emits: [] }, { pair: 'Policy>Tenant', emits: [] }, { pair: 'Policy>Integration', emits: [] }, { pair: 'Policy>Automation', emits: [] }, { pair: 'Credential>Resource', emits: [] }, { pair: 'Credential>Tenant', emits: [] }, { pair: 'Credential>Integration', emits: [] }, { pair: 'Credential>Automation', emits: [] }, { pair: 'Integration>Resource', emits: [] }, { pair: 'Integration>Tenant', emits: [] }, { pair: 'Integration>Integration', emits: [] }, { pair: 'Integration>Automation', emits: [] }] }, { name: 'has_role_on.via_grant', match: { relation: { property: { via_grant: 'present' } } }, cases: [{ pair: 'Principal>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Principal>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Principal>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Policy>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Policy>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Policy>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Policy>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Credential>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Credential>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Credential>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Credential>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Integration>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Integration>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Integration>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }, { pair: 'Integration>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }, { p: 'grants', from: 'grant', to: 'target', caps: 'role' }] }] }, { name: 'has_role_on.okta_resource_set_partial', match: { relation: { provider: 'okta', property: { resource_set_scope: 'partial' } } }, cases: [{ pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'source', to: 'resource_set', caps: 'role' }, { p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_partial'] }, { p: 'grants', from: 'source', to: 'resource_set_unexpanded', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Tenant', emits: [{ p: 'grants', from: 'source', to: 'resource_set', caps: 'role' }, { p: 'grants', from: 'source', to: 'resource_set_unexpanded', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Tenant', emits: [{ p: 'grants', from: 'source', to: 'resource_set', caps: 'role' }, { p: 'grants', from: 'source', to: 'resource_set_unexpanded', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Tenant', emits: [{ p: 'grants', from: 'source', to: 'resource_set', caps: 'role' }, { p: 'grants', from: 'source', to: 'resource_set_unexpanded', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }] }, { name: 'has_role_on.okta_resource_set_org', match: { relation: { provider: 'okta', property: { resource_set_scope: 'org' } } }, cases: [{ pair: 'Principal>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Principal>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Principal>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Policy>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Policy>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Policy>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Policy>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Credential>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Credential>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Credential>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Credential>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Integration>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Integration>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Integration>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Integration>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }] }, { name: 'has_role_on.okta_resource_set', match: { relation: { provider: 'okta', property: { resource_set: 'present' } } }, override: 'confirmed_resource_sets', cases: [{ pair: 'Principal>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Principal>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Principal>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Policy>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Credential>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Integration', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }, { pair: 'Integration>Automation', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['resource_set_not_expanded'] }] }] }, { name: 'has_role_on.session_active', match: { all: [{ relation: { property: { activation: 'session' } } }, { relation: { property: { session_active: true } } }] }, cases: [{ pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }, { pair: 'Principal>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role' }] }] }, { name: 'has_role_on.session_activation', match: { relation: { property: { activation: 'session' } } }, cases: [{ pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['session_activation'] }] }, { pair: 'Principal>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['session_activation'] }] }] }, { name: 'has_role_on.special_principal.public', match: { all: [{ source: { provider: 'atlassian', object_type: 'SpecialPrincipal' } }, { source: { property: { access_class: 'ANONYMOUS_USERS' } } }] }, cases: [{ pair: 'Principal>Resource', emits: [{ p: 'grants', from: 'everyone', to: 'target', caps: 'role' }] }, { pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'everyone', to: 'target', caps: 'role' }] }] }, { name: 'has_role_on.special_principal.tenant_members', match: { all: [{ source: { provider: 'atlassian', object_type: 'SpecialPrincipal' } }, { source: { property: { access_class: 'ALL_LICENSED_USERS' } } }, { relation: { property: { via_scheme: 'missing' } } }] }, cases: [{ pair: 'Principal>Resource', emits: [{ p: 'grants', from: 'tenant', to: 'target', caps: 'role' }] }, { pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'tenant', to: 'target', caps: 'role' }] }] }, { name: 'has_role_on.special_principal.role_bundle', match: { source: { provider: 'atlassian', object_type: 'SpecialPrincipal' } }, cases: [{ pair: 'Principal>Resource', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['dynamic_holder_unresolved'] }] }, { pair: 'Principal>Tenant', emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'role', uncertain: ['dynamic_holder_unresolved'] }] }] }] },
  permits: { effects: [], conditions: [] },
  member_of: { effects: [{ pairs: ['Principal>Tenant', 'Principal>Principal'], emits: [{ p: 'member_of', from: 'source', to: 'target' }] }, { pairs: ['Principal>Resource'], emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'membership' }] }], conditions: [{ name: 'member_of.site_product_use', match: { target: { provider: 'atlassian', object_type: 'ServerInformation' } }, cases: [{ pair: 'Principal>Tenant', emits: [{ p: 'member_of', from: 'source', to: 'target' }, { p: 'grants', from: 'source', to: 'target', caps: ['read', 'authenticate'], basis: 'vendor_default' }] }] }, { name: 'member_of.measurement_membership', match: { relation: { property: { measurement_principal: true } } }, cases: [{ pair: 'Principal>Tenant', emits: [] }, { pair: 'Principal>Resource', emits: [] }] }, { name: 'member_of.measurement_principal', match: { source: { meta: { demo_role: 'measurement_principal' } } }, cases: [{ pair: 'Principal>Tenant', emits: [] }] }, { name: 'member_of.gws_org_unit', match: { all: [{ relation: { provider: 'gws' } }, { target: { object_type: 'OrgUnit' } }] }, cases: [{ pair: 'Principal>Resource', emits: [{ p: 'member_of', from: 'source', to: 'target' }] }] }] },
  owned_by: { effects: [{ pairs: ['Endpoint>Integration', 'Endpoint>Tenant', 'Automation>Integration', 'Automation>Tenant', 'Credential>Integration', 'Credential>Tenant'], emits: [{ p: 'acts_as', from: 'source', to: 'target' }] }, { pairs: ['Resource>Principal'], emits: [{ p: 'grants', from: 'target', to: 'source', caps: 'manage' }] }, { pairs: ['Principal>Integration'], emits: [{ p: 'acts_as', from: 'target', to: 'source' }] }], conditions: [{ name: 'owned_by.caller', match: { source: { judged_or_property: { run_as_resolution: 'caller' } } }, cases: [{ pair: 'Automation>Integration', emits: [] }, { pair: 'Automation>Tenant', emits: [] }] }, { name: 'owned_by.delivery_endpoint', match: { all: [{ source: { interface: 'Endpoint' } }, { exists_relation: { type: 'receives_into', source: '$source' } }] }, cases: [{ pair: 'Endpoint>Integration', emits: [] }, { pair: 'Endpoint>Tenant', emits: [] }, { pair: 'Credential>Integration', emits: [] }, { pair: 'Credential>Tenant', emits: [] }] }, { name: 'owned_by.outbound_endpoint', match: { all: [{ source: { interface: 'Endpoint' } }, { source: { judged_or_property: { direction: 'out' } } }] }, cases: [{ pair: 'Endpoint>Tenant', emits: [] }] }, { name: 'owned_by.app_refresh_token', match: { all: [{ source: { judged_or_property: { credential_kind: 'bearer_token' } } }, { exists_relation: { type: 'authenticates_with', target: '$source' } }] }, cases: [{ pair: 'Credential>Integration', emits: [] }] }, { name: 'owned_by.org_bearer_token', match: { source: { judged_or_property: { credential_kind: 'bearer_token' } } }, cases: [{ pair: 'Credential>Tenant', emits: [] }] }, { name: 'owned_by.public_certificate', match: { source: { judged_or_property: { credential_kind: 'certificate' } } }, cases: [{ pair: 'Credential>Tenant', emits: [] }] }, { name: 'owned_by.unknown_runner_tenant', match: { source: { judged_or_property: { run_as_resolution: 'unknown' } } }, cases: [{ pair: 'Automation>Tenant', emits: [] }] }, { name: 'owned_by.registered_device', match: { source: { provider: 'gws', object_type: 'GoogleAppsCloudidentityDevicesV1Device' } }, cases: [{ pair: 'Resource>Principal', emits: [] }] }] },
  registered_in: { effects: [{ pairs: ['Integration>Tenant'], emits: [{ p: 'contained_in', from: 'source', to: 'target' }] }], conditions: [] },
  registered_by: { effects: [], conditions: [] },
  acts_as: { effects: [{ pairs: ['Integration>Principal'], emits: [{ p: 'acts_as', from: 'source', to: 'target' }] }], conditions: [] },
  authenticates_with: { effects: [{ pairs: ['Principal>Credential', 'Integration>Credential', 'Endpoint>Credential'], emits: [] }], conditions: [{ name: 'authenticates_with.org_bearer_token', match: { all: [{ target: { judged_or_property: { credential_kind: 'bearer_token' } } }, { exists_relation: { type: 'owned_by', source: '$target', target_interface: 'Tenant' } }] }, cases: [{ pair: 'Principal>Credential', emits: [{ p: 'holds', from: 'source', to: 'target', impersonate: true }] }] }, { name: 'authenticates_with.app_refresh_token', match: { all: [{ target: { judged_or_property: { credential_kind: 'bearer_token' } } }, { exists_relation: { type: 'owned_by', source: '$target', target_interface: 'Integration' } }] }, cases: [{ pair: 'Principal>Credential', emits: [{ p: 'holds', from: 'source', to: 'target', impersonate: true, uncertain: ['token_scope_limited'] }] }] }] },
  runs_as: { effects: [{ pairs: ['Automation>Principal'], emits: [{ p: 'acts_as', from: 'source', to: 'target' }] }, { pairs: ['Automation>Credential'], emits: [{ p: 'acts_as', from: 'source', to: 'target' }, { p: 'flows_to', from: 'source', to: 'target', uncertain: ['flow_not_observed'] }] }], conditions: [{ name: 'runs_as.computed_caller', match: { all: [{ relation: { property: { basis: 'computed' } } }, { source: { judged_or_property: { run_as_resolution: 'caller' } } }] }, cases: [{ pair: 'Automation>Principal', emits: [] }] }, { name: 'runs_as.computed', match: { relation: { property: { basis: 'computed' } } }, cases: [{ pair: 'Automation>Principal', emits: [{ p: 'acts_as', from: 'source', to: 'target', uncertain: ['runs_as_computed'] }] }, { pair: 'Automation>Credential', emits: [{ p: 'acts_as', from: 'source', to: 'target' }, { p: 'flows_to', from: 'source', to: 'target', uncertain: ['flow_not_observed'] }] }] }] },
  triggered_by: { effects: [{ pairs: ['Automation>Principal'], emits: [{ p: 'triggers', from: 'target', to: 'source', mode: 'invoke' }] }, { pairs: ['Automation>Endpoint', 'Automation>Resource', 'Automation>Integration'], emits: [{ p: 'triggers', from: 'target', to: 'source', mode: 'input' }] }], conditions: [{ name: 'triggered_by.input_carried', match: { exists_relation: { type: 'runs_as', source: '$source', target_interface: 'Credential' } }, cases: [{ pair: 'Automation>Resource', emits: [{ p: 'triggers', from: 'target', to: 'source', mode: 'input' }, { p: 'flows_to', from: 'target', to: 'source', uncertain: ['flow_not_observed'] }] }] }] },
  receives_into: { effects: [{ pairs: ['Endpoint>Tenant', 'Endpoint>Resource'], emits: [{ p: 'grants', from: 'source', to: 'target', caps: 'edit' }, { p: 'flows_to', from: 'source', to: 'target' }] }], conditions: [] },
  shared_with: { effects: [{ pairs: ['Resource>Tenant'], emits: [{ p: 'grants', from: 'target', to: 'source', caps: 'membership' }] }], conditions: [{ name: 'shared_with.anyone', match: { relation: { property: { permission_type: 'anyone' } } }, cases: [{ pair: 'Resource>Tenant', emits: [{ p: 'grants', from: 'everyone', to: 'source', caps: 'use' }] }] }, { name: 'shared_with.set', match: { relation: { property: { target_kind: 'set' } } }, cases: [{ pair: 'Resource>Tenant', emits: [{ p: 'grants', from: 'everyone', to: 'source', caps: 'use' }] }] }, { name: 'shared_with.role', match: { relation: { property: { role: 'writer' } } }, cases: [{ pair: 'Resource>Tenant', emits: [{ p: 'grants', from: 'target', to: 'source', caps: 'edit' }] }] }, { name: 'shared_with.slack_conversation.is_private_false', match: { source: { provider: 'slack', object_type: 'conversation', property: { is_private: false } } }, cases: [{ pair: 'Resource>Tenant', emits: [] }] }, { name: 'shared_with.slack_conversation.is_private_true', match: { source: { provider: 'slack', object_type: 'conversation', property: { is_private: true } } }, cases: [{ pair: 'Resource>Tenant', emits: [] }] }, { name: 'shared_with.slack_conversation.is_private_unknown', match: { source: { provider: 'slack', object_type: 'conversation', property: { is_private: 'missing' } } }, cases: [{ pair: 'Resource>Tenant', emits: [] }] }] },
  applies_to: { effects: [], conditions: [] },
  excludes: { effects: [], conditions: [] },
  evaluates: { effects: [], conditions: [] },
  trusts: { effects: [], conditions: [] },
  contained_in: { effects: [{ pairs: ['Tenant>Tenant'], emits: [{ p: 'member_of', from: 'source', to: 'target' }, { p: 'contained_in', from: 'source', to: 'target' }] }, { pairs: ['Tenant>Principal', 'Tenant>Integration', 'Tenant>Credential', 'Tenant>Assignment', 'Tenant>Policy', 'Tenant>Endpoint', 'Tenant>Resource', 'Tenant>Automation', 'Principal>Principal', 'Principal>Integration', 'Principal>Credential', 'Principal>Assignment', 'Principal>Policy', 'Principal>Endpoint', 'Principal>Resource', 'Principal>Automation', 'Integration>Tenant', 'Integration>Principal', 'Integration>Integration', 'Integration>Credential', 'Integration>Assignment', 'Integration>Policy', 'Integration>Endpoint', 'Integration>Resource', 'Integration>Automation', 'Credential>Tenant', 'Credential>Principal', 'Credential>Integration', 'Credential>Credential', 'Credential>Assignment', 'Credential>Policy', 'Credential>Endpoint', 'Credential>Resource', 'Credential>Automation', 'Assignment>Tenant', 'Assignment>Principal', 'Assignment>Integration', 'Assignment>Credential', 'Assignment>Assignment', 'Assignment>Policy', 'Assignment>Endpoint', 'Assignment>Resource', 'Assignment>Automation', 'Policy>Tenant', 'Policy>Principal', 'Policy>Integration', 'Policy>Credential', 'Policy>Assignment', 'Policy>Policy', 'Policy>Endpoint', 'Policy>Resource', 'Policy>Automation', 'Endpoint>Tenant', 'Endpoint>Principal', 'Endpoint>Credential', 'Endpoint>Assignment', 'Endpoint>Policy', 'Endpoint>Endpoint', 'Endpoint>Resource', 'Endpoint>Automation', 'Resource>Tenant', 'Resource>Principal', 'Resource>Integration', 'Resource>Credential', 'Resource>Assignment', 'Resource>Policy', 'Resource>Endpoint', 'Resource>Resource', 'Resource>Automation', 'Automation>Tenant'], emits: [{ p: 'contained_in', from: 'source', to: 'target' }] }, { pairs: ['Principal>Tenant'], emits: [{ p: 'member_of', from: 'source', to: 'target' }] }, { pairs: ['Endpoint>Integration'], emits: [{ p: 'acts_as', from: 'source', to: 'target' }] }, { pairs: ['Automation>Principal', 'Automation>Integration', 'Automation>Credential', 'Automation>Assignment', 'Automation>Policy', 'Automation>Endpoint', 'Automation>Resource', 'Automation>Automation'], emits: [{ p: 'flows_to', from: 'target', to: 'source', uncertain: ['flow_not_observed'] }] }], conditions: [{ name: 'contained_in.group_tenant', match: { any: [{ source: { judged_or_property: { principal_kind: 'group' } } }, { source: { object_type: ['group', 'usergroup', 'team'] } }, { exists_relation: { type: 'member_of', target: '$source' } }] }, cases: [{ pair: 'Principal>Tenant', emits: [{ p: 'contained_in', from: 'source', to: 'target' }] }] }, { name: 'contained_in.automation_resource', match: { source: { interface: 'Automation' } }, cases: [{ pair: 'Resource>Principal', emits: [] }, { pair: 'Resource>Integration', emits: [] }, { pair: 'Resource>Credential', emits: [] }, { pair: 'Resource>Assignment', emits: [] }, { pair: 'Resource>Policy', emits: [] }, { pair: 'Resource>Endpoint', emits: [] }, { pair: 'Resource>Resource', emits: [] }, { pair: 'Resource>Automation', emits: [] }] }, { name: 'contained_in.slack_conversation.is_private_false', match: { source: { provider: 'slack', object_type: 'conversation', property: { is_private: false } } }, cases: [{ pair: 'Resource>Tenant', emits: [{ p: 'contained_in', from: 'source', to: 'target' }] }] }, { name: 'contained_in.gws_project', match: { source: { in_table: 'container_bound_automations' } }, cases: [{ pair: 'Automation>Resource', emits: [{ p: 'flows_to', from: 'target', to: 'source', uncertain: ['flow_not_observed'] }, { p: 'triggers', from: 'target', to: 'source', mode: 'modify' }] }] }] },
}
export const SEMANTIC_FILTERS: ReadonlyArray<{ name: string; p: readonly SemanticFactType[]; principal_end: Record<string, unknown> }> = [
  { name: 'inactive_principal', p: ['member_of', 'grants', 'holds', 'acts_as', 'triggers'], principal_end: { source: { judged_or_property: { account_state: ['deleted', 'deprovisioned', 'suspended'] } } } },
]
export const SEMANTIC_PROVENANCE_ONLY: readonly string[] = ['registered_by', 'applies_to', 'excludes', 'evaluates', 'permits', 'trusts']
export const SEMANTIC_RECORDS: ReadonlyArray<{ name: string; select: Record<string, unknown>; name_regex?: Record<string, string>; emit: readonly SemanticEmit[] }> = [
  { name: 'okta_enduser_dashboard', select: { source: { provider: 'okta', object_type: 'Application', property: { name: 'okta_enduser' } } }, emit: [{ p: 'grants', from: 'tenant', to: 'self', caps: ['authenticate', 'read'], basis: 'vendor_default' }] },
  { name: 'atlassian_default_group_admins', select: { source: { provider: 'atlassian', object_type: 'FoundGroup' } }, name_regex: { name: '^(system-administrators|(jira|jira-software|jira-workmgmt|jira-work-management|jira-servicemanagement|jira-product-discovery|confluence|opsgenie|statuspage|trello|bitbucket|guard-detect|goals|projects|focus|loom|assets|studio|compass|atlas)-admins-.+)$' }, emit: [{ p: 'grants', from: 'self', to: 'tenant', caps: 'manage', basis: 'vendor_default', tenant_grant: 'console_role' }] },
  { name: 'atlassian_default_group_user_access_admins', select: { source: { provider: 'atlassian', object_type: 'FoundGroup' } }, name_regex: { name: '^(jira|jira-software|jira-workmgmt|jira-work-management|jira-servicemanagement|jira-product-discovery|confluence|opsgenie|statuspage|trello|bitbucket|guard-detect|goals|projects|focus|loom|assets|studio|compass|atlas)-user-access-admins-.+$' }, emit: [{ p: 'grants', from: 'self', to: 'tenant', caps: ['read', 'grant'], basis: 'vendor_default', tenant_grant: 'console_role' }] },
  { name: 'atlassian_default_group_users', select: { source: { provider: 'atlassian', object_type: 'FoundGroup' } }, name_regex: { name: '^(jira|jira-software|jira-workmgmt|jira-work-management|jira-servicemanagement|jira-product-discovery|confluence|opsgenie|statuspage|trello|bitbucket|goals|projects|focus|loom|assets|studio|compass|atlas)-users-.+$' }, emit: [{ p: 'grants', from: 'self', to: 'tenant', caps: 'edit', basis: 'vendor_default', tenant_grant: 'product_use' }] },
  { name: 'atlassian_default_group_guests', select: { source: { provider: 'atlassian', object_type: 'FoundGroup' } }, name_regex: { name: '^(jira|jira-software|jira-workmgmt|jira-work-management|jira-servicemanagement|jira-product-discovery|confluence|opsgenie|statuspage|trello|bitbucket|guard-detect|goals|projects|focus|loom|assets|studio|compass|atlas)-guests-.+$' }, emit: [{ p: 'grants', from: 'self', to: 'tenant', caps: 'use', basis: 'vendor_default', tenant_grant: 'product_use' }] },
  { name: 'github_base_permission_read', select: { source: { provider: 'github', interface: 'Tenant', property: { default_repository_permission: 'read' } } }, emit: [{ p: 'grants', from: 'self', to: 'self', caps: 'use', basis: 'stated', tenant_grant: 'base_permission' }] },
  { name: 'github_base_permission_write', select: { source: { provider: 'github', interface: 'Tenant', property: { default_repository_permission: 'write' } } }, emit: [{ p: 'grants', from: 'self', to: 'self', caps: 'edit', basis: 'stated', tenant_grant: 'base_permission' }] },
  { name: 'github_base_permission_admin', select: { source: { provider: 'github', interface: 'Tenant', property: { default_repository_permission: 'admin' } } }, emit: [{ p: 'grants', from: 'self', to: 'self', caps: 'manage', basis: 'stated', tenant_grant: 'base_permission' }] },
  { name: 'slack_workspace_calls_org', select: { source: { provider: 'slack', object_type: '200.team' } }, emit: [{ p: 'triggers', from: 'self', to: 'ref:enterprise_id', mode: 'invoke', identity: 'caller', basis: 'vendor_default' }] },
  { name: 'slack_installed_app_invoke', select: { source: { provider: 'slack', object_type: 'defs_app_id' } }, emit: [{ p: 'triggers', from: 'ref:tenant', to: 'self', mode: 'invoke', identity: 'caller', basis: 'vendor_default' }] },
]
/** 배정 자리 선언 표. emit 줄은 레코드 규칙이 된다: 보유자 → 대상 grants(caps), ceiling 이 있으면 conditions(requires, 간선 아님) */
export interface SemanticAssignment { provider: string; object_type: string; catalog?: string; relation?: string; slot?: string; emit?: { holder: string; target: string; caps: string | readonly string[]; ceiling?: string; when?: Record<string, unknown>; basis?: string }; skip?: string; unverified?: string }
export const SEMANTIC_ASSIGNMENTS: readonly SemanticAssignment[] = [
  { provider: 'okta', object_type: 'OAuth2ScopeConsentGrant', emit: { holder: 'ref:clientid|parent_scope', target: 'tenant_of_holder', caps: ['authenticate'], ceiling: 'scopeId', when: { status: 'ACTIVE' } } },
  { provider: 'github', object_type: 'credential-authorizations', catalog: 'Credential Authorization', emit: { holder: 'ref:grantee', target: 'ref:tenant', caps: ['authenticate'], ceiling: 'scopes' } },
  { provider: 'github', object_type: 'personal-access-tokens', catalog: 'Organization Programmatic Access Grant', relation: 'has_role_on', slot: 'via_grant', emit: { holder: 'ref:grantee', target: 'ref:tenant', caps: ['authenticate'] } },
  { provider: 'atlassian', object_type: 'SpacePermission', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'atlassian', object_type: 'PermissionGrant', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'gws', object_type: 'GoogleAppsCloudidentityDevicesV1DeviceUser', relation: 'owned_by', slot: 'via_assignment' },
  { provider: 'gws', object_type: 'Permission', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'gws', object_type: 'RoleAssignment', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'okta', object_type: 'AppUser', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'okta', object_type: 'ApplicationGroupAssignment', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'okta', object_type: 'CustomRole', relation: 'has_role_on', slot: 'source' },
  { provider: 'salesforce', object_type: 'GroupMember', relation: 'member_of', slot: 'via_assignment' },
  { provider: 'salesforce', object_type: 'OauthToken', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'salesforce', object_type: 'PermissionSetAssignment', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'salesforce', object_type: 'PermissionSetGroupComponent', relation: 'contained_in', slot: 'via_assignment' },
  { provider: 'salesforce', object_type: 'PermissionSetLicenseAssign', relation: 'has_role_on', slot: 'via_assignment' },
  { provider: 'salesforce', object_type: 'SessionPermSetActivation', relation: 'has_role_on', slot: 'session_activation' },
  { provider: 'slack', object_type: '200.entities[*]', relation: 'applies_to', slot: 'via_assignment' },
  { provider: 'okta', object_type: 'AssignedAppLink', skip: '사용자 자리 없음 — 정규화가 사용자 참조를 남기지 않는다. 앱 배정은 AppUser 가 낸다' },
  { provider: 'okta', object_type: 'PolicyMapping', skip: '권한 아님 — 정책 → 앱 적용(conditions). 대상 id 를 객체로 못 푼다' },
  { provider: 'gws', object_type: 'AclRule', skip: '대상(캘린더) 객체 없음' },
  { provider: 'gws', object_type: 'Token', skip: '사용자 OAuth 토큰. 앱 객체로 잇는 정규화가 아직 없다 — holds' },
  { provider: 'salesforce', object_type: 'WorkAccess', skip: '대상(parentid) 객체로 안 풀림' },
  { provider: 'salesforce', object_type: 'ContentDocumentLink', skip: '양 끝 객체로 안 풀림' },
  { provider: 'salesforce', object_type: 'UserPermissionAccess', skip: '받는 쪽' },
  { provider: 'atlassian', object_type: 'SharePermission', skip: '받는 쪽(프로젝트 구성원) 객체로 안 풀림' },
  { provider: 'gws', object_type: 'Member', unverified: '운영 수집본에 행이 없다. 합성 환경 데이터(엔진 src/data/aegi_inc_environment_v2. 2026-11-13 지움)에서는 객체 → 그룹 contained_in 만 있고 사람 자리가 관계가 되지 않는다' },
  { provider: 'gws', object_type: 'Delegate', unverified: '수집본에 행이 없다(메일 위임 — acts_as 후보)' },
  { provider: 'gws', object_type: 'InboundSsoAssignment', unverified: '수집본에 행이 없다(조직 단위 → SSO 설정 — conditions 후보)' },
  { provider: 'github', object_type: 'ExternalIdentity', relation: 'member_of', slot: 'via_assignment' },
  { provider: 'github', object_type: 'Organization Invitation', unverified: '수집본에 행이 없다(초대 대기 — 받기 전에는 권한 아님)' },
  { provider: 'slack', object_type: 'workflow-collaborator', unverified: '수집본에 이 이름 행이 없다. 워크플로 관리자는 has_role_on 역할 이름 collaborator 로 들어온다' },
]
/** 자동화 범위 표(칸 ceiling 의 범위 갈래). 범위가 수집된 자동화는 실행 신원 권한을 그 범위 안에서만 쓴다 — 엔진 accessModel.ts 가 읽는다 */
export interface AutomationScope { name: string; select: { provider: string; object_type: string }; scope: { property: string; object_type: string; ids: readonly string[] }; below: string; own_product?: boolean; other_product_interface?: string; actions?: { from: string; non_action?: { match?: string; types?: readonly string[] }; outbound?: readonly string[]; record_only?: readonly string[]; product: Record<string, string> } }
export const AUTOMATION_SCOPES: readonly AutomationScope[] = [
  { name: 'jira_rule_project_scope', select: { provider: 'atlassian', object_type: 'AutomationRule' }, scope: { property: 'scope_project_ids', object_type: 'Project', ids: ['properties.id', 'identifiers'] }, below: 'contained_in', own_product: true, other_product_interface: 'Resource', actions: { from: 'properties.components', non_action: { match: '(?:^|[.:_-])(trigger|condition)(?:$|[.:_-])', types: ['jira.incoming.webhook', 'incoming.webhook'] }, outbound: ['slack.notification', 'jira.issue.outgoing.webhook', 'outgoing.webhook', 'action.send-templated-email'], record_only: ['codebarrel.action.log'], product: { jira: 'jira', confluence: 'confluence' } } },
]
/** 설정 조건 표(칸 conditions_on). 설정 하나가 허용하면 grants(holder → target, caps), 막으면 conditions(exclude) — 엔진 semantic/settings.ts */
export interface SemanticSetting { name: string; select: Record<string, unknown>; level?: string; property?: string; values?: Record<string, 'allow' | 'deny'>; default: 'allow' | 'deny'; holder: string; except?: Record<string, unknown>; exempt?: Record<string, unknown>; target: string; caps: readonly string[]; label: string }
export const SEMANTIC_SETTINGS: readonly SemanticSetting[] = [
  { name: 'slack_member_app_install', select: { source: { provider: 'slack', object_type: '200.team' } }, level: 'workspace', property: 'member_app_install', values: { allow: 'allow', approval_required: 'deny', admins_only: 'deny' }, default: 'allow', holder: 'tenant', except: { any: [{ source: { property: { is_restricted: true } } }, { source: { property: { is_ultra_restricted: true } } }, { source: { property: { is_bot: true } } }, { source: { property: { is_app_user: true } } }, { source: { object_type: '200.bot' } }] }, exempt: { any: [{ source: { property: { is_admin: true } } }, { source: { property: { is_owner: true } } }, { source: { property: { is_primary_owner: true } } }] }, target: 'objects:defs_app_id', caps: ['grant'], label: '워크스페이스 설정 — 구성원이 앱을 설치하고 scope 를 준다' },
]

export const CAPABILITY_VOCABULARY: Record<string, { rank: number }> = {
  authenticate: { rank: 1 },
  read: { rank: 1 },
  write: { rank: 3 },
  create: { rank: 3 },
  delete: { rank: 3 },
  share: { rank: 3 },
  send: { rank: 3 },
  execute: { rank: 3 },
  configure: { rank: 3 },
  grant: { rank: 5 },
}
export const CAPABILITY_BUNDLES: Record<string, readonly string[]> = {
  none: [],
  use: ['read'],
  edit: ['read', 'write', 'create', 'delete'],
  manage: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'],
}
/** 세기 → 능력 목록 (rank_capabilities 를 편 것) */
export const CAPABILITY_OF_RANK: Record<number, readonly string[]> = {
  '0': [],
  '1': ['read'],
  '2': ['read'],
  '3': ['read', 'write', 'create', 'delete'],
  '4': ['read', 'write', 'create', 'delete'],
  '5': ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'],
}
export const CAPABILITY_ORDER = ['permissions', 'name', 'scopes', 'privileges', 'flags', 'object_type', 'grants', 'permission_prefixes', 'base_role'] as const
/** 이름 단계 표: provider 마다, 다음 '*'. 위에서부터 처음 맞는 줄 (capability_name_steps 를 편 것) */
export const CAPABILITY_NAMES: Record<string, ReadonlyArray<{ match: string; ignore_case?: boolean; caps: readonly string[]; applies_to?: readonly string[] }>> = {
  okta: [
    { match: '^super_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
    { match: '^org_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
    { match: '^app_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'], applies_to: ['application'] },
    { match: '^user_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'], applies_to: ['user', 'userfactor', 'group'] },
    { match: '^group_membership_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'], applies_to: ['group'] },
    { match: '^help_desk_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'], applies_to: ['user', 'userfactor'] },
    { match: '^mobile_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'], applies_to: ['device'] },
    { match: '^api_access_management_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'], applies_to: ['authorizationserver'] },
    { match: '^read_only_admin$', ignore_case: true, caps: ['read'] },
    { match: '^report_admin$', ignore_case: true, caps: ['read'], applies_to: ['log'] },
    { match: '^workflows_admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'], applies_to: ['workflow'] },
    { match: '^assigned$', ignore_case: true, caps: ['authenticate', 'read'] },
  ],
  salesforce: [
    { match: '^authorized$', ignore_case: true, caps: ['authenticate'] },
    { match: '^authorized$', caps: ['read'] },
  ],
  atlassian: [
    { match: '^ADMINISTER_PROJECTS$', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
    { match: '^(EDIT_WORKFLOW|EDIT_ISSUE_LAYOUT)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(BROWSE_PROJECTS|VIEW_DEV_TOOLS|VIEW_READONLY_WORKFLOW|VIEW_VOTERS_AND_WATCHERS)$', caps: ['read'] },
    { match: '^ASSIGNABLE_USER$', caps: [] },
    { match: '^(MANAGE_SPRINTS_PERMISSION|SERVICEDESK_AGENT)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(ASSIGN_ISSUES|CLOSE_ISSUES|CREATE_ISSUES|DELETE_ISSUES|EDIT_ISSUES|LINK_ISSUES|MODIFY_REPORTER|MOVE_ISSUES|RESOLVE_ISSUES|SCHEDULE_ISSUES|SET_ISSUE_SECURITY|TRANSITION_ISSUES)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(MANAGE_WATCHERS|ADD_COMMENTS|DELETE_ALL_COMMENTS|DELETE_OWN_COMMENTS|EDIT_ALL_COMMENTS|EDIT_OWN_COMMENTS|CREATE_ATTACHMENTS|DELETE_ALL_ATTACHMENTS|DELETE_OWN_ATTACHMENTS|DELETE_ALL_WORKLOGS|DELETE_OWN_WORKLOGS|EDIT_ALL_WORKLOGS|EDIT_OWN_WORKLOGS|WORK_ON_ISSUES)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^view$', caps: ['read'] },
    { match: '^edit$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^administer:space$', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
    { match: '^(read|export):space$', caps: ['read'] },
    { match: '^(create|update|delete|copy|move|archive|restore|purge|purge_version|restrict_content):[A-Za-z]+$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^atlassian/org-admin$', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
  ],
  slack: [
    { match: '^primary_owner$', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
    { match: '^collaborator$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^Rl02$', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
    { match: '^(Rl01|Rl0A)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(Rl03|Rl0J)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(Rl0D|Rl0K)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(Rl09|Rl04|Rl0F|Rl0G)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(Rl0C|Rl0L|Rl0E)$', caps: ['read'] },
  ],
  github: [
    { match: '^(security_manager|Security manager)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(ci_cd_admin|CI/CD admin)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(app_manager|App Manager|App manager)$', caps: ['read', 'write', 'create', 'delete'] },
    { match: '^(moderator|Moderator)$', caps: ['read'] },
  ],
  '*': [
    { match: '^none$', ignore_case: true, caps: [] },
    { match: '^read$', ignore_case: true, caps: ['read'] },
    { match: '^pull$', ignore_case: true, caps: ['read'] },
    { match: '^triage$', ignore_case: true, caps: ['read'] },
    { match: '^write$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'] },
    { match: '^push$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'] },
    { match: '^maintain$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'] },
    { match: '^admin$', ignore_case: true, caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
    { match: '^reader$', ignore_case: true, caps: ['read'] },
    { match: '^commenter$', ignore_case: true, caps: ['read'] },
    { match: '^writer$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'] },
    { match: '^fileorganizer$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'] },
    { match: '^organizer$', ignore_case: true, caps: ['read', 'write', 'create', 'delete'] },
    { match: '^owner$', ignore_case: true, caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] },
    { match: '^read_only_admin$', ignore_case: true, caps: ['read'] },
  ],
}
export const CAPABILITY_SUMMARY: { split: string; kv: string; levels: Record<string, readonly string[]> } = { split: ',', kv: ':', levels: { read: ['read'], write: ['read', 'write', 'create', 'delete'], admin: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] } }
export const CAPABILITY_SCOPES: { from: string; tables: Record<string, ReadonlyArray<{ match: string; caps: readonly string[] }>> } = { from: 'properties.scopes', tables: { slack: [{ match: '^admin', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] }, { match: '^chat:write(\\.public)?$', caps: ['read', 'write', 'create', 'delete'] }, { match: '^(channels|groups|im|mpim):(history|read)$', caps: ['read'] }] } }
export const CAPABILITY_PRIVILEGES: { from: string; tables: Record<string, ReadonlyArray<{ match: string; caps: readonly string[] }>> } = { from: 'properties.privileges', tables: { gws: [{ match: ':(SUPER_ADMIN|ROOT_APP_ADMIN)$', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] }, { match: ':([A-Z_]+_(RETRIEVE|READ|READ_ONLY)|[A-Z_]+_READ_[A-Z_]+|RETRIEVE_[A-Z_]+|(SIT_)?VIEW_[A-Z_]+|TELEMETRY_API(_[A-Z_]+)?|ADMIN_DASHBOARD|ADMIN_REPORTING_ACCESS|REPORTS_ACCESS)$', caps: ['read'] }, { match: ':([A-Z_]+_(ALL|CREATE|UPDATE|DELETE|MOVE|ALIAS|SUSPEND|ADD_NICKNAME|RESET_PASSWORD|FORCE_PASSWORD_CHANGE|READWRITE|FULL_ACCESS|ADMIN)|[A-Z_]*MANAGE_[A-Z_]+|REVIEW_ALL_SENSITIVE_ACTIONS)$', caps: ['read', 'write', 'create', 'delete'] }] } }
export const CAPABILITY_FLAGS: Record<string, ReadonlyArray<{ field: string; caps: readonly string[] }>> = { salesforce: [{ field: 'properties.perm_ModifyAllData', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] }, { field: 'properties.perm_ManageUsers', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] }, { field: 'properties.perm_AuthorApex', caps: ['read', 'write', 'create', 'delete', 'share', 'configure', 'grant'] }, { field: 'properties.perm_ViewAllData', caps: ['read'] }, { field: 'properties.perm_ApiEnabled', caps: [] }] }
export const CAPABILITY_OBJECT_TYPES: Record<string, Record<string, readonly string[]>> = { salesforce: { UserRole: [], PermissionSetLicense: [] } }
export const CAPABILITY_FROM_GRANTS: Record<string, readonly string[]> = { atlassian: ['ProjectRole'] }
export const CAPABILITY_PREFIXES: Record<string, { from: string; read_suffix: string; read_caps: readonly string[]; other_caps: readonly string[]; prefixes: ReadonlyArray<{ prefix: string; applies_to: readonly string[] }> }> = { okta: { from: 'properties.permissions', read_suffix: '.read', read_caps: ['read'], other_caps: ['read', 'write', 'create', 'delete'], prefixes: [{ prefix: 'okta.users.', applies_to: ['user', 'userfactor'] }, { prefix: 'okta.groups.', applies_to: ['group'] }, { prefix: 'okta.apps.', applies_to: ['application'] }, { prefix: 'okta.authzServers.', applies_to: ['authorizationserver'] }, { prefix: 'okta.devices.', applies_to: ['device'] }] } }
/** 기반 역할(properties.base_role) — 이름은 '*' 이름 표로 센다 (capabilities.yaml role_rank_order 의 base_role) */
export const CAPABILITY_BASE_ROLE = { from: 'properties.base_role', names: '*' } as const
export const MEMBERSHIP_CAPABILITIES: { default: readonly string[]; rows: ReadonlyArray<{ provider: string; target_type: string; caps: readonly string[] }> } = { default: ['read'], rows: [{ provider: 'slack', target_type: 'conversation', caps: ['read', 'write', 'send'] }] }

// ---- SaaS 를 넘는 연결 규칙 (crosswalk.yaml). 정규화는 scripts/collect/shared/crosswalk.ts 가 사본 ontology/crosswalk.yaml 을 읽어 잇는다

export const CROSSWALK_KINDS: Record<string, { method: string | null; a: readonly string[]; b: readonly string[]; same: string; evidence: string; makes: string; nowIn: readonly string[] }> = {
  secret_fingerprint: { method: null, a: ['Automation'], b: ['Credential'], same: 'exact', evidence: 'stated', makes: 'relation:runs_as', nowIn: ['cross.ts:runs_as'] },
  tenant_pointer: { method: null, a: ['Integration'], b: ['Tenant'], same: 'casefold', evidence: 'stated', makes: 'relation:registered_in', nowIn: ['cross.ts:registered_in'] },
  request_target: { method: null, a: ['Automation'], b: ['Endpoint'], same: 'exact', evidence: 'stated', makes: 'relation:triggered_by', nowIn: [] },
  request_host: { method: null, a: ['Endpoint'], b: ['Tenant'], same: 'casefold', evidence: 'stated', makes: 'relation:receives_into', nowIn: [] },
  request_resource: { method: null, a: ['Endpoint'], b: ['Resource'], same: 'casefold', evidence: 'stated', makes: 'relation:receives_into', nowIn: [] },
  action_resource: { method: null, a: ['Endpoint'], b: ['Resource'], same: 'exact', evidence: 'stated', makes: 'relation:receives_into', nowIn: [] },
  vendor_app_pair: { method: null, a: ['Integration'], b: ['Tenant'], same: 'exact', evidence: 'stated', makes: 'relation:registered_in', nowIn: [] },
  credential_endpoint: { method: null, a: ['Credential'], b: ['Tenant'], same: 'casefold', evidence: 'stated', makes: 'relation:has_role_on', nowIn: [] },
  vendor_foreign_key: { method: 'M1', a: ['Principal'], b: ['Principal'], same: 'exact', evidence: 'stated', makes: 'link', nowIn: ['identity.ts:okta_appuser_external_id'] },
  federated_subject: { method: 'M2', a: ['Principal'], b: ['Principal'], same: 'casefold', evidence: 'stated', makes: 'link', nowIn: ['identity.ts:saml_external_identity', 'identity.ts:okta_app_assignment_username'] },
  natural_key: { method: 'M3', a: ['Principal'], b: ['Principal'], same: 'casefold', evidence: 'stated', makes: 'link', nowIn: ['identity.ts:natural_key_email'] },
  log_correlation: { method: 'M4', a: ['Integration', 'Principal'], b: ['Principal'], same: 'co_occurs', evidence: 'observed', makes: 'link', nowIn: ['identity.ts:worker_log_correlation'] },
}
export const CROSSWALK_FIELDS: ReadonlyArray<{ kind: string; side: string; provider?: string; objectType?: string; path?: string }> = [
  { kind: 'tenant_pointer', side: 'a', provider: 'atlassian', objectType: 'RovoConnector', path: 'properties.target_salesforce_domain' },
  { kind: 'tenant_pointer', side: 'b', provider: 'salesforce', objectType: 'Organization', path: 'properties.api_instance_host' },
  { kind: 'secret_fingerprint', side: 'a', provider: 'gws', objectType: 'Project', path: 'properties.webhook_url_sha256' },
  { kind: 'secret_fingerprint', side: 'a', provider: 'atlassian', objectType: 'AutomationRule', path: 'properties.request_secret_fingerprints' },
  { kind: 'secret_fingerprint', side: 'b', provider: 'slack', objectType: 'incoming-webhook', path: 'properties.webhook_url_sha256' },
  { kind: 'tenant_pointer', side: 'a', provider: 'okta', objectType: 'Application', path: 'properties.githubOrg' },
  { kind: 'tenant_pointer', side: 'a', provider: 'okta', objectType: 'Application', path: 'properties.githubEnterprise' },
  { kind: 'tenant_pointer', side: 'a', provider: 'okta', objectType: 'Application', path: 'properties.slackDomain' },
  { kind: 'tenant_pointer', side: 'a', provider: 'okta', objectType: 'Application', path: 'properties.googleDomain' },
  { kind: 'tenant_pointer', side: 'a', provider: 'okta', objectType: 'Application', path: 'properties.settings.app.loginUrl' },
  { kind: 'tenant_pointer', side: 'b', provider: 'github', objectType: 'Organization', path: 'properties.login' },
  { kind: 'tenant_pointer', side: 'b', provider: 'github', objectType: 'Enterprise', path: 'properties.slug' },
  { kind: 'tenant_pointer', side: 'b', provider: 'slack', objectType: 'workspace', path: 'properties.domain' },
  { kind: 'tenant_pointer', side: 'b', provider: 'slack', objectType: 'enterprise', path: 'properties.domain' },
  { kind: 'tenant_pointer', side: 'b', provider: 'gws', objectType: 'Customer', path: 'properties.customerDomain' },
  { kind: 'tenant_pointer', side: 'b', provider: 'gws', objectType: 'User', path: 'properties.primaryEmail' },
  { kind: 'request_target', side: 'a', provider: 'gws', objectType: 'Project', path: 'properties.deployments[].deploymentId' },
  { kind: 'request_target', side: 'b', provider: 'slack', objectType: 'Slash Command Request Endpoint', path: 'properties.url_path' },
  { kind: 'request_target', side: 'b', provider: 'github', objectType: 'Webhook', path: 'properties.target_deployment_id' },
  { kind: 'request_target', side: 'a', provider: 'atlassian', objectType: 'AutomationRule', path: 'properties.incoming_rule_key' },
  { kind: 'request_target', side: 'b', provider: 'github', objectType: 'Webhook', path: 'properties.target_automation_rule_key' },
  { kind: 'request_target', side: 'a', provider: 'worker', objectType: 'WorkerScript', path: 'properties.ingress_post_sha256' },
  { kind: 'request_target', side: 'b', provider: 'slack', objectType: 'Slash Command Request Endpoint', path: 'properties.url_sha256' },
  { kind: 'request_target', side: 'b', provider: 'github', objectType: 'Webhook', path: 'properties.url.sha256' },
  { kind: 'request_target', side: 'b', provider: 'atlassian', objectType: 'AutomationRequestEndpoint', path: 'properties.url_sha256' },
  { kind: 'request_host', side: 'a', provider: 'slack', objectType: 'Slash Command Request Endpoint', path: 'properties.url_host' },
  { kind: 'request_host', side: 'b', provider: 'okta', objectType: 'org', path: 'properties.subdomain' },
  { kind: 'request_host', side: 'a', provider: 'github', objectType: 'WorkflowRequestEndpoint', path: 'properties.url_host' },
  { kind: 'request_host', side: 'a', provider: 'github', objectType: 'WorkflowRequestEndpoint', path: 'properties.url_host' },
  { kind: 'request_host', side: 'b', provider: 'atlassian', objectType: 'site', path: 'properties.baseUrl' },
  { kind: 'request_resource', side: 'a', provider: 'atlassian', objectType: 'AutomationRequestEndpoint', path: 'properties.url_github_repo' },
  { kind: 'request_resource', side: 'b', provider: 'github', objectType: 'Repository', path: 'properties.full_name' },
  { kind: 'action_resource', side: 'a', provider: 'salesforce', objectType: 'FlowSlackActionEndpoint', path: 'properties.slack_conversation_id' },
  { kind: 'action_resource', side: 'b', provider: 'slack', objectType: 'conversation', path: 'properties.id' },
  { kind: 'vendor_app_pair', side: 'a', provider: 'github', objectType: 'GitHub App Installation Registration', path: 'properties.app_id' },
  { kind: 'vendor_app_pair', side: 'b', provider: 'slack', objectType: 'Slack App Installation Registration', path: 'properties.app_id' },
  { kind: 'vendor_app_pair', side: 'a', provider: 'slack', objectType: 'Slack App Installation Registration', path: 'properties.app_id' },
  { kind: 'vendor_app_pair', side: 'b', provider: 'salesforce', objectType: 'OauthToken', path: 'properties.AppName' },
  { kind: 'vendor_app_pair', side: 'a', provider: 'slack', objectType: 'Slack App Installation Registration', path: 'properties.app_id' },
  { kind: 'vendor_app_pair', side: 'b', provider: 'gws', objectType: 'Token', path: 'properties.clientId' },
  { kind: 'vendor_app_pair', side: 'a', provider: 'github', objectType: 'GitHub App Installation Registration', path: 'properties.app_id' },
  { kind: 'vendor_app_pair', side: 'b', provider: 'gws', objectType: 'Token', path: 'properties.clientId' },
  { kind: 'vendor_app_pair', side: 'a', provider: 'github', objectType: 'GitHub App Installation Registration', path: 'properties.app_id' },
  { kind: 'vendor_app_pair', side: 'b', provider: 'atlassian', objectType: 'User', path: 'properties.accountId' },
  { kind: 'credential_endpoint', side: 'a', provider: 'salesforce', objectType: 'NamedCredential', path: 'properties.Endpoint.host' },
  { kind: 'credential_endpoint', side: 'b', provider: 'atlassian', objectType: 'site', path: 'properties.baseUrl' },
  { kind: 'vendor_foreign_key', side: 'a', provider: 'okta', objectType: 'AppUser', path: 'properties.externalId' },
  { kind: 'vendor_foreign_key', side: 'a', provider: 'okta', objectType: 'AppUser', path: 'properties.externalId' },
  { kind: 'vendor_foreign_key', side: 'b', provider: 'gws', objectType: 'User', path: 'identifiers.id' },
  { kind: 'vendor_foreign_key', side: 'b', provider: 'slack', objectType: 'user', path: 'identifiers.id' },
  { kind: 'federated_subject', side: 'a', provider: 'okta', objectType: 'User', path: 'properties.login' },
  { kind: 'federated_subject', side: 'b', provider: 'github', objectType: 'ExternalIdentity', path: 'properties.name_id' },
  { kind: 'federated_subject', side: 'a', provider: 'okta', objectType: 'AppUser', path: 'properties.userName' },
  { kind: 'federated_subject', side: 'b', provider: 'gws', objectType: 'User', path: 'properties.primaryEmail' },
  { kind: 'federated_subject', side: 'b', provider: 'gws', objectType: 'User', path: 'properties.aliases' },
  { kind: 'federated_subject', side: 'b', provider: 'gws', objectType: 'User', path: 'properties.nonEditableAliases' },
  { kind: 'federated_subject', side: 'a', provider: 'okta', objectType: 'AppUser', path: 'properties.userName' },
  { kind: 'federated_subject', side: 'b', provider: 'salesforce', objectType: 'User', path: 'identifiers.federation_id' },
  { kind: 'federated_subject', side: 'b', provider: 'salesforce', objectType: 'User', path: 'identifiers.username' },
  { kind: 'natural_key', side: 'a', provider: 'okta', objectType: 'User', path: 'properties.login' },
  { kind: 'natural_key', side: 'b', provider: 'slack', objectType: 'user', path: 'properties.email' },
  { kind: 'natural_key', side: 'a', provider: 'okta', objectType: 'User', path: 'properties.login' },
  { kind: 'natural_key', side: 'b', provider: 'salesforce', objectType: 'User', path: 'identifiers.email' },
  { kind: 'natural_key', side: 'b', provider: 'salesforce', objectType: 'User', path: 'identifiers.username' },
  { kind: 'natural_key', side: 'a', provider: 'okta', objectType: 'User', path: 'properties.login' },
  { kind: 'natural_key', side: 'b', provider: 'atlassian', objectType: 'User', path: 'identifiers.email' },
  { kind: 'natural_key', side: 'a', provider: 'okta', objectType: 'User', path: 'properties.login' },
  { kind: 'natural_key', side: 'b', provider: 'gws', objectType: 'User', path: 'properties.primaryEmail' },
  { kind: 'natural_key', side: 'a', provider: 'okta', objectType: 'User', path: 'properties.login' },
  { kind: 'natural_key', side: 'b', provider: 'github', objectType: 'User Account', path: 'properties.verified_domain_emails' },
  { kind: 'natural_key', side: 'a', provider: 'okta', objectType: 'AppUser', path: 'properties.userName' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.primaryEmail' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.aliases' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.nonEditableAliases' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.primaryEmail' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.aliases' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.nonEditableAliases' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.primaryEmail' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.aliases' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.nonEditableAliases' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.primaryEmail' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.aliases' },
  { kind: 'natural_key', side: 'a', provider: 'gws', objectType: 'User', path: 'properties.nonEditableAliases' },
  { kind: 'log_correlation', side: 'record' },
  { kind: 'log_correlation', side: 'a', provider: 'okta', objectType: 'Application', path: 'properties.client_id' },
  { kind: 'log_correlation', side: 'b', provider: 'slack', objectType: 'user', path: 'properties.app_id' },
]

// ---- 사건 사전 (activity_types.yaml). 사건 기록(Activity)은 scripts/collect/shared/activities.ts 가 이 표로 만든다
//      이 단계는 보관만 한다(간선, EA, 격차에 쓰지 않음). observation 이 있는 줄은 observations.ts 가 관측도 만든다

export const ACTIVITY_VOCABULARY: Record<string, readonly string[]> = {
  verbs: ['read', 'write', 'create', 'delete', 'grant', 'revoke', 'configure', 'authenticate', 'execute', 'send', 'export', 'request', 'activate'],
  effect_kinds: ['relation_created', 'relation_removed', 'relation_modified', 'object_created', 'object_removed', 'object_state_changed', 'object_attr_changed', 'setting_changed', 'exercised', 'denied', 'none'],
  actor_kinds: ['human', 'integration', 'automation', 'credential', 'system', 'anonymous'],
  via_as: ['app', 'token', 'bot', 'automation', 'agent', 'delegation'],
  slots: ['target', 'source', 'role', 'assignment', 'container', 'policy', 'destination', 'credential', 'object', 'counterparty'],
  outcomes: ['success', 'failure', 'unknown', 'success_implied'],
  deny_kinds: ['policy', 'no_relation', 'app_code', 'protocol'],
  decision_results: ['allow', 'deny', 'challenge'],
  unmatched: ['not_in_graph', 'ambiguous', 'name_only'],
  fits: ['fits', 'fits_with_attr', 'no_fit', 'n/a'],
  snapshot_gaps: ['not_collected', 'not_extracted', 'identity'],
  self_services: ['actor', 'target'],
}
export interface ActivityKindRule { path?: string; map?: Record<string, string>; regex?: string; kind?: string }
export interface ActivityTargetSpec { each?: string; id?: readonly string[]; join?: { paths: readonly string[]; sep: string }; type?: string; slot?: string; slot_by?: { path: string; map: Record<string, string> }; regex?: string; normalize?: readonly string[]; name_only?: boolean; params?: readonly string[] }
export interface ActivityCallShape {
  provider?: string; same_as?: string; records?: string; children?: string; key?: readonly string[]
  event_type?: string | { join: readonly string[]; sep: string }; occurred_at?: string
  params?: { list: string; name: string; value: readonly string[] }
  actor?: { id: readonly string[]; type?: string; kind?: readonly ActivityKindRule[] }
  via?: ReadonlyArray<{ id: readonly string[]; join?: { paths: readonly string[]; sep: string }; as: string; when?: string }>
  targets?: readonly ActivityTargetSpec[]; slots?: Record<string, string>; kinds?: Record<string, readonly string[]>
  outcome?: { path: string; map?: Record<string, string>; default?: string }; outcome_reason?: string
  session?: { id?: string; root_id?: string; auth_method?: string }; job?: { id?: string; step?: string }
  change?: ReadonlyArray<{ each?: string; field?: string; before?: string; after?: string; names?: string; sep?: string }>
  decision?: { result?: { path: string; map: Record<string, string> }; policy?: string; rule?: string }
}
export interface ActivityEffectRule { kind: string; relation_type?: string; from?: string; to?: string; role?: string; at?: string; interface?: string }
export interface ActivityTypeRow { calls: readonly string[]; verb: string; effects: readonly ActivityEffectRule[]; outcome?: string; slots?: Record<string, string>; decision?: boolean; deny_kind?: string; signal?: boolean; self_possible?: boolean; self_service?: 'actor' | 'target'; observation?: string; fit: string }
export const ACTIVITY_CALLS: Record<string, ActivityCallShape> = {
  'OK-12': { provider: 'okta', records: '', key: ['uuid'], event_type: 'eventType', occurred_at: 'published', actor: { id: ['actor.id', 'actor.alternateId'], type: 'actor.type', kind: [{ path: 'actor.type', map: { User: 'human', PublicClientApp: 'integration', Client: 'integration', SystemPrincipal: 'system' } }] }, targets: [{ each: 'target[]', id: ['id', 'alternateId'], type: 'type', slot_by: { path: 'detailEntry.previousPolicy', map: { true: 'source' } } }], slots: { UserGroup: 'container', AppInstance: 'container', ResourceSet: 'container', RESOURCE_SET: 'container', AppUser: 'assignment', ConsentGrant: 'assignment', ROLE_ASSIGNED: 'assignment', CUSTOM_ROLE_BINDING_ADDED: 'assignment', PolicyEntity: 'policy', PolicyRule: 'policy', Policy: 'policy', 'Bucket UUID': 'policy', 'Bucket Uuid': 'policy', ROLE: 'role', Role: 'role', CUSTOM_ROLE: 'role', AuthenticatorEnrollment: 'credential', 'Factor Type': 'credential', access_token: 'credential', refresh_token: 'credential', id_token: 'credential', code: 'credential', Token: 'credential', OAuth2ClientSecretEntity: 'credential', Connection: 'credential' }, outcome: { path: 'outcome.result', map: { SUCCESS: 'success', ALLOW: 'success', FAILURE: 'failure', DENY: 'failure' }, default: 'unknown' }, outcome_reason: 'outcome.reason', session: { id: 'authenticationContext.externalSessionId', root_id: 'authenticationContext.rootSessionId', auth_method: 'authenticationContext.credentialType' }, job: { id: 'transaction.id', step: 'authenticationContext.authenticationStep' }, change: [{ names: 'debugContext.debugData.changedAttributes', sep: ',' }, { each: 'target[]', field: 'type', before: 'changeDetails.from', after: 'changeDetails.to' }], decision: { result: { path: 'outcome.result', map: { ALLOW: 'allow', SUCCESS: 'allow', DENY: 'deny', FAILURE: 'deny', CHALLENGE: 'challenge' } } } },
  'GW-10': { provider: 'gws', records: 'items', children: 'events[]', key: ['id.uniqueQualifier', 'id.time', 'etag'], event_type: { join: ['$parent.id.applicationName', 'name'], sep: ':' }, occurred_at: '$parent.id.time', params: { list: 'parameters[]', name: 'name', value: ['value', 'multiValue', 'intValue', 'boolValue'] }, actor: { id: ['$parent.actor.profileId', '$parent.actor.email'], kind: [{ path: '$parent.actor.email', regex: 'gserviceaccount\\.com$', kind: 'integration' }, { path: '$parent.actor.callerType', map: { KEY: 'credential' } }, { path: '$parent.actor.email', regex: '.', kind: 'human' }, { path: '$parent.actor.profileId', regex: '.', kind: 'human' }] }, via: [{ id: ['$parent.actor.applicationInfo.oauthClientId'], as: 'app' }], targets: [{ params: ['doc_id', 'target_user', 'USER_EMAIL', 'GROUP_EMAIL', 'group_email', 'member_id', 'user_email', 'ORG_UNIT_NAME', 'ROLE_NAME', 'DOMAIN_NAME', 'target_domain', 'SETTING_NAME', 'ALERT_ID', 'RULE_NAME', 'shared_drive_id', 'destination_folder_id', 'source_folder_id', 'APPLICATION_NAME', 'SCRIPT_ID', 'CALENDAR_ID', 'RESOURCE_IDENTIFIER', 'email_forwarding_destination_address'] }, { join: { paths: ['$parent.actor.profileId', 'param:client_id'], sep: '|' }, id: ['param:client_id'], type: '=client_id' }, { each: '$parent.resourceDetails[]', id: ['id'], type: 'type' }], slots: { GROUP_EMAIL: 'container', group_email: 'container', ORG_UNIT_NAME: 'container', DOMAIN_NAME: 'container', target_domain: 'container', ROLE_NAME: 'role', SETTING_NAME: 'policy', RULE_NAME: 'policy', shared_drive_id: 'container', destination_folder_id: 'destination', source_folder_id: 'source' }, kinds: { target_user: ['User'], USER_EMAIL: ['User'], user_email: ['User'] }, outcome: { path: 'status.eventStatus', map: { SUCCEEDED: 'success', SUCCESS: 'success', FAILED: 'failure', FAILURE: 'failure' }, default: 'success_implied' }, change: [{ field: 'param:SETTING_NAME', before: 'param:OLD_VALUE', after: 'param:NEW_VALUE' }, { field: '=visibility', before: 'param:old_visibility', after: 'param:visibility' }] },
  'SL-11': { provider: 'slack', records: 'entries', key: ['id'], event_type: 'action', occurred_at: 'date_create', actor: { id: ['actor.user.id', 'actor.user.email'], type: 'actor.type', kind: [{ path: 'actor.type', map: { user: 'human' } }] }, via: [{ id: ['context.app.id'], as: 'app' }, { id: ['context.acting_agent'], as: 'agent' }], targets: [{ id: ['entity.user.id'], type: '=user' }, { id: ['entity.channel.id'], type: '=channel' }, { id: ['entity.app.id'], type: '=app' }, { id: ['entity.workspace.id'], type: '=workspace' }, { id: ['entity.enterprise.id'], type: '=enterprise' }, { id: ['entity.file.id'], type: '=file' }, { id: ['entity.usergroup.id'], type: '=usergroup' }, { id: ['entity.workflow.id'], type: '=workflow' }, { id: ['entity.role.id'], type: '=role' }, { id: ['entity.external_auth_oauth2_token.id'], type: '=external_auth_oauth2_token' }, { id: ['entity.external_data_source.id'], type: '=external_data_source' }, { id: ['details.target_user'], type: '=user' }, { id: ['details.target_user_id'], type: '=user' }, { each: 'details.affected_users[]', id: ['.'], type: '=user' }, { id: ['details.app_id'], type: '=app' }, { id: ['details.api_app_id'], type: '=app' }, { id: ['details.shared_with.channel_id'], type: '=channel', slot: 'destination' }, { id: ['context.location.id'], type: 'context.location.type' }], slots: { workspace: 'container', enterprise: 'container', role: 'role' }, outcome: { path: 'details.success', map: { true: 'success', false: 'failure' }, default: 'success_implied' }, session: { id: 'context.session_id' }, change: [{ field: '=scopes', before: 'details.previous_scopes', after: 'details.new_scopes' }], decision: { result: { path: 'details.decision', map: { allow: 'allow', allowed: 'allow', deny: 'deny', denied: 'deny', block: 'deny', blocked: 'deny' } }, rule: 'details.matched_rule.id' } },
  'AT-90': { provider: 'atlassian', records: 'data', key: ['id'], event_type: 'attributes.action', occurred_at: 'attributes.time', actor: { id: ['attributes.actor.id', 'attributes.actor.email'], kind: [{ path: 'attributes.actor.id', regex: '.', kind: 'human' }] }, via: [{ id: ['attributes.actor.auth.tokenId'], as: 'token' }], targets: [{ each: 'attributes.context[]', id: ['id'], type: 'type' }, { each: 'attributes.container[]', id: ['id'], type: 'type', slot: 'container' }], slots: { role: 'role', 'auth-policy': 'policy' }, kinds: { project: ['Project'] }, outcome: { path: '=success_implied' } },
  'JI-90': { provider: 'atlassian', records: 'records', key: ['id'], event_type: 'summary', occurred_at: 'created', actor: { id: ['authorAccountId'], kind: [{ path: 'authorAccountId', regex: '.', kind: 'human' }, { kind: 'system' }] }, targets: [{ id: ['objectItem.id', 'objectItem.name'], type: 'objectItem.typeName' }, { each: 'associatedItems[]', id: ['id', 'name'], type: 'typeName' }], slots: { GROUP: 'container', PROJECT: 'container', PROJECT_ROLE: 'role' }, kinds: { PROJECT: ['Project'], PROJECT_ROLE: ['ProjectRole'] }, outcome: { path: '=success_implied' }, change: [{ each: 'changedValues[]', field: 'fieldName', before: 'changedFrom', after: 'changedTo' }] },
  'CF-90': { provider: 'atlassian', records: 'results', key: ['creationDate', 'summary', 'affectedObject.name', 'affectedObject.objectType'], event_type: 'summary', occurred_at: 'creationDate', actor: { id: ['author.accountId'], kind: [{ path: 'author.accountId', regex: '.', kind: 'human' }, { kind: 'system' }] }, targets: [{ id: ['affectedObject.name'], type: 'affectedObject.objectType', name_only: true }, { each: 'associatedObjects[]', id: ['name'], type: 'objectType', name_only: true }], slots: { Group: 'container', Space: 'container', 'Space ID': 'container', 'Space key': 'container' }, outcome: { path: '=success_implied' }, change: [{ each: 'changedValues[]', field: 'name', before: 'oldValue', after: 'newValue' }] },
  'GH-17': { provider: 'github', records: '', key: ['_document_id'], event_type: 'action', occurred_at: '@timestamp', actor: { id: ['actor', 'actor_id'], kind: [{ path: 'actor_is_bot', map: { true: 'integration' } }, { path: 'actor', regex: '.', kind: 'human' }, { kind: 'system' }] }, via: [{ id: ['token_id'], as: 'token', when: 'programmatic_access_type' }, { id: ['oauth_application_id'], as: 'app' }], targets: [{ id: ['user'], type: '=user' }, { id: ['repo'], type: '=repo' }, { id: ['team'], type: '=team' }, { id: ['hook_id'], type: '=hook' }, { id: ['integration'], type: '=integration' }, { id: ['workflow_id'], type: '=workflow' }, { id: ['environment_name'], type: '=environment' }, { id: ['org'], type: '=org', slot: 'container' }], slots: { repo: 'container', team: 'container' }, outcome: { path: '=success_implied' }, change: [{ field: '=config', before: 'config_was', after: 'config' }] },
  'GH-19': { same_as: 'GH-17' },
  'SF-90': { provider: 'salesforce', records: 'records', key: ['Id'], event_type: 'Action', occurred_at: 'CreatedDate', actor: { id: ['CreatedById'], kind: [{ kind: 'human' }] }, via: [{ id: ['DelegateUser'], as: 'delegation' }], targets: [{ id: ['Display'], regex: '(?<!(?!_)\\w)(005(?:(?!_)\\w){12}(?:(?:(?!_)\\w){3})?)(?!(?!_)\\w)', type: '=User', normalize: ['to_18_char'] }], outcome: { path: '=success_implied' } },
  'GW-16': { provider: 'gws' },
  'SL-05': { provider: 'slack' },
  'SL-12': { provider: 'slack' },
  'GH-18': { provider: 'github' },
  'D-21': { provider: 'slack' },
  'GH-11': { provider: 'github' },
  'RG-GW-alertcenter.alerts.list': { provider: 'gws' },
  'RG-SF-BrowserPolicyViolation': { provider: 'salesforce' },
  'RG-SF-WaveAutoInstallRequest': { provider: 'salesforce' },
}
export const ACTIVITY_TYPES: Record<string, ActivityTypeRow> = {
  'atlassian|Default space roles removed': { calls: ['CF-90'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'atlassian|Deleted Jira issue': { calls: ['JI-90'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|Group created': { calls: ['JI-90', 'CF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[container]' }], fit: 'fits' },
  'atlassian|Project roles changed': { calls: ['JI-90'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'has_role_on', to: 'targets[container]', role: 'targets[role]' }], fit: 'fits' },
  'atlassian|Space created': { calls: ['CF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource', at: 'targets[container]' }], fit: 'fits' },
  'atlassian|Space owner updated': { calls: ['CF-90'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'owned_by', from: 'targets[container]' }], fit: 'fits' },
  'atlassian|Space role assignment set': { calls: ['CF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'atlassian|User added to group': { calls: ['JI-90', 'CF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'atlassian|User created': { calls: ['JI-90', 'CF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|allowance_pool_member_updated': { calls: ['AT-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'atlassian|allowance_pool_updated': { calls: ['AT-90'], verb: 'write', effects: [{ kind: 'none' }], fit: 'n/a' },
  'atlassian|api_token_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'authenticates_with', from: 'targets[target]' }, { kind: 'object_created', interface: 'Credential' }], fit: 'fits' },
  'atlassian|api_token_revoked': { calls: ['AT-90'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'authenticates_with', from: 'targets[target]' }, { kind: 'object_removed', interface: 'Credential' }], fit: 'fits' },
  'atlassian|audit_log_installation_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'atlassian|auth_policy_updated': { calls: ['AT-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'atlassian|automation_flow_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Automation', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|automation_flow_edit_access_mode_updated': { calls: ['AT-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'atlassian|automation_flow_owner_updated': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'owned_by', from: 'targets[target]' }], fit: 'no_fit' },
  'atlassian|confluence_accessed_api': { calls: ['AT-90'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], self_possible: true, fit: 'fits_with_attr' },
  'atlassian|confluence_audit_record_created_user': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|confluence_audit_record_default_space_role_assignment_removed': { calls: ['AT-90'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'atlassian|confluence_audit_record_group_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|confluence_audit_record_group_membership_added': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'atlassian|confluence_audit_record_space_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|confluence_audit_record_space_owner_updated': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'owned_by' }], fit: 'fits' },
  'atlassian|confluence_audit_record_space_role_assignment_set': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on' }], fit: 'fits' },
  'atlassian|confluence_livedoc_created': { calls: ['AT-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource' }], fit: 'fits' },
  'atlassian|confluence_page_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'owned_by', from: 'targets[target]', to: 'targets[container]' }, { kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|confluence_page_updated': { calls: ['AT-90'], verb: 'write', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'atlassian|confluence_page_viewed': { calls: ['AT-90'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'atlassian|confluence_removed_default_space_role_assignment': { calls: ['AT-90'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'atlassian|confluence_set_space_role_assignment': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], slots: { space: 'container' }, fit: 'fits' },
  'atlassian|confluence_space_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|confluence_space_created_v2': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|confluence_space_owner_updated': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'owned_by' }], fit: 'fits' },
  'atlassian|group_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|jira_accessed_api': { calls: ['AT-90'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], self_possible: true, fit: 'fits_with_attr' },
  'atlassian|jira_audit_record_group_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|jira_audit_record_user_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'atlassian|jira_audit_record_user_to_group_added': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'atlassian|jira_issue_created': { calls: ['AT-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource' }], fit: 'fits' },
  'atlassian|jira_issue_viewed': { calls: ['AT-90'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'atlassian|jira_member_added_project_role': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], slots: { project: 'container' }, fit: 'fits' },
  'atlassian|jira_project_role_changed': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'has_role_on' }], fit: 'fits' },
  'atlassian|logs_access_granted': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'atlassian|org_settings_update': { calls: ['AT-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[container]' }], fit: 'fits_with_attr' },
  'atlassian|rovo_ai_3p_connector_connection_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'atlassian|rovo_ai_3p_connector_connection_deleted': { calls: ['AT-90'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_removed', interface: 'Integration', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'atlassian|rovo_chat_invoked': { calls: ['AT-90'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'atlassian|rovo_chat_session_started': { calls: ['AT-90'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'acts_as', to: 'actor' }], fit: 'no_fit' },
  'atlassian|saml_config_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'trusts', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'atlassian|service_account_api_token_created': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'authenticates_with', from: 'targets[target]' }, { kind: 'object_created', interface: 'Credential' }], fit: 'fits' },
  'atlassian|updated_users_claim': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], slots: { orgs: 'container' }, fit: 'fits' },
  'atlassian|user_added_to_group': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], slots: { groups: 'container' }, fit: 'fits' },
  'atlassian|user_auth_policy_changed': { calls: ['AT-90'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'applies_to', from: 'targets[policy]', to: 'targets[target]' }], fit: 'fits' },
  'atlassian|user_created': { calls: ['AT-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[container]' }], fit: 'fits' },
  'atlassian|user_detail_change': { calls: ['AT-90'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], self_service: 'target', fit: 'fits' },
  'atlassian|user_invite_to_org': { calls: ['AT-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }, { kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'atlassian|user_login': { calls: ['AT-90'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'atlassian|user_logout': { calls: ['AT-90'], verb: 'authenticate', effects: [{ kind: 'none' }], fit: 'no_fit' },
  'github|commit': { calls: ['GH-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource', at: 'targets[target]' }, { kind: 'exercised', relation_type: 'has_role_on', from: 'actor' }], fit: 'fits' },
  'github|hook.config_changed': { calls: ['GH-17'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Endpoint', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'github|integration.update': { calls: ['GH-17'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Integration', at: 'targets[target]' }, { kind: 'relation_modified', relation_type: 'has_role_on', from: 'targets[target]' }], fit: 'fits_with_attr' },
  'github|integration_installation.create': { calls: ['GH-17'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'relation_created', relation_type: 'registered_by', from: 'targets[target]', to: 'actor' }, { kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|integration_installation.version_updated': { calls: ['GH-17'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|integration_installation_request.close': { calls: ['GH-17'], verb: 'request', effects: [{ kind: 'none' }], fit: 'fits_with_attr' },
  'github|integration_installation_request.create': { calls: ['GH-17'], verb: 'request', effects: [{ kind: 'none' }], fit: 'fits_with_attr' },
  'github|member.added': { calls: ['GH-18'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'github|oauth_application.create': { calls: ['GH-17'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Integration' }], fit: 'fits_with_attr' },
  'github|oauth_application.generate_client_secret': { calls: ['GH-17'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'github|org.add_member': { calls: ['GH-17'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|org.disable_saml': { calls: ['GH-17'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'trusts', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|org.enable_saml': { calls: ['GH-17'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'trusts', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|org.invite_member': { calls: ['GH-17'], verb: 'request', effects: [{ kind: 'none' }], fit: 'fits_with_attr' },
  'github|org.oauth_app_access_approved': { calls: ['GH-17'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|org.oauth_app_access_requested': { calls: ['GH-17'], verb: 'request', effects: [{ kind: 'none' }], fit: 'fits_with_attr' },
  'github|org.recovery_codes_generated': { calls: ['GH-17'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'github|org.sso_response': { calls: ['GH-17'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'trusts', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'github|org_credential_authorization.grant': { calls: ['GH-17'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', to: 'targets[container]' }], self_service: 'actor', fit: 'fits_with_attr' },
  'github|organization.member_added': { calls: ['GH-18'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'github|organization.member_invited': { calls: ['GH-18'], verb: 'request', effects: [{ kind: 'none' }], fit: 'fits_with_attr' },
  'github|personal_access_token.access_granted': { calls: ['GH-17'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|personal_access_token.request_created': { calls: ['GH-17'], verb: 'request', effects: [{ kind: 'none' }], fit: 'fits_with_attr' },
  'github|personal_access_token_request.approved': { calls: ['GH-18'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[credential]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|personal_access_token_request.created': { calls: ['GH-18'], verb: 'request', effects: [{ kind: 'none' }], fit: 'fits_with_attr' },
  'github|ping.-': { calls: ['GH-18'], verb: 'execute', effects: [{ kind: 'none' }], fit: 'n/a' },
  'github|pull_request.assigned': { calls: ['GH-18'], verb: 'request', effects: [{ kind: 'none' }], fit: 'n/a' },
  'github|pull_request.edited': { calls: ['GH-18'], verb: 'request', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'github|pull_request.opened': { calls: ['GH-18'], verb: 'request', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'github|pull_request.review_requested': { calls: ['GH-18'], verb: 'request', effects: [{ kind: 'none' }], fit: 'n/a' },
  'github|pull_request.synchronize': { calls: ['GH-18'], verb: 'request', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'github|push.-': { calls: ['GH-18'], verb: 'write', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'github|repo.add_member': { calls: ['GH-17'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'github|repo.update_actions_secret': { calls: ['GH-17'], verb: 'configure', effects: [{ kind: 'exercised', relation_type: 'contained_in', from: 'actor', to: 'targets[target]' }, { kind: 'object_state_changed', interface: 'Credential', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'github|repo.update_actions_variable': { calls: ['GH-17'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Resource', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'github|workflows.completed_workflow_run': { calls: ['GH-17'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'github|workflows.created_workflow_run': { calls: ['GH-17'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'github|workflows.prepared_workflow_job': { calls: ['GH-17'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'contained_in', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|ADD_ON:COMPLETED': { calls: ['GW-16'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|EDITOR:COMPLETED': { calls: ['GW-16'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|MENU:COMPLETED': { calls: ['GW-16'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|SIMPLE_TRIGGER:COMPLETED': { calls: ['GW-16'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|TRIGGER:COMPLETED': { calls: ['GW-16'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|UNKNOWN:COMPLETED': { calls: ['GW-16'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|UNKNOWN:FAILED': { calls: ['GW-16'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|User suspended': { calls: ['RG-GW-alertcenter.alerts.list'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Principal', at: 'targets[target]' }], signal: true, fit: 'fits' },
  'gws|admin:ADD_APPLICATION': { calls: ['GW-10'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Integration', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:ADD_NICKNAME': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|admin:ADD_PRIVILEGE': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|admin:ALERT_CENTER_GET_SIT_LINK': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'none' }], fit: 'n/a' },
  'gws|admin:ALERT_CENTER_LIST_CHANGE': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'none' }], fit: 'n/a' },
  'gws|admin:ALERT_CENTER_LIST_FEEDBACK': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'none' }], fit: 'n/a' },
  'gws|admin:ALERT_CENTER_LIST_RELATED_ALERTS': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'none' }], fit: 'n/a' },
  'gws|admin:ALERT_CENTER_UPDATE_ALERT_METADATA': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:ALERT_CENTER_VIEW': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'none' }], fit: 'n/a' },
  'gws|admin:ASSIGN_ROLE': { calls: ['GW-10'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', role: 'targets[role]' }], fit: 'fits' },
  'gws|admin:AUTHORIZE_API_CLIENT_ACCESS': { calls: ['GW-10'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'gws|admin:CHANGE_FIRST_NAME': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:CHANGE_LAST_NAME': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:CHANGE_PASSWORD': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential' }], fit: 'fits_with_attr' },
  'gws|admin:CHANGE_USER_LANGUAGE': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:CHANGE_USER_ORGANIZATION': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'member_of', from: 'targets[target]' }], fit: 'fits' },
  'gws|admin:CHANGE_USER_PHONE_NUMBER': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:CHANGE_USER_RELATION': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'no_fit' },
  'gws|admin:CREATE_APPLICATION_SETTING': { calls: ['GW-10'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'applies_to', from: 'targets[target]', to: 'targets[container]' }, { kind: 'setting_changed', interface: 'Resource', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|admin:CREATE_ORG_UNIT': { calls: ['GW-10'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource', at: 'targets[container]' }], fit: 'fits' },
  'gws|admin:CREATE_ROLE': { calls: ['GW-10'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:CREATE_USER': { calls: ['GW-10'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:DELETE_USER': { calls: ['GW-10'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'gws|admin:GENERATE_CERTIFICATE': { calls: ['GW-10'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'gws|admin:MOVE_USER_TO_ORG_UNIT': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'gws|admin:RENAME_USER': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|admin:SECURITY_INVESTIGATION_ACTION': { calls: ['GW-10'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[target]' }], fit: 'no_fit' },
  'gws|admin:SECURITY_INVESTIGATION_ACTION_COMPLETION': { calls: ['GW-10'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[target]' }], fit: 'no_fit' },
  'gws|admin:SECURITY_INVESTIGATION_OBJECT_CREATE_DRAFT_INVESTIGATION': { calls: ['GW-10'], verb: 'create', effects: [{ kind: 'none' }], fit: 'n/a' },
  'gws|admin:SECURITY_INVESTIGATION_QUERY': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'none' }], fit: 'n/a' },
  'gws|admin:TOGGLE_SERVICE_ENABLED': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[container]' }], fit: 'fits_with_attr' },
  'gws|admin:USER_LICENSE_ASSIGNMENT': { calls: ['GW-10'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]' }], fit: 'fits' },
  'gws|admin:USER_LICENSE_REVOKE': { calls: ['GW-10'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[target]' }], fit: 'fits' },
  'gws|drive:access_item_content': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'gws|drive:access_url': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|drive:add_to_folder': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[destination]' }], fit: 'fits' },
  'gws|drive:change_acl_editors': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Resource', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|drive:change_document_access_scope': { calls: ['GW-10'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'shared_with', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'gws|drive:change_document_visibility': { calls: ['GW-10'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'shared_with', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'gws|drive:change_user_access': { calls: ['GW-10'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], slots: { doc_id: 'container' }, fit: 'fits' },
  'gws|drive:create': { calls: ['GW-10'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource', at: 'targets[target]' }, { kind: 'relation_created', relation_type: 'owned_by', from: 'targets[target]', to: 'actor' }], fit: 'fits' },
  'gws|drive:delete': { calls: ['GW-10'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'gws|drive:download': { calls: ['GW-10'], verb: 'export', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|drive:edit': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'gws|drive:publish_change': { calls: ['GW-10'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'shared_with', from: 'targets[target]' }], fit: 'fits' },
  'gws|drive:rename': { calls: ['GW-10'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'gws|drive:search': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'gws|drive:view': { calls: ['GW-10'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'gws|login:account_disabled_generic': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'gws|login:dbsc_key_binding': { calls: ['GW-10'], verb: 'authenticate', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'no_fit' },
  'gws|login:dbsc_key_validation': { calls: ['GW-10'], verb: 'authenticate', effects: [{ kind: 'none' }], fit: 'no_fit' },
  'gws|login:email_forwarding_out_of_domain': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Principal', at: 'targets[target]' }], slots: { email_forwarding_destination_address: 'destination' }, fit: 'fits_with_attr' },
  'gws|login:login_challenge': { calls: ['GW-10'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|login:login_failure': { calls: ['GW-10'], verb: 'authenticate', effects: [{ kind: 'denied', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], outcome: 'failure', fit: 'fits_with_attr' },
  'gws|login:login_success': { calls: ['GW-10'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|login:login_verification': { calls: ['GW-10'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'gws|login:logout': { calls: ['GW-10'], verb: 'authenticate', effects: [{ kind: 'none' }], fit: 'no_fit' },
  'gws|login:password_edit': { calls: ['GW-10'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential' }], self_service: 'actor', fit: 'fits_with_attr' },
  'gws|token:authorize': { calls: ['GW-10'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], self_possible: true, fit: 'fits_with_attr' },
  'okta|app.generic.unauth_app_access_attempt': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'denied', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], outcome: 'failure', fit: 'fits' },
  'okta|app.oauth2.admin.consent.grant': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on' }, { kind: 'object_created', interface: 'Assignment', at: 'targets[assignment]' }], fit: 'fits_with_attr' },
  'okta|app.oauth2.authorize': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'denied', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }], outcome: 'failure', fit: 'fits_with_attr' },
  'okta|app.oauth2.authorize.code': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }, { kind: 'object_created', interface: 'Credential', at: 'targets[credential]' }], fit: 'fits_with_attr' },
  'okta|app.oauth2.client.lifecycle.activate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Integration', at: 'targets[target]' }], fit: 'fits' },
  'okta|app.oauth2.client.lifecycle.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Integration', at: 'targets[target]' }], fit: 'fits' },
  'okta|app.oauth2.client.privilege.grant': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', role: 'targets[role]' }], fit: 'fits' },
  'okta|app.oauth2.client.read_client_secret': { calls: ['OK-12'], verb: 'read', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[credential]' }], fit: 'fits_with_attr' },
  'okta|app.oauth2.token.grant': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'denied', relation_type: 'authenticates_with', from: 'actor', to: 'targets[credential]' }], outcome: 'failure', self_possible: true, fit: 'fits_with_attr' },
  'okta|app.oauth2.token.grant.access_token': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[credential]' }, { kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }, { kind: 'object_created', interface: 'Credential', at: 'targets[credential]' }], self_possible: true, fit: 'fits_with_attr' },
  'okta|app.oauth2.token.grant.id_token': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[credential]' }, { kind: 'object_created', interface: 'Credential', at: 'targets[credential]' }], fit: 'fits_with_attr' },
  'okta|app.oauth2.token.grant.refresh_token': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[credential]' }, { kind: 'object_created', interface: 'Credential', at: 'targets[credential]' }], fit: 'fits_with_attr' },
  'okta|app.oauth2.token.revoke': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'object_removed', interface: 'Credential', at: 'targets[credential]' }], outcome: 'failure', fit: 'fits' },
  'okta|app.oauth2.token.revoke.implicit.user': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'authenticates_with', from: 'targets[target]' }, { kind: 'object_removed', interface: 'Credential' }], fit: 'fits_with_attr' },
  'okta|app.user_management.push_new_user_success': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }, { kind: 'object_created', interface: 'Assignment', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|application.cache.invalidate': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'none' }], fit: 'n/a' },
  'okta|application.lifecycle.create': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[container]' }, { kind: 'relation_created', relation_type: 'registered_by', from: 'targets[container]', to: 'actor' }, { kind: 'object_created', interface: 'Integration', at: 'targets[container]' }], fit: 'fits' },
  'okta|application.lifecycle.deactivate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Integration', at: 'targets[container]' }], fit: 'fits' },
  'okta|application.lifecycle.update': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Integration', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|application.provision.group_push.push_memberships': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'relation_modified', relation_type: 'member_of', to: 'targets[target]' }], slots: { GroupPushMapping: 'object', UserGroup: 'source', AppGroup: 'target' }, fit: 'fits_with_attr' },
  'okta|application.provision.group_push.pushed': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|application.provision.group_push.updated': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|application.provision.user.deactivate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Assignment', at: 'targets[assignment]' }], fit: 'fits_with_attr' },
  'okta|application.provision.user.deprovision': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_removed', interface: 'Assignment', at: 'targets[assignment]' }], slots: { DeprovisionTask: 'object' }, fit: 'fits_with_attr' },
  'okta|application.provision.user.push': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|application.provision.user.push_profile': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|application.provision.user.sync': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'okta|application.provision.user.verify_exists': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|application.user_membership.add': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Assignment', at: 'targets[target]' }], observation: 'audit_event', fit: 'fits' },
  'okta|application.user_membership.change_username': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }, { kind: 'object_attr_changed', interface: 'Assignment', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|application.user_membership.remove': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_removed', interface: 'Assignment', at: 'targets[target]' }], observation: 'audit_event', fit: 'fits' },
  'okta|application.user_membership.update': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'okta|directory.app_user_profile.bootstrap': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'none' }], fit: 'n/a' },
  'okta|directory.app_user_profile.update': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'none' }], fit: 'n/a' },
  'okta|directory.mapping.update': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|group.application_assignment.add': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], slots: { UserGroup: 'target' }, fit: 'fits' },
  'okta|group.lifecycle.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[container]' }], fit: 'fits' },
  'okta|group.user_membership.add': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], observation: 'audit_event', fit: 'fits' },
  'okta|group.user_membership.remove': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], observation: 'audit_event', fit: 'fits' },
  'okta|iam.resourceset.bindings.add': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'okta|iam.resourceset.bindings.delete': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]', role: 'targets[role]' }], fit: 'fits' },
  'okta|iam.resourceset.create': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'okta|iam.resourceset.resources.add': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'okta|iam.role.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy', at: 'targets[target]' }], fit: 'fits' },
  'okta|policy.evaluate_sign_on': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'applies_to', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'evaluates', from: 'actor', to: 'targets[target]' }], decision: true, deny_kind: 'policy', fit: 'fits_with_attr' },
  'okta|policy.lifecycle.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy', at: 'targets[policy]' }], fit: 'fits' },
  'okta|policy.mapping.create': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'relation_created', relation_type: 'applies_to', from: 'targets[policy]', to: 'targets[container]' }, { kind: 'relation_removed', relation_type: 'applies_to', from: 'targets[source]', to: 'targets[container]' }], fit: 'fits' },
  'okta|policy.rule.activate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Policy', at: 'targets[policy]' }], slots: { PolicyEntity: 'container' }, fit: 'fits' },
  'okta|policy.rule.add': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy', at: 'targets[policy]' }, { kind: 'relation_created', relation_type: 'contained_in', from: 'targets[policy]', to: 'targets[container]' }], slots: { PolicyEntity: 'container' }, fit: 'fits_with_attr' },
  'okta|policy.rule.update': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[policy]' }], slots: { PolicyEntity: 'container' }, fit: 'fits_with_attr' },
  'okta|security.protected_action.attempt': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'applies_to', to: 'actor' }], decision: true, deny_kind: 'policy', fit: 'fits_with_attr' },
  'okta|system.api_token.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential', at: 'targets[credential]' }, { kind: 'relation_created', relation_type: 'authenticates_with', from: 'actor', to: 'targets[credential]' }], fit: 'fits' },
  'okta|system.email.delivery': { calls: ['OK-12'], verb: 'send', effects: [{ kind: 'none' }], fit: 'n/a' },
  'okta|system.import.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.complete_batch': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.custom_object.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.custom_object.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy' }], fit: 'fits_with_attr' },
  'okta|system.import.custom_object.update': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Policy', at: 'targets[container]' }], fit: 'fits_with_attr' },
  'okta|system.import.download.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.download.start': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.group.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.group_membership.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }, { kind: 'relation_modified', relation_type: 'member_of' }], fit: 'no_fit' },
  'okta|system.import.implicit_deletion.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.implicit_deletion.start': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.import_provisioning_info': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.membership_processing.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }, { kind: 'relation_modified', relation_type: 'member_of' }], fit: 'no_fit' },
  'okta|system.import.membership_processing.start': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.object_creation.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.object_creation.start': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.schedule': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.start': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.user.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.user.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Assignment', at: 'targets[assignment]' }, { kind: 'relation_created', relation_type: 'has_role_on', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'okta|system.import.user.delete': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'owned_by', from: 'targets[target]', to: 'targets[container]' }, { kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_removed', interface: 'Assignment', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|system.import.user_match.confirm': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.user_matching.complete': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.import.user_matching.start': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', from: 'actor', to: 'targets[container]' }], fit: 'no_fit' },
  'okta|system.operation.rate_limit.violation': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'denied', relation_type: 'applies_to', from: 'targets[policy]', to: 'actor' }], outcome: 'failure', decision: true, deny_kind: 'policy', signal: true, fit: 'fits_with_attr' },
  'okta|system.org.rate_limit.warning': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'applies_to', from: 'targets[policy]', to: 'actor' }], signal: true, self_possible: true, fit: 'fits' },
  'okta|user.account.privilege.grant': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]', role: 'targets[role]' }], fit: 'fits' },
  'okta|user.account.privilege.revoke': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]', role: 'targets[role]' }, { kind: 'object_removed', interface: 'Assignment', at: 'targets[assignment]' }], slots: { ROLE_UNASSIGNED_ALL_PRIVILEGES_REVOKED: 'assignment' }, fit: 'fits' },
  'okta|user.account.reset_password': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential' }], observation: 'audit_event', fit: 'fits' },
  'okta|user.account.subscriptions.update': { calls: ['OK-12'], verb: 'execute', effects: [{ kind: 'none' }], fit: 'n/a' },
  'okta|user.account.update_password': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential' }], self_service: 'target', fit: 'fits' },
  'okta|user.account.update_profile': { calls: ['OK-12'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], self_service: 'target', observation: 'audit_event', fit: 'fits_with_attr' },
  'okta|user.authentication.auth_via_mfa': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[credential]' }], fit: 'fits' },
  'okta|user.authentication.sso': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'okta|user.authentication.verify': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'okta|user.lifecycle.activate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'okta|user.lifecycle.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'okta|user.lifecycle.deactivate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'okta|user.lifecycle.delete.completed': { calls: ['OK-12'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'okta|user.lifecycle.delete.initiated': { calls: ['OK-12'], verb: 'delete', effects: [{ kind: 'object_state_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|user.lifecycle.reset_password': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential' }], observation: 'audit_event', fit: 'fits' },
  'okta|user.mfa.factor.activate': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'authenticates_with', from: 'targets[target]', to: 'targets[credential]' }, { kind: 'object_created', interface: 'Credential', at: 'targets[credential]' }], self_service: 'target', fit: 'fits' },
  'okta|user.mfa.factor.deactivate': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'authenticates_with', from: 'targets[target]', to: 'targets[credential]' }, { kind: 'object_removed', interface: 'Credential', at: 'targets[credential]' }], self_service: 'target', observation: 'audit_event', fit: 'fits' },
  'okta|user.mfa.factor.reset_all': { calls: ['OK-12'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'authenticates_with', from: 'targets[target]' }], observation: 'audit_event', fit: 'fits' },
  'okta|user.session.access_admin_app': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'okta|user.session.clear': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'none' }], fit: 'no_fit' },
  'okta|user.session.context.change': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'none' }], fit: 'no_fit' },
  'okta|user.session.end': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'none' }], fit: 'no_fit' },
  'okta|user.session.start': { calls: ['OK-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[credential]' }], fit: 'no_fit' },
  'okta|workflows.user.connection.create': { calls: ['OK-12'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential', at: 'targets[credential]' }, { kind: 'relation_created', relation_type: 'owned_by', from: 'targets[credential]', to: 'targets[container]' }, { kind: 'relation_created', relation_type: 'authenticates_with', from: 'actor', to: 'targets[credential]' }], fit: 'fits_with_attr' },
  'okta|workflows.user.connection.folder.assign': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'runs_as', from: 'targets[target]', to: 'targets[credential]' }], fit: 'fits_with_attr' },
  'okta|workflows.user.connection.reauthorize': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential', at: 'targets[credential]' }], fit: 'fits_with_attr' },
  'okta|workflows.user.flow.activate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Automation', at: 'targets[target]' }, { kind: 'denied', from: 'actor', to: 'targets[target]' }], outcome: 'failure', fit: 'fits_with_attr' },
  'okta|workflows.user.flow.create': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Automation', at: 'targets[target]' }], fit: 'fits' },
  'okta|workflows.user.flow.deactivate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|workflows.user.flow.execution_history.activate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|workflows.user.flow.execution_history.deactivate': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|workflows.user.flow.save': { calls: ['OK-12'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'contained_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_state_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'okta|workflows.user.flow.version.revert': { calls: ['OK-12'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|ConnectSrc': { calls: ['RG-SF-BrowserPolicyViolation'], verb: 'read', effects: [{ kind: 'denied', relation_type: 'applies_to', to: 'actor' }], outcome: 'failure', decision: true, deny_kind: 'policy', signal: true, fit: 'fits_with_attr' },
  'salesforce|ExternalServicesCreate': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Endpoint' }], fit: 'fits_with_attr' },
  'salesforce|ExternalServicesDelete': { calls: ['SF-90'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Endpoint', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|ExternalServicesSchemaChange': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Endpoint', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|PermSetAssign': { calls: ['SF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]' }], fit: 'fits' },
  'salesforce|PermSetCreate': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|PermSetCreateNoLicense': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|PermSetEnableUserPerm': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|PermSetEntityPermChanged': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|PermSetGroupStandardChange': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|PermSetGroupUserPermEnabled': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|PermSetLicenseAssign': { calls: ['SF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]' }], fit: 'fits' },
  'salesforce|PermissionSetGroupCalculationComplete': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|PermissionSetGroupCalculationStarted': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|PermissionSetGroupCreate': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|SetupEntityAccessAudit_PermissionSet_BotDefinition_Enabled': { calls: ['SF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on' }], fit: 'fits' },
  'salesforce|SetupEntityAccessAudit_PermissionSet_ExternalCredentialParameter_Enabled': { calls: ['SF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on' }], fit: 'no_fit' },
  'salesforce|SlackSeamlessAuthActivateConnection': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'trusts' }], fit: 'fits_with_attr' },
  'salesforce|SlackSeamlessAuthApproveConnection': { calls: ['SF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'trusts' }], fit: 'fits_with_attr' },
  'salesforce|SlackSeamlessAuthAutoConnection': { calls: ['SF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'trusts' }], fit: 'fits_with_attr' },
  'salesforce|SlackSeamlessAuthRemoveConnection': { calls: ['SF-90'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'trusts' }], fit: 'fits_with_attr' },
  'salesforce|SlackSeamlessAuthUserExport': { calls: ['SF-90'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'trusts', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|SlackSeamlessAuthUserProvisioning': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|WaveAppCreate:Skipped': { calls: ['RG-SF-WaveAutoInstallRequest'], verb: 'create', effects: [{ kind: 'denied', from: 'actor' }], outcome: 'failure', fit: 'fits' },
  'salesforce|activatedinteractiondefinition': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|activatedinteractiondefinitionWithSystemMode': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Automation', at: 'targets[target]' }, { kind: 'setting_changed', interface: 'Automation', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|agentPlatformEnabledOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|autonomousExperienceOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|changeAuthProviderConsumerKey': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|changeAuthProviderConsumerSecret': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|changedUserEmailVerifiedStatusUnverified': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|changedUserEmailVerifiedStatusVerified': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|changedemail': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], self_service: 'target', fit: 'fits_with_attr' },
  'salesforce|changedfederationid': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|changedpassword': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential' }], self_service: 'target', fit: 'fits_with_attr' },
  'salesforce|createdApexClass': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Automation', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|createdgroup': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|createdinteractiondefinition': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Automation', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|createdinteractiondefversion': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Automation' }], fit: 'fits_with_attr' },
  'salesforce|createdoutboundmessage': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Endpoint' }], fit: 'fits' },
  'salesforce|createdrole': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|createduser': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|createdworkflowrule': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Automation' }, { kind: 'relation_created', relation_type: 'triggered_by' }], fit: 'fits' },
  'salesforce|deletedinteractiondefversion': { calls: ['SF-90'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Automation' }], fit: 'fits_with_attr' },
  'salesforce|ecAppChildEntityCreated': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy' }], fit: 'fits' },
  'salesforce|ecAppChildEntityDeleted': { calls: ['SF-90'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Policy' }], fit: 'fits' },
  'salesforce|ecAppChildEntityUpdated': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy' }], fit: 'fits_with_attr' },
  'salesforce|ecAppEntityCreated': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy' }], fit: 'fits' },
  'salesforce|ecAppEntityUpdated': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Credential', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|ecAppGenerateConsumerKey': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'salesforce|ecAppGenerateConsumerSecret': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'salesforce|ecAppInsertValidationCert': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }, { kind: 'relation_created', relation_type: 'authenticates_with' }], fit: 'fits' },
  'salesforce|ecAppPolicyUpdated': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|ecappOauthConsumerSecretGet': { calls: ['SF-90'], verb: 'read', effects: [{ kind: 'exercised', from: 'actor' }], fit: 'fits_with_attr' },
  'salesforce|einsteinGPTPlatformEnabledOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|enabledForecasting': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|eventManagerEventDestinationEnableStore': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Endpoint', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|externalCredentialDelete': { calls: ['SF-90'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Credential', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|externalCredentialInsert': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'salesforce|externalCredentialParameterInsert': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'salesforce|externalSharingModelEnabled': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant' }], fit: 'fits_with_attr' },
  'salesforce|groupMemberAdded': { calls: ['SF-90'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]' }], fit: 'fits' },
  'salesforce|insertAuthProvider': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }, { kind: 'relation_created', relation_type: 'trusts' }], fit: 'fits_with_attr' },
  'salesforce|insertCertificate': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'salesforce|insertConnectedApplication': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Integration' }, { kind: 'relation_created', relation_type: 'registered_by', to: 'actor' }], fit: 'fits' },
  'salesforce|intAccessChanged': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'shared_with' }], fit: 'fits_with_attr' },
  'salesforce|knowledgeEnabledOrgPrefTurnedOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|namedCredentialDelete': { calls: ['SF-90'], verb: 'delete', effects: [{ kind: 'object_removed', interface: 'Credential', at: 'targets[target]' }], fit: 'fits' },
  'salesforce|namedCredentialEncryptedFieldChange': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|namedCredentialFieldChange': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Credential', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|namedCredentialInsert': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'salesforce|namedCredentialParameterInsert': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Credential' }], fit: 'fits_with_attr' },
  'salesforce|owdInternalUpdateStartedForEntity': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|owdUpdateFinished': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|owdUpdateStarted': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|remoteproxy': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy' }], fit: 'fits_with_attr' },
  'salesforce|reqFirstPartyUseOfCookiesOnOff': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|resetpassword': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Credential' }], fit: 'fits_with_attr' },
  'salesforce|role': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Policy', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|sAMLLoginEnabledOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant' }, { kind: 'relation_created', relation_type: 'trusts' }], fit: 'fits_with_attr' },
  'salesforce|sAMLLoginEnabledOnOff': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant' }, { kind: 'relation_removed', relation_type: 'trusts' }], fit: 'fits_with_attr' },
  'salesforce|samlSsoConfig_create': { calls: ['SF-90'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Policy' }, { kind: 'relation_created', relation_type: 'trusts' }], fit: 'fits_with_attr' },
  'salesforce|scoringFrameworkOrgPrefOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|secureGuestUserRecordAccessEnabled': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant' }], fit: 'fits_with_attr' },
  'salesforce|slackBetaTOSOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|slackButtonEnabledOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|slackInfraTOSOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|slackRecordChannelsOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|slackSalesEnabledOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|slackUserSyncOffOn': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|slackUserSyncOnOff': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|updatedDefaultCompactLayoutMapping': { calls: ['SF-90'], verb: 'execute', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|useremailchangesent': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'salesforce|value_CASE_FEEDS_JOB_STATUS': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|value_CASE_FEEDS_PROCESSING_STATE': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|value_FORECASTING_SETUP_STATUS': { calls: ['SF-90'], verb: 'write', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|value_MAX_STREAMING_TOPICS_PROV': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|value_ORG_CREATED_ON_VERSION': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|value_PROV_SCRATCH_ACTIVE_LIMIT': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|value_PROV_SCRATCH_DAILY_LIMIT': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|value_PROV_SNAPSHOT_ACTIVE_LIMIT': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'salesforce|value_PROV_SNAPSHOT_DAILY_LIMIT': { calls: ['SF-90'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'slack|/devbot:denied': { calls: ['SL-12'], verb: 'execute', effects: [{ kind: 'denied', relation_type: 'triggered_by', to: 'actor' }], outcome: 'failure', fit: 'no_fit' },
  'slack|/devbot:success': { calls: ['SL-12'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'triggered_by', to: 'actor' }, { kind: 'exercised', relation_type: 'runs_as' }], fit: 'fits_with_attr' },
  'slack|/mfa-reset:denied': { calls: ['SL-12'], verb: 'execute', effects: [{ kind: 'denied', relation_type: 'triggered_by', to: 'actor' }], outcome: 'failure', fit: 'no_fit' },
  'slack|/mfa-reset:success': { calls: ['SL-12'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'triggered_by', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'runs_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|agentforce_agent_slack_connection_added': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|anomaly': { calls: ['SL-11'], verb: 'authenticate', effects: [{ kind: 'none' }], signal: true, fit: 'fits' },
  'slack|app_allowlist_rule_matched': { calls: ['SL-11'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'applies_to', from: 'actor', to: 'targets[target]' }], decision: true, deny_kind: 'policy', fit: 'fits_with_attr' },
  'slack|app_approved': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|app_collaborator_added': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], slots: { app: 'container' }, fit: 'fits' },
  'slack|app_installed': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'relation_created', relation_type: 'registered_by', from: 'targets[target]', to: 'actor' }, { kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|app_manifest_created': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Integration', at: 'targets[target]' }, { kind: 'relation_created', relation_type: 'registered_by', from: 'targets[target]', to: 'actor' }], fit: 'fits' },
  'slack|app_manifest_updated': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Integration', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|app_scopes_expanded': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_modified', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|auth_policy_entity_assigned': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'relation_created', relation_type: 'applies_to' }], fit: 'fits' },
  'slack|bot_add': { calls: ['SL-05'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'slack|bot_message': { calls: ['SL-05'], verb: 'send', effects: [{ kind: 'exercised', relation_type: 'receives_into', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'owned_by', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'slack|canvas_opened': { calls: ['SL-11'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'slack|channel_email_address_created': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Endpoint' }, { kind: 'relation_created', relation_type: 'receives_into', to: 'targets[target]' }], fit: 'fits' },
  'slack|channel_join': { calls: ['SL-05'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'slack|channel_tab_added': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'none' }], fit: 'n/a' },
  'slack|external_auth_oauth2_token_fetched': { calls: ['SL-11'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|external_data_source_created': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Endpoint', at: 'targets[target]' }, { kind: 'relation_created', relation_type: 'receives_into', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|external_data_source_updated': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Endpoint', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|file_downloaded': { calls: ['SL-11'], verb: 'export', effects: [{ kind: 'exercised', relation_type: 'member_of', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'has_role_on', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|file_shared': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'shared_with', from: 'targets[target]', to: 'targets[destination]' }], fit: 'no_fit' },
  'slack|file_uploaded': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource', at: 'targets[target]' }, { kind: 'relation_created', relation_type: 'owned_by', from: 'targets[target]', to: 'actor' }], fit: 'fits' },
  'slack|idp_configuration_added': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'trusts', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|idp_prod_configuration_updated': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'trusts', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|idp_test_configuration_updated': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'trusts', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|message': { calls: ['SL-05'], verb: 'send', effects: [{ kind: 'exercised', relation_type: 'member_of', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }, { kind: 'exercised', relation_type: 'receives_into', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'slack|oauth.v2.access(install)': { calls: ['D-21'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'relation_created', relation_type: 'registered_by', from: 'targets[target]', to: 'actor' }, { kind: 'relation_created', relation_type: 'receives_into' }], fit: 'fits_with_attr' },
  'slack|org_app_future_workspace_install_disabled': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Integration', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|org_app_workspace_added': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'slack|organization_created': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Tenant', at: 'targets[container]' }], fit: 'fits' },
  'slack|permissions_assigned': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|pref.dnd_enabled': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'none' }], self_service: 'actor', fit: 'n/a' },
  'slack|pref.dnd_end_hour': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'none' }], self_service: 'actor', fit: 'n/a' },
  'slack|pref.dnd_start_hour': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'none' }], self_service: 'actor', fit: 'n/a' },
  'slack|pref.sso_setting_changed': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Tenant', at: 'targets[container]' }, { kind: 'relation_modified', relation_type: 'trusts', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|private_channel_converted_to_public': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'shared_with', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'slack|private_channel_created': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'slack|public_channel_converted_to_private': { calls: ['SL-11'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'shared_with', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits' },
  'slack|public_channel_created': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Resource', at: 'targets[target]' }], fit: 'fits' },
  'slack|public_channel_preview': { calls: ['SL-11'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'shared_with', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'slack|role_assigned': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]', role: 'targets[role]' }], fit: 'fits' },
  'slack|salesforce_access_granted': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'has_role_on', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|salesforce_mcp_server_acl_updated': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'has_role_on', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|salesforce_mcp_server_enabled': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }, { kind: 'object_created', interface: 'Tenant', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|salesforce_mcp_server_workspace_granted': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'registered_in', from: 'targets[target]', to: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|salesforce_org_record_channel_config_added': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'relation_created', relation_type: 'receives_into' }], fit: 'fits_with_attr' },
  'slack|salesforce_permissions_synced': { calls: ['SL-11'], verb: 'execute', effects: [{ kind: 'relation_modified', relation_type: 'has_role_on', from: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|seamless_auth_org_created': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'trusts', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|seamless_auth_org_updated': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'relation_modified', relation_type: 'trusts', from: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|slack_ai_mcp_connector_changed': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'setting_changed', interface: 'Integration', at: 'targets[container]' }], fit: 'fits_with_attr' },
  'slack|slack_ai_mcp_resource_read': { calls: ['SL-11'], verb: 'read', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|slack_ai_mcp_tool_called': { calls: ['SL-11'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|slack_ai_mcp_tool_permission_changed': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'acts_as', to: 'actor' }], fit: 'no_fit' },
  'slack|slack_ai_summary_requested': { calls: ['SL-11'], verb: 'execute', effects: [{ kind: 'exercised', relation_type: 'acts_as', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|user_channel_join': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'slack|user_channel_leave': { calls: ['SL-11'], verb: 'revoke', effects: [{ kind: 'relation_removed', relation_type: 'member_of', from: 'actor', to: 'targets[target]' }], fit: 'fits' },
  'slack|user_created': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'slack|user_deactivated': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'slack|user_email_updated': { calls: ['SL-11'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|user_joined_workspace': { calls: ['SL-11'], verb: 'grant', effects: [{ kind: 'relation_created', relation_type: 'member_of', from: 'targets[target]', to: 'targets[container]' }], self_service: 'target', fit: 'fits' },
  'slack|user_login': { calls: ['SL-11'], verb: 'authenticate', effects: [{ kind: 'exercised', relation_type: 'authenticates_with', from: 'actor', to: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|user_logout': { calls: ['SL-11'], verb: 'authenticate', effects: [{ kind: 'none' }], fit: 'no_fit' },
  'slack|user_profile_updated': { calls: ['SL-11'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], self_service: 'target', fit: 'fits' },
  'slack|user_reactivated': { calls: ['SL-11'], verb: 'configure', effects: [{ kind: 'object_state_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits' },
  'slack|user_username_updated': { calls: ['SL-11'], verb: 'write', effects: [{ kind: 'object_attr_changed', interface: 'Principal', at: 'targets[target]' }], fit: 'fits_with_attr' },
  'slack|workspace_created': { calls: ['SL-11'], verb: 'create', effects: [{ kind: 'object_created', interface: 'Tenant', at: 'targets[container]' }], fit: 'fits' },
}
// 사람 확인(review)이 남은 줄. 기계가 정한 행위·관계 자리라, 사건으로 출처·사용을 셀 때(engine/usage.ts) 그 효과를 믿지 않는다
export const ACTIVITY_REVIEW_TYPES: readonly string[] = ["atlassian|automation_flow_owner_updated","github|commit","github|member.added","github|organization.member_added","github|personal_access_token_request.approved","salesforce|ConnectSrc","salesforce|SetupEntityAccessAudit_PermissionSet_ExternalCredentialParameter_Enabled","salesforce|WaveAppCreate:Skipped","salesforce|ecAppChildEntityCreated","slack|/devbot:denied","slack|/devbot:success","slack|/mfa-reset:denied","slack|bot_add","slack|channel_join","slack|file_shared","slack|oauth.v2.access(install)"]
// 부여·회수 관계가 스냅샷에 없는 까닭(snapshot_gap 의 kind, 사전 밖: 수집 안 함 · 뽑지 않음 · 다른 객체로 붙음). 종류 → 관계 → kind. 점수판(gt:logs)만 읽는다
export const ACTIVITY_SNAPSHOT_GAPS: Record<string, Record<string, string>> = {
  'atlassian|group_created': { contained_in: 'not_collected' },
  'atlassian|updated_users_claim': { member_of: 'not_collected' },
  'atlassian|user_invite_to_org': { member_of: 'not_collected', has_role_on: 'not_collected' },
  'okta|application.lifecycle.create': { registered_by: 'not_collected' },
  'slack|app_collaborator_added': { has_role_on: 'not_collected' },
  'slack|app_installed': { registered_in: 'not_collected', registered_by: 'not_collected', has_role_on: 'not_extracted' },
  'slack|app_manifest_created': { registered_by: 'not_collected' },
  'slack|app_scopes_expanded': { has_role_on: 'not_extracted' },
}

// ---- 위협 유형 (threat_types.yaml). id 는 대시보드 키, name 은 판정 결과의 유형 이름, meaning 은 화면 설명

export const THREAT_TYPES = [
  { id: 'unauthorized_access', name: '비인가 접근', meaning: '대상에 읽기, 쓰기, 관리가 모두 없던 사람이 접근을 얻음' },
  { id: 'privilege_escalation', name: '권한 상승', meaning: '대상에 접근이 이미 있던 사람이 더 높은 수준을 얻음' },
  { id: 'data_exfiltration', name: '데이터 반출', meaning: '조직 안 데이터가 조직 밖 목적지로 실제로 흐름' },
  { id: 'accountability_loss', name: '추적성 상실', meaning: '고정 실행 신원이 주인이 아닌 사람의 호출을 대신해 대상 감사 로그에 호출자가 남지 않음' },
] as const
export type ThreatTypeId = typeof THREAT_TYPES[number]['id']
export type ThreatTypeName = typeof THREAT_TYPES[number]['name']
/** 한 위협에 유형이 여럿이면 이 순서로 대표 유형을 고른다 */
export const THREAT_TYPE_ORDER = ['data_exfiltration', 'privilege_escalation', 'unauthorized_access', 'accountability_loss'] as const
