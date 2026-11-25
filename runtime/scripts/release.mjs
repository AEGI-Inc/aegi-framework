// 배포 zip 을 만든다. 받는 쪽은 Node 22.13 이상만 있으면 되고 npm install 이 필요 없다.
//
//   node scripts/release.mjs            release/aegi-solution-<버전>/ 와 같은 이름의 .zip
//   node scripts/release.mjs --no-zip   폴더만
//
// 묶는 방법: esbuild 가 bin/aegi.ts(서버, 판정, 정규화)와 엔진 수집 CLI 를 각각 한 파일로 묶는다.
// vendor 코드는 import.meta 로 자기 위치를 찾아 데이터 파일(Profile, 마이그레이션, IM 모델)을 읽으므로,
// 그 자리를 배포 폴더 안의 원래 경로로 바꿔 넣고 vendor 의 데이터 파일만 같은 경로로 함께 싣는다(ENGINE_DATA).
// 정규화기가 실행 중에 불러오는 TS(tsImport)는 정적 import 로 바꿔 함께 묶는다.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const NAME = `aegi-solution-${pkg.version}`
const OUT = path.join(ROOT, 'release', NAME)

/** 이 저장소 안의 파일이 배포 폴더에서 놓일 상대 경로(같다) */
const rel = file => path.relative(ROOT, file).replace(/\\/g, '/')

const relocate = {
  name: 'aegi-relocate',
  setup(build) {
    build.onLoad({ filter: /\.(ts|mts|mjs|js)$/ }, async args => {
      if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined
      let text = await fs.promises.readFile(args.path, 'utf8')
      // tsx 로 실행 중에 불러오던 TS 를 정적 import 로 (esbuild 가 함께 묶는다)
      text = text.replace(/await import\('tsx\/esm\/api'\)/g, '({ tsImport: null })')
      text = text.replace(/\btsImport\(\s*('[^']+'|"[^"]+")\s*,\s*import\.meta\.url\s*\)/g, 'import($1)')
      const file = rel(args.path), dir = rel(path.dirname(args.path))
      text = text
        .replace(/\bimport\.meta\.dirname\b/g, `__aegiPath(${JSON.stringify(dir)})`)
        .replace(/\bimport\.meta\.filename\b/g, `__aegiPath(${JSON.stringify(file)})`)
        .replace(/\bimport\.meta\.url\b/g, `__aegiUrl(${JSON.stringify(file)})`)
      const loader = args.path.endsWith('.ts') || args.path.endsWith('.mts') ? 'ts' : 'js'
      return { contents: text, loader, resolveDir: path.dirname(args.path) }
    })
  },
}

// 배포 폴더 맨 위(AEGI_HOME)를 묶음 파일 위치(dist/)에서 찾는다. CJS 의존성(typescript 등)을 위해 require 도 만든다
const banner = `import { createRequire as __aegiRequire } from 'node:module';
import { fileURLToPath as __aegiF, pathToFileURL as __aegiP } from 'node:url';
import __aegiNodePath from 'node:path';
const require = __aegiRequire(import.meta.url);
const __filename = __aegiF(import.meta.url);
const __dirname = __aegiNodePath.dirname(__filename);
const __AEGI_HOME = process.env.AEGI_HOME || __aegiNodePath.resolve(__aegiNodePath.dirname(__aegiF(import.meta.url)), '..');
process.env.AEGI_HOME = __AEGI_HOME;
const __aegiPath = r => __aegiNodePath.join(__AEGI_HOME, r);
const __aegiUrl = r => __aegiP(__aegiNodePath.join(__AEGI_HOME, r)).href;`

async function bundle(entry, outfile, extraBanner = '') {
  await esbuild.build({
    entryPoints: [path.join(ROOT, entry)], outfile: path.join(OUT, outfile), bundle: true, platform: 'node', format: 'esm', target: 'node22',
    plugins: [relocate], banner: { js: `${banner}\n${extraBanner}` }, logLevel: 'warning', legalComments: 'none',
  })
}

function copy(from, to = from, filter = () => true) {
  fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true, filter: src => fs.statSync(src).isDirectory() || filter(rel(src)) })
}

/**
 * 엔진에서 실행 중에 읽는 파일. 코드는 dist/ 에 묶였으므로 엔진 전체(약 39MB)를 싣지 않는다.
 * 읽는 곳: src/db.ts(migrations), collect/shared/crosswalk.ts·accessRules/executor.ts(ontology),
 * profile-binding/runner/normalize.mjs·options.mjs(runtime-config.json, profiles, overlays), providers/apiList.ts(api-list.jsonl),
 * lineage/validate.ts(schema), src/standards.ts(standards 의 *.py 와 defs), src/server.ts(compliance/checks.py)
 */
const ENGINE_DATA = [
  ['migrations'], ['ontology'],
  ['scripts/collect/profile-binding/runtime-config.json'], ['scripts/collect/profile-binding/profiles'], ['scripts/collect/profile-binding/overlays'],
  ['scripts/collect/api-list/api-list.jsonl'],
  ['scripts/lineage/schema'],
  ['scripts/standards', f => f.endsWith('.py') || f.includes('/defs/')],
  ['scripts/compliance', f => f.endsWith('.py') && !path.basename(f).startsWith('test_')],
]
/**
 * 판정 코드 지문(loader/engine.ts engineSha256)이 읽는 원본: src 의 .ts·.tsx 와 src/data 밖의 .json, engine.ts, EA_CODE_FILES.
 * 스냅샷 id 에 들어가므로 저장소 실행과 같은 값이 나오게 싣는다. 아래 fingerprint 검사가 같은지 본다
 */
