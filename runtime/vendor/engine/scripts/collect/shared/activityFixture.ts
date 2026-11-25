/**
 * 사건 기록 시험의 합성 입력. 실명, 실메일, 실 id 는 없다(테스트 도메인 aegi.test).
 * Okta 감사 관측이 사전으로 옮긴 뒤에도 같은지 보는 기준 파일(__fixtures__/okta-audit-observations.json)은
 * 사전으로 옮기기 전 main 의 observations.ts 에 이 입력을 넣어 만들었다.
 */
import { DatasetV2, oktaKey } from './dataset'
import { NormalizeContext } from './context'
import { RawSet } from './raw'
import { CONFIG, env, run, T0 } from './testFixture'
import type { Envelope } from '../lib/store'

const obs = { api: 'test', params: {}, record: 'measured' as const, collected_at: T0 }

/** 앞의 9개는 엔진이 감사 관측을 만들던 종류, 뒤의 넷은 아니다(토큰 사건은 따로 관측을 만든다) */
export const OKTA_EVENT_TYPES = [
  'user.account.update_profile', 'group.user_membership.add', 'group.user_membership.remove', 'application.user_membership.add', 'application.user_membership.remove',
  'user.mfa.factor.reset_all', 'user.mfa.factor.deactivate', 'user.account.reset_password', 'user.lifecycle.reset_password',
  'user.session.start', 'app.oauth2.token.grant.refresh_token', 'policy.evaluate_sign_on', 'brand.new.thing',
]

export function oktaEvents(): any[] {
  const admin = { id: '00uadmin', type: 'User', alternateId: 'admin@aegi.test', displayName: 'Admin' }
  const user = { id: '00uA', type: 'User', alternateId: 'a@aegi.test', displayName: 'A' }
  const group = { id: '00gHELP', type: 'UserGroup', alternateId: 'unknown', displayName: 'Help' }
  const app = { id: '0oaAPP', type: 'AppInstance', alternateId: 'App', displayName: 'App' }
  const bot = { id: '0oaBOT', type: 'PublicClientApp', alternateId: 'bot', displayName: 'Bot' }
  const base = (i: number, eventType: string, actor: any, target: any[], extra: Record<string, unknown> = {}) => ({
    uuid: `ev-${String(i).padStart(2, '0')}`, eventType, published: `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`, actor, target,
    outcome: { result: 'SUCCESS' }, transaction: { id: `tx-${i}`, type: 'WEB' },
    authenticationContext: { externalSessionId: `sess-${i}`, rootSessionId: `root-${i}`, credentialType: 'PASSWORD', authenticationStep: 0 },
    client: { ipAddress: '192.0.2.10' }, ...extra,
  })
  return [
    base(1, 'user.account.update_profile', admin, [user], { debugContext: { debugData: { changedAttributes: 'department,title' } } }),
    base(2, 'group.user_membership.add', bot, [user, group]),
    base(3, 'group.user_membership.remove', admin, [user, group]),
    base(4, 'application.user_membership.add', admin, [user, app]),
    base(5, 'application.user_membership.remove', admin, [user, app]),
    base(6, 'user.mfa.factor.reset_all', bot, [user]),
    base(7, 'user.mfa.factor.deactivate', admin, [user, { id: 'mfa1', type: 'Factor Type', alternateId: 'unknown', displayName: 'TOTP' }]),
    base(8, 'user.account.reset_password', admin, [user], { outcome: { result: 'FAILURE', reason: 'INVALID_CREDENTIALS' } }),
    base(9, 'user.lifecycle.reset_password', admin, [user]),
    base(10, 'user.session.start', user, [], { outcome: { result: 'FAILURE', reason: 'VERIFICATION_ERROR' } }),
    base(11, 'app.oauth2.token.grant.refresh_token', bot, [{ id: 'rt1', type: 'refresh_token', alternateId: 'unknown', displayName: 'Refresh' }, user], { debugContext: { debugData: { grantedScopes: 'okta.users.read' } } }),
    base(12, 'policy.evaluate_sign_on', user, [{ id: 'pol1', type: 'PolicyEntity', alternateId: 'unknown', displayName: 'Default' }], { outcome: { result: 'CHALLENGE' } }),
    base(13, 'brand.new.thing', admin, [user]),
  ]
}

