/**
 * 1Password 수집 (OP-01 ~ OP-03): 계정, 사용자, 그룹, 그룹 멤버십, 금고, 금고 권한, 항목 메타, 감사 이벤트.
 *
 * 1Password 의 공개 REST API 에는 그룹·그룹 멤버·금고 권한을 읽는 경로가 없다. 그래서 OP-01·OP-02 는 공식 CLI(op)와
 * 공식 JS SDK(@1password/sdk)의 읽기 명령으로 받는다. 같은 구성은 Subimage 의 1Password 수집기(Cartography onepassword 모듈 입력)가 쓴다.
 * CLI·SDK 결과는 api.record 로 HTTP 응답과 같은 원본 봉투와 정리 규칙을 거친다.
 *
 * 자격증명
 * - CRED-OP-01: 서비스 계정 토큰(OP_SERVICE_ACCOUNT_TOKEN 으로 CLI·SDK 에 넘긴다). 금고마다 Read Items 만 준 것을 전제로 한다.
 *   금고는 이 토큰이 받은 금고만 보인다. 사용자·그룹·멤버십은 계정 전체가 보인다(Subimage 수집기 문서).
 * - CRED-OP-02: Events Reporting 토큰. Events API v3 beta 의 GET /api/v3/auditevents 로 감사 이벤트를 받는다.
 *   v2(auditevents·itemusages·signinattempts)는 읽기도 POST 라 쓰지 않는다(수집기는 GET 만 보낸다).
 *
 * 쓰지 않는 명령: op item get, op read, op run, op inject, SDK items.get·secrets.resolve 처럼 비밀값을 꺼내는 것.
 * op item list 는 메타만 준다. 혹시 값 칸이 오면 ONEPASSWORD_DROP_KEYS 로 저장 전에 버린다.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { type CallApi, type CallDef, CallError, TenantMismatchError, buildUrl } from '../lib/runner'
import { bearerAuth } from '../lib/auth'
import { missingCredential } from '../config'
import { streamStart, maxIso, type ProviderContext } from './common'

export const ONEPASSWORD_EVENTS_HOST = 'https://events.1password.com'
/** 저장 전에 버리는 키: 비밀값 칸 */
export const ONEPASSWORD_DROP_KEYS = ['value', 'password', 'secret', 'totp', 'otp', 'notesPlain', 'fields', 'sections', 'files', 'token']
/** 그룹·금고 fan-out 상한. 넘으면 앞에서 자르고 partial(fanout_limit) */
export const ONEPASSWORD_FANOUT_LIMIT = 500
/** 감사 이벤트 페이지 상한. 넘으면 partial(max_pages) */
export const ONEPASSWORD_MAX_PAGES = 50

/** CLI·SDK 를 부르는 쪽. 시험에서는 가짜로 바꾼다 */
export interface OnePasswordDeps {
  /** op <args> --format json 을 돌려 JSON 을 돌려준다. 실패하면 OnePasswordCliError */
  op(args: string[], token: string): Promise<unknown>
  /** SDK vaults.get(id, { accessors: true }) */
  vaultAccess(vaultId: string, token: string): Promise<unknown>
}

export class OnePasswordCliError extends Error {
  constructor(public readonly kind: 'auth' | 'denied' | 'not_found' | 'other', message: string) {
    super(message)
  }
}

const execFileP = promisify(execFile)

