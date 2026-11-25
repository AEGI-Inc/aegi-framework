/**
 * GitHub 수집 (계획서 5.1절, GH-01 ~ GH-28. GH-18 웹훅은 worker.ts. GH-24 ~ GH-28 은 v2 V2-P1).
 *
 * 자격증명: CRED-GH-01 GitHub App `aegi-collector` 설치 토큰이 기본.
 *   GH-19 는 엔터프라이즈 설치(GITHUB_APP_ENTERPRISE_INSTALLATION_ID), GH-20·GH-22 는
 *   엔터프라이즈 소유자 토큰(CRED-GH-02)이 있으면 그것을 쓴다. 이 셋은 없어도 나머지는 진행한다.
 */
import fs from 'node:fs'
import { buildUrl, type CallApi, type CallDef, type Classifier, httpClassifier } from '../lib/runner'
import { bearerAuth, githubAppAuth, oauthRefreshTokenAuth, GITHUB_HEADERS } from '../lib/auth'
import { sha256Hex } from '../lib/sanitize'
import { summarizeWorkflowContent, summarizeVariables } from '../lib/github-actions'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import { isoDate, maxIso, streamStart, type ProviderContext } from './common'
import { runProbes, type ProbeTarget } from './probes'

const API = 'https://api.github.com'

/** GraphQL 은 200 과 함께 errors 를 준다. 데이터가 하나도 없으면 권한 오류로 본다 */
export const graphqlClassifier: Classifier = res => {
  const http = httpClassifier(res)
  if (http) return http
  const body = res.body as { data?: Record<string, unknown> | null; errors?: Array<{ type?: string; message?: string }> }
  if (!body?.errors?.length) return null
  const type = body.errors[0].type ?? 'ERROR'
  const hasData = body.data && Object.values(body.data).some(v => v !== null)
  return { kind: hasData ? 'partial' : type === 'NOT_FOUND' ? 'not_found' : 'forbidden', code: `graphql_${type.toLowerCase()}` }
}

/** 웹훅 주소는 host, scheme 과 지문만 (GH-15) */
export function maskHookUrl(hook: any): any {
  if (!hook?.config?.url) return hook
  const url = String(hook.config.url)
  let host = 'invalid'
  let scheme: string | undefined
  let deploymentId: string | undefined
  let automationRuleKey: string | undefined
  let automationNamespace: string | undefined
  try {
    const parsed = new URL(url)
    host = parsed.host
    scheme = parsed.protocol.replace(/:$/, '').toLowerCase() || undefined
    // Preserve the public Apps Script deployment identifier before discarding the
    // URL. Never treat a lookalike host, redirect URL or development URL as a receiver.
    if (parsed.protocol === 'https:' && parsed.hostname === 'script.google.com' && !parsed.port && !parsed.username && !parsed.password) {
      deploymentId = parsed.pathname.match(/^\/(?:a\/macros\/[^/]+|macros)\/s\/([A-Za-z0-9_-]+)\/exec\/?$/)?.[1]
    }
    if (parsed.protocol === 'https:' && parsed.hostname === 'api-private.atlassian.com' && !parsed.port && !parsed.username && !parsed.password) {
      const route = parsed.pathname.match(/^\/automation\/webhooks\/(jira|confluence)\/a\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/[^/]+)?\/?$/i)
      if (route) { automationRuleKey = `${route[1].toLowerCase()}/${route[3].toLowerCase()}`; automationNamespace = route[2].toLowerCase() }
    }
  } catch { /* 그대로 */ }
  return { ...hook, config: { ...hook.config, url: { host, ...(scheme ? { scheme } : {}), sha256: sha256Hex(url), ...(deploymentId ? { deployment_id: deploymentId } : {}), ...(automationRuleKey ? { automation_rule_key: automationRuleKey, automation_namespace_ref: automationNamespace } : {}) } } }
}

interface RepoRef {
  name: string
  default_branch: string
}

