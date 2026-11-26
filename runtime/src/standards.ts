/**
 * 기준별 설정 판정(Config Findings). 엔진 scripts/standards 의 Python 판정기를 수집 원본에 돌리고,
 * 결과를 운영과 같은 standard_runs 이력에 넣어 standard_head 를 옮긴다(엔진 history.ts 그대로).
 * Python 3 표준 라이브러리만 쓴다. Python 이 없거나 결과 파일을 만들지 못하면 그래프 게시는 그대로 두고 이 단계만 건너뛴다.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { LocalDb } from './db.ts'
import { DATA_DIR, ENGINE_DIR } from './paths.ts'
import { publishAssessment } from '../engine/scripts/standards/history.ts'

const RUN_ALL = path.join(ENGINE_DIR, 'scripts', 'standards', 'run_all.py')

/** 쓸 수 있는 Python 3. AEGI_PYTHON 이 있으면 그것만 본다 */
export function findPython(env: Record<string, string | undefined> = process.env): string | null {
  const candidates = env.AEGI_PYTHON ? [env.AEGI_PYTHON] : process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
  for (const c of candidates) {
    const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8' })
    if (r.status === 0 && r.stdout.trim() === '3') return c
  }
  return null
}

export type StandardsResult = { state: 'published'; id: string; standards: number; findings: number } | { state: 'skipped'; reason: string }
type RunAll = (python: string, args: string[], options: { encoding: 'utf8'; env: NodeJS.ProcessEnv }) => { status: number | null; stdout?: string | null }
export type JudgeStandardsOptions = { /** 테스트에서 Python 실행을 대체한다. */ python?: string | null; run?: RunAll }

/** 엔진이 standard_results.json 에 남긴 실패 판정기 이름. 옛 vendor 결과에는 이 칸이 없다 */
export function failedDetectors(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { failed_detectors?: unknown }).failed_detectors)) return []
  return (value as { failed_detectors: unknown[] }).failed_detectors.filter((d): d is string => typeof d === 'string' && d.length > 0)
}

/** rawDir 는 runs/, raw/ 가 든 수집 폴더, datasetDir 는 정규화 결과, snapshotId 는 판정에 쓴 그래프 */
export async function judgeStandards(local: LocalDb, rawDir: string, runId: string, datasetDir: string, snapshotId: string | null, log: (line: string) => void, options?: JudgeStandardsOptions): Promise<StandardsResult> {
  const python = options?.python === undefined ? findPython() : options.python
  if (!python) return { state: 'skipped', reason: 'Python 3 이 없다 (설치하거나 AEGI_PYTHON 으로 경로를 준다)' }
  const out = path.join(DATA_DIR, 'standards', runId)
  fs.rmSync(out, { recursive: true, force: true })
  const r = (options?.run ?? spawnSync)(python, [RUN_ALL, '--raw', path.join(rawDir, 'raw', runId), '--dataset', datasetDir, '--out', out], {
    encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
  })
  const file = path.join(out, 'standard_results.json')
  // run_all 은 판정기 일부가 실패하면 0 이 아닌 코드로 끝나지만 성공분은 묶어 둔다. 묶음이 없을 때만 건너뛴다
  if (!fs.existsSync(file)) {
    const stdout = typeof r.stdout === 'string' ? r.stdout : ''
    const failed = stdout.split('\n').filter(l => /\bFAIL\b/.test(l)).map(l => l.trim().split(/\s+/)[0])
    return { state: 'skipped', reason: `판정기 실패${failed.length ? ` (${failed.join(', ')})` : ''}` }
  }
  const value = JSON.parse(fs.readFileSync(file, 'utf8'))
  const failed = failedDetectors(value)
  const published = await publishAssessment(local.exec, value, snapshotId)
  if (failed.length) log(`기준별 판정 일부 실패: ${failed.join(', ')}`)
  log(`기준별 판정: 기준 ${published.standards}, finding ${published.findings}`)
  return { state: 'published', id: published.id, standards: published.standards, findings: published.findings }
}
