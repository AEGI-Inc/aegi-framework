/**
 * 데이터셋을 한 환경에 게시한다: 엔진 계산 → 스냅샷 적재, 검증 → 현재 포인터 변경 → 정리.
 * 게시 뒤 대시보드에서 확인하고, 문제가 있으면 npm run rollback 으로 직전 스냅샷으로 되돌린다.
 *
 *   npm run publish -- --env production --dataset collected/<run>
 *   npm run publish -- --env production --from-current             # 판정 코드, 제목 틀만 바뀜: D1 current 스냅샷의 데이터를 다시 판정
 *
 * --allow-older   지금 current 보다 오래된 데이터셋을 일부러 올린다
 * --allow-degraded 정규화에서 Profile 객체가 크게 빠진(verify.json identity_rejections_not_systemic) 데이터셋을 알고 올린다
 * --skip-compliance-scope         컴플라이언스 대상 판정을 건너뛴다
 * 기준별 판정은 npm run standards:publish 로 독립 게시한다. --standard-results 는 사용하지 않는다
 */
import { execFileSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import { computeSnapshot } from './engine.ts'
import { effectiveAccessDrift, exportCurrentDataset, refreshExported, type ExportedDataset } from './fromCurrent.ts'
import { linkStalenessWarning } from './linkStaleness'
import { bundleFromFiles, sameBundle } from './kv.ts'
import { bundleFromSnapshot, getHead, getSnapshot, loadSnapshot, pruneSnapshots, setHead } from './snapshot.ts'
import { publishComplianceScope } from '../compliance-scope/publishScope.ts'
import { connect } from './connect.ts'
import type { SqlExecutor } from './sql.ts'
import { readApprovals } from './approvalRows.ts'

import { assertNotDegraded, assertNotOlder, describeTarget, parseTarget, readDatasetSummary, ROOT } from './target.ts'
import { ONTOLOGY_SOURCE } from '../../src/ontology/generated.ts'

/** 스냅샷에 남길 게시 코드 커밋. 기록용이며 Git 을 못 읽어도 게시는 막지 않는다 */
function engineVersion(): string | null {
  try {
    const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const dirty = Boolean(git(['status', '--porcelain', '--', 'src', 'scripts', 'migrations', 'package.json']))
    return `${git(['rev-parse', 'HEAD'])}${dirty ? '+dirty' : ''}`
  } catch {
    return null
  }
}

async function main() {
  const target = parseTarget(process.argv.slice(2))
  if (target.options.has('--standard-results')) throw new Error('기준별 판정은 npm run standards:publish -- --env <환경> --file <파일> 로 별도 게시하세요')
  const exec = await connect(target, { migrate: true })
  let exported: ExportedDataset | null = null
  if (target.flags.has('--from-current')) {
    exported = await exportCurrentDataset(exec)
    target.datasetDir = exported.dir
    console.log(`--from-current: ${target.env} current 스냅샷 ${exported.snapshotId}(${exported.datasetName ?? '이름 없음'})의 데이터를 지금 판정 코드로 다시 계산한다`)
  }
  try {
    if (exported) {
      // 링크는 다시 만들지 않는다. 스냅샷 링크가 지금 crosswalk 와 다르면 알린다(막지 않는다)
      const stale = linkStalenessWarning(exported.dir, { fromCurrent: true })
      if (stale) console.warn(`[주의] ${stale}`)
      const ea = refreshExported(exported)
      console.log(`EA: 지금 코드로 다시 계산 (${ea.before === null ? '스냅샷에 없었음' : `전 ${ea.before}행`} → ${ea.after}행, ${ea.changed ? '바뀜: 데이터셋 지문을 새 EA 로 다시 만든다' : '같음'})`)
      if (ea.lineage === 'reanchored') console.log('계보: 꺼낸 파일 바이트가 원본과 달라 꺼낸 데이터로 다시 만들었다. 내용은 같고 지문만 바뀐다(데이터셋 지문도 다시 만든다)')
      if (ea.lineage === 'rebuilt') console.warn('[주의] 계보: 꺼낸 데이터로 다시 만든 계보가 스냅샷 계보와 내용까지 다르다(계보 코드가 바뀌었다). 지금 코드의 계보로 올린다')
    }
    await publish(target, exec, exported)
  } finally {
    if (exported) fs.rmSync(exported.dir, { recursive: true, force: true })
  }
}

async function publish(target: ReturnType<typeof parseTarget>, exec: SqlExecutor, exported: ExportedDataset | null) {
  const summary = readDatasetSummary(target.datasetDir)
  console.log(`[게시]\n${describeTarget(target, summary)}`)
  // 게시는 EA 를 계산하지 않고 데이터셋의 파일을 올린다. 없거나 지금 코드 결과와 다르면 알린다(10-27 게시본은 EA 없이 올라갔다)
  if (!exported) {
    // 정규화가 식별 실패 레코드를 빼고 계속했으면 알리고, Profile 객체가 크게 빠졌으면 멈춘다(--allow-degraded 로 넘긴다)
    assertNotDegraded(target, target.datasetDir)
    const drift = effectiveAccessDrift(target.datasetDir)
    if (drift) console.warn(`[주의] ${drift}. 이대로 게시하면 대시보드 EA 가 지금 코드와 다르다. 게시 뒤 --from-current 로 다시 게시하면 맞춰진다`)
    const stale = linkStalenessWarning(target.datasetDir)
    if (stale) console.warn(`[주의] ${stale}`)
  }

  const head = await getHead(exec)
  const current = head ? await getSnapshot(exec, head.snapshot_id) : null
  await assertNotOlder(target, summary, current?.dataset_created_at ?? null)

  const t0 = Date.now()
  const approvals = await readApprovals(exec)
  const computed = computeSnapshot(target.datasetDir, { approvals, verifyCuts: true })
  if (approvals.length) console.log(`승인 목록 ${approvals.length}행을 위협 판정에 씀`)
  if (exported) computed.datasetSha256 = exported.datasetSha256
  console.log(`계산: 위협 ${computed.threatsV2.length}, 자격증명 피해 범위 ${computed.blast.length} (${Date.now() - t0}ms)`)

  const t1 = Date.now()
  const loaded = await loadSnapshot(exec, computed, {
    datasetName: exported ? exported.datasetName : path.relative(ROOT, target.datasetDir) || target.datasetDir,
    engineVersion: engineVersion(),
    knowledgeVersion: ONTOLOGY_SOURCE.commit.slice(0, 7),
    log: line => console.log(line),
  })
  console.log(`스냅샷 ${loaded.id}: ${loaded.reused ? '이미 있음' : `적재, 검증 완료 (${Date.now() - t1}ms)`}`)

  if (target.flags.has('--skip-compliance-scope')) {
    console.warn('[주의] --skip-compliance-scope: 컴플라이언스 대상 판정을 건너뛴다')
  } else {
    await publishComplianceScope(exec, loaded.id, target.datasetDir, {
      knowledgeDir: target.options.get('--knowledge'),
      log: line => console.log(line),
    })
  }

  // D1 스냅샷에서 호환 포맷의 번들을 다시 만든다(KV에 게시하지 않는다). 파일에서 만든 번들과 다르면 D1 에 빠진 자료가 있다는 뜻이라 멈춘다
  const publishedAt = new Date().toISOString()
  const bundle = await bundleFromSnapshot(exec, loaded.id, publishedAt)
  if (!sameBundle(bundle, bundleFromFiles(target.datasetDir, publishedAt))) throw new Error('D1 스냅샷에서 만든 번들이 데이터셋 파일과 다르다. 포인터를 바꾸지 않는다')

  const newHead = await setHead(exec, loaded.id, 'publish', undefined, head?.snapshot_id ?? null)
  console.log(`current: ${newHead.snapshot_id} (이전 ${newHead.previous_snapshot_id ?? '없음'})`)

  const dropped = await pruneSnapshots(exec)
  if (dropped.length) console.log(`정리한 스냅샷: ${dropped.join(', ')}`)
  console.log(`완료. 확인: npm run d1:verify -- --env ${target.env} ${exported ? '--from-current' : `--dataset ${path.relative(ROOT, target.datasetDir)}`}`)
}

main().catch(err => {
  console.error(`[오류] ${err.message}`)
  process.exit(1)
})
