/**
 * Slack 수집 (계획서 5.3절, A경로 — V-01 결과). SL-12 봇 요청 로그는 worker.ts.
 *
 * 토큰: ORG = CRED-SL-01 (SLACK-API-TESTER 조직 설치 사용자 토큰), BOT = CRED-SL-02 (같은 앱 봇 토큰),
 *       CFG = CRED-SL-03 (앱 설정 토큰, 12시간).
 * 조직 설치 앱의 봇 토큰은 워크스페이스 메서드에 team_id 가 필수다 (없으면 missing_argument, 09-27 첫 수집).
 * Slack 은 오류도 HTTP 200 + ok:false 로 준다. 그 error 코드로 401/403/partial 을 가른다.
 * 메시지 본문은 지문·길이·링크 참조만 남는다 (sanitize.ts 의 text 규칙).
 */
import { buildUrl, type CallApi, type CallDef, type Classifier } from '../lib/runner'
import { bearerAuth } from '../lib/auth'
import type { Auth } from '../lib/http'
import { missingCredential } from '../config'
import { sha256Hex } from '../lib/sanitize'
import { maxIso, streamStart, toEpochSeconds, type ProviderContext } from './common'
import { runProbes, type ProbeTarget } from './probes'
import { slackAuthTestMismatch, slackTeamInfoMismatch } from '../tenant'
import { ensureSlackConfigToken, type SlackConfigTokenResult } from '../lib/slackConfigToken'

const API = 'https://slack.com/api'
const AUDIT = 'https://api.slack.com/audit/v1'

const AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive'])
const FORBIDDEN_ERRORS = new Set(['missing_scope', 'not_allowed_token_type', 'no_permission', 'feature_not_enabled', 'not_authorized', 'access_denied', 'team_access_not_granted', 'ekm_access_denied', 'restricted_action'])
const UNSEEN_ERRORS = new Set(['channel_not_found', 'not_in_channel'])
/** SL-09 team.integrationLogs 를 넘길 최대 쪽 수 (쪽마다 100건) */
const INTEGRATION_LOG_MAX_PAGES = 50

export const slackClassifier: Classifier = res => {
  const body = res.body as { ok?: boolean; error?: string } | null
  const error = body && body.ok === false ? body.error ?? 'unknown' : null
  if (res.status === 401 || (error && AUTH_ERRORS.has(error))) return { kind: 'auth', code: `slack_${error ?? 'http_401'}` }
  if (res.status === 403 || (error && FORBIDDEN_ERRORS.has(error))) return { kind: 'forbidden', code: `slack_${error ?? 'http_403'}` }
  if (error && UNSEEN_ERRORS.has(error)) return { kind: 'partial', code: 'bot_not_member' }
  if (res.status === 404) return { kind: 'not_found', code: 'http_404' }
  if (res.status < 200 || res.status >= 300) return { kind: 'api', code: `http_${res.status}` }
  if (error) return { kind: 'api', code: `slack_${error}` }
  return null
}

type TokenKind = 'ORG' | 'BOT' | 'CFG'
const TOKEN: Record<TokenKind, { cred: 'CRED-SL-01' | 'CRED-SL-02' | 'CRED-SL-03'; env: string }> = {
  ORG: { cred: 'CRED-SL-01', env: 'SLACK_COLLECTOR_USER_TOKEN' },
  BOT: { cred: 'CRED-SL-02', env: 'SLACK_COLLECTOR_BOT_TOKEN' },
  CFG: { cred: 'CRED-SL-03', env: 'SLACK_CONFIG_TOKEN' },
}

/** app_ids 한 번에 넣는 앱 수 (2026-11-19 실측: 20개까지 확인) */
const APP_IDS_PER_REQUEST = 20

