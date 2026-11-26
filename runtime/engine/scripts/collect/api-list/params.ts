/**
 * 경로 변수({userId} 등)의 값을 어디서 얻는지 정한다.
 *
 * - const: 설정 값(조직 login, Google 고객 ID 등)
 * - fanout: 이번 실행에서 앞서 끝난 손코드 호출의 원본 페이지(예: OK-02 사용자 목록의 id)
 *
 * 변수 이름만으로는 모호해서({id}) 바로 앞 경로 조각(users, groups …)을 함께 본다.
 * - parent: 표에 없는 변수는 같은 SaaS 의 부모 목록 operation(경로 `/a/{x}/b` 의 부모는 GET `/a`)에서 받는다 (build.ts).
 *
 * 경로 변수가 여럿이면 마지막 변수만 부모 목록 항목에서 꺼내고, 앞 변수는 부모 페이지의 요청 값에서 이어받는다(중첩 fanout).
 */
import type { Provider } from '../lib/store'

export interface FanoutSource {
  /** 부모 목록을 받은 손코드 호출 ID */
  call: string
  /** 이 요청 값이 없는 페이지만 (예: OK-03 의 그룹 목록 페이지는 group 이 없다) */
  absent?: string[]
  /** payload 에서 항목 배열까지의 경로. '*' 는 payload 자체가 배열 */
  items: string
  field: string
  /** field 가 없을 때 차례로 볼 항목 필드 (같은 이름, 이름 힌트, 부모 identity, id) */
  fields?: string[]
  /** Google 자원 이름(devices/abc)처럼 / 가 있으면 마지막 조각만 쓴다 */
  last_segment?: boolean
  /** 이 경로와 맞는 부모 페이지만 쓴다 (손코드 호출 하나가 여러 경로를 부르는 경우) */
  path_template?: string
  /** 앞 경로 변수: 자식 변수 이름 → 부모 페이지 request_params 이름 */
  inherit?: Record<string, string>
}

export type ParamResolution =
  | { kind: 'const'; config: string }
  | { kind: 'literal'; value: string }
  | { kind: 'fanout'; from: FanoutSource }

/** 값이 설정에 있는 변수 */
const CONSTS: Partial<Record<Provider, Record<string, ParamResolution>>> = {
  github: {
    org: { kind: 'const', config: 'github.org' },
    owner: { kind: 'const', config: 'github.org' },
    enterprise: { kind: 'const', config: 'github.enterprise' },
  },
  gws: {
    customer: { kind: 'literal', value: 'my_customer' },
    customerId: { kind: 'literal', value: 'my_customer' },
    customersId: { kind: 'literal', value: 'my_customer' },
  },
  atlassian: {
    orgId: { kind: 'const', config: 'atlassian.orgId' },
  },
}

/**
 * 경로에 없는 필수 인자(쿼리, RPC 인자)의 값. operation_id → 인자 이름 → 값.
 * 문서에 필수로 적히지 않아 빈 인자로 불렀다가 오류가 난 것만 넣는다(2026-11-02 실측, engine #246).
 */
export const QUERY_PARAMS: Record<string, Record<string, ParamResolution>> = {
  'op:slack_docs_methods:admin.teams.settings.info': { team_id: { kind: 'const', config: 'slack.teamId' } },
  'op:slack_docs_methods:admin.apps.requests.list': { team_id: { kind: 'const', config: 'slack.teamId' } },
  // 문서상 이 메서드가 받는 정책 이름은 비밀번호 로그인(email_password) 하나다
  'op:slack_docs_methods:admin.auth.policy.getEntities': { policy_name: { kind: 'literal', value: 'email_password' } },
  // filter 가 없으면 400. principalType 은 두 종류뿐이다
  'op:okta_management_openapi:listPrincipalRateLimitEntities': { filter: { kind: 'literal', value: 'principalType eq "OAUTH_CLIENT" or principalType eq "SSWS_TOKEN"' } },
  'op:slack_docs_methods:conversations.listConnectInvites': { team_id: { kind: 'const', config: 'slack.teamId' } },
  // 기본 limit 200 이면 invalid_arguments "must be less than 25"
  'op:slack_docs_methods:team.externalTeams.list': { limit: { kind: 'literal', value: '20' } },
  // Chrome telemetry 는 readMask 가 없으면 400, 알림 설정은 pageSize 를 1~100 으로 줘야 한다
  'op:gws_chromemanagement:chromemanagement.customers.telemetry.devices.list': { readMask: { kind: 'literal', value: 'name,deviceId,serialNumber,orgUnitId' } },
  'op:gws_chromemanagement:chromemanagement.customers.telemetry.users.list': { readMask: { kind: 'literal', value: 'name,orgUnitId,userEmail,userId' } },
  'op:gws_chromemanagement:chromemanagement.customers.telemetry.notificationConfigs.list': { pageSize: { kind: 'literal', value: '100' } },
  // Groups Settings API 는 alt=json 이 없으면 Atom XML 을 반환한다
  'op:gws_groupssettings:groupsSettings.groups.get': { alt: { kind: 'literal', value: 'json' } },
}

