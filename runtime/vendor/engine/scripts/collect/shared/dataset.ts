/**
 * 정규화 결과를 쌓는 곳. 합성 데이터와 같은 JSON 8종 형식(계획서 D-02)으로 내보낸다.
 *
 * - 객체 키(fixture_key)는 `<접두사>-<타입 약어>-<원천 id>` (6.1절). 같은 키면 한 객체로 합치고 관측 기록을 쌓는다.
 * - 관계의 references.value 는 객체 키다 (대시보드 로더가 키로 푼다). 원천 id 는 객체의 identifiers 에 있다.
 * - 끝점 객체가 없는 관계는 만들지 않고 dropped 로 센다 (못 본 것을 지어내지 않는다).
 */
import type { AegiObject, FixtureObject, InterfaceType, Provider } from '../../../src/model/object'
import { INTERFACE_CONTRACT_VALUES } from '../../../src/model/object'
import type { FixtureRelation, RelationType } from '../../../src/model/relation'
import type { IdentityLink } from '../../../src/model/link'
import type { EvidenceObservation, FindingEvidenceLink } from '../../../src/model/evidence'
import { objectCatalog } from '../../../src/objectCatalog'

const CATALOG_PROVIDER: Record<string, string> = { github: 'GitHub', okta: 'Okta', slack: 'Slack', gws: 'Google Workspace' }

/**
 * 정규화 표(CATALOG)에 없는 종류는 규격 목록(src/objectCatalog.ts)에서 이름으로 찾는다.
 * 존재 확인(XX-90)으로 받은 종류를 해석 없이 범용 객체로 남길 때 쓴다
 */
export function catalogByName(provider: string, type: string): { id: string; interfaces: InterfaceType[] } | undefined {
  const row = objectCatalog.find(o => o.provider === CATALOG_PROVIDER[provider] && o.name === type)
  return row ? { id: row.id, interfaces: row.interfaces as InterfaceType[] } : undefined
}

export interface SourceObs {
  api: string
  params: Record<string, unknown>
  record: 'measured'
  collected_at: string
}