export function slackCalls(ctx: ProviderContext): CallDef[] {
  const { config, creds } = ctx
  const s = config.slack
  let ensuredSlackConfigToken: SlackConfigTokenResult | null = null
  const auth = (kind: TokenKind): Auth => bearerAuth(TOKEN[kind].cred, creds.get(TOKEN[kind].env) ?? '')
  const missing = (...kinds: TokenKind[]) => () => {
    for (const k of kinds) {
      if (k === 'CFG') {
        if (!creds.get('SLACK_CONFIG_TOKEN') && !creds.get('SLACK_CONFIG_REFRESH_TOKEN')) {
          return missingCredential(creds, 'CRED-SL-03')
        }
      } else {
        const m = missingCredential(creds, TOKEN[k].cred)
        if (m) return m
      }
    }
    return null
  }

  const state = {
    channels: new Map<string, { id: string; is_private?: boolean; is_member?: boolean; name?: string }>(),
    botIds: new Set<string>(),
    /** 봇 사용자, 봇 정보, 승인 앱 목록에서 찾은 앱 id. 매니페스트(SL-10)를 이 앱마다 받는다 */
    appIds: new Set<string>(),
    usergroups: [] as Array<{ id: string }>,
    /** 이번 감사 로그(SL-11)에 나온 사용자 그룹 id — IdP 그룹은 usergroups.list 에 안 나온다 */
    auditUsergroups: new Set<string>(),
    /** admin.usergroups API 는 조직 IdP 그룹만 받는다. 일반 워크스페이스 그룹 id 와 섞지 않는다.
     * https://docs.slack.dev/reference/methods/admin.usergroups.listChannels/ */
    idpUsergroups: new Set<string>(s.idpUsergroupIds ?? []),
  }

  const method = (m: string, query: Record<string, string | number | boolean | undefined> = {}) => buildUrl(`${API}/${m}`, query)
  const list = (api: CallApi, kind: TokenKind, m: string, query: Record<string, string | number | boolean | undefined>, items: (b: any) => any[], params: Record<string, unknown> = {}, extra: object = {}) =>
    api.list({ ...extra, url: method(m, query), auth: auth(kind), classify: slackClassifier, paginate: { kind: 'slack' }, items, params: { method: m, ...params } })
  const get = (api: CallApi, kind: TokenKind, m: string, query: Record<string, string | number | boolean | undefined> = {}, params: Record<string, unknown> = {}) =>
    api.get({ url: method(m, query), auth: auth(kind), classify: slackClassifier, params: { method: m, ...params } })

  const call = (id: string, title: string, tokens: TokenKind[], run: (api: CallApi) => Promise<void>, depends?: () => string | null): CallDef => ({
    id,
    provider: 'slack',
    title,
    credential: TOKEN[tokens[0]].cred,
    unavailable: () => missing(...tokens)() ?? depends?.() ?? null,
    run,
  })

  const oldest = () => String(toEpochSeconds(config.since))

  return [
    {
      id: 'SL-00',
      provider: 'slack',
      title: '엔터프라이즈·워크스페이스',
      credential: 'CRED-SL-01',
      unavailable: () => (missing('ORG')() && missing('BOT')() ? missing('ORG')() : null),
      // 테넌트 확인을 먼저 한다(tenant.ts). 토큰이 설정과 다른 조직이면 저장하지 않고 멈추고, 남은 Slack 호출은 건너뛴다
      run: async api => {
        if (!missing('BOT')()) await api.get({ url: method('team.info', { team: s.teamId }), auth: auth('BOT'), classify: slackClassifier, params: { method: 'team.info' }, verify: b => slackTeamInfoMismatch(b, s) })
        else api.partial('credential_missing:CRED-SL-02')
        if (!missing('ORG')()) {
          await api.get({ url: method('auth.test'), auth: auth('ORG'), classify: slackClassifier, params: { method: 'auth.test' }, verify: b => slackAuthTestMismatch(b, s) })
          await list(api, 'ORG', 'admin.teams.list', { limit: 100 }, b => b?.teams ?? [])
        } else api.partial('credential_missing:CRED-SL-01')
      },
    },
    call('SL-01', '사용자 (관리자 조회)', ['ORG'], async api => {
      await list(api, 'ORG', 'admin.users.list', { team_id: s.teamId, limit: 100 }, b => b?.users ?? [])
    }),
    call('SL-02', '사용자·봇 (워크스페이스)', ['BOT'], async api => {
      const members = await list(api, 'BOT', 'users.list', { team_id: s.teamId, limit: 200 }, b => b?.members ?? [])
      for (const m of members) {
        if (m?.profile?.bot_id) state.botIds.add(m.profile.bot_id)
        if (m?.profile?.api_app_id) state.appIds.add(m.profile.api_app_id)
      }
    }),
    call('SL-03', '채널 (봇 목록 + 관리자 검색)', ['BOT'], async api => {
      const convs = await list(api, 'BOT', 'conversations.list', { team_id: s.teamId, types: 'public_channel,private_channel', exclude_archived: false, limit: 200 }, b => b?.channels ?? [])
      for (const c of convs) state.channels.set(c.id, c)
      if (!missing('ORG')()) {
        const found = await list(api, 'ORG', 'admin.conversations.search', { team_ids: s.teamId, limit: 20 }, b => b?.conversations ?? [])
        for (const c of found) if (!state.channels.has(c.id)) state.channels.set(c.id, { id: c.id, is_private: c.is_private, is_member: false, name: c.name })
      } else {
        api.partial('credential_missing:CRED-SL-01 (봇이 없는 비공개 채널은 못 찾음)')
      }
      // 설정의 채널 id 는 발견을 돕는 힌트일 뿐이다. 없어도 위 두 목록으로 찾는다
      for (const id of s.extraChannels ?? []) if (!state.channels.has(id)) state.channels.set(id, { id, is_member: false })
    }),
    call('SL-04', '채널 멤버', ['BOT'], async api => {
      for (const c of state.channels.values()) {
        await list(api, 'BOT', 'conversations.members', { channel: c.id, limit: 200 }, b => b?.members ?? [], { channel: c.id })
      }
    }, () => (state.channels.size ? null : 'depends_on:SL-03')),
    // 수집 봇이 들어 있는 채널 전부. 봇이 없는 채널의 메시지는 API 로 읽을 수 없어 partial 로 남긴다
    call('SL-05', '채널 메시지 (봇이 든 채널 전부, 본문은 지문만)', ['BOT'], async api => {
      const readable = new Set([...state.channels.values()].filter(c => c.is_member !== false).map(c => c.id))
      for (const id of s.extraChannels ?? []) readable.add(id)
      const unreadable = [...state.channels.keys()].filter(id => !readable.has(id)).sort()
      if (unreadable.length) api.partial(`bot_not_member:${unreadable.join(',')}`)
      for (const channel of [...readable].sort()) {
        const messages = await list(api, 'BOT', 'conversations.history', { channel, oldest: oldest(), limit: 200 }, b => b?.messages ?? [], { channel })
        for (const m of messages) {
          if (m.bot_id) state.botIds.add(m.bot_id)
          if (m.reply_count > 0 && m.thread_ts) {
            await list(api, 'BOT', 'conversations.replies', { channel, ts: m.thread_ts, limit: 200 }, b => b?.messages ?? [], { channel, thread_ts: m.thread_ts })
          }
        }
      }
    }),
    call('SL-06', '사용자 그룹', ['BOT'], async api => {
      const res = await get(api, 'BOT', 'usergroups.list', { team_id: s.teamId, include_users: true, include_disabled: true })
      state.usergroups = res?.usergroups ?? []
    }),
    call('SL-07', '봇 정보', ['BOT'], async api => {
      // 다른 워크스페이스·삭제된 봇은 bot_not_found 다. 그 봇만 partial 로 남긴다
      for (const bot of state.botIds) {
        const res: any = await api.optional(`bots_info:${bot}`, () => get(api, 'BOT', 'bots.info', { bot, team_id: s.teamId }, { bot }))
        if (res?.bot?.app_id) state.appIds.add(res.bot.app_id)
      }
    }, () => (state.botIds.size ? null : 'depends_on:SL-02/SL-05 (봇 id 없음)')),
    call('SL-08', '앱 승인·제한 목록', ['ORG'], async api => {
      // 조직 설치 앱은 enterprise 단위, 워크스페이스 설치 앱은 team 단위로 승인 목록에 오른다
      for (const scope of [{ team_id: s.teamId }, { enterprise_id: s.enterpriseId }]) {
        const approved = await list(api, 'ORG', 'admin.apps.approved.list', { ...scope, limit: 100 }, b => b?.approved_apps ?? [], scope)
        for (const a of approved) if (a?.app?.id) state.appIds.add(a.app.id)
        await list(api, 'ORG', 'admin.apps.restricted.list', { ...scope, limit: 100 }, b => b?.restricted_apps ?? [], scope)
      }
    }),
    // 연동 기록 (레거시 team.integrationLogs). Incoming Webhook 이 붙은 채널(channel)을 주는 유일한 Web API 다.
    // 쪽 번호로 넘긴다(paging.pages). admin scope 가 없으면 missing_scope 라 partial 로 남긴다
    call('SL-09', '연동 기록 (Incoming Webhook 채널)', ['ORG'], async api => {
      await api.optional('integration_logs', async () => {
        let page = 1
        let pages = 1
        do {
          const body: any = await get(api, 'ORG', 'team.integrationLogs', { team_id: s.teamId, count: 100, page }, { page })
          pages = Number(body?.paging?.pages ?? 1)
          page++
        } while (page <= pages && page <= INTEGRATION_LOG_MAX_PAGES)
        // 상한에서 멈췄으면 남은 쪽을 못 받은 것이다. full 로 두지 않는다
        if (page <= pages) api.partial(`integration_logs:max_pages:${INTEGRATION_LOG_MAX_PAGES}`)
      })
    }, () => (s.integrationLogs ? null : 'config_missing:slack.integrationLogs (ORG 토큰 admin scope 필요)')),
    // 찾은 앱 전부. 설정 토큰 주인이 만든 앱만 매니페스트를 내준다 — 남의 앱은 그 앱만 partial 로 남긴다
    call('SL-10', '앱 매니페스트 (슬래시 명령 주소·scope)', ['CFG'], async api => {
      if (!ensuredSlackConfigToken) {
        ensuredSlackConfigToken = await ensureSlackConfigToken(creds, ctx.transport)
        if (ensuredSlackConfigToken.status === 'rotate_failed' || ensuredSlackConfigToken.status === 'persist_failed') {
          api.partial(`config_token_${ensuredSlackConfigToken.status}:${ensuredSlackConfigToken.error ?? 'unknown'}`)
        }
      }
      for (const appId of [...new Set([...state.appIds, ...(s.appIds ?? [])])].sort()) {
        await api.optional(`manifest:${appId}`, () => api.get({ url: method('apps.manifest.export', { app_id: appId }), auth: auth('CFG'), classify: slackClassifier, params: { method: 'apps.manifest.export', app_id: appId }, transform: body => {
          if (!body?.manifest?.features?.slash_commands) return body
          return { ...body, manifest: { ...body.manifest, features: { ...body.manifest.features, slash_commands: body.manifest.features.slash_commands.map((c: any) => ({ ...c, request_url_sha256: typeof c.url === 'string' ? sha256Hex(c.url) : undefined })) } } }
        } }))
      }
    }, () => (state.appIds.size || s.appIds?.length ? null : 'depends_on:SL-02/SL-07/SL-08 (앱 id 없음)')),
    call('SL-11', '감사 로그 (Audit Logs API)', ['ORG'], async api => {
      const stream = 'slack.audit'
      await api.get({ url: `${AUDIT}/actions`, auth: auth('ORG'), classify: slackClassifier, params: { endpoint: 'actions' } })
      const start = streamStart(api, stream, config.since)
      const from = String(toEpochSeconds(start))
      const entries = await api.list({
        url: buildUrl(`${AUDIT}/logs`, { oldest: from, limit: 200 }),
        auth: auth('ORG'),
        classify: slackClassifier,
        paginate: { kind: 'slack' },
        items: b => b?.entries ?? [],
        params: { endpoint: 'logs', oldest: from },
      })
      const last = maxIso(entries.map((e: any) => e.date_create))
      api.setCursor(stream, { cursor: null, last_event_at: last ?? api.cursor(stream)?.last_event_at ?? null })
      for (const e of entries) {
        if (e?.entity?.type !== 'usergroup' || !e.entity.usergroup?.id) continue
        state.auditUsergroups.add(e.entity.usergroup.id)
        if (e.details?.idp_group_member_count !== undefined) state.idpUsergroups.add(e.entity.usergroup.id)
      }
    }),
    call('SL-13', '조직 IdP 그룹 기본 채널 (선택)', ['ORG'], async api => {
      for (const id of [...state.idpUsergroups].sort()) {
        await api.optional(`idp_group_channels:${id}`, () => get(api, 'ORG', 'admin.usergroups.listChannels', { usergroup_id: id, team_id: s.teamId }, { usergroup: id }))
      }
    }, () => (state.idpUsergroups.size ? null : 'config_missing:slack.idpUsergroupIds (또는 SL-11 IdP 그룹 증거 필요)')),
    // 사용자 그룹 멤버 (V-15, T-55). Okta Group Push 로 만든 IdP 그룹은 usergroups.list 에 안 나오지만
    // id 를 알면 usergroups.users.list 로 멤버를 읽을 수 있다(09-27 확인). id 는 SL-06 · SL-11 · 설정에서 모은다.
    call('SL-15', '사용자 그룹 멤버 (IdP 그룹 포함)', ['BOT'], async api => {
      const ids = [...new Set([...state.usergroups.map(g => g.id), ...state.auditUsergroups, ...state.idpUsergroups, ...(s.usergroupIds ?? [])])].sort()
      for (const id of ids) {
        await api.optional(`usergroup_users:${id}`, () => get(api, 'BOT', 'usergroups.users.list', { usergroup: id, team_id: s.teamId, include_disabled: true }, { usergroup: id }))
      }
    }, () => (state.usergroups.length || state.auditUsergroups.size || state.idpUsergroups.size || s.usergroupIds?.length ? null : 'depends_on:SL-06/SL-11 (사용자 그룹 id 없음)')),
    // 관리 역할 배정 (V2-P3, 판단표 3차 C01). 존재 확인(SL-90)에서 옮겨 와 사용자 → 대상(조직, 워크스페이스, 채널) has_role_on 으로 편다.
    // 역할 이름을 주는 API 는 없어 role_id 를 이름 역할의 키로 쓴다. 조직 토큰에 admin.roles:read 가 있어야 한다
    call('SL-16', '관리 역할 배정', ['ORG'], async api => {
      await list(api, 'ORG', 'admin.roles.listAssignments', { limit: 100 }, b => b?.role_assignments ?? [])
    }),
    // V2-P2 (판단표 3차 B19, B20): 워크플로(협업자, 단계, 함수 포함)와 정보 차단. 존재 확인(SL-90)에서 옮겨 온다
    call('SL-17', '워크플로 (협업자, 단계, 함수)', ['ORG'], async api => {
      await list(api, 'ORG', 'admin.workflows.search', { limit: 50 }, b => b?.workflows ?? [])
    }),
    call('SL-18', '정보 차단 (Information Barrier)', ['ORG'], async api => {
      await list(api, 'ORG', 'admin.barriers.list', { limit: 100 }, b => b?.barriers ?? [])
    }),
    // 앱 id 를 쿼리 인자(app_ids)로 받는 관리 API. 수집 API 목록은 경로 밖 인자를 채우지 못해 인자 없이 불렀다 (2026-11-19 실측 invalid_arguments: missing required field: app_ids)
    ...([
      ['SL-19', '앱 설정 (앱 id 로 조회)', 'admin.apps.config.lookup', (b: any) => b?.configs ?? [], {}],
      ['SL-20', '앱이 등록한 함수 (앱 id 로 조회)', 'admin.functions.list', (b: any) => b?.functions ?? [], { team_id: s.teamId, limit: 100 }],
    ] as Array<[string, string, string, (b: any) => any[], Record<string, string | number>]>).map(([id, title, m, items, query]) => call(id, title, ['ORG'], async api => {
      const ids = [...state.appIds].sort()
      for (let i = 0; i < ids.length; i += APP_IDS_PER_REQUEST) {
        const app_ids = ids.slice(i, i + APP_IDS_PER_REQUEST).join(',')
        await api.optional(`${m}:${i}`, () => list(api, 'ORG', m, { ...query, app_ids }, items, { app_ids }))
      }
    }, () => (state.appIds.size ? null : 'depends_on:SL-02/SL-07/SL-08 (앱 id 없음)'))),
    // 존재 확인: 수집하지 않는 종류 (Slack Connect 상대 조직)
    call('SL-90', '존재 확인 (수집하지 않는 종류)', ['BOT'], async api => {
      const probe = (catalogName: string, needs: string, m: string, key: string, query: Record<string, string | number | boolean | undefined> = {}): ProbeTarget => ({
        catalogName, needs,
        fetch: a => a.list({ url: method(m, { limit: 100, ...query }), auth: auth('BOT'), classify: slackClassifier, paginate: { kind: 'slack' }, items: b => b?.[key] ?? [], params: { method: m, probe: catalogName }, maxPages: 3 }),
      })
      await runProbes(api, [
        // limit 은 25 미만이어야 한다(100 이면 invalid_arguments). API 목록 경로(api-list/params.ts)와 같은 값
        probe('external-team', 'conversations.connect:manage, team:read', 'team.externalTeams.list', 'organizations', { limit: 20 }),
      ])
    }),
  ]
}