/** user 토큰으로는 not_allowed_token_type 인 Slack 메서드. 수집 앱 bot 토큰(CRED-SL-02, conversations.connect:manage)으로 부른다 (2026-11-02 실측) */
export const SLACK_BOT_TOKEN_OPS = new Set([
  'op:slack_docs_methods:conversations.listConnectInvites',
  'op:slack_docs_methods:conversations.requestSharedInvite.list',
  'op:slack_docs_methods:team.externalTeams.list',
])

/** Salesforce 객체 중 WHERE 없이는 조회되지 않는 것 (Implementation restriction). 같은 조직의 전체 부모로 거른다 */
export const SOQL_WHERE: Record<string, string> = {
  ContentDocumentLink: 'LinkedEntityId IN (SELECT Id FROM User)',
  ContentFolderMember: 'ParentContentFolderId IN (SELECT Id FROM ContentFolder)',
}

/** (앞 경로 조각 → 부모 목록). 변수 이름과 상관없이 앞 조각으로 고른다 */
const BY_SEGMENT: Partial<Record<Provider, Record<string, FanoutSource>>> = {
  github: {
    teams: { call: 'GH-04', absent: ['team'], items: '*', field: 'slug' },
    members: { call: 'GH-02', items: '*', field: 'login' },
    users: { call: 'GH-02', items: '*', field: 'login' },
  },
  okta: {
    users: { call: 'OK-02', items: '*', field: 'id' },
    groups: { call: 'OK-03', absent: ['group'], items: '*', field: 'id' },
    apps: { call: 'OK-07', absent: ['app'], items: '*', field: 'id' },
    authenticators: { call: 'OK-22', items: '*', field: 'id', path_template: '/api/v1/authenticators' },
    policies: { call: 'OK-10', items: '*', field: 'id', path_template: '/api/v1/policies' },
  },
  gws: {
    users: { call: 'GW-03', items: 'users', field: 'primaryEmail' },
    groups: { call: 'GW-04', absent: ['group'], items: 'groups', field: 'email' },
    calendars: { call: 'GW-03', items: 'users', field: 'primaryEmail' },
  },
  atlassian: {
    project: { call: 'JI-04', items: 'values', field: 'key' },
    user: { call: 'JI-02', items: '*', field: 'accountId' },
    spaces: { call: 'CF-01', items: 'results', field: 'id' },
  },
}

/** 이름으로만 정하는 변수 (앞 조각이 다른 변수일 때) */
const BY_NAME: Partial<Record<Provider, Record<string, FanoutSource>>> = {
  github: {
    repo: { call: 'GH-05', items: '*', field: 'name' },
    team_slug: { call: 'GH-04', absent: ['team'], items: '*', field: 'slug' },
    username: { call: 'GH-02', items: '*', field: 'login' },
  },
  gws: {
    userKey: { call: 'GW-03', items: 'users', field: 'primaryEmail' },
    groupKey: { call: 'GW-04', absent: ['group'], items: 'groups', field: 'email' },
    groupUniqueId: { call: 'GW-04', absent: ['group'], items: 'groups', field: 'email' },
  },
  atlassian: {
    projectIdOrKey: { call: 'JI-04', items: 'values', field: 'key' },
    projectKeyOrId: { call: 'JI-04', items: 'values', field: 'key' },
    accountId: { call: 'JI-02', items: '*', field: 'accountId' },
    // 조직 사용자 관리 API(/users/{account_id}/manage…)의 이름
    account_id: { call: 'JI-02', items: '*', field: 'accountId' },
  },
}

export interface TemplateParam {
  name: string
  /** 바로 앞 경로 조각 (없거나 변수면 null) */
  segment: string | null
}

export function templateParams(template: string): TemplateParam[] {
  const segs = template.split('?')[0].split('/').filter(Boolean)
  const out: TemplateParam[] = []
  segs.forEach((s, i) => {
    const m = /^\{([^}]+)\}$/.exec(s)
    if (!m) return
    const prev = segs[i - 1]
    out.push({ name: m[1], segment: prev && !/^\{/.test(prev) ? prev : null })
  })
  return out
}

export function resolveParam(provider: Provider, p: TemplateParam): ParamResolution | null {
  const c = CONSTS[provider]?.[p.name]
  if (c) return c
  const byName = BY_NAME[provider]?.[p.name]
  if (byName) return { kind: 'fanout', from: byName }
  const bySeg = p.segment ? BY_SEGMENT[provider]?.[p.segment] : undefined
  return bySeg ? { kind: 'fanout', from: bySeg } : null
}

export interface ParamPlan {
  ok: boolean
  /** 실패 사유 (unresolved_param:<이름>, nested_fanout) */
  reason?: string
  resolutions: Record<string, ParamResolution>
  fanout?: { param: string; from: FanoutSource }
}