/** 카탈로그 ID·interface (src/objectCatalog.ts 기준) */
export const CATALOG: Record<string, { id: string; interfaces: InterfaceType[] }> = {
  'github|Enterprise': { id: 'GH-v0.2-0001', interfaces: ['Tenant'] },
  'github|Organization': { id: 'GH-v0.2-0002', interfaces: ['Tenant'] },
  'github|User Account': { id: 'GH-v0.2-0003', interfaces: ['Principal'] },
  'github|Repository': { id: 'GH-v0.2-0004', interfaces: ['Resource'] },
  'github|Team': { id: 'GH-v0.2-0007', interfaces: ['Principal'] },
  'github|Organization Custom Repository Role': { id: 'GH-v0.2-0021', interfaces: ['Policy'] },
  'github|GitHub App Installation Registration': { id: 'GH-v0.2-0026::integration', interfaces: ['Integration'] },
  'github|Organization Programmatic Access Grant': { id: 'GH-v0.2-0030', interfaces: ['Assignment'] },
  'github|Credential Authorization': { id: 'GH-v0.2-0032', interfaces: ['Assignment'] },
  'github|ExternalIdentity': { id: 'GH-v0.2-0040', interfaces: ['Assignment'] },
  'github|Repository ruleset': { id: 'GH-v0.2-0042', interfaces: ['Policy'] },
  'github|Branch Protection Rule': { id: 'GH-v0.2-0046', interfaces: ['Policy'] },
  'github|Workflow': { id: 'GH-v0.2-0064', interfaces: ['Automation'] },
  'github|Webhook': { id: 'GH-v0.2-0088', interfaces: ['Endpoint'] },
  'github|Commit': { id: 'GH-v0.2-0116', interfaces: ['Resource'] },
  'github|Pull Request': { id: 'GH-v0.2-0122', interfaces: ['Resource'] },
  'github|Environment': { id: 'model-v2:github:Environment', interfaces: ['Resource'] },
  'github|Actions Secret': { id: 'model-v2:github:Actions Secret', interfaces: ['Credential'] },
  'github|Organization Actions Secret': { id: 'model-v2:github:Organization Actions Secret', interfaces: ['Credential'] },
  'github|Dependabot Secret': { id: 'model-v2:github:Dependabot Secret', interfaces: ['Credential'] },
  'github|Organization Dependabot Secret': { id: 'model-v2:github:Organization Dependabot Secret', interfaces: ['Credential'] },
  'github|Deploy Key': { id: 'model-v2:github:Deploy Key', interfaces: ['Credential'] },
  'github|Organization Role': { id: 'model-v2:github:Organization Role', interfaces: ['Policy'] },
  'github|ExternalGroup': { id: 'model-v2:github:ExternalGroup', interfaces: ['Principal'] },
  'github|Organization Invitation': { id: 'model-v2:github:Organization Invitation', interfaces: ['Assignment'] },
  'github|Deployment branch policy': { id: 'model-v2:github:Deployment branch policy', interfaces: ['Policy'] },
  'github|Deployment protection rule (custom/app)': { id: 'model-v2:github:Deployment protection rule (custom/app)', interfaces: ['Policy'] },
  'github|IpAllowListEntry': { id: 'model-v2:github:IpAllowListEntry', interfaces: ['Policy'] },
  'github|OrganizationIdentityProvider': { id: 'model-v2:github:OrganizationIdentityProvider', interfaces: ['Integration'] },
  'github|VerifiableDomain': { id: 'model-v2:github:VerifiableDomain', interfaces: ['Policy'] },
  'github|Runner Group': { id: 'model-v2:github:Runner Group', interfaces: ['Resource'] },
  'github|Self hosted runners': { id: 'model-v2:github:Self hosted runners', interfaces: ['Resource'] },
  'github|Package': { id: 'model-v2:github:Package', interfaces: ['Resource'] },
  'okta|org': { id: 'OKTA-v1-0047', interfaces: ['Tenant'] },
  'okta|User': { id: 'OKTA-v1-2614', interfaces: ['Principal'] },
  'okta|Group': { id: 'OKTA-v1-2040', interfaces: ['Principal'] },
  'okta|UserFactor': { id: 'OKTA-v1-2620', interfaces: ['Credential'] },
  'okta|IamRole': { id: 'OKTA-v1-2113', interfaces: ['Policy'] },
  'okta|ResourceSet': { id: 'OKTA-v1-2489', interfaces: ['Policy'] },
  'okta|Application': { id: 'OKTA-v1-1741', interfaces: ['Integration'] },
  'okta|AppUser': { id: 'OKTA-v1-1734', interfaces: ['Assignment'] },
  'okta|ApplicationGroupAssignment': { id: 'OKTA-v1-1753', interfaces: ['Assignment'] },
  'okta|OAuth2Client': { id: 'OKTA-v1-2266', interfaces: ['Principal'] },
  'okta|OAuth2RefreshToken': { id: 'OKTA-v1-2274', interfaces: ['Credential'] },
  'okta|GroupRule': { id: 'OKTA-v1-2052', interfaces: ['Automation'] },
  'okta|Policy': { id: 'OKTA-v1-2405', interfaces: ['Policy'] },
  'okta|PolicyRule': { id: 'OKTA-v1-2419', interfaces: ['Policy'] },
  'okta|APIServiceIntegrationInstance': { id: 'model-v2:okta:APIServiceIntegrationInstance', interfaces: ['Integration'] },
  'okta|APIServiceIntegrationInstanceSecret': { id: 'model-v2:okta:APIServiceIntegrationInstanceSecret', interfaces: ['Credential'] },
  'okta|ApiToken': { id: 'model-v2:okta:ApiToken', interfaces: ['Credential'] },
  'okta|EventHook': { id: 'model-v2:okta:EventHook', interfaces: ['Endpoint'] },
  'okta|InlineHook': { id: 'model-v2:okta:InlineHook', interfaces: ['Endpoint'] },
  'okta|LogStream': { id: 'model-v2:okta:LogStream', interfaces: ['Endpoint'] },
  'okta|IdentityProvider': { id: 'model-v2:okta:IdentityProvider', interfaces: ['Integration'] },
  'okta|ProfileMapping': { id: 'model-v2:okta:ProfileMapping', interfaces: ['Automation'] },
  'okta|IdPKeyCredential': { id: 'model-v2:okta:IdPKeyCredential', interfaces: ['Credential'] },
  'okta|SecurityEventsProvider': { id: 'model-v2:okta:SecurityEventsProvider', interfaces: ['Endpoint'] },
  'okta|SsfStream': { id: 'model-v2:okta:SsfStream', interfaces: ['Endpoint'] },
  'okta|EmailServer': { id: 'model-v2:okta:EmailServer', interfaces: ['Endpoint'] },
  'okta|AuthenticatorBase': { id: 'model-v2:okta:AuthenticatorBase', interfaces: ['Policy'] },
  'okta|TrustedOrigin': { id: 'model-v2:okta:TrustedOrigin', interfaces: ['Policy'] },
  'okta|device-assurances': { id: 'model-v2:okta:device-assurances', interfaces: ['Policy'] },
  'okta|zones': { id: 'model-v2:okta:zones', interfaces: ['Policy'] },
  'okta|AgentPool': { id: 'model-v2:okta:AgentPool', interfaces: ['Integration'] },
  'slack|enterprise': { id: 'SLK-v5.1-0029', interfaces: ['Tenant'] },
  'slack|workspace': { id: 'SLK-v5.1-0068', interfaces: ['Tenant'] },
  'slack|user': { id: 'SLK-v5.1-0060', interfaces: ['Principal'] },
  'slack|bot': { id: 'SLK-v5.1-0013', interfaces: ['Principal'] },
  'slack|bot-token': { id: 'SLK-v5.1-0014', interfaces: ['Credential'] },
  'slack|conversation': { id: 'SLK-v5.1-0022', interfaces: ['Resource'] },
  'slack|usergroup': { id: 'SLK-v5.1-0062', interfaces: ['Principal'] },
  'slack|Message': { id: 'SLK-v2-rev-0001', interfaces: ['Resource'] },
  'slack|Slack App Installation Registration': { id: 'SLK-v5.1-0006::integration', interfaces: ['Integration'] },
  'slack|Slash Command Request Endpoint': { id: 'SLK-v2-gap-0004', interfaces: ['Endpoint'] },
  'slack|incoming-webhook': { id: 'SLK-v5.1-0041', interfaces: ['Endpoint', 'Credential'] },
  'slack|workflow': { id: 'model-v2:slack:workflow', interfaces: ['Automation'] },
  'slack|workflow-collaborator': { id: 'model-v2:slack:workflow-collaborator', interfaces: ['Assignment'] },
  'slack|barrier': { id: 'model-v2:slack:barrier', interfaces: ['Policy'] },
  'gws|Customer': { id: 'GWS-v3-0162', interfaces: ['Tenant'] },
  'gws|User': { id: 'GWS-v3-0198', interfaces: ['Principal'] },
  'gws|Group': { id: 'GWS-v3-0174', interfaces: ['Principal'] },
  'gws|Member': { id: 'GWS-v3-0176', interfaces: ['Assignment'] },
  'gws|Role': { id: 'GWS-v3-0189', interfaces: ['Policy'] },
  'gws|RoleAssignment': { id: 'GWS-v3-0190', interfaces: ['Assignment'] },
  'gws|Token': { id: 'GWS-v3-0196', interfaces: ['Credential', 'Assignment'] },
  'gws|Delegate': { id: 'model-v2:gws:Delegate', interfaces: ['Assignment'] },
  'gws|File': { id: 'GWS-v3-2166', interfaces: ['Resource'] },
  'gws|Permission': { id: 'GWS-v3-2172', interfaces: ['Assignment'] },
  'gws|Form': { id: 'GWS-v3-2458', interfaces: ['Resource'] },
  'gws|Project': { id: 'GWS-v3-3268', interfaces: ['Automation'] },
  'gws|InboundSamlSsoProfile': { id: 'model-v2:gws:InboundSamlSsoProfile', interfaces: ['Integration'] },
  'gws|InboundOidcSsoProfile': { id: 'model-v2:gws:InboundOidcSsoProfile', interfaces: ['Integration'] },
  'gws|IdpCredential': { id: 'model-v2:gws:IdpCredential', interfaces: ['Credential'] },
  'gws|InboundSsoAssignment': { id: 'model-v2:gws:InboundSsoAssignment', interfaces: ['Assignment'] },
  'gws|Asp': { id: 'model-v2:gws:Asp', interfaces: ['Credential'] },
  'gws|Drive': { id: 'model-v2:gws:Drive', interfaces: ['Resource'] },
  'gws|OrgUnit': { id: 'model-v2:gws:OrgUnit', interfaces: ['Resource'] },
  'gws|AclRule': { id: 'model-v2:gws:AclRule', interfaces: ['Assignment'] },
  'gws|AllowlistedDomain': { id: 'model-v2:gws:AllowlistedDomain', interfaces: ['Policy'] },
  'gws|Policy': { id: 'model-v2:gws:Policy', interfaces: ['Policy'] },
  // Salesforce, Atlassian 은 예전 규격 목록이 없다. 오브젝트 모델 v1 수집 Profile id 와 interface 를 그대로 쓴다
  // (원본은 docs/spec/model-v1/runtime-catalog.json)
  'salesforce|Organization': { id: 'model-v1:salesforce:Organization', interfaces: ['Tenant'] },
  'salesforce|User': { id: 'model-v1:salesforce:User', interfaces: ['Principal'] },
  'salesforce|Profile': { id: 'model-v1:salesforce:Profile', interfaces: ['Policy'] },
  'salesforce|PermissionSet': { id: 'model-v1:salesforce:PermissionSet', interfaces: ['Policy'] },
  'salesforce|PermissionSetAssignment': { id: 'model-v1:salesforce:PermissionSetAssignment', interfaces: ['Assignment'] },
  'salesforce|UserRole': { id: 'model-v1:salesforce:UserRole', interfaces: ['Policy'] },
  'salesforce|Group': { id: 'model-v1:salesforce:Group', interfaces: ['Principal'] },
  'salesforce|GroupMember': { id: 'model-v1:salesforce:GroupMember', interfaces: ['Assignment'] },
  'salesforce|ConnectedApplication': { id: 'model-v1:salesforce:ConnectedApplication', interfaces: ['Integration'] },
  'salesforce|OauthToken': { id: 'model-v1:salesforce:OauthToken', interfaces: ['Assignment'] },
  'atlassian|site': { id: 'model-v1:atlassian:site', interfaces: ['Tenant'] },
  'atlassian|User': { id: 'model-v1:atlassian:User', interfaces: ['Principal'] },
  'atlassian|Group': { id: 'model-v1:atlassian:Group', interfaces: ['Principal'] },
  'atlassian|Project': { id: 'model-v1:atlassian:Project', interfaces: ['Resource'] },
  'atlassian|ProjectRole': { id: 'model-v1:atlassian:ProjectRole', interfaces: ['Policy'] },
  'atlassian|PermissionScheme': { id: 'model-v1:atlassian:PermissionScheme', interfaces: ['Policy'] },
  // 권한 스킴 줄은 판단표 G4-Q02 로 PermissionScheme 의 permissions 속성이 됐다. 예전 데이터셋을 읽을 때만 쓴다
  'atlassian|PermissionGrant': { id: 'model-v1:atlassian:PermissionGrant', interfaces: ['Assignment'] },
  'atlassian|SpecialPrincipal': { id: 'model-v1:atlassian:SpecialPrincipal', interfaces: ['Principal'] },
  'atlassian|Filter': { id: 'model-v1:atlassian:Filter', interfaces: ['Resource'] },
  'atlassian|SharePermission': { id: 'model-v1:atlassian:SharePermission', interfaces: ['Assignment'] },
  'atlassian|Space': { id: 'model-v1:atlassian:Space', interfaces: ['Resource'] },
  'atlassian|SpacePermission': { id: 'model-v1:atlassian:SpacePermission', interfaces: ['Assignment'] },
}

