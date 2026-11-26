/**
 * 그 환경 D1 의 current 스냅샷을 데이터셋 폴더 모양으로 꺼낸다(--from-current).
 * 데이터셋 폴더(collected/<run>) 없이, 판정 코드나 제목 틀만 바뀌었을 때 같은 데이터를 다시 판정해 게시하고 검증할 때 쓴다.
 * 스냅샷에는 판정에 쓰는 파일(objects, relations, links, observations, evidence_links, manifest, coverage 등)이 모두 들어 있다.
 * EA 도 판정 코드가 만들므로 게시와 검증은 꺼낸 뒤 EA 를 지금 코드로 다시 쓴다(refreshExported).
 * 계보는 꺼낸 바이트로 잰 지문이 맞지 않을 때만 꺼낸 데이터로 다시 만든다(refreshExportedLineage).
 */
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { EffectiveAccessFile } from '../../src/detection/v2/effectiveAccess/types.ts'
import { datasetEffectiveAccess } from '../accessRules/production.ts'
import { LINEAGE_FILE, lineageForDir, sourceDigest } from '../lineage/run.ts'
import { validateLineageEvents } from '../lineage/validate.ts'
import { OPTIONAL_FILES, readDatasetFiles, REQUIRED_FILES } from './engine.ts'
import { bundleFromSnapshot, getHead, getSnapshot } from './snapshot.ts'
import type { SqlExecutor } from './sql.ts'

export interface ExportedDataset {
  dir: string
  snapshotId: string
  /** 처음 게시할 때 쓴 데이터셋 이름 */
  datasetName: string | null
  /**
   * 처음 게시한 데이터셋 파일의 지문. 꺼낸 파일은 원본이 정규화 모양이 아니면 바이트가 달라 지문이 달라지므로,
   * 다시 판정한 스냅샷은 이 지문을 이어 쓴다. 내용이 같은지는 게시 때 D1 번들과 꺼낸 파일을 견줘 확인한다.
   * EA 를 다시 계산해 내용이 바뀌면 refreshExported 가 원래 지문과 새 EA 로 다시 만든다
   */
  datasetSha256: string
}

export async function exportCurrentDataset(exec: SqlExecutor, dir?: string): Promise<ExportedDataset> {
  const head = await getHead(exec)
  if (!head) throw new Error('current 스냅샷이 없다. --from-current 는 이미 게시한 스냅샷이 있어야 한다')
  const snap = await getSnapshot(exec, head.snapshot_id)
  if (!snap) throw new Error(`current 스냅샷 ${head.snapshot_id} 의 기록이 없다`)
  const bundle = await bundleFromSnapshot(exec, head.snapshot_id)
  const out = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), `aegi-current-${head.snapshot_id}-`))
  fs.mkdirSync(out, { recursive: true })
  for (const name of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    if (bundle[name] === undefined) continue
    // 정규화(runner/products.ts writeProducts)와 같은 모양(1칸 들여쓰기, 끝 줄바꿈)으로 쓴다. 정규화가 쓴 데이터셋이면 바이트까지 같아,
    // 계보(lineage_events)가 원본 바이트로 잰 지문이 맞는다. 다른 도구가 쓴 데이터셋은 바이트가 달라 refreshExported 가 계보를 맞춘다.
    // 데이터셋 지문은 원본 것(datasetSha256)을 이어 쓴다
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(bundle[name], null, 1) + '\n')
  }
  return { dir: out, snapshotId: head.snapshot_id, datasetName: snap.dataset_name ?? null, datasetSha256: snap.dataset_sha256 }
}

/**
 * 데이터셋 폴더의 effective_access.json 을 지금 운영 EA 코드로 다시 쓴다(정규화와 같은 모양, 1칸 들여쓰기).
 * 계산은 정규화(runner/products.ts buildProducts)와 같은 함수 하나(scripts/accessRules/production.ts datasetEffectiveAccess)다.
 * runs_as_inherits 는 규칙 파일을 읽는 실행기가 계산해, 규칙이나 실행기가 바뀌면 같은 데이터에서도 EA 가 달라진다.
 * 같은 데이터와 같은 코드면 같은 바이트가 나온다. 계산이나 형식 검사가 실패하면 던지고 파일은 그대로 둔다.
 * changed 는 원래 파일이 없거나 내용이 달랐는지다. 돌려주는 행 수는 로그용이다
 */
export function refreshEffectiveAccess(dir: string, ontology?: string): { before: number | null; after: number; changed: boolean } {
  const files = readDatasetFiles(dir)
  const ea = datasetEffectiveAccess(files, { ontology })
  const changed = !files.effective_access || JSON.stringify(files.effective_access) !== JSON.stringify(ea)
  fs.writeFileSync(path.join(dir, 'effective_access.json'), JSON.stringify(ea, null, 1) + '\n')
  return { before: files.effective_access?.rows.length ?? null, after: ea.rows.length, changed }
}

