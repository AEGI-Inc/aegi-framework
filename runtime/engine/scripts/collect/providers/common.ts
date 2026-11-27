import type { CollectorConfig, Credentials } from '../config'
import type { Transport } from '../lib/http'
import type { CallApi, CallDef } from '../lib/runner'

export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>
  resolveCname(hostname: string): Promise<string[]>
  resolveMx(hostname: string): Promise<Array<{ exchange: string; priority: number }>>
}

export interface ProviderContext {
  config: CollectorConfig
  creds: Credentials
  transport: Transport
  dnsResolver?: DnsResolver
}

export type CallFactory = (ctx: ProviderContext) => CallDef[]

/** 로그 스트림 시작점: 커서가 있으면 커서, 없으면 설정의 since */
export function streamStart(api: CallApi, stream: string, since: string): string {
  return api.cursor(stream)?.last_event_at ?? since
}

export function maxIso(values: Array<string | number | null | undefined>): string | null {
  let best: number | null = null
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue
    const t = typeof v === 'number' ? (v > 1e12 ? v : v * 1000) : Date.parse(v)
    if (Number.isFinite(t) && (best === null || t > best)) best = t
  }
  return best === null ? null : new Date(best).toISOString()
}

export const toEpochSeconds = (iso: string): number => Math.floor(Date.parse(iso) / 1000)
export const isoDate = (iso: string): string => iso.slice(0, 10)
