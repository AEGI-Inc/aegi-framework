/**
 * 실측 환경 세팅 자동화의 공통 부분.
 *
 * 작업(Task) 하나는 "확인(plan) → 필요하면 적용(apply) → 다시 확인" 을 한다.
 * - plan 은 조회(GET)만 한다. 이미 되어 있으면 done, 할 일이 있으면 todo,
 *   선행 작업·수동 단계가 안 끝났으면 blocked, 자격증명이 없으면 skipped.
 * - apply 는 --apply 를 줬을 때만 부른다. 다시 돌려도 같은 결과가 나오도록(멱등) 만든다.
 * - 드라이런에서 쓰기 요청이 나가면 HttpClient 가 막는다 (코드 실수로 바뀌는 일을 막는 안전장치).
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export type Saas = 'gws' | 'okta' | 'github' | 'slack' | 'atlassian' | 'salesforce'
export type PlanStatus = 'done' | 'todo' | 'blocked' | 'skipped'

export interface Plan {
  status: PlanStatus
  detail: string
}

export interface Task {
  id: string
  saas: Saas
  title: string
  /** 세팅 가이드의 절 (예: "1.1") */
  guide: string
  plan(): Promise<Plan>
  apply(): Promise<string>
}

export interface ManualStep {
  id: string
  saas: Saas | 'cloudflare'
  title: string
  guide: string
  /** API 로 못 하는 이유 */
  why: string
  /** 사람이 할 일 */
  how: string
}

export const done = (detail: string): Plan => ({ status: 'done', detail })
export const todo = (detail: string): Plan => ({ status: 'todo', detail })
export const blocked = (detail: string): Plan => ({ status: 'blocked', detail })
export const skipped = (detail: string): Plan => ({ status: 'skipped', detail })

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface HttpRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

/** 실제 네트워크 대신 가짜 서버를 끼울 수 있게 전송 계층을 분리한다 (테스트용). */
export type Transport = (req: HttpRequest) => Promise<HttpResponse>

export const fetchTransport: Transport = async req => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body })
  const headers: Record<string, string> = {}
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
  const text = await res.text()
  let body: unknown = text
  try { body = text ? JSON.parse(text) : null } catch { /* 본문이 JSON 이 아니면 문자열 그대로 */ }
  return { status: res.status, headers, body }
}

export class HttpError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message)
  }
}

export class DryRunWriteError extends Error {}

const SECRET_PATTERNS = [/xox[abposr]-[A-Za-z0-9-]+/g, /SSWS [A-Za-z0-9_-]+/g, /Bearer [A-Za-z0-9._-]+/g, /hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g]

/** 로그·오류 메시지에 토큰이 새지 않게 가린다. */
export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((t, re) => t.replace(re, '[REDACTED]'), text)
}

export interface HttpClientOptions {
  name: string
  baseUrl: string
  auth: () => Promise<Record<string, string>>
  transport: Transport
  dryRun: boolean
  /** 429 재시도 대기 배수 (테스트에서는 0) */
  retryDelayMs?: number
  extraHeaders?: Record<string, string>
}

type Query = Record<string, string | number | boolean | undefined>

export class HttpClient {
  /** 이번 실행에서 나간 쓰기 요청 수 (테스트가 멱등성을 확인할 때 쓴다) */
  writes = 0

  constructor(private opts: HttpClientOptions) {}

  get dryRun(): boolean {
    return this.opts.dryRun
  }

  url(pathOrUrl: string, query?: Query): string {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : this.opts.baseUrl.replace(/\/$/, '') + pathOrUrl)
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v))
    return url.toString()
  }

  async request(method: string, pathOrUrl: string, options: { query?: Query; json?: unknown; form?: Record<string, string> } = {}): Promise<HttpResponse> {
    const isWrite = method !== 'GET' && method !== 'HEAD'
    if (isWrite && this.opts.dryRun) {
      throw new DryRunWriteError(`[${this.opts.name}] 드라이런 중 쓰기 요청을 막았다: ${method} ${pathOrUrl}`)
    }
    const headers: Record<string, string> = { Accept: 'application/json', ...(this.opts.extraHeaders ?? {}), ...(await this.opts.auth()) }
    let body: string | undefined
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8'
      body = JSON.stringify(options.json)
    } else if (options.form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = new URLSearchParams(options.form).toString()
    }
    const url = this.url(pathOrUrl, options.query)
    if (isWrite) this.writes++

    for (let attempt = 0; ; attempt++) {
      const res = await this.opts.transport({ method, url, headers, body })
      const retryable = res.status === 429 || res.status >= 500
      if (retryable && attempt < 3) {
        const after = Number(res.headers['retry-after'] ?? 1)
        await sleep((Number.isFinite(after) ? after : 1) * (this.opts.retryDelayMs ?? 1000))
        continue
      }
      return res
    }
  }

  /** 2xx 가 아니면 HttpError. 본문은 토큰을 가린 뒤 메시지에 싣는다. */
  async json<T = any>(method: string, pathOrUrl: string, options: { query?: Query; json?: unknown; form?: Record<string, string>; allow?: number[] } = {}): Promise<T> {
    const res = await this.request(method, pathOrUrl, options)
    if ((res.status < 200 || res.status >= 300) && !(options.allow ?? []).includes(res.status)) {
      const summary = redact(typeof res.body === 'string' ? res.body : JSON.stringify(res.body)).slice(0, 400)
      throw new HttpError(res.status, res.body, `[${this.opts.name}] ${method} ${pathOrUrl} → ${res.status} ${summary}`)
    }
    return res.body as T
  }

  /** 없으면 null (404) */
  async getOrNull<T = any>(pathOrUrl: string, query?: Query): Promise<T | null> {
    const res = await this.request('GET', pathOrUrl, { query })
    if (res.status === 404) return null
    if (res.status < 200 || res.status >= 300) {
      throw new HttpError(res.status, res.body, `[${this.opts.name}] GET ${pathOrUrl} → ${res.status} ${redact(JSON.stringify(res.body)).slice(0, 400)}`)
    }
    return res.body as T
  }

  /** Link 헤더(rel="next")로 이어지는 목록 (GitHub, Okta) */
  async listByLink<T = any>(pathOrUrl: string, query?: Query): Promise<T[]> {
    const items: T[] = []
    let next: string | undefined = this.url(pathOrUrl, query)
    while (next) {
      const res = await this.request('GET', next)
      if (res.status < 200 || res.status >= 300) {
        throw new HttpError(res.status, res.body, `[${this.opts.name}] GET ${next} → ${res.status} ${redact(JSON.stringify(res.body)).slice(0, 400)}`)
      }
      items.push(...((res.body as T[]) ?? []))
      next = parseNextLink(res.headers['link'])
    }
    return items
  }
}

