/**
 * 정규화 입력: collected/ 의 원본만 읽는다 (계획서 2절 원칙 2 — 같은 원본이면 같은 결과).
 *
 * - 상태 호출(목록·상세): 그 호출이 full·partial 로 끝난 **가장 최근 실행**의 페이지만 쓴다.
 *   예전 실행의 페이지를 섞으면 지금은 없는 객체가 되살아난다.
 * - 로그 스트림(감사 로그·System Log·Worker D1 로그): **모든 실행**의 페이지를 쓴다. 행 중복은 정규화기가 id 로 거른다.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Envelope, Provider, RunRecord } from '../lib/store'

export const STREAM_CALLS = new Set(['GH-17', 'GH-19', 'OK-12', 'SL-11', 'GW-10', 'SL-12', 'GH-18', 'D-21'])

export interface RawRun {
  record: RunRecord
  pages: Envelope[]
}

export function loadRawRun(root: string, runId: string): RawRun {
  const record = JSON.parse(fs.readFileSync(path.join(root, 'runs', `${runId}.json`), 'utf8')) as RunRecord
  const pages: Envelope[] = []
  const rawDir = path.join(root, 'raw', record.run_id)
  if (fs.existsSync(rawDir)) {
    for (const provider of fs.readdirSync(rawDir)) {
      const dir = path.join(rawDir, provider)
      if (!fs.statSync(dir).isDirectory()) continue
      for (const file of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
        pages.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Envelope)
      }
    }
  }
  return { record, pages }
}

export class RawSet {
  constructor(public runs: RawRun[]) {
    this.runs.sort((a, b) => a.record.run_id.localeCompare(b.record.run_id))
  }

  static load(root: string): RawSet {
    const runsDir = path.join(root, 'runs')
    if (!fs.existsSync(runsDir)) return new RawSet([])
    const runs: RawRun[] = []
    for (const f of fs.readdirSync(runsDir).filter(f => f.endsWith('.json'))) {
      runs.push(loadRawRun(root, f.slice(0, -5)))
    }
    return new RawSet(runs)
  }

  /** 이 호출이 쓸 만하게 끝난 가장 최근 실행 */
  private latestRun(provider: Provider, callId: string): RawRun | undefined {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const call = this.runs[i].record.calls.find(c => c.provider === provider && c.call_id === callId)
      if (call && (call.completeness === 'full' || call.completeness === 'partial')) return this.runs[i]
    }
    return undefined
  }

  /** 실행마다 (provider, 호출 ID) → 페이지. 호출마다 전체 페이지를 거르지 않게 처음 부를 때 한 번 묶는다 */
  private byCall?: Map<RawRun, Map<string, Envelope[]>>
  private pagesIn(run: RawRun, provider: Provider, callId: string): Envelope[] {
    this.byCall ??= new Map()
    let m = this.byCall.get(run)
    if (!m) {
      m = new Map()
      for (const e of run.pages) { const k = `${e.provider}\0${e.call_id}`; if (!m.has(k)) m.set(k, []); m.get(k)!.push(e) }
      this.byCall.set(run, m)
    }
    return m.get(`${provider}\0${callId}`) ?? []
  }

  /** 호출의 원본 페이지. 로그 스트림은 모든 실행, 그 밖은 최근 실행 하나 */
  pages(provider: Provider, callId: string): Envelope[] {
    if (STREAM_CALLS.has(callId)) return this.runs.flatMap(r => this.pagesIn(r, provider, callId))
    const run = this.latestRun(provider, callId)
    return run ? [...this.pagesIn(run, provider, callId)] : []
  }

  /** 호출의 완결성 (최근 실행 기준). 한 번도 성공하지 않았으면 가장 최근 기록, 기록이 없으면 null */
  status(provider: Provider, callId: string): { completeness: string; reasons: string[]; run_id: string } | null {
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const call = this.runs[i].record.calls.find(c => c.provider === provider && c.call_id === callId)
      if (call && (call.completeness === 'full' || call.completeness === 'partial')) return { completeness: call.completeness, reasons: call.reasons, run_id: call.run_id }
    }
    for (let i = this.runs.length - 1; i >= 0; i--) {
      const call = this.runs[i].record.calls.find(c => c.provider === provider && c.call_id === callId)
      if (call) return { completeness: call.completeness, reasons: call.reasons, run_id: call.run_id }
    }
    return null
  }

  runIds(): string[] {
    return this.runs.map(r => r.record.run_id)
  }
}

/** 페이지의 항목 배열. 배열 payload 면 그대로, 아니면 key 의 배열 */
export function itemsOf(env: Envelope, key?: string): any[] {
  const p = env.payload as any
  if (Array.isArray(p)) return p
  if (key && Array.isArray(p?.[key])) return p[key]
  return []
}
