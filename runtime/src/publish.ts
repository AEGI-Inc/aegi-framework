/**
 * 데이터셋 폴더를 로컬 SQLite 에 게시한다. 운영 게시(engine scripts/loader/publish.ts)와 같은 함수를 같은 순서로 부른다:
 * 판정 계산 → 스냅샷 적재·검증 → 번들 대조 → current 포인터 변경 → 옛 스냅샷 정리.
 * 다른 점: 대상이 D1 이 아니라 로컬 파일이고, 데이터셋에 EA 가 없으면 지금 코드로 계산해 넣는다(운영은 경고만 한다).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { aggregatesOf, computeSnapshot, engineSha256, type ComputedSnapshot, type DatasetFiles } from '../vendor/engine/scripts/loader/engine.ts'
import { composeDisplayText } from '../vendor/engine/scripts/displayText/compose.ts'
import { loadCanonical, readCache } from '../vendor/engine/scripts/displayText/files.ts'
import { effectiveAccessDrift, refreshEffectiveAccess } from '../vendor/engine/scripts/loader/fromCurrent.ts'
import { bundleFromFiles, sameBundle } from '../vendor/engine/scripts/loader/kv.ts'
import { bundleFromSnapshot, getHead, loadSnapshot, pruneSnapshots, setHead } from '../vendor/engine/scripts/loader/snapshot.ts'
import type { SqlExecutor } from '../vendor/engine/scripts/loader/sql.ts'
import { readApprovals } from '../vendor/engine/scripts/loader/approvalRows.ts'
import { gapSummary } from '../vendor/engine/src/detection/threat/threatGap.ts'
import { ONTOLOGY_SOURCE } from '../vendor/engine/src/ontology/generated.ts'
import { readVersions } from './versions.ts'

export interface PublishResult { snapshotId: string; reused: boolean; findings: number; accessGaps: number; blast: number }

export async function publishDataset(exec: SqlExecutor, datasetDir: string, opts: { name?: string; log?: (line: string) => void; computeEa?: boolean } = {}): Promise<PublishResult> {
  const log = opts.log ?? (() => undefined)
  if (opts.computeEa) {
    const drift = effectiveAccessDrift(datasetDir)
    if (drift) {
      const ea = refreshEffectiveAccess(datasetDir)
      log(`유효 권한(EA) 계산: ${ea.after}행 (${drift})`)
    }
  }
  const t0 = Date.now()
  const objectsFile = path.join(datasetDir, 'objects.json')
  const rawObjects = fs.existsSync(objectsFile) ? JSON.parse(fs.readFileSync(objectsFile, 'utf8')) : null
  const isEmpty = Array.isArray(rawObjects) && rawObjects.length === 0

  let computed: ComputedSnapshot
  if (isEmpty) {
    const manifestFile = path.join(datasetDir, 'manifest.json')
    const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {}
    const files: DatasetFiles = {
      manifest,
      objects: [],
      relations: [],
      links: [],
      observations: [],
      evidence_links: [],
    }
    const datasetSha256 = crypto.createHash('sha256').update(fs.existsSync(manifestFile) ? fs.readFileSync(manifestFile, 'utf8') : '').digest('hex')
    computed = {
      datasetDir,
      datasetSha256,
      engineSha256: engineSha256(),
      files,
      threatsV2: [],
      blast: [],
      aggregates: aggregatesOf(files, [], []),
      displayText: composeDisplayText([], loadCanonical(), readCache()),
      accessTable: { version: 1, targets: {} },
    }
  } else {
    // 운영 게시(engine scripts/loader/publish.ts)와 같이 대시보드 승인 목록을 판정에 넣고 차단 지점을 다시 판정해 확인한다
    const approvals = await readApprovals(exec)
    computed = computeSnapshot(datasetDir, { approvals, verifyCuts: true })
  }
  const accessGaps = gapSummary(computed.threatsV2).threats
  log(`판정: 위협 ${computed.threatsV2.length}, 권한 차집합 위협 ${accessGaps}, 자격증명 피해 범위 ${computed.blast.length} (${Date.now() - t0}ms)`)

  const head = await getHead(exec)
  const loaded = await loadSnapshot(exec, computed, {
    datasetName: opts.name ?? path.basename(datasetDir),
    engineVersion: readVersions()?.sources.engine?.commit ?? null,
    knowledgeVersion: ONTOLOGY_SOURCE.commit.slice(0, 7),
  })
  const publishedAt = new Date().toISOString()
  const bundle = await bundleFromSnapshot(exec, loaded.id, publishedAt)
  const fileBundle = isEmpty
    ? {
        format: 'aegi-measured-bundle/v1',
        variant: 'v2',
        published_at: publishedAt,
        manifest: computed.files.manifest,
        objects: [],
        relations: [],
        links: [],
        observations: [],
        evidence_links: [],
      }
    : bundleFromFiles(datasetDir, publishedAt)
  if (!sameBundle(bundle, fileBundle)) throw new Error('SQLite 스냅샷에서 만든 번들이 데이터셋 파일과 다르다. current 를 바꾸지 않는다')
  if (head?.snapshot_id !== loaded.id) await setHead(exec, loaded.id, 'publish', undefined, head?.snapshot_id ?? null)
  await pruneSnapshots(exec)
  log(`스냅샷 ${loaded.id} ${loaded.reused ? '(이미 있음)' : '적재'} → current`)
  return { snapshotId: loaded.id, reused: loaded.reused, findings: computed.threatsV2.length, accessGaps, blast: computed.blast.length }
}