export function parseNextLink(link: string | undefined): string | undefined {
  if (!link) return undefined
  for (const part of link.split(',')) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(part.trim())
    if (m) return m[1]
  }
  return undefined
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// 상태와 비밀값
// ---------------------------------------------------------------------------

/**
 * 만든 객체의 id 를 남긴다 (setup-output/state.json, git 제외).
 * 이 값으로 docs/spec/profiles/scenario_instances.yaml 의 null 을 채운다.
 */
export class SetupState {
  data: Record<string, any>

  constructor(private file: string | null) {
    this.data = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  }

  get<T = any>(key: string): T | undefined {
    return this.data[key]
  }

  set(key: string, value: unknown): void {
    this.data[key] = value
    this.save()
  }

  save(): void {
    if (!this.file) return
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n')
  }
}

/** 비밀값은 화면에 찍지 않고 setup-output/secrets/ 에 0600 으로 쓴다. 팀 비밀 보관소로 옮긴 뒤 지운다. */
export class SecretStore {
  written: string[] = []

  constructor(private dir: string | null) {}

  /** 비밀은 아니지만 사람이 열어 볼 파일 (예: GitHub App 매니페스트 양식) */
  saveHtml(name: string, content: string): string {
    if (!this.dir) return `(memory)/${name}`
    const file = path.join(path.dirname(this.dir), name)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
    return file
  }

  /** 저장 위치. 메모리 모드면 null (파일이 이미 있는지 볼 때 쓴다) */
  path(name: string): string | null {
    return this.dir ? path.join(this.dir, name) : null
  }

  save(name: string, content: string): string {
    this.written.push(name)
    if (!this.dir) return `(memory)/${name}`
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const file = path.join(this.dir, name)
    fs.writeFileSync(file, content.endsWith('\n') ? content : content + '\n', { mode: 0o600 })
    return file
  }
}

export function randomPassword(): string {
  // 대문자·소문자·숫자·기호가 모두 들어가게 한다 (GWS·Okta 기본 비밀번호 정책)
  return `Aa1!${crypto.randomBytes(18).toString('base64url')}`
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

export interface TaskReport {
  task: Task
  before: Plan
  after?: Plan
  applied?: string
  error?: string
}

export async function runTasks(tasks: Task[], options: { apply: boolean; log?: (line: string) => void }): Promise<TaskReport[]> {
  const log = options.log ?? (() => {})
  const reports: TaskReport[] = []
  for (const task of tasks) {
    const report: TaskReport = { task, before: blocked('확인 전') }
    try {
      report.before = await task.plan()
      if (report.before.status === 'todo' && options.apply) {
        report.applied = await task.apply()
        report.after = await task.plan()
      }
    } catch (err) {
      report.error = redact(err instanceof Error ? err.message : String(err))
      if (!report.before || report.before.detail === '확인 전') report.before = blocked(report.error)
    }
    reports.push(report)
    log(formatReport(report))
  }
  return reports
}

const ICON: Record<PlanStatus, string> = { done: '✓', todo: '•', blocked: '⛔', skipped: '–' }

export function formatReport(r: TaskReport): string {
  const status = r.after ?? r.before
  const head = `${ICON[status.status]} [${r.task.saas}] ${r.task.id} — ${r.task.title} (가이드 ${r.task.guide})`
  const lines = [head, `    ${status.detail}`]
  if (r.applied) lines.push(`    적용: ${r.applied}`)
  if (r.error) lines.push(`    오류: ${r.error}`)
  return lines.join('\n')
}

/** 같은 실행 안에서 조회 결과를 재사용한다 (예: 사용자 id). 적용 뒤에는 지운다. */
export class Memo {
  private cache = new Map<string, Promise<unknown>>()

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (!this.cache.has(key)) this.cache.set(key, load())
    return this.cache.get(key) as Promise<T>
  }

  clear(prefix?: string): void {
    for (const key of [...this.cache.keys()]) if (!prefix || key.startsWith(prefix)) this.cache.delete(key)
  }
}
