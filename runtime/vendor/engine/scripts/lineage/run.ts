/**
 * 데이터셋 폴더에서 계보(OpenLineage 이벤트)를 만들어 lineage_events.json 에 쓴다. 설계: docs/spec/AEGI_LINEAGE_V1.md
 *
 *   npm run lineage                                    실측 v2 (src/data/aegi_inc_measured_v2)
 *   npm run lineage -- --dataset <폴더>                다른 데이터셋
 *   npm run lineage -- --ndjson <파일>                 이벤트를 한 줄에 하나씩 따로 내보낸다 (Marquez 같은 도구용)
 *   npm run lineage -- --check                         파일은 쓰지 않고 공식 스키마 검사와 요약만
 *
 * IM Profile 정규화(normalize)가 끝에 같은 일을 한다. 이미 정규화된 폴더에 계보만 다시 붙일 때 쓴다.
 * 공식 스키마 검사에서 문제가 하나라도 나오면 쓰지 않고 종료 코드 1 이다.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { lineageFromDataset } from '../../src/lineage/build'
import { EVIDENCE_LABELS, isRunEvent, type LineageFile } from '../../src/lineage/types'
import { validateLineageEvents } from './validate'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const LINEAGE_FILE = 'lineage_events.json'

const readJson = (dir: string, name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))

/** 계보를 만드는 데 쓰는 데이터 파일. scripts/loader/kv.ts 의 LINEAGE_SOURCE_FILES 와 같아야 한다 */
export const LINEAGE_SOURCE_FILES = ['manifest', 'objects', 'relations', 'links', 'observations', 'evidence_links']
export const sourceDigest = (dir: string) => {
  const hash = crypto.createHash('sha256')
  for (const f of LINEAGE_SOURCE_FILES) hash.update(fs.readFileSync(path.join(dir, `${f}.json`)))
  return hash.digest('hex')
}

export function lineageForDir(dir: string): LineageFile {
  const file = lineageFromDataset({
    manifest: readJson(dir, 'manifest.json'),
    objects: readJson(dir, 'objects.json'),
    relations: readJson(dir, 'relations.json'),
    links: readJson(dir, 'links.json'),
    observations: readJson(dir, 'observations.json'),
    evidence_links: readJson(dir, 'evidence_links.json'),
  })
  return { ...file, source_sha256: sourceDigest(dir) }
}

/** 정규화 실행기가 부른다. 스키마 문제가 있으면 예외. 예전 파일은 먼저 지워, 실패해도 새 데이터 옆에 예전 계보가 남지 않는다 */
export function writeLineage(dir: string, opts: { ndjson?: string; check?: boolean } = {}): LineageFile {
  if (!opts.check) fs.rmSync(path.join(dir, LINEAGE_FILE), { force: true })
  const file = lineageForDir(dir)
  const problems = validateLineageEvents(file.events)
  const levels = Object.entries(file.counts.byLevel).map(([k, v]) => `${EVIDENCE_LABELS[k as keyof typeof EVIDENCE_LABELS]} ${v}`).join(', ')
  console.log(`[lineage] Run ${file.counts.runs}개, 정적 Job ${file.counts.jobs}개, 데이터 ${file.counts.datasets}개 (${levels})`)
  for (const e of file.events) {
    const level = isRunEvent(e) ? e.run.facets.aegi_evidence.level : e.job.facets?.aegi_evidence?.level
    const fields = e.outputs.flatMap(d => Object.keys(d.facets?.columnLineage?.fields ?? {}))
    console.log(`  ${isRunEvent(e) ? 'Run' : 'Job'} ${EVIDENCE_LABELS[level!]}: ${e.inputs.map(d => d.name).join(', ') || '(입력 모름)'} → ${e.job.name} → ${e.outputs.map(d => d.name).join(', ') || '(출력 없음)'}${fields.length ? ` [필드 ${fields.length}개]` : ''}`)
  }
  if (problems.length) {
    for (const p of problems.slice(0, 20)) console.error(`  스키마 문제: 이벤트 ${p.index} ${p.where} ${p.message}`)
    throw new Error(`OpenLineage 공식 스키마 검사에서 문제 ${problems.length}건`)
  }
  console.log('[lineage] OpenLineage 2-0-2 공식 스키마 검사 통과')
  if (opts.check) return file
  fs.writeFileSync(path.join(dir, LINEAGE_FILE), JSON.stringify(file, null, 2) + '\n')
  if (opts.ndjson) fs.writeFileSync(opts.ndjson, file.events.map(e => JSON.stringify(e)).join('\n') + '\n')
  console.log(`[lineage] 썼다: ${path.relative(ROOT, path.join(dir, LINEAGE_FILE))}${opts.ndjson ? `, ${opts.ndjson}` : ''}`)
  return file
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const arg = (name: string) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  try {
    const dir = path.resolve(ROOT, arg('--dataset') ?? 'src/data/aegi_inc_measured_v2')
    if (!fs.existsSync(path.join(dir, 'objects.json'))) throw new Error(`${path.relative(ROOT, dir)} 에 데이터셋이 없다`)
    const ndjson = arg('--ndjson')
    writeLineage(dir, { ndjson: ndjson ? path.resolve(ndjson) : undefined, check: args.includes('--check') })
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}