export function githubCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds, transport } = ctx
  const org = config.github.org
  const enterprise = config.github.enterprise
  const missingApp = () => missingCredential(creds, 'CRED-GH-01')

  let appAuth: Auth | null = null
  const app = (): Auth => {
    if (appAuth) return appAuth
    if (!creds.get('GITHUB_APP_PRIVATE_KEY') && creds.get('GITHUB_COLLECTOR_OAUTH_TOKEN')) {
      const oauthToken = creds.get('GITHUB_COLLECTOR_OAUTH_TOKEN')!
      if (!oauthToken.startsWith('gho_') && !oauthToken.startsWith('ghp_') && creds.get('GITHUB_COLLECTOR_REFRESH_TOKEN') && creds.get('GITHUB_OAUTH_CLIENT_ID') && creds.get('GITHUB_OAUTH_CLIENT_SECRET')) {
        appAuth = oauthRefreshTokenAuth({
          ref: 'CRED-GH-01',
          tokenUrl: 'https://github.com/login/oauth/access_token',
          clientId: creds.get('GITHUB_OAUTH_CLIENT_ID')!,
          clientSecret: creds.get('GITHUB_OAUTH_CLIENT_SECRET')!,
          refreshToken: creds.get('GITHUB_COLLECTOR_REFRESH_TOKEN')!,
          transport,
          onRotate: ({ refreshToken }) => creds.set('GITHUB_COLLECTOR_REFRESH_TOKEN', refreshToken),
        })
      } else {
        appAuth = bearerAuth('CRED-GH-01', oauthToken)
      }
      return appAuth
    }
    let pem = creds.get('GITHUB_APP_PRIVATE_KEY')
    if (!pem && fs.existsSync('setup-output/secrets/github-app-collector.pem')) {
      pem = fs.readFileSync('setup-output/secrets/github-app-collector.pem', 'utf8')
    }
    const appId = creds.get('GITHUB_APP_ID') || '5596279'
    appAuth = githubAppAuth({
      ref: 'CRED-GH-01',
      appId,
      installationId: creds.get('GITHUB_APP_INSTALLATION_ID')!,
      privateKeyPem: pem!,
      transport,
    })
    return appAuth
  }
  const owner = (): Auth | null => {
    const t = creds.get('GITHUB_OWNER_TOKEN')
    return t ? bearerAuth('CRED-GH-02', t) : null
  }

  const state = { members: [] as string[], repos: [] as RepoRef[], environments: [] as Array<{ repo: string; name: string }> }
  const url = (path: string, query?: Record<string, string | number | undefined>) => buildUrl(API + path, query)
  const base = { headers: GITHUB_HEADERS }
  const list = (api: CallApi, path: string, query: Record<string, string | number | undefined> = {}, params: Record<string, unknown> = {}, items: (b: any) => any[] = b => b, extra: object = {}) =>
    api.list({ ...base, ...extra, url: url(path, { per_page: 100, ...query }), auth: (extra as { auth?: Auth }).auth ?? app(), paginate: { kind: 'link' }, items, params })
  const get = (api: CallApi, path: string, params: Record<string, unknown> = {}, extra: object = {}) => api.get({ ...base, ...extra, url: url(path), auth: app(), params })
  const graphql = (api: CallApi, auth: Auth, query: string, variables: Record<string, unknown>, params: Record<string, unknown> = {}) =>
    api.get({ ...base, url: `${API}/graphql`, auth, method: 'POST', body: JSON.stringify({ query, variables }), classify: graphqlClassifier, params: { ...params, variables } })

  const repoList = () => state.repos
  const needRepos = () => missingApp() ?? (repoList().length ? null : 'depends_on:GH-05 (저장소 목록 없음)')

  const call = (id: string, title: string, run: (api: CallApi) => Promise<void>, unavailable: () => string | null = missingApp): CallDef => ({ id, provider: 'github', title, credential: 'CRED-GH-01', unavailable, run })

  return [
    call('GH-01', 'Organization', async api => {
      await get(api, `/orgs/${org}`)
    }),
    {
      id: 'GH-23',
      provider: 'github',
      title: 'Enterprise (GraphQL)',
      credential: 'CRED-GH-02',
      // App 설치 토큰은 엔터프라이즈 조회가 FORBIDDEN 이다 (09-27 확인). 소유자 토큰이 있으면 그것으로
      unavailable: () => (owner() ? null : missingApp()),
      run: async api => {
        await graphql(api, owner() ?? app(), 'query($slug: String!) { enterprise(slug: $slug) { id databaseId slug name createdAt } }', { slug: enterprise })
      },
    },
    call('GH-02', '조직 멤버 (전체·관리자)', async api => {
      const all = await list(api, `/orgs/${org}/members`, { role: 'all' }, { role: 'all' })
      await list(api, `/orgs/${org}/members`, { role: 'admin' }, { role: 'admin' })
      state.members = all.map((m: any) => m.login)
    }),
    call('GH-35', '외부 협력자 (전체·2FA 미사용)', async api => {
      await api.optional('outside_collaborators:all', () => list(api, `/orgs/${org}/outside_collaborators`, { filter: 'all' }, { filter: 'all' }))
      await api.optional('outside_collaborators:2fa_disabled', () => list(api, `/orgs/${org}/outside_collaborators`, { filter: '2fa_disabled' }, { filter: '2fa_disabled' }))
    }),
    call('GH-03', '사용자 보강', async api => {
      for (const login of state.members) await get(api, `/users/${login}`, { login })
    }, () => missingApp() ?? (state.members.length ? null : 'depends_on:GH-02')),
    call('GH-21', '검증 도메인 이메일 (GraphQL)', async api => {
      await graphql(
        api,
        app(),
        'query($org: String!) { organization(login: $org) { membersWithRole(first: 100) { nodes { login databaseId organizationVerifiedDomainEmails(login: $org) } } } }',
        { org },
      )
    }),
    call('GH-04', '팀·팀 멤버·팀 저장소', async api => {
      const teams = await list(api, `/orgs/${org}/teams`)
      for (const t of teams) {
        await list(api, `/orgs/${org}/teams/${t.slug}/members`, { role: 'all' }, { team: t.slug })
        await list(api, `/orgs/${org}/teams/${t.slug}/repos`, {}, { team: t.slug })
      }
    }),
    call('GH-05', '저장소', async api => {
      const repos = await list(api, `/orgs/${org}/repos`, { type: 'all' })
      const wanted = config.github.repos?.length ? new Set(config.github.repos) : null
      for (const r of repos) {
        if (wanted && !wanted.has(r.name)) continue
        const detail = await get(api, `/repos/${org}/${r.name}`, { repo: r.name })
        if (detail) state.repos.push({ name: r.name, default_branch: detail.default_branch ?? r.default_branch })
      }
      if (wanted) for (const name of wanted) if (!state.repos.some(r => r.name === name)) api.partial(`repo_not_found:${name}`)
    }),
    call('GH-06', '저장소 직접 협업자', async api => {
      for (const r of repoList()) await list(api, `/repos/${org}/${r.name}/collaborators`, { affiliation: 'direct' }, { repo: r.name, affiliation: 'direct' })
    }, needRepos),
    call('GH-07', '조직 사용자 정의 저장소 역할', async api => {
      await list(api, `/orgs/${org}/custom-repository-roles`, {}, {}, b => b?.custom_roles ?? [])
    }),
    call('GH-08', '룰셋 (저장소·조직)', async api => {
      for (const r of repoList()) {
        const sets = await list(api, `/repos/${org}/${r.name}/rulesets`, { includes_parents: 'true' }, { repo: r.name })
        for (const s of sets) await get(api, `/repos/${org}/${r.name}/rulesets/${s.id}`, { repo: r.name, ruleset: s.id })
      }
      // 조직 룰셋은 App 의 조직 Administration(read) 권한이 필요하다 (09-27 첫 수집에서 403)
      const orgSets = (await api.optional('org_rulesets', () => list(api, `/orgs/${org}/rulesets`, {}, { scope: 'org' }))) ?? []
      for (const s of orgSets) await get(api, `/orgs/${org}/rulesets/${s.id}`, { scope: 'org', ruleset: s.id })
    }, needRepos),
    call('GH-09', '기본 브랜치 보호 규칙 (없으면 404 기록)', async api => {
      for (const r of repoList()) await get(api, `/repos/${org}/${r.name}/branches/${encodeURIComponent(r.default_branch)}/protection`, { repo: r.name, branch: r.default_branch })
    }, needRepos),
    // 기준별 설정 판정(scripts/standards)이 읽는 호출. 조직 Actions 권한은 App 토큰(조직 Administration 읽기)으로 읽는다. 소유자 PAT(read:org)는 403 이다
    call('GHS-01', '조직 Actions 권한', async api => {
      await api.get({ ...base, url: url(`/orgs/${org}/actions/permissions`), auth: app(), params: {} })
    }),
    call('GHS-02', '조직 워크플로 기본 권한', async api => {
      await api.get({ ...base, url: url(`/orgs/${org}/actions/permissions/workflow`), auth: app(), params: {} })
    }),
    call('GHS-03', '기본 브랜치에 적용되는 규칙 (룰셋 포함)', async api => {
      for (const r of repoList()) await list(api, `/repos/${org}/${r.name}/rules/branches/${encodeURIComponent(r.default_branch)}`, {}, { repo: r.name, branch: r.default_branch })
    }, needRepos),
    call('GHS-04', '저장소 전체 협업자 (상속 관리자 포함)', async api => {
      for (const r of repoList()) await list(api, `/repos/${org}/${r.name}/collaborators`, { affiliation: 'all' }, { repo: r.name, affiliation: 'all' })
    }, needRepos),
    call('GHS-05', '저장소 코드 스캐닝 기본 설정', async api => {
      for (const r of repoList()) {
        await api.optional(`code_scanning_default_setup:${r.name}`, () =>
          get(api, `/repos/${org}/${r.name}/code-scanning/default-setup`, { repo: r.name }),
        )
      }
    }, needRepos),
    call('GH-10', '워크플로 목록·정의 메타데이터', async api => {
      for (const r of repoList()) {
        const workflows = await list(api, `/repos/${org}/${r.name}/actions/workflows`, {}, { repo: r.name }, b => b?.workflows ?? [])
        if (!workflows.length) continue
        const commit: any = await api.optional(`workflow_ref:${r.name}`, () => get(api, `/repos/${org}/${r.name}/commits/${encodeURIComponent(r.default_branch)}`, { repo: r.name, kind: 'workflow_ref' }, { transform: (b: any) => ({ sha: b?.sha }) }))
        if (!/^[a-f0-9]{40}$/i.test(commit?.sha ?? '')) { api.partial(`workflow_ref_unresolved:${r.name}`); continue }
        for (const w of workflows) {
          if (!/^\.github\/workflows\/[^/]+\.ya?ml$/.test(w.path ?? '')) { api.partial(`workflow_path_unsupported:${w.id}`); continue }
          const filePath = w.path.split('/').map(encodeURIComponent).join('/')
          const definition: any = await api.optional(`workflow_definition:${w.id}`, () => api.get({ ...base, url: url(`/repos/${org}/${r.name}/contents/${filePath}`, { ref: commit.sha }), auth: app(), params: { repo: r.name, workflow: w.id, path: w.path, ref: commit.sha }, transform: summarizeWorkflowContent }))
          if (definition && definition.workflow_definition?.status !== 'parsed') api.partial(`workflow_definition_unreadable:${w.id}`)
        }
      }
    }, needRepos),
    call('GH-34', 'Actions 변수 메타데이터 (값은 지문으로만)', async api => {
      await api.optional('org_variables', () => list(api, `/orgs/${org}/actions/variables`, {}, { scope: 'org', org, kind: 'variables' }, b => b?.variables ?? [], { transform: summarizeVariables, auth: owner() ?? app() }))
      for (const r of repoList()) {
        await api.optional(`repo_variables:${r.name}`, () => list(api, `/repos/${org}/${r.name}/actions/variables`, {}, { scope: 'repo', repo: r.name, kind: 'variables' }, b => b?.variables ?? [], { transform: summarizeVariables, auth: owner() ?? app() }))
        const envs = await api.optional(`variable_environments:${r.name}`, () => list(api, `/repos/${org}/${r.name}/environments`, {}, { repo: r.name }, b => b?.environments ?? [], { auth: owner() ?? app() })) ?? []
        for (const e of envs) await api.optional(`env_variables:${r.name}:${e.name}`, () => list(api, `/repos/${org}/${r.name}/environments/${encodeURIComponent(e.name)}/variables`, {}, { scope: 'environment', repo: r.name, environment: e.name, kind: 'variables' }, b => b?.variables ?? [], { transform: summarizeVariables, auth: owner() ?? app() }))
      }
    }, needRepos),
    call('GH-11', '커밋 (목록·상세, diff 제외)', async api => {
      const max = config.github.maxCommitDetails ?? 200
      for (const r of repoList()) {
        const commits = await api.optional(`commits:${r.name}`, () => list(api, `/repos/${org}/${r.name}/commits`, { since: config.since, until: api.period.until }, { repo: r.name, since: config.since, until: api.period.until })) ?? []
        if (commits.length > max) api.partial(`commit_details_capped:${r.name}:${max}/${commits.length}`)
        for (const c of commits.slice(0, max)) await get(api, `/repos/${org}/${r.name}/commits/${c.sha}`, { repo: r.name, sha: c.sha })
      }
    }, needRepos),
    call('GH-12', 'Pull Request (상세·리뷰·타임라인)', async api => {
      for (const r of repoList()) {
        const pulls = await list(api, `/repos/${org}/${r.name}/pulls`, { state: 'all' }, { repo: r.name })
        for (const p of pulls) {
          const ref = { repo: r.name, number: p.number }
          await get(api, `/repos/${org}/${r.name}/pulls/${p.number}`, ref)
          await list(api, `/repos/${org}/${r.name}/pulls/${p.number}/reviews`, {}, ref)
          // copilot_work_started 행위자 = 에이전트 요청자 (V-07 시험에서 확인)
          await list(api, `/repos/${org}/${r.name}/issues/${p.number}/timeline`, {}, { ...ref, kind: 'timeline' })
        }
      }
    }, needRepos),
    call('GH-13', 'PAT 승인·요청 (App 전용)', async api => {
      const grants = await list(api, `/orgs/${org}/personal-access-tokens`)
      for (const g of grants) await list(api, `/orgs/${org}/personal-access-tokens/${g.id}/repositories`, {}, { pat_id: g.id })
      // 대기 중 요청은 "Personal access token requests" 권한이 따로 필요하다. 승인·요청 이력은 GH-18 웹훅에도 있다
      await api.optional('pat_requests', () => list(api, `/orgs/${org}/personal-access-token-requests`, {}, { kind: 'requests' }))
    }, () => missingApp() ?? (!creds.get('GITHUB_APP_PRIVATE_KEY') && creds.get('GITHUB_COLLECTOR_OAUTH_TOKEN')?.startsWith('gho_') ? 'github_app_required' : null)),
    call('GH-14', 'App 설치', async api => {
      const installs = await list(api, `/orgs/${org}/installations`, {}, {}, b => b?.installations ?? [])
      for (const slug of new Set(installs.map((i: any) => i.app_slug).filter(Boolean))) await get(api, `/apps/${slug}`, { app_slug: slug })
    }),
    call('GH-15', '웹훅 (주소는 host·지문만)', async api => {
      const mask = { transform: (b: any) => (Array.isArray(b) ? b.map(maskHookUrl) : b) }
      await list(api, `/orgs/${org}/hooks`, {}, { scope: 'org' }, b => b, mask)
      for (const r of repoList()) await list(api, `/repos/${org}/${r.name}/hooks`, {}, { repo: r.name }, b => b, mask)
    }),
    // V2-P1 (판단표 3차 A01 ~ A05): 존재 확인(GH-90)에서 옮겨 와 객체로 수집한다
    call('GH-24', '배포 환경', async api => {
      for (const r of repoList()) {
        const envs = await list(api, `/repos/${org}/${r.name}/environments`, {}, { repo: r.name }, b => b?.environments ?? [])
        for (const e of envs) state.environments.push({ repo: r.name, name: e.name })
      }
    }, needRepos),
    call('GH-25', 'Actions, Dependabot 비밀값 (이름과 날짜만, 값은 API 가 주지 않는다)', async api => {
      const secrets = (b: any) => b?.secrets ?? []
      for (const kind of ['actions', 'dependabot'] as const) {
        // 조직 비밀값: 선택 저장소(visibility=selected)면 그 저장소 목록도 받는다
        const orgSecrets = (await api.optional(`org_${kind}_secrets`, () => list(api, `/orgs/${org}/${kind}/secrets`, {}, { scope: 'org', kind }, secrets))) ?? []
        for (const s of orgSecrets) {
          if (s.visibility === 'selected') await list(api, `/orgs/${org}/${kind}/secrets/${encodeURIComponent(s.name)}/repositories`, {}, { scope: 'org', kind, secret: s.name }, b => b?.repositories ?? [])
        }
        await api.optional(`repo_${kind}_secrets`, async () => {
          for (const r of repoList()) await list(api, `/repos/${org}/${r.name}/${kind}/secrets`, {}, { repo: r.name, kind }, secrets)
        })
      }
      await api.optional('environment_secrets', async () => {
        for (const e of state.environments) await list(api, `/repos/${org}/${e.repo}/environments/${encodeURIComponent(e.name)}/secrets`, {}, { repo: e.repo, environment: e.name, kind: 'actions' }, secrets)
      })
    }),
    call('GH-26', '배포 키 (공개키는 지문만)', async api => {
      const mask = { transform: (b: any) => (Array.isArray(b) ? b.map(({ key, ...k }: any) => ({ ...k, key_sha256: key ? sha256Hex(String(key)) : null })) : b) }
      for (const r of repoList()) await list(api, `/repos/${org}/${r.name}/keys`, {}, { repo: r.name }, b => b, mask)
    }, needRepos),
    call('GH-27', '조직 역할과 배정', async api => {
      const roles = await list(api, `/orgs/${org}/organization-roles`, {}, {}, b => b?.roles ?? [])
      for (const role of roles) {
        await list(api, `/orgs/${org}/organization-roles/${role.id}/teams`, {}, { role_id: role.id, kind: 'teams' })
        await list(api, `/orgs/${org}/organization-roles/${role.id}/users`, {}, { role_id: role.id, kind: 'users' })
      }
    }),
    call('GH-28', '외부 그룹 (Enterprise Managed Users 조직만)', async api => {
      const groups = (await api.optional('external_groups', () => list(api, `/orgs/${org}/external-groups`, {}, {}, b => b?.groups ?? []))) ?? []
      for (const g of groups) await get(api, `/orgs/${org}/external-group/${g.group_id}`, { group_id: g.group_id })
    }),
    // V2-P2 (판단표 3차 B01, B03, B05 ~ B09): 조건 없는 것. 존재 확인(GH-90)에 있던 초대, 러너, 러너 그룹도 옮겨 온다
    call('GH-29', '조직 초대 (대기 중)', async api => {
      await list(api, `/orgs/${org}/invitations`)
    }),
    call('GH-30', '배포 브랜치 정책, 배포 보호 규칙', async api => {
      for (const e of state.environments) {
        const path = `/repos/${org}/${e.repo}/environments/${encodeURIComponent(e.name)}`
        // 브랜치 정책은 환경이 사용자 지정 브랜치 정책일 때만 있다. 아니면 404 라 선택 호출로 둔다
        await api.optional(`branch_policies:${e.repo}:${e.name}`, () => list(api, `${path}/deployment-branch-policies`, {}, { repo: e.repo, environment: e.name, kind: 'branch_policies' }, b => b?.branch_policies ?? []))
        await api.optional(`protection_rules:${e.repo}:${e.name}`, () => get(api, `${path}/deployment_protection_rules`, { repo: e.repo, environment: e.name, kind: 'protection_rules' }))
      }
    }, () => missingApp() ?? (state.environments.length ? null : 'depends_on:GH-24 (배포 환경 없음)')),
    call('GH-31', 'IP 허용 목록, 조직 SAML IdP, 검증 도메인 (GraphQL)', async api => {
      // 도메인 확인 토큰(verificationToken)과 IdP 인증서(idpCertificate)는 받지 않는다
      // 2026-11-08: App 설치 토큰은 organization_administration:read 가 있어도 FORBIDDEN 이었다(2·3회차). 소유자 토큰(CRED-GH-02, read:org)이 있으면 그것을 쓴다
      await graphql(
        api,
        owner() ?? app(),
        'query($org: String!) { organization(login: $org) { ipAllowListEnabledSetting ipAllowListForInstalledAppsEnabledSetting ipAllowListEntries(first: 100) { totalCount nodes { id name allowListValue isActive createdAt updatedAt } } samlIdentityProvider { id ssoUrl issuer digestMethod signatureMethod } domains(first: 100) { totalCount nodes { id domain isVerified isApproved createdAt updatedAt } } } }',
        { org },
      )
    }),
    call('GH-32', '자체 호스팅 러너, 러너 그룹', async api => {
      const groups = await list(api, `/orgs/${org}/actions/runner-groups`, {}, { kind: 'groups' }, b => b?.runner_groups ?? [])
      for (const g of groups) {
        await list(api, `/orgs/${org}/actions/runner-groups/${g.id}/runners`, {}, { runner_group: g.id, kind: 'runners' }, b => b?.runners ?? [])
        if (g.visibility === 'selected') await list(api, `/orgs/${org}/actions/runner-groups/${g.id}/repositories`, {}, { runner_group: g.id, kind: 'repositories' }, b => b?.repositories ?? [])
      }
    }),
    call('GH-33', '패키지', async api => {
      // package_type 이 필수라 종류마다 부른다
      for (const t of ['container', 'npm', 'maven', 'rubygems', 'docker', 'nuget']) await api.optional(`packages:${t}`, () => list(api, `/orgs/${org}/packages`, { package_type: t }, { package_type: t }))
    }),
    call('GH-17', '조직 감사 로그', async api => {
      await auditLog(api, app(), `/orgs/${org}/audit-log`, 'github.org_audit', '')
    }),
    {
      // 2026-10-29: enterprise 감사 로그 API 는 classic PAT 나 OAuth App 토큰만 받는다(GitHub 문서). 조직 소유 App 은 enterprise 에 설치되지 않는다.
      // 그래서 enterprise 소유자 PAT(CRED-GH-02, read:audit_log)가 있으면 그것을 먼저 쓰고, 없을 때만 App 의 enterprise 설치를 본다.
      id: 'GH-19',
      provider: 'github',
      title: '엔터프라이즈 감사 로그 (조직 필터)',
      credential: creds.get('GITHUB_OWNER_TOKEN') ? 'CRED-GH-02' : 'CRED-GH-01-ENT',
      unavailable: () => (owner() ? null : missingCredential(creds, 'CRED-GH-01-ENT')),
      run: async api => {
        const ownerAuth = owner()
        if (ownerAuth) {
          await auditLog(api, ownerAuth, `/enterprises/${enterprise}/audit-log`, 'github.enterprise_audit', `org:${org} `)
          return
        }
        const entAuth = githubAppAuth({
          ref: 'CRED-GH-01-ENT',
          appId: creds.get('GITHUB_APP_ID')!,
          installationId: creds.get('GITHUB_APP_ENTERPRISE_INSTALLATION_ID')!,
          privateKeyPem: creds.get('GITHUB_APP_PRIVATE_KEY')!,
          transport,
        })
        await auditLog(api, entAuth, `/enterprises/${enterprise}/audit-log`, 'github.enterprise_audit', `org:${org} `)
      },
    },
    {
      id: 'GH-20',
      provider: 'github',
      title: '엔터프라이즈 SAML 외부 신원 (GraphQL)',
      credential: 'CRED-GH-02',
      unavailable: () => (owner() ? null : missingApp()),
      run: async api => {
        await graphql(
          api,
          owner() ?? app(),
          'query($slug: String!) { enterprise(slug: $slug) { ownerInfo { samlIdentityProvider { id ssoUrl issuer externalIdentities(first: 100) { totalCount nodes { guid samlIdentity { nameId username } user { login databaseId } } } } } } }',
          { slug: enterprise },
        )
      },
    },
    {
      id: 'GH-22',
      provider: 'github',
      title: 'SAML 자격증명 승인 (선택)',
      credential: 'CRED-GH-02',
      unavailable: () => (owner() ? null : 'credential_missing:CRED-GH-02 (GITHUB_OWNER_TOKEN) — 선택 호출'),
      run: async api => {
        // token_last_eight(토큰 끝 8자)는 버린다 — credential_id 로 충분하다
        await api.list({ ...base, url: url(`/orgs/${org}/credential-authorizations`, { per_page: 100 }), auth: owner(), paginate: { kind: 'link' }, items: b => b, rules: { dropKeys: ['token_last_eight'] } })
      },
    },
    // 존재 확인: 수집하지 않는 종류(Codespaces 비밀값, 사설 레지스트리, 저장소 초대, 릴리스 등). 시크릿은 이름과 날짜만 오고 값은 API 가 주지 않는다
    call('GH-90', '존재 확인 (수집하지 않는 종류)', async api => {
      const itemsOf = (key?: string) => (b: any) => (Array.isArray(b) ? b : key && Array.isArray(b?.[key]) ? b[key] : [])
      const probe = (catalogName: string, needs: string, paths: string[], key?: string): ProbeTarget => ({
        catalogName, needs,
        fetch: async a => {
          const all: unknown[] = []
          let seen = false
          for (const p of paths) {
            const got = await a.list({ ...base, url: url(p, { per_page: 100 }), auth: app(), paginate: { kind: 'link' }, items: itemsOf(key), params: { probe: catalogName, path: p }, maxPages: 3 })
            seen = true
            all.push(...got)
          }
          return seen ? all : null
        },
      })
      const perRepo = (suffix: string) => repoList().map(r => `/repos/${org}/${r.name}/${suffix}`)
      await runProbes(api, [
        probe('Codespaces Secret', 'App 권한 organization_codespaces_secrets: read', [`/orgs/${org}/codespaces/secrets`], 'secrets'),
        probe('Organization private registry', 'App 권한 organization_private_registries: read', [`/orgs/${org}/private-registries`], 'configurations'),
        probe('Organization Custom Property', 'App 권한 organization_custom_properties: read', [`/orgs/${org}/properties/schema`]),
        probe('Repository Invitation', 'App 권한 administration: read (저장소)', perRepo('invitations')),
        probe('Release', 'App 권한 contents: read (저장소)', perRepo('releases')),
      ])
    }, needRepos),
  ]

  async function auditLog(api: CallApi, auth: Auth, path: string, stream: string, phrasePrefix: string): Promise<void> {
    const start = streamStart(api, stream, config.since)
    // 감사 로그 phrase 는 날짜 단위다. 커서 날짜부터 다시 받으면 겹치는 행은 정규화에서 _document_id 로 걸러진다
    const phrase = `${phrasePrefix}created:>=${isoDate(start)}`
    const rows = await api.list({ ...base, url: url(path, { phrase, include: 'all', order: 'asc', per_page: 100 }), auth, paginate: { kind: 'link' }, items: b => b, params: { phrase } })
    const last = maxIso(rows.map((r: any) => r['@timestamp'] ?? r.created_at))
    api.setCursor(stream, { cursor: null, last_event_at: last ?? api.cursor(stream)?.last_event_at ?? null })
  }
}
