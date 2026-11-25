/**
 * 공통 테스트 픽스처.
 */
import type { Envelope, Provider, RunRecord } from '../lib/store'
import { sha256Hex } from '../lib/sanitize'
import type { NormalizeConfig } from './context'

export const HOOK_FP = sha256Hex('https://hooks.slack.com/services/T/B/x')
export const T0 = '2026-09-27T03:40:00Z'

export function env(provider: Provider, call_id: string, payload: unknown, request_params: Record<string, unknown> = {}, endpoint = `https://api.test/${call_id}`): Envelope {
  return { provider, call_id, page: 1, method: 'GET', endpoint, request_params, collected_at: T0, http_status: 200, response_sha256: '', payload_sha256: '', collector_version: 'test', credential_ref: 'CRED-TEST', sanitization: { secrets: 0, content_fields: 0, dropped_fields: 0, correlation_ids: 0 }, payload }
}

export function run(runId: string, pages: Envelope[]): { record: RunRecord; pages: Envelope[] } {
  const ids = [...new Set(pages.map(p => `${p.provider}|${p.call_id}`))]
  return {
    record: { run_id: runId, collector_version: 'test', started_at: T0, args: {}, period: { since: T0, until: T0 }, calls: ids.map(i => { const [provider, call_id] = i.split('|'); return { run_id: runId, call_id, provider: provider as Provider, title: '', started_at: T0, pages: 1, record_count: 1, completeness: 'full' as const, reasons: [], notes: [] } }) },
    pages: pages.map(p => ({ ...p })),
  }
}

export const people = { admin: 'admin@aegi.test', A: 'a@aegi.test', B: 'b@aegi.test', C: 'c@aegi.test', D: 'd@aegi.test', E: 'e@aegi.test', F: 'f@aegi.test', target: 'target@aegi.test' }
export const CONFIG: NormalizeConfig = {
  people,
  accounts: { A: { github: 'gh-a', slack: 'UA' }, C: { github: 'gh-c', slack: 'UC' } },
  sensitivePaths: ['scenario-lab/auth/**'],
  measurementPrincipals: { slack: ['UCOLLECTOR'] },
}

export const oktaUsers = Object.entries(people).map(([role, login]) => ({ id: `00u${role}`, status: 'ACTIVE', profile: { login, email: login } }))
export const slackUsers = ['A', 'B', 'C', 'D', 'E', 'F'].map(r => ({ id: `U${r}`, email: (people as any)[r], name: r.toLowerCase() }))