const SERVICE: Partial<Record<Provider, string>> = { okta: 'management' }

export interface ObjectInput {
  key: string
  provider: Provider
  type: string
  id: string | number
  /** 바뀔 수 있는 보조 식별자 (login, email 등) */
  mutableIds?: Record<string, string | number | null | undefined>
  /** tenant(루트) 또는 parent 참조. 객체 키 */
  tenant?: string
  parent?: string
  /** 그 밖의 참조: 이름 → 객체 키 목록 (없는 객체면 원천 값을 external_locator 로) */
  refs?: Record<string, Array<{ key?: string; type: string; value: string | number; external?: boolean }>>
  properties: Record<string, unknown>
  display: string
  normal?: boolean
  obs: SourceObs
  /** 오브젝트 카탈로그 Profile 이 정한 타입 id 와 인터페이스. 있으면 CATALOG 표 대신 쓴다 (scripts/collect/catalog) */
  catalog?: { id: string; interfaces: InterfaceType[] }
}

export interface RelationInput {
  provider: Provider
  type: RelationType
  template?: string
  source: string
  target: string
  /** 역할 자리: Policy 객체 키 또는 기본 제공 역할 이름 */
  role?: { key: string } | { name: string }
  basis?: 'stated' | 'computed' | 'flag'
  properties?: Record<string, unknown>
  obs: SourceObs
}

