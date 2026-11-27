/**
 * 수집 결과 저장 (계획서 7.1·7.2절). 전부 collected/ 아래, git 제외.
 *
 *   raw/<run_id>/<provider>/<call_id>-<page>.json   응답 한 페이지 = 파일 하나 (봉투 + 정리된 payload)
 *   runs/<run_id>.json                              실행 기록 (호출마다 한 행)
 *   cursors.json                                    로그 스트림별 커서
 *   labels/correlation.json                         정답 라벨 (D-12)
 *
 * dir 가 null 이면 메모리에만 둔다 (테스트).
 */
import fs from 'fs'
import path from 'path'
import type { LabelHit, SanitizeStats } from './sanitize'

export type Provider = 'github' | 'okta' | 'slack' | 'gws' | 'salesforce' | 'atlassian' | 'worker' | 'aws' | 'gcp' | 'microsoft' | 'onepassword' | 'snowflake'
export type Completeness = 'full' | 'partial' | 'best_effort' | 'failed' | 'skipped'

export interface Envelope {
  provider: Provider
  call_id: string
  page: number
  method: string
  /** 쿼리까지 포함한 호출 주소. 인증 정보는 URL 에 싣지 않는다 */
  endpoint: string
  request_params: Record<string, unknown>
  collected_at: string
  http_status: number
  /** 정리 전 응답 본문의 sha256 (무결성 확인용. 되돌릴 수 없다) */
  response_sha256: string
  /** 저장한 payload(JSON 직렬화)의 sha256 */
  payload_sha256: string
  collector_version: string
  /** 자격증명 ID 만 (CRED-GH-01 등) */
  credential_ref: string
  sanitization: SanitizeStats
  /**
   * 수집 API 목록 호출(scripts/collect/api-list)이 실행한 IR operation. 손으로 쓴 호출에는 없다.
   * 정규화기는 이 값과 엔드포인트가 맞을 때만 Profile binding 의 operation 으로 이 페이지를 읽는다
   */
  operation?: EnvelopeOperation
  payload: unknown
}

export interface EnvelopeOperation {
  /** IR operation ID (예: op:okta_management_openapi:listUsers) */
  id: string
  /** 호출 주소를 만든 경로 템플릿 (호스트 제외, 예: /api/v1/users/{userId}/factors) */
  path_template: string
  /** 수집 API 목록 항목 ID */
  registry_id: string
}

export interface CallRecord {
  run_id: string
  call_id: string
  provider: Provider
  title: string
  started_at: string
  finished_at?: string
  http_status?: number
  pages: number
  record_count: number
  next_cursor?: string | null
  rate_limit_remaining?: number | null
  error_code?: string | null
  completeness: Completeness
  /** partial·failed·skipped 의 사유 (예: bot_not_member, scope_not_granted) */
  reasons: string[]
  /** 404 처럼 기록만 하고 넘어간 것 */
  notes: string[]
  /** 응답 헤더(Deprecation·Sunset·Warning·버전 불일치)와 Slack warnings 기록 */
  api_warnings?: string[]
}

export interface RunRecord {
  run_id: string
  collector_version: string
  started_at: string
  finished_at?: string
  args: Record<string, unknown>
  period: { since: string; until: string }
  calls: CallRecord[]
}

export interface CursorState {
  cursor: string | null
  last_success_at: string
  last_event_at: string | null
}

export interface LabelEntry extends LabelHit {
  run_id: string
  provider: Provider
  call_id: string
  file: string
}

export class CollectStore {
  /** 메모리 모드에서 쓴 파일 (테스트가 들여다본다) */
  memory = new Map<string, string>()
  private pageCounters = new Map<string, number>()

  constructor(public dir: string | null, public runId: string) {}

  private write(rel: string, data: unknown): string {
    const text = JSON.stringify(data, null, 2) + '\n'
    if (!this.dir) {
      this.memory.set(rel, text)
      return rel
    }
    const file = path.join(this.dir, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text)
    return rel
  }

  private read<T>(rel: string, fallback: T): T {
    if (!this.dir) return this.memory.has(rel) ? (JSON.parse(this.memory.get(rel)!) as T) : fallback
    const file = path.join(this.dir, rel)
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : fallback
  }

  nextPage(provider: Provider, callId: string): number {
    const key = `${provider}/${callId}`
    const n = (this.pageCounters.get(key) ?? 0) + 1
    this.pageCounters.set(key, n)
    return n
  }

  writeRaw(env: Envelope): string {
    const name = `${env.call_id}-${String(env.page).padStart(4, '0')}.json`
    return this.write(path.posix.join('raw', this.runId, env.provider, name), env)
  }

  writeRun(run: RunRecord): void {
    this.write(path.posix.join('runs', `${run.run_id}.json`), run)
  }

  readCursors(): Record<string, CursorState> {
    return this.read('cursors.json', {} as Record<string, CursorState>)
  }

  writeCursors(cursors: Record<string, CursorState>): void {
    this.write('cursors.json', cursors)
  }

  /** 라벨은 실행이 거듭돼도 쌓는다. 같은 (상관 ID, 파일, 경로) 는 한 번만 */
  appendLabels(entries: LabelEntry[]): void {
    if (!entries.length) return
    const rel = path.posix.join('labels', 'correlation.json')
    const existing = this.read<{ entries: LabelEntry[] }>(rel, { entries: [] })
    const seen = new Set(existing.entries.map(e => `${e.correlation_id}|${e.file}|${e.json_path}`))
    for (const e of entries) {
      const key = `${e.correlation_id}|${e.file}|${e.json_path}`
      if (!seen.has(key)) {
        existing.entries.push(e)
        seen.add(key)
      }
    }
    this.write(rel, existing)
  }
}
