// 조직 경계 표 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 규칙 5, 6)
//
// 벤더가 계정 속성으로 「조직 밖」이라고 밝힌 계정만 조직 밖으로 둔다. 메일 도메인만으로는 정하지 않는다(규칙 6).
// 판정(judge.ts)은 SaaS 이름 없이 ThreatInputs.outside 만 읽는다. 표는 aegi-knowledge ontology 로 옮길 대상이다.
//
// 근거 (2026-11-12 확인)
//   Slack user is_restricted 「whether or not the user is a guest user」, is_stranger 「belongs to a different workspace」,
//     team_id 「Workspace ID the user belongs to」, enterprise_user.enterprise_id(Enterprise Grid 조직 ID)  https://docs.slack.dev/reference/objects/user-object
//     team enterprise_id(그 워크스페이스가 속한 Enterprise Grid 조직)  https://docs.slack.dev/reference/methods/team.info
//   Google Workspace User isGuestUser 「Indicates if the inserted user is a guest」
//     https://developers.google.com/workspace/admin/directory/reference/rest/v1/users
//   Atlassian accountType customer 「Jira Service Desk account representing an external service」
//     https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-users/
//   Salesforce User UserType PowerPartner, CspLitePortal, CustomerSuccess, PowerCustomerSuccess, Guest 는 파트너, 고객, 비인증 사용자
//     https://developer.salesforce.com/docs/platform/object-reference/references/standard-objects/object-user.html
import type { GraphStoreV2 } from '../../model/graph'
import type { FixtureObject } from '../../model/object'

type Props = Record<string, unknown>

export const BOUNDARY_TABLE = {
  /** 속성 값이 이 중 하나면 조직 밖 */
  flags: [
    { provider: 'slack', objectType: '200.members[*]', path: 'is_restricted', values: [true], reason: '게스트' },
    { provider: 'slack', objectType: '200.members[*]', path: 'is_ultra_restricted', values: [true], reason: '단일 채널 게스트' },
    { provider: 'slack', objectType: '200.members[*]', path: 'is_stranger', values: [true], reason: '다른 워크스페이스' },
    { provider: 'gws', objectType: 'User', path: 'isGuestUser', values: [true], reason: '게스트' },
    { provider: 'atlassian', objectType: 'User', path: 'accountType', values: ['customer'], reason: '고객 계정' },
    {
      provider: 'salesforce', objectType: 'User', path: 'UserType',
      values: ['PowerPartner', 'CspLitePortal', 'CustomerSuccess', 'PowerCustomerSuccess', 'Guest'], reason: '파트너, 고객, 비인증 사용자',
    },
  ],
  /**
   * 계정의 워크스페이스가 수집한 워크스페이스와 다르면 조직 밖(Slack Connect 외부 구성원).
   * 같은 Enterprise Grid 조직의 다른 워크스페이스 계정은 조직 안(orgPath 와 tenantOrgPath 가 같으면)
   */
  homeTenant: [
    {
      provider: 'slack', objectType: '200.members[*]', path: 'team_id', tenantTypes: ['200.team', '200.team_2'], tenantPath: 'id',
      orgPath: 'enterprise_user.enterprise_id', tenantOrgPath: 'enterprise_id', reason: '외부 워크스페이스',
    },
  ],
} as const

const objectsOf = (graph: GraphStoreV2, provider: string, type: string): FixtureObject[] =>
  (graph.objectsByProvider.get(provider) ?? []).filter(o => o.canonical.object_type === type)

/** 점으로 이은 경로(a.b)도 읽는다 */
const prop = (o: FixtureObject, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Props)[k] : undefined), o.canonical.properties)

/** 조직 밖 계정 키와 사유 */
export function outsideAccounts(graph: GraphStoreV2): Map<string, string> {
  const out = new Map<string, string>()
  for (const f of BOUNDARY_TABLE.flags) {
    for (const o of objectsOf(graph, f.provider, f.objectType)) {
      if ((f.values as readonly unknown[]).includes(prop(o, f.path)) && !out.has(o.fixture_key)) out.set(o.fixture_key, f.reason)
    }
  }
  for (const h of BOUNDARY_TABLE.homeTenant) {
    const tenants = h.tenantTypes.flatMap(t => objectsOf(graph, h.provider, t))
    const home = new Set(tenants.map(o => String(prop(o, h.tenantPath) ?? '')).filter(Boolean))
    const homeOrg = new Set(tenants.map(o => String(prop(o, h.tenantOrgPath) ?? '')).filter(Boolean))
    // 수집한 워크스페이스를 모르면 정하지 않는다
    if (!home.size) continue
    for (const o of objectsOf(graph, h.provider, h.objectType)) {
      const team = prop(o, h.path)
      const org = prop(o, h.orgPath)
      if (typeof org === 'string' && homeOrg.has(org)) continue
      if (typeof team === 'string' && team && !home.has(team) && !out.has(o.fixture_key)) out.set(o.fixture_key, h.reason)
    }
  }
  return out
}
