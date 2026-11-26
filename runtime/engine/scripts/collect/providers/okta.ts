/**
 * Okta 수집 (계획서 5.2절, OK-01 ~ OK-18. OK-14 는 SC-I 증거: 사용자 프로필 스키마, OK-15 ~ OK-18 은 v2 V2-P1).
 *
 * 자격증명: CRED-OK-01 API Service 앱 `aegi-collector` (private_key_jwt + DPoP, Read-only Administrator)
 * 또는 OIDC Native/Web 앱 OAuth refresh_token.
 * 토큰은 설정의 okta.scopes (또는 OAuth 승인 범위 OKTA_SCOPES)로 받는다. 그 목록에 없는 scope 가 필요한 호출은 skipped(scope_not_granted).
 * Okta 평가판은 약 10-17 만료 — 최종 수집(T-41)은 10-15 까지.
 */
import { buildUrl, CallError, type CallApi, type CallDef } from '../lib/runner'
import { oktaDpopAuth, oktaSswsAuth, oauthRefreshTokenAuth, normalizeOktaOrgUrl } from '../lib/auth'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import { sha256Hex } from '../lib/sanitize'
import { maxIso, streamStart, type ProviderContext } from './common'
import { runProbes, type ProbeTarget } from './probes'

/** OAuth 승인 범위가 있으면 설정값보다 우선한다. 갱신 토큰 회전 뒤에도 같은 값을 쓴다. */
/** OK-18 외부 IdP 한 행에서 클라이언트 비밀 원문을 빼고 sha256 지문만 남긴다. client_id 는 남긴다(상대 SaaS 앱과 잇는 값) */
export function maskIdpClientSecret(idp: any): any {
  const client = idp?.protocol?.credentials?.client
  if (!client || typeof client !== 'object' || !('client_secret' in client)) return idp
  const { client_secret, ...rest } = client
  return { ...idp, protocol: { ...idp.protocol, credentials: { ...idp.protocol.credentials, client: { ...rest, client_secret_sha256: client_secret ? sha256Hex(String(client_secret)) : undefined } } } }
}

export function oktaGrantedScopes(ctx: Pick<ProviderContext, 'config' | 'creds'>): string[] {
  const raw = ctx.creds.get('OKTA_SCOPES')
  return raw ? raw.split(/[\s,]+/).filter(Boolean) : ctx.config.okta.scopes
}

/** Okta 수동 호출과 수집 API 목록 호출이 함께 쓰는 인증 선택 순서. */
export function oktaAuth(ctx: ProviderContext): Auth {
  const { creds, transport } = ctx
  const orgUrl = normalizeOktaOrgUrl(creds.get('OKTA_ORG_URL') ?? '')
  if (creds.get('OKTA_API_TOKEN')) {
    return oktaSswsAuth('CRED-OK-01', creds.get('OKTA_API_TOKEN')!)
  }
  if (creds.get('OKTA_COLLECTOR_PRIVATE_KEY')) {
    return oktaDpopAuth({
      ref: 'CRED-OK-01',
      orgUrl,
      clientId: creds.get('OKTA_COLLECTOR_CLIENT_ID')!,
      keyId: creds.get('OKTA_COLLECTOR_KEY_ID')!,
      privateKeyPem: creds.get('OKTA_COLLECTOR_PRIVATE_KEY')!,
      scopes: oktaGrantedScopes(ctx),
      transport,
    })
  }
  return oauthRefreshTokenAuth({
    ref: 'CRED-OK-01',
    tokenUrl: `${orgUrl}/oauth2/v1/token`,
    clientId: creds.get('OKTA_COLLECTOR_CLIENT_ID')!,
    clientSecret: creds.get('OKTA_COLLECTOR_CLIENT_SECRET'),
    refreshToken: creds.get('OKTA_COLLECTOR_REFRESH_TOKEN')!,
    transport,
    onRotate: ({ refreshToken, scope }) => {
      creds.set('OKTA_COLLECTOR_REFRESH_TOKEN', refreshToken)
      if (scope) creds.set('OKTA_SCOPES', scope)
    },
  })
}

