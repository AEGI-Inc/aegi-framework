import crypto from 'node:crypto'
import type { Provider } from './lib/store'
import type { CallDef } from './lib/runner'
import type { CallFactory, ProviderContext } from './providers/common'
import { githubCalls } from './providers/github'
import { oktaCalls } from './providers/okta'
import { slackCalls } from './providers/slack'
import { gwsCalls } from './providers/gws'
import { salesforceCalls } from './providers/salesforce'
import { atlassianCalls } from './providers/atlassian'
import { workerCalls } from './providers/worker'
import { awsCalls } from './providers/aws'
import { gcpCalls } from './providers/gcp'
import { microsoftCalls } from './providers/microsoft'
import { onepasswordCalls } from './providers/onepassword'
import { guardTenants } from './tenant'

export const PROVIDERS: Record<Provider, CallFactory> = {
  github: githubCalls,
  okta: oktaCalls,
  slack: slackCalls,
  gws: gwsCalls,
  salesforce: salesforceCalls,
  atlassian: atlassianCalls,
  worker: workerCalls,
  aws: awsCalls,
  gcp: gcpCalls,
  microsoft: microsoftCalls,
  onepassword: ctx => onepasswordCalls(ctx),
}

export function newRunId(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${crypto.randomBytes(2).toString('hex')}`
}

/**
 * CLI 진입점 없이 호출을 고른다. 일반 수집 CLI는 extra로 수집 API 목록 호출을 더하고,
 * 감사 sync는 손코드 감사 호출만 선택한다. 앞 호출의 결과를 읽는 호출 순서는 유지한다.
 */
export function selectCalls(ctx: ProviderContext, only?: string[], callIds?: string[], extra?: CallFactory): CallDef[] {
  const providers = (only?.length ? only : Object.keys(PROVIDERS)) as Provider[]
  const unknown = providers.filter(p => !PROVIDERS[p])
  if (unknown.length) throw new Error(`모르는 SaaS: ${unknown.join(', ')} (가능: ${Object.keys(PROVIDERS).join(', ')})`)
  const calls = guardTenants([
    ...providers.flatMap(p => PROVIDERS[p](ctx)),
    ...(extra ? extra(ctx).filter(c => providers.includes(c.provider)) : []),
  ], ctx.config, ctx.creds)
  if (!callIds?.length) return calls
  const wanted = new Set(callIds.map(c => c.toUpperCase()))
  const missing = [...wanted].filter(id => !calls.some(c => c.id.toUpperCase() === id))
  if (missing.length) throw new Error(`모르는 호출 ID: ${missing.join(', ')}`)
  // 수집 API 목록 호출의 부모(fanout) 호출은 같이 고르지 않는다. 부모가 없으면 그 호출은 partial(no_parent_values) 이다
  return calls.filter(c => wanted.has(c.id.toUpperCase()))
}
