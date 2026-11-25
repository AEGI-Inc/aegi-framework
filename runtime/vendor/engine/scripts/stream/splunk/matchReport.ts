/**
 * 이벤트 ↔ 그래프 일치 보고서. 수집 원본 감사 로그를 Splunk 로 보낼 때와 같은 모양(ship.ts STREAM_SOURCES)으로
 * 매퍼에 넣고, 데이터셋의 객체·관계와 같았던 것을 센다. 네트워크와 비밀값을 쓰지 않는다.
 *
 *   npm run splunk:match-report -- --raw collected/raw/<run> --dataset collected/<데이터셋> [--json <파일>]
 *
 * 세는 것: 행위자·대상의 객체 일치와 그 근거(matched_on), 못 찾은 대상 종류, 관계 끝점 일치(relation_matches)의
 * 관계 종류, 이벤트 종류, 칸 모양. 「같다」는 사실만 세고 해석하지 않는다.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { mapRow } from './mapper'
import { EntityResolver } from './resolver'
import { STREAM_SOURCES } from './ship'
import type { EventSlot, GraphRelationRef, NormalizedEvent } from './types'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

export interface SourceReport {
  callId: string
  records: number
  events: number
  mappingErrors: number
  actors: { total: number; matched: number }
  targets: { total: number; matched: number }
  /** `<identifier>/<same>` → 건수 (행위자와 대상) */
  matchedOn: Record<string, number>
  /** 못 찾은 대상의 종류 → 건수 */
  unmatchedTargets: Record<string, number>
  relationMatches: {
    events: number
    total: number
    byRelationType: Record<string, number>
    /** `<이벤트 종류> → <관계 종류>` → 건수 */
    byEventType: Record<string, number>
    /** `actor→target` 같은 칸 모양 → 건수 */
    bySlots: Record<string, number>
    withRole: number
  }
}

const slotName = (s: EventSlot) => (s === 'actor' ? 'actor' : 'target')
const inc = (m: Record<string, number>, k: string, n = 1) => { m[k] = (m[k] ?? 0) + n }

/** 데이터셋 relations.json → graph-index 와 같은 관계 줄 */
export function datasetRelations(dataset: string): GraphRelationRef[] {
  const rows = JSON.parse(fs.readFileSync(path.join(dataset, 'relations.json'), 'utf8')) as Array<{ fixture_key: string; canonical: { relation_type: string; references: Record<string, { value?: string } | undefined> } }>
  return rows.map(r => ({ id: r.fixture_key, type: r.canonical.relation_type, from: String(r.canonical.references.source?.value ?? ''), to: String(r.canonical.references.target?.value ?? ''), role: r.canonical.references.role?.value ?? null }))
}

