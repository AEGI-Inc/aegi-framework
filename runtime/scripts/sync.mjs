// 세 저장소(engine, dashboard, knowledge)의 고정 커밋을 vendor/ 로 가져오고 대시보드 화면을 vendor/web 으로 빌드한다.
// vendor/ 는 손으로 고치지 않는다. 설치판 전용 코드는 src/ 에만 둔다.
//
//   node scripts/sync.mjs                     옆 폴더 저장소의 origin/main (먼저 fetch)
//   node scripts/sync.mjs --engine <ref> --dashboard <ref> --knowledge <ref>
//   node scripts/sync.mjs --web-only          vendor/dashboard 로 화면만 다시 빌드
//
// patches/*.patch: 원 저장소에 아직 없는 설치판 수정. 가져온 뒤, 화면 빌드 전에 이름 순으로 얹는다.
// 얹지 못하면 멈춘다. 원 저장소에 들어가면 그 패치 파일을 지운다.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const VENDOR = path.join(ROOT, 'vendor')
const WORKSPACE = path.resolve(process.env.AEGI_WORKSPACE ?? path.join(ROOT, '..'))
const args = process.argv.slice(2)
const arg = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

/** 가져올 경로. 문서, 시험 환경 세팅, 시나리오 봇처럼 설치판이 쓰지 않는 것은 뺀다. 원 저장소 시험 파일은 원 저장소 CI 몫이라 가져오지 않는다 */
const EXCLUDE = [':(exclude,glob)**/*.test.*']
const SOURCES = [
  // engine scripts 는 설치판 코드(bin, src), 수집 CLI, 시험이 import 하거나 실행 중에 읽는 폴더만. setup 은 수집 HTTP 가 쓰는 core.ts 하나.
  // env, groundtruth, ops, relationEffects, ontology(스크립트) 등 운영·시험 환경 도구는 받지 않는다
  { name: 'engine', repo: 'aegi-adapter-engine', paths: ['src', ...['accessRules', 'collect', 'compliance', 'cutActions', 'displayText', 'lineage', 'loader', 'standards', 'stream', 'vault', 'setup/core.ts'].map(p => `scripts/${p}`), 'migrations', 'ontology', 'display-text', 'package.json', 'tsconfig.json'] },
  { name: 'dashboard', repo: 'aegi-dashboard-new', paths: ['src', 'server', 'public', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'package.json'] },
  { name: 'knowledge', repo: 'aegi-knowledge', paths: ['schema/im-model/model/v3.2'] },
]

const git = (repo, ...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function exportRepo(source) {
  const repo = path.join(WORKSPACE, source.repo)
  if (!fs.existsSync(path.join(repo, '.git'))) throw new Error(`${repo} 가 없다. AEGI_WORKSPACE 로 세 저장소가 있는 폴더를 준다`)
  const ref = arg(`--${source.name}`) ?? 'origin/main'
  if (ref.startsWith('origin/')) git(repo, 'fetch', '-q', 'origin')
  const commit = git(repo, 'rev-parse', `${ref}^{commit}`)
  const dest = path.join(VENDOR, source.name)
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  // core.autocrlf=true 인 PC 에서는 archive 가 CRLF 로 풀어 LF 인 patches/ 가 얹히지 않는다. 저장소에 든 그대로(LF) 푼다
  const archive = spawnSync('git', ['-C', repo, '-c', 'core.autocrlf=false', 'archive', '--format=tar', commit, '--', ...source.paths, ...EXCLUDE], { maxBuffer: 1 << 30 })
  if (archive.status !== 0) throw new Error(`git archive 실패 (${source.repo}): ${archive.stderr}`)
  const tar = spawnSync('tar', ['-x'], { cwd: dest, input: archive.stdout, maxBuffer: 1 << 30 })
  if (tar.status !== 0) throw new Error(`tar 실패 (${source.repo}): ${tar.stderr}`)
  console.log(`${source.name}: ${source.repo} ${ref} = ${commit.slice(0, 12)}`)
  return { repo: `AEGI-Inc/${source.repo}`, ref, commit, paths: source.paths }
}

function applyPatches() {
  const dir = path.join(ROOT, 'patches')
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.patch')).sort()) {
    const r = spawnSync('git', ['apply', '--whitespace=nowarn', path.join(dir, f)], { cwd: ROOT, encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`패치 ${f} 를 얹지 못했다. 원 저장소가 바뀌었으면 패치를 다시 만든다:
${r.stderr}`)
    console.log(`patch: ${f}`)
  }
}

function buildWeb() {
  const out = path.join(VENDOR, 'web')
  fs.rmSync(out, { recursive: true, force: true })
  // 대시보드 vite.config.ts 를 그대로 쓴다. 빌드에서는 실측 파일 플러그인이 꺼지고 화면은 /api/measured/* 를 읽는다.
  // VITE_AEGI_COLLECTOR_STATUS=on: 화면이 설치판 서버의 /__aegi/collector-status(자격증명 준비 상태)를 읽는다
  // VITE_AEGI_LOCAL=on: 로컬 설치판. 운영(dash.aegi.site)과 같은 메뉴를 그리고 로컬 서버 기능(설정 카드, 다시 확인, 빈 데이터셋, 샘플)만 켠다.
  //   이 플래그는 patches/0001-dashboard-local-install.patch 가 넣는다. 공개 데모용 VITE_AEGI_DEMO, VITE_AEGI_PUBLIC_DEMO 는 켜지 않는다
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
  if (!fs.existsSync(vite)) throw new Error('vite 가 없다. 먼저 npm install')
  const env = { ...process.env, VITE_AEGI_COLLECTOR_STATUS: 'on', VITE_AEGI_LOCAL: 'on', VITE_AEGI_DEMO: '', VITE_AEGI_PUBLIC_DEMO: '' }
  const r = spawnSync(process.execPath, [vite, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'warn'], { cwd: path.join(VENDOR, 'dashboard'), stdio: 'inherit', env })
  if (r.status !== 0) throw new Error('화면 빌드 실패')
  fs.rmSync(path.join(VENDOR, 'dashboard', '.vite'), { recursive: true, force: true })
  console.log(`web: ${path.relative(ROOT, out)}`)
}

if (args.includes('--web-only')) {
  buildWeb()
} else {
  const versions = { synced_at: new Date().toISOString(), sources: {} }
  for (const s of SOURCES) versions.sources[s.name] = exportRepo(s)
  applyPatches()
  buildWeb()
  fs.writeFileSync(path.join(VENDOR, 'VERSIONS.json'), JSON.stringify(versions, null, 2) + '\n')
}