/**
 * 꺼낸 폴더의 계보 지문 맞추기. D1 은 파싱한 값만 담아 원본 파일의 바이트(들여쓰기, 키 순서)를 되살리지 못한다.
 * 그래서 정규화가 아닌 도구가 쓴 데이터셋(합성 데이터를 얹은 폴더 등)을 꺼내면, 원본 바이트로 잰 계보 지문(source_sha256)이
 * 꺼낸 바이트와 달라 게시와 검증이 bundleFromFiles 의 계보 검사에서 멈췄다(2026-11-08 운영 dataset-prod3).
 * 계보는 데이터 파일 여섯 개(LINEAGE_SOURCE_FILES)만으로 정해지므로, 지문이 다를 때만 꺼낸 파일로 다시 만든다.
 * 지문이 맞으면(정규화가 쓴 데이터셋) 손대지 않고(kept), 계보가 없던 스냅샷에는 새로 만들지 않는다(none).
 * 다시 만든 계보가 지문만 다르면 reanchored, 계보 코드가 바뀌어 내용까지 다르면 rebuilt 다.
 * 다시 만든 계보가 공식 스키마 검사에 걸리면 던지고 파일은 그대로 둔다
 */
export function refreshExportedLineage(dir: string): 'none' | 'kept' | 'reanchored' | 'rebuilt' {
  const file = path.join(dir, LINEAGE_FILE)
  if (!fs.existsSync(file)) return 'none'
  const stored = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (stored.source_sha256 === sourceDigest(dir)) return 'kept'
  const rebuilt = lineageForDir(dir)
  const problems = validateLineageEvents(rebuilt.events)
  if (problems.length) throw new Error(`꺼낸 데이터로 다시 만든 계보가 OpenLineage 스키마 검사에 걸렸다(${problems.length}건). 계보를 맞추지 못해 멈춘다`)
  fs.writeFileSync(file, JSON.stringify(rebuilt, null, 1) + '\n')
  const withoutDigest = ({ source_sha256: _, ...rest }: Record<string, unknown>) => JSON.stringify(rest)
  return withoutDigest(stored) === withoutDigest(rebuilt as unknown as Record<string, unknown>) ? 'reanchored' : 'rebuilt'
}

/**
 * --from-current 의 EA 다시 계산과 계보 지문 맞추기(게시와 d1:verify 가 같이 쓴다). EA 가 바뀌면 내용이 바뀐 데이터셋이므로 데이터셋 지문을
 * sha256(원래 지문 + 줄바꿈 + 새 EA 파일)로 바꾼다. 그래서 같은 판정 코드여도 EA 가 다르면 새 스냅샷이 되고(같은 id 의 옛 스냅샷을
 * 다시 쓰다 번들 비교에서 멈추지 않는다), EA 가 같으면 원래 지문을 이어 써 같은 스냅샷을 다시 쓴다.
 * 계보를 다시 만들었으면 같은 까닭으로 sha256(지금 지문 + 줄바꿈 + 새 계보 파일)로 한 번 더 바꾼다
 */
export function refreshExported(exported: ExportedDataset, ontology?: string): ReturnType<typeof refreshEffectiveAccess> & { lineage: ReturnType<typeof refreshExportedLineage> } {
  const result = refreshEffectiveAccess(exported.dir, ontology)
  if (result.changed) {
    exported.datasetSha256 = crypto.createHash('sha256').update(`${exported.datasetSha256}\n`).update(fs.readFileSync(path.join(exported.dir, 'effective_access.json'))).digest('hex')
  }
  const lineage = refreshExportedLineage(exported.dir)
  if (lineage === 'reanchored' || lineage === 'rebuilt') {
    exported.datasetSha256 = crypto.createHash('sha256').update(`${exported.datasetSha256}\n`).update(fs.readFileSync(path.join(exported.dir, LINEAGE_FILE))).digest('hex')
  }
  return { ...result, lineage }
}

/** 담아 둔 EA 파일(stored)이 없거나 다시 계산한 EA 와 다르면 그 까닭, 같으면 null. --dataset 게시 전 확인과 engine:verify 가 쓴다 */
export function effectiveAccessFileDrift(stored: EffectiveAccessFile | undefined, ea: EffectiveAccessFile): string | null {
  if (!stored) return `데이터셋에 effective_access.json 이 없다(지금 코드로는 ${ea.rows.length}행)`
  if (JSON.stringify(stored) !== JSON.stringify(ea)) return `데이터셋의 effective_access.json 이 지금 코드 결과와 다르다(파일 ${stored.rows.length}행, 지금 코드 ${ea.rows.length}행)`
  return null
}

/** --dataset 게시 전 확인: 데이터셋의 EA 파일을 믿지 않고 다시 계산해 견준다(effectiveAccessFileDrift). 계산이 실패해도 게시는 막지 않고 까닭만 돌려준다 */
export function effectiveAccessDrift(dir: string, ontology?: string): string | null {
  const files = readDatasetFiles(dir)
  let ea: EffectiveAccessFile
  try {
    ea = datasetEffectiveAccess(files, { ontology })
  } catch (err) {
    return `지금 코드로 EA 를 계산하지 못했다(${err instanceof Error ? err.message : String(err)})`
  }
  return effectiveAccessFileDrift(files.effective_access, ea)
}
