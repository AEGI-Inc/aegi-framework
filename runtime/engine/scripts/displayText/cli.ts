/**
 * 화면 설명 문구: 빈 것 보기, AI 로 채우기, 검토 초안 뽑기, 데이터셋에 문서 쓰기.
 *
 *   npm run display-text -- --dataset <폴더>                       빈 것만 본다(네트워크 없음)
 *   npm run display-text -- --dataset <폴더> --generate [--limit 200] 빈 것을 AI 로 만들어 .cache/display-text.json 에 넣는다
 *   npm run display-text -- --review-out <폴더>                     캐시의 생성분을 검토용 YAML 로 쓴다
 *   npm run display-text -- --dataset <폴더> --write                합친 문서를 <폴더>/display_text.json 으로 쓴다
 *
 * AI 설정은 이 저장소의 .env.local(없으면 환경 변수)의 AEGI_DISPLAY_TEXT_*, 없으면 AEGI_ASSISTANT_* 다(model.ts).
 */
import fs from 'fs'
import path from 'path'
import { parseEnvFile } from '../collect/config.ts'
import { readDatasetFiles } from '../loader/engine.ts'
import { composeDisplayText } from './compose.ts'
import { CACHE_FILE, ROOT, loadCanonical, readCache, writeCache, writeReviewDrafts } from './files.ts'
import { generateMissing, planMissing } from './generate.ts'
import { createModelClient, modelSettings } from './model.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

async function main() {
  const datasetArg = arg('dataset')
  const reviewOut = arg('review-out')
  if (!datasetArg && !reviewOut) throw new Error('--dataset <폴더> 나 --review-out <폴더> 가 필요하다')
  const cache = readCache()

  if (reviewOut) {
    const written = writeReviewDrafts(cache, path.resolve(reviewOut))
    console.log(`검토 초안 ${written.length}개: ${path.resolve(reviewOut)}`)
    if (!datasetArg) return
  }

  const dir = path.resolve(datasetArg!)
  const files = readDatasetFiles(dir)
  const canonical = loadCanonical()
  let doc = composeDisplayText(files.objects, canonical, cache)
  const plan = planMissing(files, doc, canonical)
  console.log(`데이터셋 ${path.relative(ROOT, dir) || dir}`)
  console.log(`  SaaS 설명 빈 것: ${plan.providers.map(p => p.subject).join(', ') || '없음'}`)
  console.log(`  객체 종류 설명 ${Object.keys(doc.types).length}/${Object.keys(doc.types).length + plan.types.length}, 빈 것 ${plan.types.length}`)

  if (flag('generate')) {
    const env = { ...process.env, ...parseEnvFile(fs.existsSync(path.join(ROOT, '.env.local')) ? fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8') : '') }
    const settings = modelSettings(env)
    const limit = Number(arg('limit') ?? 200)
    console.log(`AI 생성: ${settings.kind} ${settings.model}, 한도 ${limit}`)
    const result = await generateMissing(plan, cache, createModelClient(settings), { limit, log: line => console.log(`  ${line}`) })
    writeCache(cache)
    console.log(`만듦 ${result.added.length}, 실패 ${result.failed.length}, 다음으로 미룸 ${result.deferred.length}. 캐시 ${path.relative(ROOT, CACHE_FILE)}`)
    doc = composeDisplayText(files.objects, canonical, cache)
    if (result.failed.length) process.exitCode = 1
  }

  if (flag('write')) {
    const out = path.join(dir, 'display_text.json')
    fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n')
    console.log(`썼다: ${out}`)
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
