/**
 * 호환 번들 포맷(aegi-measured-bundle/v1)의 파일 변환과 비교 도구. Dashboard는 D1 번들을 읽는다.
 * publish 는 D1에서 재구성한 번들과 파일 번들을 비교한다.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { isDeepStrictEqual } from 'util'
import { OPTIONAL_FILES, REQUIRED_FILES } from './engine.ts'

/** scripts/lineage/run.ts 의 LINEAGE_SOURCE_FILES, sourceDigest 와 같다 */
const LINEAGE_SOURCE_FILES = ['manifest', 'objects', 'relations', 'links', 'observations', 'evidence_links']

export function bundleFromFiles(dir: string, publishedAt: string): Record<string, unknown> {
  const missing = REQUIRED_FILES.filter(f => !fs.existsSync(path.join(dir, `${f}.json`)))
  if (missing.length) throw new Error(`데이터셋 파일이 없다: ${missing.join(', ')}`)
  const bundle: Record<string, any> = { format: 'aegi-measured-bundle/v1', variant: 'v2', published_at: publishedAt }
  for (const f of [...REQUIRED_FILES, ...OPTIONAL_FILES]) {
    const file = path.join(dir, `${f}.json`)
    if (fs.existsSync(file)) bundle[f] = JSON.parse(fs.readFileSync(file, 'utf8'))
  }
  if (!Array.isArray(bundle.objects) || !bundle.objects.length) throw new Error('objects.json 이 비어 있다')
  // 계보는 정규화 결과에서 만든다. 만든 데이터의 지문이 지금 파일과 다르면 예전 데이터의 계보다
  if (bundle.lineage_events) {
    const hash = crypto.createHash('sha256')
    for (const f of LINEAGE_SOURCE_FILES) hash.update(fs.readFileSync(path.join(dir, `${f}.json`)))
    if (bundle.lineage_events.source_sha256 !== hash.digest('hex')) throw new Error('lineage_events.json 이 지금 데이터와 다른 정규화에서 나왔다. npm run lineage 를 다시 돌린다')
  }
  return bundle
}

/** 두 번들이 published_at 말고 같은지. 키 순서까지 본다 */
export function sameBundle(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const strip = ({ published_at: _, ...rest }: Record<string, unknown>) => rest
  return isDeepStrictEqual(Object.keys(a), Object.keys(b)) && isDeepStrictEqual(strip(a), strip(b))
}
