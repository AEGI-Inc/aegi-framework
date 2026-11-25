/**
 * Atlassian Cloud 수집: Jira (AT-01, JI-02 ~ JI-07, JI-90), Confluence (CF-01, CF-02, CF-90), 조직 감사 기록 (AT-90).
 *
 * 자격증명: CRED-AT-01 수집 전용 계정의 이메일과 API 토큰. Jira, Confluence 가 같은 사이트와 계정을 쓴다.
 * AT-90 은 조직 Admin API 키(CRED-AT-ORG-02, read:events:admin)를 쓴다.
 * 권한 스킴, 프로젝트 역할 구성원, 감사 기록은 Jira 관리자여야 보인다. 수집기는 GET 만 보낸다.
 * 객체 선택 근거: 오브젝트 모델 v1 연구 묶음의 jira, confluence 타입과 4단계 결정
 * (권한 스킴 줄과 프로젝트 역할은 역할 칸이 있는 has_role_on, 필터 공유는 배정).
 */
import { buildUrl, CallError, type CallApi, type CallDef } from '../lib/runner'
import { atlassianBasicAuth, bearerAuth, normalizeAtlassianSiteUrl, oauthRefreshTokenAuth, TokenError } from '../lib/auth'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import { summarizeAutomationRule } from '../lib/external-definition'
import { maxIso, type ProviderContext } from './common'

const PAGE = 50
/** AT-90 은 지난 실행의 마지막 기록보다 이만큼 앞부터 다시 읽는다(늦게 잡히는 기록). 겹친 것은 ship 장부가 거른다 */
const ORG_AUDIT_OVERLAP_MS = 30 * 60_000
/** AT-90 한 쪽 건수. 기본 30, 허용 1~500(2026-11-19 실측: 1000 이면 400 ADMIN-400-17 "Limit must be in the range [1, 500]") */
const ORG_AUDIT_PAGE = 500