export class Dataset {
  objects = new Map<string, FixtureObject>()
  protected relationInputs = new Map<string, RelationInput>()
  links: IdentityLink[] = []
  observations: EvidenceObservation[] = []
  evidenceLinks: FindingEvidenceLink[] = []
  /** 정규화 중 알게 된 한계 (보고서에 싣는다) */
  notes: string[] = []
  dropped: Array<{ relation: string; missing: string[] }> = []

  has(key: string): boolean {
    return this.objects.has(key)
  }

  get(key: string): FixtureObject | undefined {
    return this.objects.get(key)
  }

  typeOf(key: string): string | undefined {
    return this.objects.get(key)?.canonical.object_type
  }

  addObject(input: ObjectInput): string {
    const catalog = input.catalog ?? CATALOG[`${input.provider}|${input.type}`] ?? catalogByName(input.provider, input.type)
    if (!catalog) throw new Error(`카탈로그에 없는 타입: ${input.provider} ${input.type}`)
    const existing = this.objects.get(input.key)
    if (existing) {
      mergeObservation(existing.canonical, input.obs)
      for (const [k, v] of Object.entries(input.properties)) if (v !== undefined && existing.canonical.properties[k] === undefined) existing.canonical.properties[k] = v
      return input.key
    }
    const identifiers: AegiObject['identifiers'] = { primary: ['id'], id: { value: input.id, stability: 'stable' } }
    for (const [k, v] of Object.entries(input.mutableIds ?? {})) if (v !== undefined && v !== null && v !== '') identifiers[k] = { value: v, stability: 'mutable' }

    const references: NonNullable<AegiObject['references']> = {}
    const refTarget = (key: string) => ({ provider: input.provider, object_type: this.typeOf(key) ?? 'unknown', identifier_type: 'primary', value: key })
    if (input.tenant) references.tenant = { kind: 'tenant', targets: [refTarget(input.tenant)] }
    if (input.parent) references.parent = { kind: 'parent', targets: [refTarget(input.parent)] }
    for (const [name, targets] of Object.entries(input.refs ?? {})) {
      if (!targets.length) continue
      references[name] = {
        kind: targets.some(t => t.external) ? 'external_locator' : 'direct_id',
        targets: targets.map(t => ({ provider: input.provider, object_type: t.type, identifier_type: t.key ? 'primary' : 'native', value: t.key ?? t.value, ...(t.external ? { status: 'external' } : {}) })),
      }
    }

    const properties = Object.fromEntries(Object.entries(input.properties).filter(([, v]) => v !== undefined))
    this.objects.set(input.key, {
      fixture_key: input.key,
      catalog_ref: { id: catalog.id, provider_term: input.type, interface: catalog.interfaces },
      canonical: {
        provider: input.provider,
        ...(SERVICE[input.provider] ? { service: SERVICE[input.provider] } : {}),
        object_type: input.type,
        interfaces: catalog.interfaces,
        identifiers,
        references,
        properties,
        judged: {},
        source: { schema_version: 4, observations: [input.obs] },
      },
      fixture_meta: { display_name: input.display, normal: input.normal ?? true },
    })
    return input.key
  }

