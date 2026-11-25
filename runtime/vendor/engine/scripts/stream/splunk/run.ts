/**
 * Splunk 이벤트 파이프라인 (docs/SPLUNK_TIMELINE_PLAN.md).
 *
 *   npm run splunk -- ship --raw collected                    원본 감사 로그(OK-12, GW-10, GH-17, SL-11, SF-90)를 HEC 로 보낸다
 *   npm run splunk -- pull --dataset collected/g4-out         승인 검색으로 읽어 <dataset>/events.json 에 합친다
 *   npm run splunk -- pull --dataset <source> --remap-from <epoch> --remap-out <new-dir>
 *                                                                  원본은 유지하고 새 데이터셋에 재매핑
 *
 * 환경변수: SPLUNK_URL, SPLUNK_TOKEN, SPLUNK_HEC_TOKEN, SPLUNK_TLS_SHA256, SPLUNK_OKTA_TENANT, SPLUNK_GWS_TENANT
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { connectionFromEnv } from './config'
import { cursorKey, loadEventFile, saveEventFile } from './ingest'
import { EntityResolver } from './resolver'
import type { GraphRelationRef } from './types'
import { pullWindow } from './pull'
import { shipToSplunk } from './ship'
import { pinnedHttpsWire, SearchTransport } from './transport'
import { planWindow } from './windowPlanner'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2)
  const conn = connectionFromEnv()
  const t = new SearchTransport(conn, pinnedHttpsWire(conn.tlsSha256))

  if (cmd === 'ship') {
    const raw = path.resolve(ROOT, arg(args, '--raw') ?? 'collected')
    if (!conn.hecToken) throw new Error('SPLUNK_HEC_TOKEN 이 없다')
    const r = await shipToSplunk(t, raw)
    console.log(`HEC 전송 ${r.sent}건 ${JSON.stringify(r.byIndex)} · 시각이나 ID 가 없어 건너뜀 ${r.skipped}건`)
    const failed = Object.entries(r.failed)
    for (const [index, message] of failed) console.error(`[실패] ${index}: ${message} (Splunk index, HEC 토큰 허용 index 를 확인한다)`)
    if (failed.length) process.exit(1)
    return
  }

  if (cmd === 'pull') {
    let dataset = path.resolve(ROOT, arg(args, '--dataset') ?? 'src/data/aegi_inc_measured_v2')
    const remapFromArg = arg(args, '--remap-from')
    const remapFrom = remapFromArg === undefined ? null : Number(remapFromArg)
    if (remapFrom !== null) {
      const outArg = arg(args, '--remap-out')
      if (!arg(args, '--dataset') || !outArg) throw new Error('--remap-from 은 명시한 --dataset과 새 경로 --remap-out을 함께 요구한다')
      if (!Number.isInteger(remapFrom) || remapFrom < 0) throw new Error('--remap-from 은 0 이상의 정수 epoch 초여야 한다')
      const output = path.resolve(ROOT, outArg)
      if (fs.existsSync(output)) throw new Error(`재매핑 출력 경로가 이미 있다: ${output}`)
      fs.cpSync(dataset, output, { recursive: true, errorOnExist: true, force: false })
      dataset = output
    }
    const objects = JSON.parse(fs.readFileSync(path.join(dataset, 'objects.json'), 'utf8'))
    const tokenNamesPath = arg(args, '--gws-token-names')
    const tokenNames = tokenNamesPath ? JSON.parse(fs.readFileSync(path.resolve(tokenNamesPath), 'utf8')) : []
    if (!Array.isArray(tokenNames)) throw new Error('--gws-token-names 는 [{clientId, displayText}] 형식의 JSON 배열이어야 한다')
    // 데이터셋의 관계로 이벤트 행위자, 대상이 관계 두 끝과 같은지도 센다(resolver.ts relationMatches)
    const relationsPath = path.join(dataset, 'relations.json')
    const relations: GraphRelationRef[] | undefined = fs.existsSync(relationsPath)
      ? (JSON.parse(fs.readFileSync(relationsPath, 'utf8')) as Array<{ fixture_key: string; canonical: { relation_type: string; references: Record<string, { value?: string } | undefined> } }>)
        .map(r => ({ id: r.fixture_key, type: r.canonical.relation_type, from: String(r.canonical.references.source?.value ?? ''), to: String(r.canonical.references.target?.value ?? ''), role: r.canonical.references.role?.value ?? null }))
      : undefined
    const selfClientIds = (process.env.AEGI_GWS_SELF_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const resolver = new EntityResolver(objects, tokenNames, { relations, selfClientIds })
    const file = loadEventFile(dataset)
    const backfillFrom = Number(arg(args, '--backfill-from') ?? 0)
    for (const [index, sourcetypes] of Object.entries(conn.approved)) {
      for (const sourcetype of sourcetypes) {
        const key = cursorKey(index, sourcetype)
        const expected = file.cursors[key]
        const window = planWindow(remapFrom === null ? expected : undefined, Date.now() / 1000, { backfillFrom: remapFrom ?? backfillFrom })
        if (!window) { console.log(`${key}: 새 구간 없음`); continue }
        const r = await pullWindow(t, file, resolver, { approved: conn.approved, index, sourcetype, tenant: conn.tenants[index] ?? index, window, expectedCursor: expected })
        for (const line of r.lines) console.log(`${key}: ${line}`)
        if (r.splits) console.log(`${key}: Splunk 가 잘라 구간을 ${r.splits}번 나눠 받았다 (검색 ${r.searches}번)`)
        if (r.rejected.length) console.warn(`[경고] ${key}: 변환 실패 ${r.rejected.length}건을 격리했다 (events.json rejected): ${[...new Set(r.rejected)].slice(0, 3).join('; ')}`)
        for (const w of r.warnings) console.warn(`[경고] ${key}: cursor 를 구간 끝까지 못 옮겼다. ${w}`)
      }
    }
    saveEventFile(dataset, file)
    console.log(`썼다: ${path.relative(ROOT, path.join(dataset, 'events.json'))} (이벤트 ${file.events.length} · 객체 미해석 ${file.unresolved} · 충돌 ${file.conflicts.length} · 격리 ${file.rejected?.length ?? 0})`)
    if (file.rejected?.length) {
      const from = Math.min(...file.rejected.map(x => x.indextime ?? x.window.index_earliest))
      console.warn(`[경고] 격리 ${file.rejected.length}건. 매퍼를 고친 뒤 pull --dataset <이 데이터셋> --remap-from ${from} --remap-out <새 경로> 로 다시 받으면 변환된 것은 격리에서 지운다`)
    }
    return
  }

  throw new Error('사용법: npm run splunk -- ship --raw <dir> | pull --dataset <dir>')
}

main().catch(err => { console.error(`[오류] ${err.message}`); process.exit(1) })
