/**
 * 그 환경의 current 스냅샷이 데이터셋과 정확히 같은지 검사한다.
 *
 *   npm run d1:verify -- --env preview|production --dataset <데이터셋 폴더>
 *   npm run d1:verify -- --env preview|production --from-current      # --from-current 로 게시한 뒤
 *
 * 1. current 스냅샷의 데이터셋 지문이 이 데이터셋과 같고, 지금 판정 코드로 만든 스냅샷이다
 * 2. 스냅샷 표마다 행 id 와 순서가 다시 계산한 결과와 같다 (엔진 결과 포함)
 * 3. D1 스냅샷에서 만든 번들이 데이터셋 파일과 같다
 * 4. 대시보드가 읽는 graph_* 뷰가 current 스냅샷만 보인다
 * (KV dataset/v2 는 D1 단일 원본 전환으로 검증 대상에서 제외)
 */
import { connect } from './connect.ts'
import fs from 'fs'
import { computeSnapshot } from './engine.ts'
import { readApprovals } from './approvalRows.ts'
import { exportCurrentDataset, refreshExported, type ExportedDataset } from './fromCurrent.ts'
import { bundleFromFiles, sameBundle } from './kv.ts'
import { bundleFromSnapshot, getHead, getSnapshot, snapshotIdOf, snapshotRows, verifySnapshotRows } from './snapshot.ts'
import { describeTarget, parseTarget, readDatasetSummary } from './target.ts'

async function main() {
  const target = parseTarget()
  const exec = await connect(target)
  let exported: ExportedDataset | null = null
  if (target.flags.has('--from-current')) {
    exported = await exportCurrentDataset(exec)
    target.datasetDir = exported.dir
  }
  try {
    // 게시(--from-current)와 같게 EA 를 지금 코드로 다시 계산해 견준다
    if (exported) refreshExported(exported)
    await verify(target, exec, exported)
  } finally {
    if (exported) fs.rmSync(exported.dir, { recursive: true, force: true })
  }
}

async function verify(target: ReturnType<typeof parseTarget>, exec: Awaited<ReturnType<typeof connect>>, exported: ExportedDataset | null) {
  console.log(`[정합성 검증]\n${describeTarget(target, readDatasetSummary(target.datasetDir))}`)
  const problems: string[] = []
  const ok = (line: string) => console.log(`   ✓ ${line}`)

  const head = await getHead(exec)
  if (!head) throw new Error('current 스냅샷이 없다. npm run publish 먼저')
  const snap = await getSnapshot(exec, head.snapshot_id)
  // 게시(publish.ts)와 같은 입력으로 다시 계산한다: 승인 목록, 차단 지점 확인
  const computed = computeSnapshot(target.datasetDir, { approvals: await readApprovals(exec), verifyCuts: true })
  if (exported) computed.datasetSha256 = exported.datasetSha256
  console.log(`\ncurrent: ${head.snapshot_id} (${snap?.status}, 적재 ${snap?.loaded_at ?? '-'})`)

  if (snap?.dataset_sha256 !== computed.datasetSha256) problems.push(`current 스냅샷의 데이터셋 지문(${snap?.dataset_sha256.slice(0, 12)})이 이 데이터셋(${computed.datasetSha256.slice(0, 12)})과 다르다`)
  else ok('데이터셋 지문 일치')
  const expectedId = snapshotIdOf(computed.files.manifest?.created_at, computed.datasetSha256, computed.engineSha256, computed.inputsSha256)
  if (head.snapshot_id !== expectedId) problems.push(`current 스냅샷(${head.snapshot_id})이 지금 판정 코드로 만든 스냅샷(${expectedId})이 아니다. 다시 게시한다`)
  else ok('지금 판정 코드로 만든 스냅샷')

  const rows = snapshotRows(computed)
  const rowProblems = await verifySnapshotRows(exec, head.snapshot_id, rows)
  problems.push(...rowProblems)
  if (!rowProblems.length) ok(`스냅샷 표 ${Object.keys(rows).length}개 행 일치 (객체 ${rows.snap_objects.rows.length}, 관계 ${rows.snap_relations.rows.length}, 위협 ${rows.snap_findings.rows.length}, 피해 범위 ${rows.snap_blast_radius.rows.length})`)

  const publishedAt = new Date().toISOString()
  if (!sameBundle(await bundleFromSnapshot(exec, head.snapshot_id, publishedAt), bundleFromFiles(target.datasetDir, publishedAt))) problems.push('D1 스냅샷에서 만든 번들이 데이터셋 파일과 다르다')
  else ok('D1 스냅샷만으로 데이터셋 번들을 그대로 복원')

  for (const [view, table] of [['graph_objects', 'snap_objects'], ['graph_relations', 'snap_relations'], ['graph_findings', 'snap_findings'], ['graph_effective_access', 'snap_effective_access']] as const) {
    const n = (await exec.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${view}`))[0]?.n ?? 0
    if (n !== rows[table].rows.length) problems.push(`${view} 뷰 ${n}행 (기대 ${rows[table].rows.length})`)
  }
  if (!problems.some(p => p.includes('뷰'))) ok('대시보드 graph_* 뷰가 current 스냅샷만 보임')

  console.log('\n========================================')
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`)
    console.error('[결론] 정합성 검증 실패')
    // process.exit 는 main 의 finally(꺼낸 임시 폴더 지우기)를 건너뛴다
    process.exitCode = 1
    return
  }
  console.log(`[결론] ${target.env} current 스냅샷 ${head.snapshot_id} 가 데이터셋과 일치한다`)
}

main().catch(err => {
  console.error(`[오류] ${err.message}`)
  process.exit(1)
})