/** 마지막 fanout 변수의 부모 목록을 찾는다. inherit 는 앞 fanout 변수 이름들 */
export type ParentFinder = (last: TemplateParam, inherit: string[]) => FanoutSource | null

export function planParams(provider: Provider, template: string, parentOf?: ParentFinder): ParamPlan {
  const resolutions: Record<string, ParamResolution> = {}
  const pending: Array<{ p: TemplateParam; r: ParamResolution | null }> = []
  for (const p of templateParams(template)) {
    const r = resolveParam(provider, p)
    if (r && r.kind !== 'fanout') resolutions[p.name] = r
    else pending.push({ p, r })
  }
  if (!pending.length) return { ok: true, resolutions }
  if (pending.length === 1 && pending[0].r?.kind === 'fanout') {
    const from = pending[0].r.from
    resolutions[pending[0].p.name] = pending[0].r
    return { ok: true, resolutions, fanout: { param: pending[0].p.name, from } }
  }
  const last = pending[pending.length - 1].p
  const from = parentOf?.(last, pending.slice(0, -1).map(x => x.p.name))
  if (from) {
    for (const { p } of pending) resolutions[p.name] = { kind: 'fanout', from }
    return { ok: true, resolutions, fanout: { param: last.name, from } }
  }
  const missing = pending.find(x => !x.r)
  return { ok: false, reason: missing ? `unresolved_param:${missing.p.name}` : 'nested_fanout', resolutions }
}

/** 경로 틀이 주소의 끝과 맞는가 (정규화기 input.mjs 와 같은 방식). 호스트 쪽 기본 경로(/wiki/api/v2 등)는 앞에 붙어도 된다 */
export function matchesTemplate(url: string, template: string): boolean {
  const re = template.split('?')[0].split('/').map(s => (/^\{[^}]+\}$/.test(s) ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/').replace(/\/$/, '')
  let pathname: string
  try { pathname = new URL(url).pathname.replace(/\/$/, '') } catch { return false }
  return new RegExp(re + '$').test(pathname)
}

/**
 * 부모 페이지에서 fanout 값 묶음을 뽑는다: { 마지막 변수: 항목 값, 앞 변수: 부모 요청 값 }.
 * 앞 변수 값이 없는 페이지는 버린다. 중복 제거, 순서 보존.
 */
export function fanoutTuples(pages: Array<{ url?: string; request_params: Record<string, unknown>; payload: unknown }>, from: FanoutSource, param: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = []
  const seen = new Set<string>()
  for (const page of pages) {
    if (from.path_template && page.url && !matchesTemplate(page.url, from.path_template)) continue
    if ((from.absent ?? []).some(k => page.request_params[k] != null)) continue
    const inherited: Record<string, string> = {}
    let ok = true
    for (const [child, parentKey] of Object.entries(from.inherit ?? {})) {
      // 손코드 호출은 userId 를 user 처럼 Id 를 뗀 이름으로 남긴다
      const v = page.request_params[parentKey] ?? page.request_params[parentKey.replace(/(Id|_id)$/, '')]
      if (typeof v === 'string' || typeof v === 'number') inherited[child] = String(v)
      else ok = false
    }
    if (!ok) continue
    const items = from.items === '*' ? page.payload : from.items.split('.').reduce<any>((cur, k) => cur?.[k], page.payload)
    for (const item of Array.isArray(items) ? items : []) {
      const v = (from.fields ?? [from.field]).map(f => item?.[f]).find(x => (typeof x === 'string' && x) || typeof x === 'number')
      if (v === undefined) continue
      // 자원 이름의 조각은 이미 URL 인코딩되어 있다(devices/Ei…%3D). 경로에 넣을 때 다시 인코딩하므로 풀어 둔다
      const value = from.last_segment && typeof v === 'string' ? decodeSegment(v.split('/').pop()!) : String(v)
      if (!value) continue
      const tuple = { ...inherited, [param]: value }
      const key = JSON.stringify(tuple)
      if (!seen.has(key)) { seen.add(key); out.push(tuple) }
    }
  }
  return out
}

function decodeSegment(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

/** 부모 페이지에서 fanout 값을 뽑는다 (중복 제거, 순서 보존) */
export function fanoutValues(pages: Array<{ request_params: Record<string, unknown>; payload: unknown }>, from: FanoutSource): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const page of pages) {
    if ((from.absent ?? []).some(k => page.request_params[k] != null)) continue
    const items = from.items === '*' ? page.payload : (page.payload as any)?.[from.items]
    for (const item of Array.isArray(items) ? items : []) {
      const v = item?.[from.field]
      if ((typeof v === 'string' && v) || typeof v === 'number') {
        const s = String(v)
        if (!seen.has(s)) { seen.add(s); out.push(s) }
      }
    }
  }
  return out
}