  addRelation(input: RelationInput): void {
    const roleTag = input.role ? ('key' in input.role ? input.role.key : `name:${input.role.name}`) : ''
    const key = ['R', input.type, input.source, input.target, roleTag].filter(Boolean).join('|')
    const existing = this.relationInputs.get(key)
    if (existing) return
    this.relationInputs.set(key, input)
  }

  /** 끝점이 모두 있는 관계만 내보낸다. 객체 타입은 이 시점에 채운다(객체가 관계보다 늦게 들어와도 된다) */
  relations(): FixtureRelation[] {
    const out: FixtureRelation[] = []
    this.dropped = []
    for (const [key, r] of this.relationInputs) {
      const missing = [r.source, r.target, ...(r.role && 'key' in r.role ? [r.role.key] : [])].filter(k => !this.objects.has(k))
      if (missing.length) {
        this.dropped.push({ relation: key, missing })
        continue
      }
      const ref = (k: string, kind: string) => ({ provider: r.provider, object_type: this.typeOf(k)!, identifier_type: 'primary', value: k, kind })
      const role = r.role
        ? 'key' in r.role
          ? ref(r.role.key, 'role')
          : { provider: r.provider, object_type: null, kind: 'name_key' as const, value: r.role.name }
        : undefined
      out.push({
        fixture_key: key,
        canonical: {
          provider: r.provider,
          relation_type: r.type,
          template: r.template ?? (r.type === 'has_role_on' ? 'role_grant' : 'direct'),
          references: { source: ref(r.source, 'source'), ...(role ? { role } : {}), target: ref(r.target, 'target') },
          properties: { basis: r.basis ?? 'stated', ...(r.properties ?? {}) },
          source: { api: r.obs.api, params: r.obs.params, record: 'measured', schema_version: 3, collected_at: r.obs.collected_at },
        },
      })
    }
    return out.sort((a, b) => a.fixture_key.localeCompare(b.fixture_key))
  }

