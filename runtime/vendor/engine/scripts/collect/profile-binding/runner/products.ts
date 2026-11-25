import crypto from 'node:crypto'
import path from 'node:path'
import { buildGraphStoreV2 } from '../../../../src/data/datasetStore'
import { linkPairCounts } from '../../../../src/detection/v2/effectiveAccess/common'
import { lineageFromDataset } from '../../../../src/lineage/build'
import { cutActionsSummary, loadCutActions } from '../../../cutActions/shadow'
import { datasetEffectiveAccess } from '../../../accessRules/production'
import { validateLineageEvents } from '../../../lineage/validate'
import { LINEAGE_SOURCE_FILES } from '../../../lineage/run'
import { buildCoverage } from '../../shared/coverage'
import type { RawSet } from '../../shared/raw'
import type { DatasetFiles } from '../../../loader/engine'
import { jsonChunks, writeJson } from './json-stream.mjs'

export function buildProducts(files: DatasetFiles, raw: RawSet) {
  // EA 는 게시, 검증과 같은 함수 하나로 만든다(형식 검사, 계산 시각까지). 바인딩은 쓰지 않는다
  const effectiveAccess = datasetEffectiveAccess(files)
  const lineage = lineageFromDataset(files)
  const lineageProblems = validateLineageEvents(lineage.events)
  if (lineageProblems.length) throw new Error(`Lineage validation failed: ${lineageProblems.length}`)
  const hash = crypto.createHash('sha256')
  // 파일과 같은 바이트를 조각으로 더한다(10,000명 objects 는 한 문자열로 만들 수 없다)
  for (const name of LINEAGE_SOURCE_FILES) for (const chunk of jsonChunks(files[name as keyof DatasetFiles])) hash.update(chunk)
  return { effective_access: effectiveAccess, coverage: buildCoverage(raw, String(files.manifest.created_at)), lineage_events: { ...lineage, source_sha256: hash.digest('hex') } }
}

export function writeProducts(dir: string, products: ReturnType<typeof buildProducts>) {
  for (const [name, value] of Object.entries(products)) writeJson(path.join(dir, name + '.json'), value)
}

/**
 * 조치 동사 그림자 (4층): 사전의 닫은 동사(cut_actions.yaml status adopted)를 끊는 곳(EA 행의 cut)에 붙여 본 수를 실행 보고서에 남긴다.
 * 운영 EA 는 그대로다. 그림자가 실패해도 정규화는 멈추지 않고 실패만 남긴다. 키와 이름은 남기지 않는다. ontology 는 시험용.
 */
export function cutActionsShadow(files: DatasetFiles, products: ReturnType<typeof buildProducts>, ontology?: string) {
  try {
    const graph = buildGraphStoreV2(files.objects, files.relations, files.links)
    return { status: 'ok' as const, ...cutActionsSummary(graph, products.effective_access, loadCutActions(ontology)) }
  } catch (error) {
    return { status: 'error' as const, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 동일인 링크 쌍 수: 약한 간선 둘 이상을 거쳐야 해서 EA 가 잇지 않는 쌍(blocked)을 실행 보고서에 남긴다.
 * Relation 담당 10-29 결정 C2 의 다시 볼 조건이다 — 0 이 아니면 다시 본다. 키와 이름은 남기지 않는다.
 * 그림자처럼 세다가 실패해도 정규화는 멈추지 않고 실패만 남긴다
 */
export function identityLinkPairs(files: DatasetFiles) {
  try {
    return { status: 'ok' as const, ...linkPairCounts(files.links) }
  } catch (error) {
    return { status: 'error' as const, error: error instanceof Error ? error.message : String(error) }
  }
}
