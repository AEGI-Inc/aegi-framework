/**
 * 데이터셋 폴더의 판정 결과를 대시보드 번들의 derived 와 같은 모양(derived.json)으로 쓴다.
 * 게시본은 D1 스냅샷에서 서버가 derived 를 만든다(aegi-dashboard-new server/snapshotBundle.ts). 픽스처와 기능 테스트 데이터셋처럼
 * D1 에 올리지 않는 데이터셋은 이 파일을 데이터셋 폴더에 두면 dev 서버가 같은 모양으로 싣는다. 대시보드는 판정을 직접 하지 않는다.
 *
 *   npm run derived:write -- <데이터셋 폴더> [--out <파일>]   기본 <데이터셋 폴더>/derived.json
 */
import fs from 'fs'
import path from 'path'
import { computeSnapshot, type ComputedSnapshot } from './engine.ts'
import { snapshotIdOf, snapshotRows } from './snapshot.ts'

/** 서버 derivedText 와 같은 칸, 같은 차례 */
export function derivedOf(c: ComputedSnapshot): Record<string, unknown> {
  const rows = snapshotRows(c)
  const details = (t: 'snap_findings' | 'snap_blast_radius') => {
    const i = rows[t].columns.indexOf('detail')
    return rows[t].rows.map(r => JSON.parse(String(r[i])))
  }
  return {
    snapshot_id: snapshotIdOf(c.files.manifest.created_at as string | undefined, c.datasetSha256, c.engineSha256, c.inputsSha256),
    findings: details('snap_findings'),
    blast_radius: details('snap_blast_radius'),
    aggregates: Object.fromEntries(c.aggregates.map(a => [a.id, a.detail])),
    ...(c.displayText ? { display_text: c.displayText } : {}),
    ...(c.accessTable ? { access_table: c.accessTable } : {}),
  }
}

function main() {
  const args = process.argv.slice(2)
  const dir = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--out')
  if (!dir) throw new Error('사용법: npm run derived:write -- <데이터셋 폴더> [--out <파일>]')
  const outAt = args.indexOf('--out')
  const out = outAt >= 0 ? args[outAt + 1] : path.join(dir, 'derived.json')
  const derived = derivedOf(computeSnapshot(path.resolve(dir)))
  fs.writeFileSync(out, JSON.stringify(derived) + '\n')
  console.log(`썼다: ${out} (위협 ${(derived.findings as unknown[]).length}, 피해 범위 ${(derived.blast_radius as unknown[]).length})`)
}

if (/derivedFile.ts$/.test(process.argv[1] ?? '')) main()