  sortedObjects(): FixtureObject[] {
    return [...this.objects.values()].sort((a, b) => a.fixture_key.localeCompare(b.fixture_key))
  }
}

function mergeObservation(canonical: AegiObject, obs: SourceObs): void {
  const list = (canonical.source.observations ??= [])
  const sig = `${obs.api}|${JSON.stringify(obs.params)}`
  if (!list.some(o => `${o.api}|${JSON.stringify(o.params)}` === sig)) list.push(obs)
}

/** 원천 id 를 키에 쓸 수 있게 (영숫자·._- 만) */
export function keyPart(v: string | number): string {
  return String(v).replace(/[^A-Za-z0-9._-]/g, '_')
}

/** D1 의 SQLite 시각(UTC, 'YYYY-MM-DD HH:MM:SS')을 ISO 로 */
export function sqliteToIso(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v) return undefined
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) ? `${v.replace(' ', 'T')}Z` : v
}

/**
 * v2 데이터셋 — v1 Dataset 과 같은 JSON 형식을 내되, aegi-schema 규칙 둘을 강제한다.
 *
 * - basis 는 생략할 수 없다 (Relation_Schema_v3 「basis — 기본값이 없다. 생략하면 lint 오류」). v1 은 비면 stated 로 채웠다.
 * - 같은 사실이 여러 관측에서 오면 stated > computed > flag 순으로 이긴다 (v1 은 먼저 들어온 쪽이 이겼다).
 * - 참조로만 나온 대상은 껍데기(stub) 노드로 만든다 (Object_Schema_v4.1 「참조로만 나온 대상도 노드가 된다」).
 *   v1 은 끝점이 없는 관계를 버렸다.
 */
export type Basis = 'stated' | 'computed' | 'flag'
export type RelationInputV2 = RelationInput & { basis: Basis }

const RANK: Record<Basis, number> = { stated: 2, computed: 1, flag: 0 }

/**
 * 정규화기가 properties 로 넘긴 값 중 judged 로 옮길 것. expires_at 은 벤더 값 그대로라 properties 에 둔다.
 * 판단표 G4 의 origin, activation, assignment_count 는 벤더 필드 이름과 겹친다(Okta Trusted Origin 의 origin 은 주소다).
 * 이 셋은 이름으로 옮기지 않고 정규화가 끝난 뒤 judgments.ts 가 judged 에 직접 적는다
 */
export const SET_DIRECTLY = new Set(['expires_at', 'origin', 'activation', 'assignment_count'])
const JUDGED_FIELDS = new Set(Object.keys(INTERFACE_CONTRACT_VALUES).filter(k => !SET_DIRECTLY.has(k)))

export class DatasetV2 extends Dataset {
  stubs: Array<{ key: string; via: string }> = []