export function gwsItems(): any[] {
  return [{
    kind: 'admin#reports#activity', etag: 'e1', id: { time: '2026-10-01T00:01:00.000Z', uniqueQualifier: '111', applicationName: 'token', customerId: 'C01' },
    actor: { email: 'a@aegi.test', profileId: '1001', callerType: 'USER' },
    events: [
      { type: 'auth', name: 'authorize', parameters: [{ name: 'client_id', value: 'cli-1' }, { name: 'app_name', value: 'Tool' }, { name: 'scope', multiValue: ['https://www.googleapis.com/auth/drive'] }] },
      { type: 'auth', name: 'authorize', parameters: [{ name: 'client_id', value: 'cli-2' }, { name: 'app_name', value: 'Other' }] },
    ],
  }]
}

export function slackEntries(): any[] {
  return [{ id: 'sl-1', date_create: 1759276800, action: 'user_channel_join', actor: { type: 'user', user: { id: 'UA', email: 'a@aegi.test' } }, entity: { type: 'channel', channel: { id: 'CHELP', name: 'help' } }, context: { session_id: 77, location: { type: 'workspace', id: 'T1' } } }]
}

export function githubEvents(): any[] {
  return [{ _document_id: 'gh-1', action: 'org.oauth_app_access_approved', actor: 'gh-a', actor_id: 11, user: 'gh-c', org: 'aegi', '@timestamp': 1759276800000 }]
}

export function fixtureDataset(): DatasetV2 {
  const ds = new DatasetV2()
  ds.addObject({ key: oktaKey.org('o1'), provider: 'okta', type: 'org', id: 'o1', properties: {}, display: 'org', obs })
  for (const id of ['00uadmin', '00uA']) ds.addObject({ key: oktaKey.user(id), provider: 'okta', type: 'User', id, tenant: oktaKey.org('o1'), properties: {}, display: id, obs })
  ds.addObject({ key: oktaKey.group('00gHELP'), provider: 'okta', type: 'Group', id: '00gHELP', tenant: oktaKey.org('o1'), properties: {}, display: 'Help', obs })
  ds.addObject({ key: oktaKey.app('0oaAPP'), provider: 'okta', type: 'Application', id: '0oaAPP', tenant: oktaKey.org('o1'), properties: {}, display: 'App', obs })
  ds.addObject({ key: oktaKey.client('0oaBOT'), provider: 'okta', type: 'OAuth2Client', id: '0oaBOT', tenant: oktaKey.org('o1'), properties: {}, display: 'Bot', obs, catalog: { id: 'TEST-CLIENT', interfaces: ['Integration'] } })
  ds.addObject({ key: oktaKey.refreshToken('rt1'), provider: 'okta', type: 'RefreshToken', id: 'rt1', tenant: oktaKey.org('o1'), properties: {}, display: 'rt1', obs, catalog: { id: 'TEST-TOKEN', interfaces: ['Credential'] } })
  return ds
}

/** withLogs 가 false 면 로그 호출(OK-12, GW-10, SL-11, GH-17, GH-19)을 뺀 같은 원본 */
export function fixtureRaw(withLogs = true): RawSet {
  const pages: Envelope[] = [env('okta', 'OK-02', [{ id: '00uA', status: 'ACTIVE', profile: { login: 'a@aegi.test' } }])]
  if (withLogs) {
    pages.push(env('okta', 'OK-12', oktaEvents()))
    pages.push(env('gws', 'GW-10', { items: gwsItems() }))
    pages.push(env('slack', 'SL-11', { entries: slackEntries() }))
    pages.push(env('github', 'GH-17', githubEvents()))
    pages.push(env('github', 'GH-19', githubEvents()))
  }
  return new RawSet([run('20261001T000000Z-0001', pages)])
}

export const fixtureContext = () => new NormalizeContext(CONFIG)