const ENGINE_FINGERPRINT = [
  ['src', f => /\.(ts|tsx)$/.test(f) || (f.endsWith('.json') && !f.startsWith('vendor/engine/src/data/'))],
  ['scripts/loader/engine.ts'],
  ['scripts/accessRules/production.ts'], ['scripts/accessRules/executor.ts'],
  // 화면 설명 문구 정본: composeDisplayText 가 실행 중에 읽고 engineSha256 이 지문에 넣는다
  ['display-text', f => /\.(yaml|md|json)$/.test(f)],
  ['scripts/collect/shared/match.ts'], ['scripts/loader/fromCurrent.ts'],
]

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

await bundle('bin/aegi.ts', 'dist/aegi.mjs')
// 수집 CLI 는 자기가 직접 실행됐는지 argv[1] 로 본다. 묶음에서는 원래 경로를 가리키게 둔다
await bundle('vendor/engine/scripts/collect/run.ts', 'dist/collect.mjs', `process.argv[1] = __aegiPath('vendor/engine/scripts/collect/run.ts');`)

// 실행 중에 읽는 데이터: 엔진 데이터와 코드 지문용 원본, IM 모델, 대시보드 마이그레이션, 화면
for (const [p, filter] of [...ENGINE_DATA, ...ENGINE_FINGERPRINT]) copy(`vendor/engine/${p}`, undefined, filter)
copy('vendor/knowledge')
copy('vendor/dashboard/server/migrations')
copy('vendor/web')
copy('vendor/VERSIONS.json')
copy('sample')
for (const doc of ['docs/saas-collection-guide.md', 'docs/saas-collection-summary.md', 'docs/saas-adapter-scopes.md', 'docs/saas-adapter-guide.html']) {
  if (fs.existsSync(path.join(ROOT, doc))) copy(doc)
}
for (const f of ['.env.example', 'splunk.sources.example.json', 'README.md', 'start.cmd', 'start.sh', 'collect.cmd', 'collect.sh']) if (fs.existsSync(path.join(ROOT, f))) copy(f)
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'aegi-solution', version: pkg.version, private: true, type: 'module', engines: pkg.engines,
  scripts: { start: 'node dist/aegi.mjs start', aegi: 'node dist/aegi.mjs' } }, null, 2) + '\n')

// 실은 원본으로 낸 코드 지문이 vendor 전체로 낸 것과 같은지 본다(빠진 파일이 있으면 스냅샷 id 가 달라진다)
const fingerprint = root => spawnSync(process.execPath, ['--import', 'tsx', '-e',
  `import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'vendor/engine/scripts/loader/engine.ts')).href)}).then(m => console.log(m.engineSha256(${JSON.stringify(root)})))`],
{ cwd: ROOT, encoding: 'utf8' })
const [full, shipped] = [path.join(ROOT, 'vendor', 'engine'), path.join(OUT, 'vendor', 'engine')].map(fingerprint)
if (full.status !== 0 || shipped.status !== 0 || full.stdout.trim() !== shipped.stdout.trim()) {
  console.error(full.stderr, shipped.stderr)
  throw new Error(`코드 지문이 다르다: vendor ${full.stdout.trim()} / 배포 ${shipped.stdout.trim()}`)
}

// 묶음이 뜨는지 확인한다(데이터 폴더는 임시로)
const tmp = fs.mkdtempSync(path.join(OUT, '..', '.check-'))
const check = spawnSync(process.execPath, [path.join(OUT, 'dist', 'aegi.mjs'), 'doctor'], { encoding: 'utf8', env: { ...process.env, AEGI_HOME: '', AEGI_DATA_DIR: tmp, AEGI_ENV_FILE: path.join(tmp, '.env') } })
fs.rmSync(tmp, { recursive: true, force: true })
if (check.status !== 0) { console.error(check.stdout, check.stderr); throw new Error('묶음 점검(doctor)이 실패했다') }

const size = dir => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).reduce((n, d) => n + fs.statSync(path.join(d.parentPath, d.name)).size, 0)
console.log(`폴더: ${rel(OUT)} (${(size(OUT) / 1e6).toFixed(1)}MB)`)

if (!process.argv.includes('--no-zip')) {
  const zip = `${OUT}.zip`
  fs.rmSync(zip, { force: true })
  const r = process.platform === 'win32'
    // Compress-Archive 는 다른 프로그램이 막 복사한 파일을 읽는 중이면 접근 거부로 멈춘다. Windows 10 이상 기본 tar(bsdtar)로 만든다
    ? spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, NAME], { cwd: path.dirname(OUT), stdio: 'inherit' })
    : spawnSync('zip', ['-qr', zip, NAME], { cwd: path.dirname(OUT), stdio: 'inherit' })
  if (r.status !== 0) throw new Error('zip 실패')
  console.log(`zip: ${rel(zip)} (${(fs.statSync(zip).size / 1e6).toFixed(1)}MB)`)
}