export function oktaCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds, transport } = ctx
  const orgUrl = () => normalizeOktaOrgUrl(creds.get('OKTA_ORG_URL') ?? '')
  const grantedScopes = () => oktaGrantedScopes(ctx)
  let auth: Auth | null = null
  const okta = (): Auth => {
    if (auth) return auth
    auth = oktaAuth(ctx)
    return auth
  }

  const state = {
    users: [] as Array<{ id: string }>,
    groups: [] as Array<{ id: string }>,
    apps: [] as any[],
    serviceClientIds: [] as string[],
  }

  const url = (path: string, query?: Record<string, string | number | undefined>) => buildUrl(orgUrl() + path, query)
  const list = (api: CallApi, path: string, query: Record<string, string | number | undefined> = {}, params: Record<string, unknown> = {}, items: (b: any) => any[] = b => (Array.isArray(b) ? b : []), extra: object = {}) =>
    api.list({ ...extra, url: url(path, query), auth: okta(), paginate: { kind: 'link' }, items, params })
  const get = (api: CallApi, path: string, params: Record<string, unknown> = {}, extra: object = {}) => api.get({ ...extra, url: url(path), auth: okta(), params })

  const call = (id: string, title: string, scopes: string[], run: (api: CallApi) => Promise<void>, depends?: () => string | null): CallDef => ({
    id,
    provider: 'okta',
    title,
    credential: 'CRED-OK-01',
    unavailable: () => {
      const missing = missingCredential(creds, 'CRED-OK-01')
      if (missing) return missing
      if (!creds.get('OKTA_API_TOKEN')) {
        const activeScopes = oktaGrantedScopes(ctx)
        const notGranted = scopes.filter(s => !activeScopes.includes(s))
        if (notGranted.length) return `scope_not_granted:${notGranted.join(',')}`
      }
      return depends?.() ?? null
    },
    run,
  })

  return [
    call('OK-01', 'org', ['okta.orgs.read'], async api => {
      await get(api, '/api/v1/org')
    }),
    call('OK-02', '사용자', ['okta.users.read'], async api => {
      state.users = await list(api, '/api/v1/users', { limit: 200 })
    }),
    call('OK-03', '그룹·그룹 멤버', ['okta.groups.read'], async api => {
      state.groups = await list(api, '/api/v1/groups', { limit: 200 })
      for (const g of state.groups) await list(api, `/api/v1/groups/${g.id}/users`, { limit: 200 }, { group: g.id })
    }),
    call('OK-04', '사용자 인증 수단 (factor)', ['okta.users.read'], async api => {
      for (const u of state.users) await list(api, `/api/v1/users/${u.id}/factors`, {}, { user: u.id })
    }, () => (state.users.length ? null : 'depends_on:OK-02')),
    call('OK-05', 'IAM 역할·리소스 세트', ['okta.roles.read'], async api => {
      // 조회마다 따로 시도한다 — Read-only Administrator 가 /iam/* 일부를 못 볼 수 있다 (09-27 첫 수집에서 /iam/roles 403)
      const roles = await api.optional('iam_roles', () => get(api, '/api/v1/iam/roles'))
      // 사용자 정의 역할마다 권한 목록. 판정이 권한 이름으로 역할 세기와 닿는 객체 종류를 정한다(accessModel.ts oktaCustomRole). 없으면 role_rank_unknown
      for (const r of roles?.roles ?? []) await api.optional('iam_role_permissions', () => get(api, `/api/v1/iam/roles/${r.id}/permissions`, { role: r.id }))
      const sets = await api.optional('iam_resource_sets', () => get(api, '/api/v1/iam/resource-sets'))
      for (const s of sets?.['resource-sets'] ?? []) {
        await api.optional('iam_resource_set_resources', () => get(api, `/api/v1/iam/resource-sets/${s.id}/resources`, { resource_set: s.id }))
        await api.optional('iam_resource_set_bindings', () => get(api, `/api/v1/iam/resource-sets/${s.id}/bindings`, { resource_set: s.id }))
      }
      if (!roles && !sets) throw new CallError('forbidden', 403, 'iam_all_forbidden', 'IAM 역할·리소스 세트를 하나도 읽지 못했다 (Read-only Administrator 권한 범위 확인)')
    }),
    call('OK-07', '앱·앱 사용자·앱 그룹 배정', ['okta.apps.read'], async api => {
      state.apps = await list(api, '/api/v1/apps', { limit: 200 })
      for (const a of state.apps) {
        await list(api, `/api/v1/apps/${a.id}/users`, { limit: 200 }, { app: a.id })
        await list(api, `/api/v1/apps/${a.id}/groups`, { limit: 200 }, { app: a.id })
      }
      state.serviceClientIds = state.apps
        .filter(a => a?.settings?.oauthClient?.application_type === 'service' || a?.credentials?.oauthClient?.token_endpoint_auth_method === 'private_key_jwt')
        .map(a => a?.credentials?.oauthClient?.client_id)
        .filter(Boolean)
    }),
    // Group Push 매핑 (V-15, T-55). targetGroupId 는 Okta 쪽 APP_GROUP 이라 대상 SaaS 그룹 id 가 아니다 —
    // 그 id 는 System Log(OK-12) 의 group_push 이벤트 AppGroup.alternateId 에서 얻는다(정규화).
    call('OK-13', 'Group Push 매핑', ['okta.apps.read', 'okta.groups.read'], async api => {
      const pushApps = state.apps.filter(a => (a?.features ?? []).includes('GROUP_PUSH'))
      for (const a of pushApps) {
        await api.optional(`group_push_mappings:${a.id}`, () => list(api, `/api/v1/apps/${a.id}/group-push/mappings`, { limit: 1000 }, { app: a.id }))
      }
    }, () => (state.apps.length ? null : 'depends_on:OK-07')),
    call('OK-08', 'OAuth 클라이언트·앱 공개 키', ['okta.clients.read', 'okta.apps.read'], async api => {
      await list(api, '/oauth2/v1/clients', { limit: 200 }, {}, b => (Array.isArray(b) ? b : []), { rules: { dropKeys: ['client_secret'] } })
      for (const a of state.apps.filter(x => x?.credentials?.oauthClient?.client_id)) await get(api, `/api/v1/apps/${a.id}/credentials/jwks`, { app: a.id })
      // 앱 인증기 설정은 oauthClientId 가 필수다. 없이 부르면 400 E0000028 (2026-11-19 실측)
      for (const id of new Set<string>(state.apps.map(x => x?.credentials?.oauthClient?.client_id).filter((v: unknown): v is string => typeof v === 'string'))) {
        await api.optional(`app_authenticator_configuration:${id}`, () => api.get({ url: url('/.well-known/app-authenticator-configuration', { oauthClientId: id }), auth: okta(), params: { kind: 'app_authenticator_configuration', oauthClientId: id } }))
      }
    }),
    call('OK-06', '관리자 역할 배정 (사용자·그룹·서비스 앱)과 대상 범위', ['okta.roles.read'], async api => {
      // 역할 받은 사용자 목록이 막히면 OK-02 의 사용자 전원을 하나씩 본다
      const assignees = await api.optional('iam_assignees', () => get(api, '/api/v1/iam/assignees/users'))
      const userIds = new Set<string>(assignees ? (assignees.value ?? []).map((u: any) => u.id) : state.users.map(u => u.id))
      let readable = 0
      const roleList = async (label: string, path: string, params: Record<string, unknown>) => {
        const roles = await api.optional(label, () => list(api, path, {}, params))
        if (roles) readable++
        return roles ?? []
      }
      for (const id of userIds) {
        for (const r of await roleList('user_roles', `/api/v1/users/${id}/roles`, { user: id })) {
          if (r.type !== 'CUSTOM') await api.optional('user_role_targets', () => list(api, `/api/v1/users/${id}/roles/${r.id}/targets/groups`, {}, { user: id, role: r.id }))
        }
      }
      for (const g of state.groups) {
        for (const r of await roleList('group_roles', `/api/v1/groups/${g.id}/roles`, { group: g.id })) {
          if (r.type !== 'CUSTOM') await api.optional('group_role_targets', () => list(api, `/api/v1/groups/${g.id}/roles/${r.id}/targets/groups`, {}, { group: g.id, role: r.id }))
        }
      }
      for (const cid of state.serviceClientIds) await roleList('client_roles', `/oauth2/v1/clients/${cid}/roles`, { client: cid })
      if (!readable) throw new CallError('forbidden', 403, 'role_assignments_all_forbidden', '역할 배정을 하나도 읽지 못했다 (Read-only Administrator 권한 범위 확인)')
      if (!state.groups.length) api.partial('groups_unknown:OK-03')
      if (!state.apps.length) api.partial('apps_unknown:OK-07')
    }),
    call('OK-09', '사용자 위임 앱 토큰', ['okta.users.read'], async api => {
      for (const u of state.users) {
        const clients = await list(api, `/api/v1/users/${u.id}/clients`, {}, { user: u.id })
        for (const c of clients) await list(api, `/api/v1/users/${u.id}/clients/${c.client_id}/tokens`, {}, { user: u.id, client: c.client_id })
      }
    }, () => (state.users.length ? null : 'depends_on:OK-02')),
    call('OK-10', '정책·정책 규칙', ['okta.policies.read'], async api => {
      for (const type of config.okta.policyTypes) {
        const policies = await api.optional(`policies:${type}`, () => list(api, '/api/v1/policies', { type }, { type })) ?? []
        for (const p of policies) await list(api, `/api/v1/policies/${p.id}/rules`, {}, { type, policy: p.id })
      }
    }),
    call('OK-11', '그룹 규칙', ['okta.groups.read'], async api => {
      await list(api, '/api/v1/groups/rules', { limit: 200 })
    }),
    // 사용자 프로필 스키마와 속성별 권한(SELF READ_WRITE 등). 그룹 규칙이 조건으로 쓰는 속성을 본인이 고칠 수 있는지 (SC-I)
    call('OK-14', '사용자 프로필 스키마', ['okta.schemas.read'], async api => {
      await get(api, '/api/v1/meta/schemas/user/default', { kind: 'user_schema' })
    }),
    // V2-P1 (판단표 3차 A06 ~ A09): 존재 확인(OK-90)에서 옮겨 와 객체로 수집한다
    call('OK-15', 'API 서비스 통합 인스턴스, 비밀값', ['okta.oauthIntegrations.read'], async api => {
      const mask = { transform: (b: any) => (Array.isArray(b) ? b.map(({ clientSecret, secret, ...k }: any) => ({ ...k, secret_sha256: (clientSecret || secret) ? sha256Hex(String(clientSecret || secret)) : undefined })) : b) }
      const instances = await list(api, '/integrations/api/v1/api-services', { limit: 200 })
      for (const inst of instances) {
        await api.optional(`api_service_secrets:${inst.id}`, () => list(api, `/integrations/api/v1/api-services/${inst.id}/secrets`, {}, { instance_id: inst.id }, b => (Array.isArray(b) ? b : []), mask))
      }
    }),
    call('OK-16', 'API 토큰 (토큰 값은 API 가 주지 않는다)', ['okta.apiTokens.read'], async api => {
      const mask = { transform: (b: any) => (Array.isArray(b) ? b.map(({ token, ...k }: any) => ({ ...k, token_sha256: token ? sha256Hex(String(token)) : undefined })) : b) }
      await list(api, '/api/v1/api-tokens', { limit: 200 }, {}, b => (Array.isArray(b) ? b : []), mask)
    }),
    call('OK-17', '이벤트 훅, 인라인 훅, 로그 스트림', [], async api => {
      const activeScopes = grantedScopes()
      if (activeScopes.includes('okta.eventHooks.read')) {
        await api.optional('event_hooks', () => list(api, '/api/v1/eventHooks', { limit: 200 }, { kind: 'event_hooks' }))
      }
      if (activeScopes.includes('okta.inlineHooks.read')) {
        await api.optional('inline_hooks', () => list(api, '/api/v1/inlineHooks', { limit: 200 }, { kind: 'inline_hooks' }))
      }
      if (activeScopes.includes('okta.logStreams.read')) {
        await api.optional('log_streams', () => list(api, '/api/v1/logStreams', { limit: 200 }, { kind: 'log_streams' }))
      }
    }, () => {
      const missing = missingCredential(creds, 'CRED-OK-01')
      if (missing) return missing
      const activeScopes = grantedScopes()
      const anyGranted = ['okta.eventHooks.read', 'okta.inlineHooks.read', 'okta.logStreams.read'].some(s => activeScopes.includes(s))
      return anyGranted ? null : 'scope_not_granted:okta.eventHooks.read,okta.inlineHooks.read,okta.logStreams.read'
    }),
    call('OK-18', '외부 IdP', ['okta.idps.read'], async api => {
      // OIDC IdP 응답은 protocol.credentials.client.client_secret 을 그대로 준다. 원문 대신 지문만 남긴다
      const mask = { transform: (b: any) => (Array.isArray(b) ? b.map(maskIdpClientSecret) : b) }
      await list(api, '/api/v1/idps', { limit: 200 }, {}, b => (Array.isArray(b) ? b : []), mask)
    }),
    // V2-P2 (판단표 3차 B10 ~ B13, B15, B17): 조건 없는 것. 존재 확인(OK-90)에 있던 종류도 옮겨 온다
    call('OK-19', '프로필 매핑 (식)', ['okta.profileMappings.read'], async api => {
      const mappings = await list(api, '/api/v1/mappings', { limit: 200 }, { kind: 'list' })
      for (const m of mappings) if (m?.id) await api.optional(`mapping:${m.id}`, () => get(api, `/api/v1/mappings/${m.id}`, { mapping: m.id }))
    }),
    call('OK-20', 'IdP 서명 키 (인증서는 지문만)', ['okta.idps.read'], async api => {
      const mask = { transform: (b: any) => (Array.isArray(b) ? b.map(({ x5c, n, ...k }: any) => ({ ...k, x5c_sha256: Array.isArray(x5c) && x5c[0] ? sha256Hex(String(x5c[0])) : undefined })) : b) }
      await list(api, '/api/v1/idps/credentials/keys', { limit: 200 }, {}, b => (Array.isArray(b) ? b : []), mask)
    }),
    ...([
      ['OK-21', '보안 이벤트 수신, SSF 송신 스트림, 메일 서버', [
        ['okta.securityEventsProviders.read', 'security_events_providers', (api: CallApi) => list(api, '/api/v1/security-events-providers', {}, { kind: 'security_events_providers' })],
        ['ssf.read', 'ssf_streams', (api: CallApi) => get(api, '/api/v1/ssf/stream', { kind: 'ssf_streams' })],
        ['okta.emailServers.read', 'email_servers', (api: CallApi) => get(api, '/api/v1/email-servers', { kind: 'email_servers' }, { transform: (b: any) => (Array.isArray(b?.['email-servers']) ? { ...b, 'email-servers': b['email-servers'].map(({ password, ...s }: any) => s) } : b) })],
      ]],
      ['OK-22', '인증기, 신뢰 출처, 기기 보증 정책, 네트워크 영역', [
        ['okta.authenticators.read', 'authenticators', async (api: CallApi) => {
          const authenticators = await list(api, '/api/v1/authenticators', {}, { kind: 'authenticators' })
          // 허용 기기 모델(AAGUID) 목록은 WebAuthn 인증기에만 있다. 다른 인증기는 400 E0000020 (2026-11-19 실측)
          for (const a of authenticators.filter((x: any) => x?.key === 'webauthn' && typeof x?.id === 'string')) await list(api, `/api/v1/authenticators/${a.id}/aaguids`, {}, { kind: 'authenticator_aaguids', authenticatorId: a.id })
        }],
        ['okta.trustedOrigins.read', 'trusted_origins', (api: CallApi) => list(api, '/api/v1/trustedOrigins', { limit: 200 }, { kind: 'trusted_origins' })],
        ['okta.deviceAssurance.read', 'device_assurances', (api: CallApi) => list(api, '/api/v1/device-assurances', {}, { kind: 'device_assurances' })],
        ['okta.networkZones.read', 'zones', (api: CallApi) => list(api, '/api/v1/zones', { limit: 200 }, { kind: 'zones' })],
      ]],
    ] as Array<[string, string, Array<[string, string, (api: CallApi) => Promise<unknown>]>]>).map(([id, title, parts]): CallDef => call(id, title, [], async api => {
      // 종류마다 범위가 달라 허용된 범위만 부른다 (OK-17 과 같은 방식). API 토큰(SSWS) 모드에서는 OAuth scope 목록을 따지지 않는다
      const activeScopes = grantedScopes()
      const isApiToken = Boolean(creds.get('OKTA_API_TOKEN'))
      for (const [scope, kind, run] of parts) {
        if (isApiToken && kind === 'ssf_streams') continue
        if (isApiToken || activeScopes.includes(scope)) await api.optional(kind, () => run(api))
      }
    }, () => {
      if (creds.get('OKTA_API_TOKEN')) return null
      const activeScopes = grantedScopes()
      return parts.some(([scope]) => activeScopes.includes(scope)) ? null : `scope_not_granted:${parts.map(([scope]) => scope).join(',')}`
    })),
    call('OK-23', '에이전트 풀 (AD, LDAP 연동 에이전트)', ['okta.agentPools.read'], async api => {
      await list(api, '/api/v1/agentPools', {})
    }),
    // 존재 확인: 수집하지 않는 종류마다 그 scope 하나만 담은 토큰으로 목록을 한 번 부른다.
    // 수집 앱에 허용되지 않은 scope 는 토큰 발급이 실패하므로 본 수집 토큰(config.okta.scopes)과 섞지 않는다.
    // OAuth refresh_token 모드에서는 이미 발급된 토큰의 허용 범위 안에서만 조회한다.
    call('OK-90', '존재 확인 (수집하지 않는 종류)', [], async api => {
      const isPrivateKey = Boolean(creds.get('OKTA_COLLECTOR_PRIVATE_KEY'))
      const scoped = new Map<string, Auth>()
      const authFor = (scope: string) => {
        if (!isPrivateKey) return okta()
        if (!scoped.has(scope)) scoped.set(scope, oktaDpopAuth({ ref: 'CRED-OK-01', orgUrl: orgUrl(), clientId: creds.get('OKTA_COLLECTOR_CLIENT_ID')!, keyId: creds.get('OKTA_COLLECTOR_KEY_ID')!, privateKeyPem: creds.get('OKTA_COLLECTOR_PRIVATE_KEY')!, scopes: [scope], transport }))
        return scoped.get(scope)!
      }
      const probe = (catalogName: string, path: string, scope: string): ProbeTarget => ({
        catalogName, needs: scope,
        fetch: a => a.list({ url: url(path, { limit: 200 }), auth: authFor(scope), paginate: { kind: 'link' }, items: b => (Array.isArray(b) ? b : b ? [b] : []), params: { probe: catalogName }, maxPages: 5 }),
      })
      const targets = [
        probe('AuthorizationServer', '/api/v1/authorizationServers', 'okta.authorizationServers.read'),
        probe('Device', '/api/v1/devices', 'okta.devices.read'),
        probe('push-providers', '/api/v1/push-providers', 'okta.pushProviders.read'),
        probe('behaviors', '/api/v1/behaviors', 'okta.behaviors.read'),
        probe('Realm', '/api/v1/realms', 'okta.realms.read'),
        probe('DomainResponse', '/api/v1/domains', 'okta.domains.read'),
        probe('EmailDomainResponse', '/api/v1/email-domains', 'okta.emailDomains.read'),
        probe('BotProtectionConfiguration', '/api/v1/captchas', 'okta.captchas.read'),
        probe('ThreatInsightConfiguration', '/api/v1/threats/configuration', 'okta.threatInsights.read'),
      ]
      const activeScopes = grantedScopes()
      await runProbes(api, isPrivateKey ? targets : targets.filter(t => activeScopes.includes(t.needs)))
    }),
    call('OK-12', 'System Log', ['okta.logs.read'], async api => {
      const stream = 'okta.system_log'
      const since = streamStart(api, stream, config.since)
      // until 을 주면 next 링크가 끝난다 (주지 않으면 폴링용 링크가 계속 나온다)
      const rows = await list(api, '/api/v1/logs', { since, until: api.period.until, limit: 1000, sortOrder: 'ASCENDING' }, { since, until: api.period.until })
      const last = maxIso(rows.map((r: any) => r.published))
      api.setCursor(stream, { cursor: null, last_event_at: last ?? api.cursor(stream)?.last_event_at ?? null })
    }),
  ]
}