function classifyCli(stderr: string): OnePasswordCliError['kind'] {
  const s = stderr.toLowerCase()
  if (/unauthori[sz]ed|invalid token|authentication|not signed in|401/.test(s)) return 'auth'
  if (/forbidden|not supported|isn't supported|permission|403/.test(s)) return 'denied'
  if (/not found|isn't a (user|group)|doesn't exist/.test(s)) return 'not_found'
  return 'other'
}

export const defaultOnePasswordDeps: OnePasswordDeps = {
  async op(args, token) {
    try {
      const { stdout } = await execFileP('op', [...args, '--format', 'json'], {
        env: { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: token },
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      })
      return stdout.trim() ? JSON.parse(stdout) : null
    } catch (err: any) {
      const stderr = String(err?.stderr ?? err?.message ?? '')
      throw new OnePasswordCliError(classifyCli(stderr), `op ${args.join(' ')}: ${stderr.split('\n')[0].slice(0, 200)}`)
    }
  },
  async vaultAccess(vaultId, token) {
    let sdk: any
    try {
      sdk = await import('@1password/sdk')
    } catch {
      throw new OnePasswordCliError('other', '@1password/sdk 를 불러오지 못했다 (npm install)')
    }
    try {
      const client = await sdk.createClient({ auth: token, integrationName: 'aegi-collector', integrationVersion: '0.1.0' })
      return await client.vaults.get(vaultId, { accessors: true })
    } catch (err: any) {
      const msg = String(err?.message ?? err)
      throw new OnePasswordCliError(classifyCli(msg), `sdk vaults.get ${vaultId}: ${msg.slice(0, 200)}`)
    }
  },
}

/** CLI·SDK 오류를 수집기 오류로. 인증 오류는 이 SaaS 의 나머지 호출을 멈춘다 */
function toCallError(err: unknown): unknown {
  if (!(err instanceof OnePasswordCliError)) return err
  const status = err.kind === 'auth' ? 401 : err.kind === 'denied' ? 403 : err.kind === 'not_found' ? 404 : 500
  const kind = err.kind === 'auth' ? 'auth' : err.kind === 'denied' ? 'forbidden' : err.kind === 'not_found' ? 'not_found' : 'api'
  return new CallError(kind, status, `onepassword_${err.kind}`, err.message)
}

const rules = { dropKeys: ONEPASSWORD_DROP_KEYS }

/** 금고 권한 비트. @1password/sdk 0.5.0 types.js 의 상수 값 그대로다. 이름 없는 비트는 permissions 정수에만 남는다 */
export const ONEPASSWORD_PERMISSION_BITS: Record<string, number> = {
  recover_vault: 1, manage_vault: 2, reveal_item_password: 16, read_items: 32, update_items: 64, create_items: 128,
  archive_items: 256, delete_items: 512, update_item_history: 1024, send_items: 1048576, import_items: 2097152,
  export_items: 4194304, print_items: 8388608,
}

/** vaults.get(accessors) 응답의 access[] 마다 켜진 비트의 이름(permission_names)을 붙인다 */
export function withPermissionNames(body: any): any {
  if (!body || !Array.isArray(body.access)) return body
  return {
    ...body,
    access: body.access.map((a: any) => {
      const n = Number(a?.permissions)
      if (!Number.isFinite(n)) return a
      return { ...a, permission_names: Object.entries(ONEPASSWORD_PERMISSION_BITS).filter(([, bit]) => (n & bit) === bit).map(([name]) => name) }
    }),
  }
}

export function onepasswordCalls(ctx: ProviderContext, deps: OnePasswordDeps = defaultOnePasswordDeps): CallDef[] {
  const { creds, config } = ctx
  const saToken = () => creds.require('ONEPASSWORD_SERVICE_ACCOUNT_TOKEN')
  const state: { accountId?: string } = {}

  /** 읽기 명령 하나를 돌려 원본으로 남긴다 */
  async function cli(api: CallApi, args: string[], params: Record<string, unknown>): Promise<any> {
    let body: unknown
    try {
      body = await deps.op(args, saToken())
    } catch (err) {
      throw toCallError(err)
    }
    return api.record({ endpoint: `op ${args.join(' ')}`, body, params, rules, credentialRef: 'CRED-OP-01' })
  }
  /** 부가 읽기: 403·404·기타 오류는 partial 로 남기고 넘어간다. 인증 오류는 올린다 */
  const optionalCli = (api: CallApi, label: string, args: string[], params: Record<string, unknown>) =>
    api.optional(label, () => cli(api, args, params))

  const fanout = <T>(api: CallApi, xs: T[]): T[] => {
    if (xs.length <= ONEPASSWORD_FANOUT_LIMIT) return xs
    api.partial('fanout_limit')
    return xs.slice(0, ONEPASSWORD_FANOUT_LIMIT)
  }
  const expectAccount = config.onepassword?.accountId

  return [
    {
      id: 'OP-01',
      provider: 'onepassword',
      title: '계정, 사용자, 그룹, 그룹 멤버십',
      credential: 'CRED-OP-01',
      unavailable: () => missingCredential(creds, 'CRED-OP-01'),
      run: async api => {
        const who = await cli(api, ['whoami'], { kind: 'whoami' })
        const accountId = who?.account_uuid ?? who?.AccountUUID ?? who?.account_id
        if (expectAccount && accountId && accountId !== expectAccount) {
          throw new TenantMismatchError(`onepassword 계정 ${accountId} != 설정 ${expectAccount}`)
        }
        state.accountId = accountId
        await optionalCli(api, 'users', ['user', 'list'], { kind: 'users' })
        const groups = (await optionalCli(api, 'groups', ['group', 'list'], { kind: 'groups' })) ?? []
        for (const g of fanout(api, Array.isArray(groups) ? groups : [])) {
          if (!g?.id) continue
          await optionalCli(api, `group_members:${g.id}`, ['group', 'user', 'list', g.id], { kind: 'group_members', group_id: g.id })
        }
      },
    },
    {
      id: 'OP-02',
      provider: 'onepassword',
      title: '금고, 금고 권한(사용자·그룹), 항목 메타',
      credential: 'CRED-OP-01',
      unavailable: () => missingCredential(creds, 'CRED-OP-01'),
      run: async api => {
        const vaults = (await cli(api, ['vault', 'list'], { kind: 'vaults' })) ?? []
        for (const v of fanout(api, Array.isArray(vaults) ? vaults : [])) {
          if (!v?.id) continue
          await api.optional(`vault_access:${v.id}`, async () => {
            let body: unknown
            try {
              body = await deps.vaultAccess(v.id, saToken())
            } catch (err) {
              throw toCallError(err)
            }
            return api.record({ endpoint: `sdk vaults.get(${v.id}, accessors)`, body, params: { kind: 'vault_access', vault_id: v.id }, rules, credentialRef: 'CRED-OP-01', transform: withPermissionNames })
          })
          await optionalCli(api, `items:${v.id}`, ['item', 'list', '--vault', v.id, '--include-archive'], { kind: 'items', vault_id: v.id })
        }
      },
    },
    {
      id: 'OP-03',
      provider: 'onepassword',
      title: '감사 이벤트 (Events API v3 beta)',
      credential: 'CRED-OP-02',
      unavailable: () => missingCredential(creds, 'CRED-OP-02'),
      run: async api => {
        const host = (config.onepassword?.eventsHost ?? ONEPASSWORD_EVENTS_HOST).replace(/\/+$/, '')
        const auth = bearerAuth('CRED-OP-02', creds.require('ONEPASSWORD_EVENTS_TOKEN'))
        const start = streamStart(api, 'onepassword:auditevents', api.period.since)
        let token: string | undefined
        let pages = 0
        const seen: string[] = []
        do {
          const query: Record<string, string> = token ? { page_token: token } : { start_time: start, end_time: api.period.until, max_page_size: '1000' }
          const body: any = await api.get({ url: buildUrl(`${host}/api/v3/auditevents`, query), auth, params: { kind: 'auditevents' }, rules })
          if (!body) break
          for (const e of body.audit_events ?? []) seen.push(e?.insert_time ?? e?.create_time)
          token = body.next_page_token || undefined
          pages++
          if (token && pages >= ONEPASSWORD_MAX_PAGES) {
            api.partial(`max_pages:${ONEPASSWORD_MAX_PAGES}`)
            break
          }
        } while (token)
        const last = maxIso(seen)
        if (last) api.setCursor('onepassword:auditevents', { cursor: null, last_event_at: last })
      },
    },
  ]
}
