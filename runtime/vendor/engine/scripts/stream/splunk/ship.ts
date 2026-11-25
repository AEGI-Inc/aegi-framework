/**
 * 수집기가 받은 원본 감사 로그(OK-12 Okta System Log, GW-10 GWS Reports, GH-17 GitHub 조직 감사 로그,
 * SL-11 Slack Audit Logs, SF-90 Salesforce 설정 감사 기록, JI-90 Jira 감사 기록, CF-90 Confluence 감사 기록,
 * AT-90 Atlassian 조직 감사 기록)를 Splunk HEC 로 보낸다.
 * 원본은 바꾸지 않는다. 이벤트 시각은 원본 발생 시각이다. 보낸 원본 키는 장부에 남겨 다시 보내지 않는다.
 */
import fs from 'fs'
import path from 'path'
import type { SearchTransport } from './transport'
import type { EventProvider } from './types'
import { confluenceId, confluenceTime, isConfluenceAudit } from './confluence'

export const SHIP_LEDGER = 'splunk-shipped.json'

interface StreamSource {
  provider: EventProvider
  callId: string
  index: string
  sourcetype: string
  items: (payload: any) => any[]
  originId: (e: any) => string | null
  /** 원본 발생 시각(epoch 초). 없거나 읽을 수 없으면 null */
  time: (e: any) => number | null
  /** HEC 에 보낼 모양. 없으면 항목 그대로 */
  event?: (e: any) => unknown
}

const isoSec = (v: unknown): number | null => {
  const ms = typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isNaN(ms) ? null : ms / 1000
}
const numSec = (v: unknown, scale: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? v / scale : null)

export const STREAM_SOURCES: StreamSource[] = [
  {
    provider: 'okta', callId: 'OK-12', index: 'aegi_okta', sourcetype: 'okta:im2:log',
    items: p => (Array.isArray(p) ? p : []),
    originId: e => (typeof e?.uuid === 'string' ? `okta:${e.uuid}` : null),
    time: e => isoSec(e?.published),
  },
  {
    provider: 'gws', callId: 'GW-10', index: 'aegi_gws', sourcetype: 'gws:reports:activity',
    items: p => (Array.isArray(p?.items) ? p.items : []),
    originId: e => (e?.id?.uniqueQualifier ? `gws:${e.id.applicationName}:${e.id.time}:${e.id.uniqueQualifier}` : null),
    time: e => isoSec(e?.id?.time),
  },
  {
    // 감사 로그 phrase 가 날짜 단위라 실행끼리 겹친다. _document_id 로 거른다
    provider: 'github', callId: 'GH-17', index: 'aegi_github', sourcetype: 'github:cloud:audit',
    items: p => (Array.isArray(p) ? p : []),
    originId: e => (typeof e?._document_id === 'string' ? `github:${e._document_id}` : null),
    time: e => numSec(e?.['@timestamp'] ?? e?.created_at, 1000),
  },
  {
    // SL-11 의 첫 페이지는 actions 목록이라 entries 가 없다
    provider: 'slack', callId: 'SL-11', index: 'aegi_slack', sourcetype: 'slack:audit',
    items: p => (Array.isArray(p?.entries) ? p.entries : []),
    originId: e => (typeof e?.id === 'string' ? `slack:${e.id}` : null),
    time: e => numSec(e?.date_create, 1),
  },
  {
    provider: 'salesforce', callId: 'SF-90', index: 'aegi_salesforce', sourcetype: 'sfdc:setupaudittrail',
    items: p => (Array.isArray(p?.records) ? p.records.filter((r: any) => r?.attributes?.type === 'SetupAuditTrail') : []),
    originId: e => (typeof e?.Id === 'string' ? `salesforce:${e.Id}` : null),
    time: e => isoSec(e?.CreatedDate),
  },
  {
    provider: 'atlassian', callId: 'JI-90', index: 'aegi_atlassian', sourcetype: 'jira:audit',
    items: p => (Array.isArray(p?.records) ? p.records : []),
    originId: e => (typeof e?.id === 'number' || typeof e?.id === 'string' ? `jira:${e.id}` : null),
    time: e => isoSec(e?.created),
  },
  {
    provider: 'atlassian', callId: 'CF-90', index: 'aegi_atlassian', sourcetype: 'confluence:audit',
    items: p => (Array.isArray(p?.results) ? p.results : Array.isArray(p) ? p : []),
    originId: e => (isConfluenceAudit(e) ? `confluence:${confluenceId(e)}` : null),
    time: e => (isConfluenceAudit(e) ? confluenceTime(e) : null),
  },
  {
    // Guard 웹훅과 같은 data[] 봉투로 하나씩 감싸 보낸다. 같은 sourcetype 과 mapper 로 읽힌다
    provider: 'atlassian', callId: 'AT-90', index: 'aegi_atlassian', sourcetype: 'atlassian:guard:audit',
    items: p => (Array.isArray(p?.data) ? p.data.filter((e: any) => e?.type === 'events') : []),
    originId: e => (typeof e?.id === 'string' && e.id ? `atlassian-guard:${e.id}` : null),
    time: e => isoSec(e?.attributes?.time),
    event: e => ({ data: [e] }),
  },
]