export function fixturePages(): Envelope[] {
  return [
    // GitHub
    env('github', 'GH-01', { id: 1, login: 'org' }),
    env('github', 'GH-02', [{ id: 11, login: 'gh-a', type: 'User' }, { id: 13, login: 'gh-c', type: 'User' }], { role: 'all' }),
    env('github', 'GH-05', [{ id: 100, name: 'internal-ops-tools', full_name: 'org/internal-ops-tools', default_branch: 'main' }]),
    env('github', 'GH-06', [{ id: 11, login: 'gh-a', role_name: 'write' }], { repo: 'internal-ops-tools' }),
    env('github', 'GH-11', { sha: 'aaa111', author: { login: 'gh-a' }, committer: { login: 'gh-a' }, commit: { author: { date: '2026-09-27T03:45:14Z' }, message: { $fp: 'sha256:x', len: 3 } }, files: [{ filename: 'scenario-lab/devbot/config.json' }] }, { repo: 'internal-ops-tools', sha: 'aaa111' }),
    env('github', 'GH-11', { sha: 'bbb222', author: { login: 'gh-a' }, committer: { login: 'gh-a' }, commit: { author: { date: '2026-09-27T03:46:52Z' }, message: { $fp: 'sha256:y', len: 3 } }, files: [{ filename: 'scenario-lab/auth/token.js' }] }, { repo: 'internal-ops-tools', sha: 'bbb222' }),
    env('github', 'GH-13', [{ id: 7, owner: { id: 11, login: 'gh-a' }, token_id: 99, token_name: 'tok', permissions: { repository: { contents: 'write', metadata: 'read' } }, repository_selection: 'subset' }]),
    env('github', 'GH-13', [{ full_name: 'org/internal-ops-tools' }], { pat_id: 7 }),
    env('github', 'GH-20', { data: { enterprise: { ownerInfo: { samlIdentityProvider: { externalIdentities: { nodes: [{ guid: 'g-a', samlIdentity: { nameId: people.A }, user: { login: 'gh-a' } }, { guid: 'g-c', samlIdentity: { nameId: people.C }, user: { login: 'gh-c' } }] } } } } } }),
    // Okta
    env('okta', 'OK-01', { id: '00o1', subdomain: 'trial' }),
    env('okta', 'OK-02', oktaUsers),
    env('okta', 'OK-03', [{ id: '00gHELP', type: 'OKTA_GROUP', profile: { name: 'HelpDesk-Admins' } }]),
    env('okta', 'OK-03', [{ id: '00uB', profile: { login: people.B } }], { group: '00gHELP' }),
    env('okta', 'OK-05', { roles: [{ id: 'cr1', label: 'AEGI HelpDesk Operator' }] }),
    env('okta', 'OK-06', [{ id: 'ra1', type: 'CUSTOM', role: 'cr1', 'resource-set': 'rs1', status: 'ACTIVE' }], { group: '00gHELP' }, 'https://trial.okta.com/api/v1/groups/00gHELP/roles'),
    env('okta', 'OK-06', [{ id: 'ra2', type: 'CUSTOM', role: 'cr1', 'resource-set': 'rs1', status: 'ACTIVE' }], { client: '0oaBOT' }, 'https://trial.okta.com/oauth2/v1/clients/0oaBOT/roles'),
    env('okta', 'OK-07', [{ id: '0oaGOOGLE', name: 'google', label: 'Google Workspace', signOnMode: 'SAML_2_0' }, { id: '0oaBOT', name: 'oidc_client', label: 'Helpdesk Action', credentials: { oauthClient: { client_id: '0oaBOT' } } }]),
    env('okta', 'OK-07', ['A', 'B', 'C', 'D', 'E', 'F'].map(r => ({ id: `00u${r}`, scope: 'USER', status: 'ACTIVE', credentials: { userName: (people as any)[r] } })), { app: '0oaGOOGLE' }, 'https://trial.okta.com/api/v1/apps/0oaGOOGLE/users'),
    env('okta', 'OK-08', [{ client_id: '0oaBOT', client_name: 'Helpdesk Action', application_type: 'service', client_secret: 'must-drop' }]),
    env('okta', 'OK-12', [
      { uuid: 'e1', eventType: 'user.mfa.factor.reset_all', published: '2026-09-27T03:42:57Z', actor: { id: '0oaBOT', displayName: 'Helpdesk Action' }, target: [{ id: '00utarget', type: 'User' }] },
      { uuid: 'e0', eventType: 'user.mfa.factor.reset_all', published: '2026-09-25T10:40:21Z', actor: { id: '0oaBOT', displayName: 'Helpdesk Action' }, target: [{ id: '00utarget', type: 'User' }] },
    ]),
    // Slack
    env('slack', 'SL-00', { ok: true, team: { id: 'T1', name: 'Sandbox', enterprise_id: 'E1', enterprise_name: 'Ent' } }),
    env('slack', 'SL-01', { ok: true, users: slackUsers }),
    env('slack', 'SL-02', { ok: true, members: [{ id: 'UBOTMFA', is_bot: true, name: 'mfa-reset', profile: { bot_id: 'BMFA', api_app_id: 'APPMFA' } }, { id: 'UBOTINTAKE', is_bot: true, name: 'intake', profile: { bot_id: 'BINTAKE', api_app_id: 'APPINTAKE' } }, { id: 'UCOLLECTOR', is_bot: true, name: 'collector', profile: { bot_id: 'BCOLLECTOR', api_app_id: 'APPCOLLECT' } }] }),
    env('slack', 'SL-03', { ok: true, channels: [{ id: 'CHELP', name: 'helpdesk', is_private: true }, { id: 'CDEV', name: 'dev-automation' }, { id: 'CINTAKE', name: 'sales-customer-intake', is_private: true, internal_team_ids: ['T1'] }] }),
    env('slack', 'SL-04', { ok: true, members: ['UA', 'UB', 'UBOTMFA', 'UCOLLECTOR'] }, { channel: 'CHELP' }),
    env('slack', 'SL-04', { ok: true, members: ['UA', 'UD'] }, { channel: 'CDEV' }),
    env('slack', 'SL-04', { ok: true, members: ['UE', 'UF', 'UCOLLECTOR'] }, { channel: 'CINTAKE' }),
    env('slack', 'SL-05', { ok: true, messages: [{ ts: '1790481951.547979', subtype: 'bot_message', bot_id: 'BINTAKE', app_id: 'APPINTAKE', text: { $fp: 'sha256:z', len: 40 } }] }, { channel: 'CINTAKE' }),
    env('slack', 'SL-08', { ok: true, approved_apps: ['APPDEV', 'APPMFA', 'APPINTAKE'].map(id => ({ app: { id, name: id }, scopes: [{ name: 'commands' }] })) }, {}, 'https://slack.com/api/admin.apps.approved.list'),
    env('slack', 'SL-10', { ok: true, manifest: { display_information: { name: 'DevBot' }, features: { slash_commands: [{ command: '/devbot', url: 'https://bots.test/devbot' }] }, oauth_config: { scopes: { bot: ['commands'] } } } }, { app_id: 'APPDEV' }),
    env('slack', 'SL-10', { ok: true, manifest: { display_information: { name: 'MFA Reset' }, features: { slash_commands: [{ command: '/mfa-reset', url: 'https://bots.test/mfa-reset' }] } } }, { app_id: 'APPMFA' }),
    // GWS
    env('gws', 'GW-01', { id: 'C01', customerDomain: 'aegi.test' }),
    env('gws', 'GW-03', { users: ['A', 'B', 'C', 'D', 'E', 'F'].map(r => ({ id: `g${r}`, primaryEmail: (people as any)[r] })) }),
    env('gws', 'GW-07', { files: [{ id: 'SHEET1', name: 'Responses', mimeType: 'application/vnd.google-apps.spreadsheet', owners: [{ emailAddress: people.E }] }] }, { user: people.E }),
    env('gws', 'GW-07', { permissions: [{ id: 'p1', type: 'user', role: 'owner', emailAddress: people.E }] }, { user: people.E, file: 'SHEET1' }),
    env('gws', 'GW-08', { formId: 'FORM1', info: { title: 'Intake' }, linkedSheetId: 'SHEET1', items: [{ title: '회사명' }] }),
    env('gws', 'GW-09', { scriptId: 'SCRIPT1', title: 'Sync', parentId: 'SHEET1' }, { script: 'SCRIPT1' }, 'https://script.googleapis.com/v1/projects/SCRIPT1'),
    env('gws', 'GW-09', { files: [{ name: 'Code', type: 'SERVER_JS', source: { $fp: 'sha256:c', len: 10, urls: [{ host: 'hooks.slack.com', sha256: HOOK_FP }] } }] }, { script: 'SCRIPT1' }, 'https://script.googleapis.com/v1/projects/SCRIPT1/content'),
    env('gws', 'GW-09', { processes: [{ functionName: 'onFormSubmit', processStatus: 'COMPLETED', startTime: '2026-09-27T04:05:50Z' }] }, { script: 'SCRIPT1' }, 'https://script.googleapis.com/v1/processes?userProcessFilter.scriptId=SCRIPT1'),
    // Worker D1
    env('worker', 'SL-12', { results: [
      { id: 4, command: '/mfa-reset', user_id: 'UB', channel_id: 'CHELP', result_status: 'success', result_data: { target_id: '00utarget', okta_client_id: '0oaBOT' }, api_app_id: 'APPMFA', created_at: '2026-09-25 10:40:19' },
      { id: 5, command: '/mfa-reset', user_id: 'UA', channel_id: 'CHELP', result_status: 'success', result_data: { target_id: '00utarget', okta_client_id: '0oaBOT' }, api_app_id: 'APPMFA', created_at: '2026-09-27 03:42:55' },
      { id: 6, command: '/devbot', user_id: 'UA', channel_id: 'CDEV', result_status: 'success', result_data: { action: 'sync-config', commit_sha: 'aaa111' }, api_app_id: 'APPDEV', created_at: '2026-09-27 03:45:13' },
      { id: 7, command: '/devbot', user_id: 'UD', channel_id: 'CDEV', result_status: 'success', result_data: { action: 'update-script', commit_sha: 'bbb222' }, api_app_id: 'APPDEV', created_at: '2026-09-27 03:46:52' },
    ] }),
    env('worker', 'D-21', { results: [{ id: 1, app_name: 'Customer Intake Sync', channel_id: 'CINTAKE', webhook_url_fingerprint: HOOK_FP, raw_response: { app_id: 'APPINTAKE', incoming_webhook: { channel: 'sales-customer-intake', channel_id: 'CINTAKE' } }, created_at: '2026-09-25 06:46:56' }] }),
  ]
}