  addRelation(input: RelationInputV2): void {
    if (!input.basis) throw new Error(`basis 가 없는 관계: ${input.type} ${input.source} -> ${input.target}`)
    const roleTag = input.role ? ('key' in input.role ? input.role.key : `name:${input.role.name}`) : ''
    const key = ['R', input.type, input.source, input.target, roleTag].filter(Boolean).join('|')
    const existing = this.relationInputs.get(key)
    if (!existing) {
      this.relationInputs.set(key, input)
      return
    }
    if (RANK[input.basis] > RANK[existing.basis as Basis]) this.relationInputs.set(key, { ...existing, basis: input.basis })
  }

  /** 지금까지 넣은 관계 (끝점 확인 · 껍데기 만들기 전). SaaS 를 넘는 연결(crosswalk.ts)이 식에서 본다 */
  relationRows(): RelationInputV2[] {
    return [...this.relationInputs.values()] as RelationInputV2[]
  }

  /**
   * 껍데기였던 대상이 실제 목록에 나오면 껍데기 표시를 지운다.
   * interface 계약값(principal_kind, run_as_resolution …)은 properties 가 아니라 judged 에 둔다 (Interface_Spec_v3 「각 interface의 계약」).
   */
  addObject(input: ObjectInput): string {
    const existing = this.get(input.key)
    const properties: Record<string, unknown> = {}
    const judged: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input.properties)) (JUDGED_FIELDS.has(k) ? judged : properties)[k] = v
    const key = super.addObject({ ...input, properties })
    for (const [k, v] of Object.entries(judged)) this.setJudged(key, k, v)
    if (existing?.fixture_meta?.stub) {
      const { stub: _stub, stub_via: _via, ...meta } = existing.fixture_meta as Record<string, unknown>
      existing.fixture_meta = { ...meta, display_name: input.display } as typeof existing.fixture_meta
      this.stubs = this.stubs.filter(s => s.key !== input.key)
    }
    return key
  }

  /** 계약값 하나를 적는다. 비어 있거나 unknown 인 값만 덮는다 (알게 된 값을 모름으로 되돌리지 않는다) */
  setJudged(key: string, field: string, value: unknown): void {
    const obj = this.get(key)
    if (!obj || value === undefined || value === null) return
    const judged = (obj.canonical.judged ??= {})
    if (judged[field] === undefined || judged[field] === 'unknown') judged[field] = value
  }

  /** 모든 관계 입력 (판정값 계산이 훑는다. 돌려준 입력을 고치면 데이터셋에 남는다) */
  allRelationInputs(): RelationInputV2[] {
    return [...this.relationInputs.values()] as RelationInputV2[]
  }

  /** 이 provider 의 관계 입력 (껍데기를 만들 때 끝점을 훑는다) */
  relationInputsOf(provider: Provider): RelationInputV2[] {
    return [...this.relationInputs.values()].filter(r => r.provider === provider) as RelationInputV2[]
  }

  /** 껍데기 노드. 속성은 비우고, 테넌트는 가리킨 쪽에서 물려받는다 */
  addStub(input: { key: string; provider: Provider; type: string; id: string | number; tenant?: string; display: string; via: string; obs: SourceObs }): string {
    if (this.has(input.key)) return input.key
    const stub: ObjectInput = { key: input.key, provider: input.provider, type: input.type, id: input.id, tenant: input.tenant, properties: {}, display: input.display, obs: input.obs }
    this.addObject(stub)
    const obj = this.get(input.key)!
    obj.fixture_meta = { ...obj.fixture_meta, stub: true, stub_via: input.via }
    this.stubs.push({ key: input.key, via: input.via })
    return input.key
  }
}