export interface ShipEvent { time: number; host: string; source: string; sourcetype: string; index: string; event: unknown }

/** 원본 폴더(collected/<x>)의 모든 실행에서 보낼 이벤트를 모은다. 장부에 있는 것과 같은 실행 안의 중복은 뺀다 */
export function collectShipEvents(rawDir: string, shipped: Set<string>): { events: ShipEvent[]; keys: string[]; skipped: number } {
  const events: ShipEvent[] = []
  const keys: string[] = []
  let skipped = 0
  const seen = new Set(shipped)
  const runsRoot = path.join(rawDir, 'raw')
  if (!fs.existsSync(runsRoot)) return { events, keys, skipped }
  for (const run of fs.readdirSync(runsRoot).sort()) {
    for (const src of STREAM_SOURCES) {
      const dir = path.join(runsRoot, run, src.provider)
      if (!fs.existsSync(dir)) continue
      for (const file of fs.readdirSync(dir).filter(f => f.startsWith(`${src.callId}-`) && f.endsWith('.json')).sort()) {
        const envelope = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as { payload?: unknown }
        for (const e of src.items(envelope.payload)) {
          const key = src.originId(e)
          const t = src.time(e)
          if (!key || t === null) { skipped++; continue }
          if (seen.has(key)) continue
          seen.add(key)
          keys.push(key)
          events.push({ time: t, host: 'aegi-adapter-engine', source: `aegi-shipper:${src.callId}`, sourcetype: src.sourcetype, index: src.index, event: src.event ? src.event(e) : e })
        }
      }
    }
  }
  return { events, keys, skipped }
}

export function loadLedger(rawDir: string): Set<string> {
  const file = path.join(rawDir, SHIP_LEDGER)
  return new Set(fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { keys: string[] }).keys : [])
}

export function saveLedger(rawDir: string, keys: Set<string>): void {
  fs.writeFileSync(path.join(rawDir, SHIP_LEDGER), JSON.stringify({ updated_at: new Date().toISOString(), keys: [...keys] }, null, 1))
}

/**
 * index 별로 묶음마다 보내고 성공한 묶음만 장부에 남긴다.
 * 한 index 가 거절되면(Splunk 에 아직 없는 index 등) 그 index 의 나머지만 멈추고 다른 index 는 계속 보낸다.
 */
export async function shipToSplunk(t: SearchTransport, rawDir: string, batchSize = 50): Promise<{ sent: number; skipped: number; byIndex: Record<string, number>; failed: Record<string, string> }> {
  const ledger = loadLedger(rawDir)
  const { events, keys, skipped } = collectShipEvents(rawDir, ledger)
  const groups = new Map<string, Array<{ event: ShipEvent; key: string }>>()
  events.forEach((event, i) => {
    const g = groups.get(event.index) ?? []
    g.push({ event, key: keys[i]! })
    groups.set(event.index, g)
  })
  const byIndex: Record<string, number> = {}
  const failed: Record<string, string> = {}
  let sent = 0
  for (const [index, items] of groups) {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      try {
        await t.hecSend(batch.map(b => b.event))
      } catch (err) {
        failed[index] = (err as Error).message
        break
      }
      for (const b of batch) ledger.add(b.key)
      byIndex[index] = (byIndex[index] ?? 0) + batch.length
      sent += batch.length
      saveLedger(rawDir, ledger)
    }
  }
  return { sent, skipped, byIndex, failed }
}