/** 원본 폴더의 호출마다 정규 이벤트를 만들고 센다 */
export function matchReport(rawDir: string, dataset: string): SourceReport[] {
  const objects = JSON.parse(fs.readFileSync(path.join(dataset, 'objects.json'), 'utf8'))
  const selfClientIds = (process.env.AEGI_GWS_SELF_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const resolver = new EntityResolver(objects, [], { relations: datasetRelations(dataset), selfClientIds })
  const files = fs.readdirSync(rawDir, { recursive: true, encoding: 'utf8' }).filter(f => f.endsWith('.json')).sort()
  const out: SourceReport[] = []
  for (const src of STREAM_SOURCES) {
    const mine = files.filter(f => path.basename(f).startsWith(`${src.callId}-`))
    if (!mine.length) continue
    const rep: SourceReport = {
      callId: src.callId, records: 0, events: 0, mappingErrors: 0, actors: { total: 0, matched: 0 }, targets: { total: 0, matched: 0 },
      matchedOn: {}, unmatchedTargets: {}, relationMatches: { events: 0, total: 0, byRelationType: {}, byEventType: {}, bySlots: {}, withRole: 0 },
    }
    for (const f of mine) {
      const payload = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8')).payload
      for (const item of src.items(payload)) {
        rep.records++
        const row = { _raw: JSON.stringify(src.event ? src.event(item) : item) }
        const mapped = mapRow(row, { index: src.index, sourcetype: src.sourcetype, sid: 'report', offset: rep.records, tenant: src.index, receivedAt: '' }, resolver)
        if (mapped.error) { rep.mappingErrors++; continue }
        for (const e of mapped.events) count(rep, e)
      }
    }
    out.push(rep)
  }
  return out
}

function count(rep: SourceReport, e: NormalizedEvent) {
  rep.events++
  if (e.actor) {
    rep.actors.total++
    if (e.actor.object_key) rep.actors.matched++
    if (e.actor.matched_on) inc(rep.matchedOn, `${e.actor.matched_on.identifier}/${e.actor.matched_on.same}`)
  }
  for (const t of e.targets) {
    rep.targets.total++
    if (t.object_key) rep.targets.matched++
    else inc(rep.unmatchedTargets, t.type)
    if (t.matched_on) inc(rep.matchedOn, `${t.matched_on.identifier}/${t.matched_on.same}`)
  }
  const rm = e.relation_matches ?? []
  if (rm.length) rep.relationMatches.events++
  for (const m of rm) {
    rep.relationMatches.total++
    inc(rep.relationMatches.byRelationType, m.relation_type)
    inc(rep.relationMatches.byEventType, `${e.event_type} → ${m.relation_type}`)
    inc(rep.relationMatches.bySlots, `${slotName(m.source)}→${slotName(m.target)}`)
    if (m.role) rep.relationMatches.withRole++
  }
}

const top = (m: Record<string, number>, n: number) => Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)

export function formatReport(reports: SourceReport[]): string {
  const lines: string[] = []
  const sum = (f: (r: SourceReport) => number) => reports.reduce((a, r) => a + f(r), 0)
  lines.push(`이벤트 ${sum(r => r.events)}건, 관계 끝점 일치가 있는 이벤트 ${sum(r => r.relationMatches.events)}건, 일치 ${sum(r => r.relationMatches.total)}개`)
  for (const r of reports) {
    lines.push('', `[${r.callId}] 레코드 ${r.records}, 이벤트 ${r.events}, 매핑 오류 ${r.mappingErrors}`)
    lines.push(`  행위자 ${r.actors.matched}/${r.actors.total}, 대상 ${r.targets.matched}/${r.targets.total}`)
    lines.push(`  일치 근거: ${top(r.matchedOn, 8).map(([k, n]) => `${k} ${n}`).join(', ') || '없음'}`)
    lines.push(`  못 찾은 대상: ${top(r.unmatchedTargets, 8).map(([k, n]) => `${k} ${n}`).join(', ') || '없음'}`)
    const rm = r.relationMatches
    lines.push(`  관계 끝점 일치: 이벤트 ${rm.events}, 일치 ${rm.total}, role 도 있음 ${rm.withRole}`)
    if (rm.total) {
      lines.push(`    관계 종류: ${top(rm.byRelationType, 10).map(([k, n]) => `${k} ${n}`).join(', ')}`)
      lines.push(`    칸 모양: ${top(rm.bySlots, 4).map(([k, n]) => `${k} ${n}`).join(', ')}`)
      for (const [k, n] of top(rm.byEventType, 8)) lines.push(`    ${n}  ${k}`)
    }
  }
  return lines.join('\n')
}

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const raw = arg(args, '--raw'), dataset = arg(args, '--dataset'), json = arg(args, '--json')
  if (!raw || !dataset) {
    console.error('사용법: npm run splunk:match-report -- --raw collected/raw/<run> --dataset collected/<데이터셋> [--json <파일>]')
    process.exit(2)
  }
  const reports = matchReport(path.resolve(ROOT, raw), path.resolve(ROOT, dataset))
  console.log(formatReport(reports))
  if (json) fs.writeFileSync(path.resolve(json), JSON.stringify(reports, null, 2))
}