export const ghKey = {
  enterprise: (id: string | number) => `GH-ENT-${keyPart(id)}`,
  org: (id: string | number) => `GH-ORG-${keyPart(id)}`,
  user: (id: string | number) => `GH-U-${keyPart(id)}`,
  team: (id: string | number) => `GH-TEAM-${keyPart(id)}`,
  repo: (id: string | number) => `GH-REPO-${keyPart(id)}`,
  customRole: (id: string | number) => `GH-CROLE-${keyPart(id)}`,
  ruleset: (id: string | number) => `GH-RULESET-${keyPart(id)}`,
  protection: (repoId: string | number, branch: string) => `GH-BPR-${keyPart(repoId)}-${keyPart(branch)}`,
  workflow: (id: string | number) => `GH-WF-${keyPart(id)}`,
  commit: (sha: string) => `GH-COMMIT-${keyPart(sha)}`,
  pull: (id: string | number) => `GH-PR-${keyPart(id)}`,
  grant: (id: string | number) => `GH-GRANT-${keyPart(id)}`,
  installation: (id: string | number) => `GH-INST-${keyPart(id)}`,
  hook: (id: string | number) => `GH-HOOK-${keyPart(id)}`,
  externalIdentity: (guid: string) => `GH-EXTID-${keyPart(guid)}`,
}

export const oktaKey = {
  org: (id: string) => `OKTA-ORG-${keyPart(id)}`,
  user: (id: string) => `OKTA-U-${keyPart(id)}`,
  group: (id: string) => `OKTA-G-${keyPart(id)}`,
  factor: (id: string) => `OKTA-UF-${keyPart(id)}`,
  role: (id: string) => `OKTA-ROLE-${keyPart(id)}`,
  resourceSet: (id: string) => `OKTA-RS-${keyPart(id)}`,
  app: (id: string) => `OKTA-APP-${keyPart(id)}`,
  appUser: (appId: string, userId: string) => `OKTA-AU-${keyPart(appId)}-${keyPart(userId)}`,
  appGroup: (appId: string, groupId: string) => `OKTA-AGA-${keyPart(appId)}-${keyPart(groupId)}`,
  client: (clientId: string) => `OKTA-CLIENT-${keyPart(clientId)}`,
  refreshToken: (id: string) => `OKTA-RT-${keyPart(id)}`,
  groupRule: (id: string) => `OKTA-GRULE-${keyPart(id)}`,
  policy: (id: string) => `OKTA-POL-${keyPart(id)}`,
}

export const slackKey = {
  enterprise: (id: string) => `SLK-ENT-${keyPart(id)}`,
  workspace: (id: string) => `SLK-WS-${keyPart(id)}`,
  user: (id: string) => `SLK-U-${keyPart(id)}`,
  bot: (id: string) => `SLK-BOT-${keyPart(id)}`,
  channel: (id: string) => `SLK-CH-${keyPart(id)}`,
  message: (channel: string, ts: string) => `SLK-MSG-${keyPart(channel)}-${keyPart(ts)}`,
  usergroup: (id: string) => `SLK-UG-${keyPart(id)}`,
  appInstall: (appId: string) => `SLK-APP-${keyPart(appId)}`,
  endpoint: (appId: string, command: string) => `SLK-END-${keyPart(appId)}-${keyPart(command.replace(/^\//, ''))}`,
  botToken: (appId: string) => `SLK-BOTTOKEN-${keyPart(appId)}`,
  webhook: (appId: string, channel: string) => `SLK-HOOK-${keyPart(appId)}-${keyPart(channel)}`,
}

export const gwsKey = {
  customer: (id: string) => `GWS-CUST-${keyPart(id)}`,
  user: (id: string) => `GWS-U-${keyPart(id)}`,
  group: (id: string) => `GWS-G-${keyPart(id)}`,
  member: (groupId: string, memberId: string) => `GWS-MEM-${keyPart(groupId)}-${keyPart(memberId)}`,
  token: (userId: string, clientId: string) => `GWS-TOKEN-${keyPart(userId)}-${keyPart(clientId)}`,
  delegate: (userId: string, email: string) => `GWS-DELEGATE-${keyPart(userId)}-${keyPart(email)}`,
  role: (id: string | number) => `GWS-ROLE-${keyPart(id)}`,
  roleAssignment: (id: string | number) => `GWS-RA-${keyPart(id)}`,
  file: (id: string) => `GWS-FILE-${keyPart(id)}`,
  permission: (fileId: string, permId: string) => `GWS-PERM-${keyPart(fileId)}-${keyPart(permId)}`,
  form: (id: string) => `GWS-FORM-${keyPart(id)}`,
  project: (id: string) => `GWS-PROJECT-${keyPart(id)}`,
  unlistedProject: (user: string, name: string) => `GWS-PROJECT-UNLISTED-${keyPart(user)}-${keyPart(name)}`,
}