export function atlassianCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds, transport } = ctx
  const site = () => normalizeAtlassianSiteUrl(creds.get('ATLASSIAN_SITE_URL') ?? '')
  const isOAuthMode = () => !creds.get('ATLASSIAN_COLLECTOR_API_TOKEN') && Boolean(creds.get('ATLASSIAN_COLLECTOR_REFRESH_TOKEN'))
  let auth: Auth | null = null
  const at = (): Auth => {
    if (auth) return auth
    if (isOAuthMode()) {
      auth = oauthRefreshTokenAuth({
        ref: 'CRED-AT-01',
        tokenUrl: 'https://auth.atlassian.com/oauth/token',
        clientId: creds.get('ATLASSIAN_COLLECTOR_CLIENT_ID')!,
        clientSecret: creds.get('ATLASSIAN_COLLECTOR_CLIENT_SECRET')!,
        refreshToken: creds.get('ATLASSIAN_COLLECTOR_REFRESH_TOKEN')!,
        transport,
        onRotate: ({ refreshToken }) => creds.set('ATLASSIAN_COLLECTOR_REFRESH_TOKEN', refreshToken),
      })
      return auth
    }
    auth = atlassianBasicAuth('CRED-AT-01', creds.get('ATLASSIAN_COLLECTOR_EMAIL')!, creds.get('ATLASSIAN_COLLECTOR_API_TOKEN')!)
    return auth
  }
  const url = (path: string, query?: Record<string, string | number | boolean | undefined>) => {
    const cloudId = creds.get('ATLASSIAN_CLOUD_ID')
    if (isOAuthMode() && cloudId) {
      if (path.startsWith('/wiki/')) return buildUrl(`https://api.atlassian.com/ex/confluence/${cloudId}${path}`, query)
      if (path.startsWith('/rest/')) return buildUrl(`https://api.atlassian.com/ex/jira/${cloudId}${path}`, query)
    }
    return buildUrl(site() + path, query)
  }

  const state = { projects: [] as Array<{ id: string }>, groups: [] as Array<{ groupId: string }>, spaces: [] as Array<{ id: string }>, accounts: [] as string[] }

  const jiraPage = (api: CallApi, path: string, query: Record<string, string | number | boolean | undefined> = {}, params: Record<string, unknown> = {}, items: (b: any) => any[] = b => (Array.isArray(b) ? b : Array.isArray(b?.values) ? b.values : [])) =>
    api.list({ url: url(path, { startAt: 0, maxResults: PAGE, ...query }), auth: at(), paginate: { kind: 'offset', pageSize: PAGE }, items, params })
  const get = (api: CallApi, path: string, params: Record<string, unknown> = {}, query?: Record<string, string | number | boolean | undefined>) => api.get({ url: url(path, query), auth: at(), params })
  const wikiPage = (api: CallApi, path: string, params: Record<string, unknown> = {}, query: Record<string, string> = {}) =>
    api.list({ url: url(path, { limit: 250, ...query }), auth: at(), paginate: { kind: 'confluence' }, items: b => (Array.isArray(b?.results) ? b.results : []), params })

  const call = (id: string, title: string, product: 'jira' | 'confluence', run: (api: CallApi) => Promise<void>, depends?: () => string | null): CallDef => ({
    id, provider: 'atlassian', title, credential: 'CRED-AT-01',
    unavailable: () => {
      if (!config.atlassian?.[product]) return `not_configured:atlassian.${product}`
      return missingCredential(creds, 'CRED-AT-01') ?? depends?.() ?? null
    },
    run,
  })

  const automation = async (api: CallApi, product: 'jira' | 'confluence') => {
    try {
      const presetCloudId = creds.get('ATLASSIAN_CLOUD_ID')
      const info: any = presetCloudId ? { cloudId: presetCloudId } : await get(api, '/_edge/tenant_info', { kind: 'automation_cloud' })
      if (!/^[A-Za-z0-9-]+$/.test(info?.cloudId ?? '')) { api.partial('automation_cloud_id_unavailable'); return }
      const base = `https://api.atlassian.com/automation/public/${product}/${info.cloudId}/rest/v1/rule`
      let next: string | null = base + '/summary?limit=100'
      const seen = new Set<string>(), ruleIds = new Set<string>()
      while (next) {
        if (seen.has(next) || seen.size >= 1000) { api.partial('automation_pagination_incomplete'); break }
        seen.add(next)
        const page: any = await api.get({ url: next, auth: at(), params: { product, kind: 'automation_summary' } })
        if (!page) break
        for (const rule of page.data ?? []) if (typeof rule.uuid === 'string') ruleIds.add(rule.uuid)
        const link = page.links?.next
        if (!link) { next = null; continue }
        let candidate: URL
        try { candidate = new URL(link, base + '/summary') } catch { api.partial('automation_next_invalid'); break }
        if (candidate.origin !== 'https://api.atlassian.com' || candidate.pathname !== new URL(base + '/summary').pathname || candidate.username || candidate.password) { api.partial('automation_next_outside_collection'); break }
        next = candidate.href
      }
      for (const id of ruleIds) await api.optional(`automation_rule:${id}`, () => api.get({ url: `${base}/${encodeURIComponent(id)}?redactSensitiveFields=true`, auth: at(), params: { cloud: info.cloudId, product, rule: id, kind: 'automation_definition' }, transform: summarizeAutomationRule }))
    } catch (err) {
      // 자격증명 문제(401, OAuth 토큰 갱신 실패)는 다시 던진다. 실행 기록에 failed 와 원인이 남고, 이 SaaS 의 남은 호출은 멈춘다(runner.ts 7.2절).
      // 그 밖(403 기능·권한 없음, API 오류)은 api.optional 처럼 partial 로 남기되 오류 코드를 사유에 붙인다
      if ((err instanceof CallError && err.kind === 'auth') || err instanceof TokenError) throw err
      if (err instanceof CallError) { api.partial(`automation_rules_unavailable:${err.code}`); api.note(err.message); return }
      api.partial('automation_rules_unavailable')
    }
  }

  // 조직 감사 기록(Guard). 조직 ID 와 시작 시각은 설정, 키는 CRED-AT-ORG-02. 기간을 끝까지 links.next 로 넘긴다.
  // 시작은 config.since, orgAudit.since, 커서(마지막 기록 − 30분) 중 가장 늦은 때다
  const orgAudit: CallDef = {
    id: 'AT-90', provider: 'atlassian', title: 'Atlassian 조직 감사 기록(Guard)', credential: 'CRED-AT-ORG-02',
    unavailable: () => {
      const o = config.atlassian?.orgAudit
      if (!o) return 'not_configured:atlassian.orgAudit'
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(o.orgId ?? '')) return 'invalid_config:atlassian.orgAudit.orgId'
      if (o.since !== undefined && !Number.isFinite(Date.parse(o.since))) return 'invalid_config:atlassian.orgAudit.since'
      return missingCredential(creds, 'CRED-AT-ORG-02')
    },
    run: async api => {
      const o = config.atlassian!.orgAudit!
      const stream = 'atlassian.org_audit'
      const last = api.cursor(stream)?.last_event_at
      const from = Math.max(...[config.since, o.since].filter((v): v is string => !!v).map(v => Date.parse(v)),
        last ? Date.parse(last) - ORG_AUDIT_OVERLAP_MS : -Infinity)
      const rows = await api.list({
        url: buildUrl(`https://api.atlassian.com/admin/v1/orgs/${o.orgId}/events`, { from: Number.isFinite(from) ? from : undefined, to: Date.parse(api.period.until), limit: ORG_AUDIT_PAGE }),
        auth: bearerAuth('CRED-AT-ORG-02', creds.get('ATLASSIAN_ORG_AUDIT_API_KEY')!),
        paginate: { kind: 'atlassian-admin' },
        items: b => (Array.isArray(b?.data) ? b.data : []),
        params: { org: o.orgId, from: Number.isFinite(from) ? new Date(from).toISOString() : null },
      })
      api.setCursor(stream, { cursor: null, last_event_at: maxIso(rows.map((e: any) => e?.attributes?.time)) ?? last ?? null })
    },
  }

  // 조직(org) 수준 사용자, 역할, 그룹 (2026-11-15 수집 빈 곳). 사이트 사용자(JI-02)에는 조직 관리자 역할도, 사이트에 없는 조직 구성원도 없다.
  // 키는 조직 API 키 CRED-AT-ORG-01(읽기 범위), 조직 ID 는 config.atlassian.orgId. 공식 문서:
  // https://developer.atlassian.com/cloud/admin/organization/rest/api-group-directory/ (read:directories:admin)
  // https://developer.atlassian.com/cloud/admin/organization/rest/api-group-users/ (role-assignments, read:directories:admin)
  // https://developer.atlassian.com/cloud/admin/organization/rest/api-group-groups/ (read:groups:admin)
  const ORG_API = 'https://api.atlassian.com/admin/v2/orgs'
  const orgState = { directories: [] as string[], users: [] as Array<{ directory: string; accountId: string }>, listed: false }
  const orgKey = () => bearerAuth('CRED-AT-ORG-01', creds.get('ATLASSIAN_COLLECTOR_ORG_API_KEY')!)
  const orgId = () => config.atlassian?.orgId ?? ''
  const orgPage = (api: CallApi, path: string, params: Record<string, unknown>, query: Record<string, string | number> = {}) =>
    api.list({ url: buildUrl(`${ORG_API}/${encodeURIComponent(orgId())}${path}`, { limit: 100, ...query }), auth: orgKey(), paginate: { kind: 'atlassian-admin' }, items: b => (Array.isArray(b?.data) ? b.data : []), params: { org: orgId(), ...params } })
  const orgCall = (id: string, title: string, run: (api: CallApi) => Promise<void>, depends?: () => string | null): CallDef => ({
    id, provider: 'atlassian', title, credential: 'CRED-AT-ORG-01',
    unavailable: () => {
      if (!config.atlassian?.orgId) return 'config_missing:atlassian.orgId'
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(config.atlassian.orgId)) return 'invalid_config:atlassian.orgId'
      return missingCredential(creds, 'CRED-AT-ORG-01') ?? depends?.() ?? null
    },
    run,
  })
  const orgCalls: CallDef[] = [
    orgCall('AT-02', '조직 디렉터리와 조직 사용자', async api => {
      const dirs = await orgPage(api, '/directories', { kind: 'directories' })
      orgState.directories = dirs.map((d: any) => d?.directoryId).filter((d: unknown): d is string => typeof d === 'string' && /^[A-Za-z0-9-]+$/.test(d))
      orgState.users = []
      for (const directory of orgState.directories) {
        const users = await orgPage(api, `/directories/${encodeURIComponent(directory)}/users`, { kind: 'users', directory })
        for (const u of users) if (typeof u?.accountId === 'string') orgState.users.push({ directory, accountId: u.accountId })
      }
      orgState.listed = true
    }),
    // 사용자마다 역할 배정(조직 관리자 atlassian/org-admin, 사이트 관리자, 제품 역할). 그룹으로 받은 역할도 roleAssignmentMethods 로 나온다
    orgCall('AT-03', '조직 사용자 역할 배정', async api => {
      for (const u of orgState.users) {
        await api.optional(`role_assignments:${u.accountId}`, () => orgPage(api, `/directories/${encodeURIComponent(u.directory)}/users/${encodeURIComponent(u.accountId)}/role-assignments`, { kind: 'user_role_assignments', directory: u.directory, user: u.accountId }))
      }
    }, () => (orgState.users.length ? null : orgState.listed ? 'not_found:조직 사용자 없음' : 'depends_on:AT-02')),
    // 조직 그룹(디렉터리 소속). 사이트 그룹 목록(JI-03)에는 그룹의 조직 소속이 없다
    orgCall('AT-04', '조직 그룹', async api => {
      for (const directory of orgState.directories) await orgPage(api, `/directories/${encodeURIComponent(directory)}/groups`, { kind: 'groups', directory })
    }, () => (orgState.directories.length ? null : orgState.listed ? 'not_found:조직 디렉터리 없음' : 'depends_on:AT-02')),
  ]

  return [
    orgAudit,
    ...orgCalls,
    call('JI-10', 'Jira Automation 규칙 목록·정의 참조', 'jira', api => automation(api, 'jira')),
    call('CF-10', 'Confluence Automation 규칙 목록·정의 참조', 'confluence', api => automation(api, 'confluence')),
    call('AT-01', 'Jira 사이트 정보', 'jira', async api => { await get(api, '/rest/api/3/serverInfo') }),
    call('JI-02', 'Jira 사용자', 'jira', async api => {
      const users = await jiraPage(api, '/rest/api/3/users/search')
      state.accounts = users.map((u: any) => u?.accountId).filter((id: unknown): id is string => typeof id === 'string')
    }),
    call('JI-03', '그룹과 회원', 'jira', async api => {
      state.groups = await jiraPage(api, '/rest/api/3/group/bulk')
      for (const g of state.groups) await jiraPage(api, '/rest/api/3/group/member', { groupId: g.groupId, includeInactiveUsers: true }, { group: g.groupId })
    }),
    call('JI-04', '프로젝트', 'jira', async api => {
      state.projects = await jiraPage(api, '/rest/api/3/project/search', { expand: 'lead' })
    }),
    // 역할 목록은 이름 → 주소 맵이다. 주소 끝의 역할 id 로 구성원을 읽는다
    call('JI-05', '프로젝트 역할과 구성원', 'jira', async api => {
      for (const p of state.projects) {
        const roles = await api.optional(`project_roles:${p.id}`, () => get(api, `/rest/api/3/project/${p.id}/role`, { project: p.id, kind: 'role_map' }))
        for (const href of Object.values(roles ?? {})) {
          const roleId = /\/role\/(\d+)$/.exec(String(href))?.[1]
          if (roleId) await api.optional(`project_role:${p.id}:${roleId}`, () => get(api, `/rest/api/3/project/${p.id}/role/${roleId}`, { project: p.id, role: roleId }))
        }
      }
    }, () => (state.projects.length ? null : 'depends_on:JI-04')),
    call('JI-06', '권한 스킴과 프로젝트별 스킴', 'jira', async api => {
      await get(api, '/rest/api/3/permissionscheme', { kind: 'schemes' }, { expand: 'permissions,user,group,projectRole' })
      for (const p of state.projects) await api.optional(`project_scheme:${p.id}`, () => get(api, `/rest/api/3/project/${p.id}/permissionscheme`, { project: p.id }))
    }),
    // 워크플로 id 를 쿼리 인자로 받는다. 인자 없이 부르면 400 "워크플로 ID를 제공하거나 프로젝트 및 이슈 유형 ID를 모두 제공해야 합니다" (2026-11-19 실측)
    call('JI-11', '워크플로와 워크플로별 편집 규칙', 'jira', async api => {
      const flows = await jiraPage(api, '/rest/api/3/workflow/search')
      for (const id of new Set<string>(flows.map((w: any) => w?.id?.entityId).filter((v: unknown): v is string => typeof v === 'string'))) {
        await api.optional(`workflow_capabilities:${id}`, () => get(api, '/rest/api/3/workflows/capabilities', { workflow: id }, { workflowId: id }))
      }
    }),
    call('JI-07', '필터와 공유', 'jira', async api => {
      await jiraPage(api, '/rest/api/3/filter/search', { expand: 'sharePermissions,editPermissions,owner' })
    }),
    // 감사 기록은 offset/limit 이고 끝까지 페이지를 넘겨 받는다
    call('JI-90', 'Jira 감사 기록', 'jira', async api => {
      if (!config.atlassian?.audit) { api.partial('not_configured:atlassian.audit'); return }
      await api.list({
        url: url('/rest/api/3/auditing/record', { from: config.since, to: api.period.until, limit: 1000, offset: 0 }),
        auth: at(),
        paginate: { kind: 'offset', pageSize: 1000, offsetParam: 'offset', limitParam: 'limit' },
        items: b => (Array.isArray(b?.records) ? b.records : []),
        params: { from: config.since },
      })
    }),
    call('CF-01', 'Confluence 스페이스', 'confluence', async api => {
      state.spaces = await wikiPage(api, '/wiki/api/v2/spaces')
    }),
    call('CF-02', 'Confluence 스페이스 권한', 'confluence', async api => {
      for (const s of state.spaces) await api.optional(`space_permissions:${s.id}`, () => wikiPage(api, `/wiki/api/v2/spaces/${s.id}/permissions`, { space: s.id }))
    }, () => (state.spaces.length ? null : 'depends_on:CF-01')),
    // 계정 id 를 쿼리 인자로 받는다. 인자 없이 부르면 400 "Username/Userkey are not accepted as parameters" (2026-11-19 실측)
    call('CF-03', 'Confluence 사용자별 소속 그룹', 'confluence', async api => {
      for (const id of state.accounts) await api.optional(`memberof:${id}`, () => wikiPage(api, '/wiki/rest/api/user/memberof', { account: id }, { accountId: id }))
    }, () => (state.accounts.length ? null : 'depends_on:JI-02')),
    // Confluence 감사 기록(CF-90). Free 는 403 이므로 optional 로 넘긴다.
    // 응답에 isLast·total 이 없어 offset 방식으로는 첫 쪽에서 멈춘다. _links.next 를 따라 넘기고, 다음 쪽을 못 받으면 partial(runner 'confluence-v1')
    call('CF-90', 'Confluence 감사 기록', 'confluence', async api => {
      if (!config.atlassian?.audit) { api.partial('not_configured:atlassian.audit'); return }
      await api.optional('confluence_audit', () => api.list({
        url: url('/wiki/rest/api/audit', {
          startDate: config.since ? new Date(config.since).getTime() : undefined,
          endDate: new Date(api.period.until).getTime(),
          start: 0,
          limit: 1000,
        }),
        auth: at(),
        paginate: { kind: 'confluence-v1', pageSize: 1000 },
        items: b => (Array.isArray(b?.results) ? b.results : Array.isArray(b) ? b : []),
      }))
    }),
  ]
}
