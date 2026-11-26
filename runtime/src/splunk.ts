/**
 * 기업 Splunk 연결. Splunk 자체(설치 형태, index 이름, 수집 add-on)는 기업마다 다르므로 설치판은 두 가지만 받는다:
 *   1. 연결 정보(.env): 검색 REST 주소, 검색 토큰, 인증서 확인 방법
 *   2. 출처 설정(splunk.sources.json): 어느 index·sourcetype 이 어느 SaaS 감사 로그인지, 필드 경로, tenant 격리
 * 검색은 엔진 SearchTransport 가 Splunk REST(/services/search/jobs)로 보낸다. 운영 Connector(servicesFromEnv)와 같은 조립이다.
 */
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { TransportError, pinnedHttpsWire, SearchTransport, type Wire } from '../engine/scripts/stream/splunk/transport.ts'
import { validateWorkspace, type Workspace } from '../engine/scripts/stream/splunk/query/workspace.ts'
import { ENV_FILE } from './paths.ts'

export const WORKSPACE_ID = 'local'
const TIMEOUT_MS = 15_000
const MAX_RESPONSE_BYTES = 20_000_000

export interface SplunkSettings {
  searchBase: string
  token: string
  tls: { kind: 'fingerprint'; sha256: string } | { kind: 'ca'; file: string } | { kind: 'system' }
  sourcesFile: string
}

/** .env 의 Splunk 연결 정보. SPLUNK_URL 이 없으면 null(로그 기능을 끈다). 값이 틀리면 오류 */
export function splunkSettings(env: Record<string, string>): SplunkSettings | null {
  if (!env.SPLUNK_URL) return null
  let url: URL
  try { url = new URL(env.SPLUNK_URL) } catch { throw new Error('SPLUNK_URL 이 주소 형식이 아니다 (예: https://splunk.example.com:8089)') }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('SPLUNK_URL 은 계정 정보 없는 https 주소여야 한다 (검색 REST, 보통 8089 포트)')
  if (!env.SPLUNK_TOKEN) throw new Error('SPLUNK_TOKEN 이 없다 (Splunk 인증 토큰. 검색 권한만 있는 계정으로 만든다)')
  const base = path.dirname(ENV_FILE)
  const tls: SplunkSettings['tls'] = env.SPLUNK_TLS_SHA256 ? { kind: 'fingerprint', sha256: env.SPLUNK_TLS_SHA256 }
    : env.SPLUNK_CA_FILE ? { kind: 'ca', file: path.resolve(base, env.SPLUNK_CA_FILE) }
    : { kind: 'system' }
  return { searchBase: url.origin, token: env.SPLUNK_TOKEN, tls, sourcesFile: path.resolve(base, env.SPLUNK_SOURCES_FILE || 'splunk.sources.json') }
}

/** 출처 설정 splunk.sources.json 이 없으면 splunk.sources.example.json 을 복사해 둔다. 이미 있으면 덮어쓰지 않는다 */
export function ensureSplunkSourcesFile(env: Record<string, string>): { created: boolean; path: string } {
  const base = path.dirname(ENV_FILE)
  const target = path.resolve(base, env.SPLUNK_SOURCES_FILE || 'splunk.sources.json')
  if (!fs.existsSync(target)) {
    const example = path.resolve(base, 'splunk.sources.example.json')
    const fallback = path.resolve(import.meta.dirname, '..', 'splunk.sources.example.json')
    const src = fs.existsSync(example) ? example : fs.existsSync(fallback) ? fallback : null
    if (src) {
      fs.copyFileSync(src, target)
      return { created: true, path: target }
    }
  }
  return { created: false, path: target }
}


/** 출처 설정 파일. `{ policyVersion?, sources: [...] }` 또는 엔진 Connector 설정 `{ workspaces: [{ sources }] }` */
export function loadWorkspace(file: string): Workspace {
  if (!fs.existsSync(file)) throw new Error(`Splunk 출처 설정이 없다: ${file} (splunk.sources.example.json 을 복사해 index, sourcetype 을 기업 Splunk 에 맞춘다)`)
  let v: Record<string, unknown>
  try { v = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (err) { throw new Error(`${file} 를 JSON 으로 읽지 못했다: ${err instanceof Error ? err.message : err}`) }
  const ws = Array.isArray(v.workspaces) ? v.workspaces[0] as Record<string, unknown> : v
  try {
    return validateWorkspace({ id: WORKSPACE_ID, policyVersion: typeof ws?.policyVersion === 'string' ? ws.policyVersion : 'v1', sources: ws?.sources })
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err)
    const hint: Record<string, string> = {
      invalid_workspace: 'sources 가 1~12개 목록이어야 한다',
      invalid_source: 'ref, provider, index, sourcetype 이 영문으로 시작하는 80자 이하 이름이고 ref 가 겹치지 않아야 한다',
      invalid_fields: 'fields 는 1~16개, 이름은 소문자_숫자, 값은 JSON 경로여야 한다',
      tenant_isolation_required: 'isolation 은 {"dedicated": true}(이 tenant 전용 index) 또는 {"field": 경로, "value"|"values": tenant id} 여야 한다',
    }
    throw new Error(`${file}: ${code}${hint[code] ? ` (${hint[code]})` : ''}`)
  }
}

/** 공인 CA 또는 지정 CA 로 인증서 체인을 확인하는 HTTPS. 응답 크기와 시간 한도는 지문 고정 전송과 같다 */
function verifiedHttpsWire(ca: Buffer | undefined): Wire {
  return req => new Promise((resolve, reject) => {
    const url = new URL(req.url)
    const r = https.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: req.method,
      headers: { ...req.headers, ...(req.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(req.body)) } : {}) },
      agent: false, rejectUnauthorized: true, ...(ca ? { ca } : {}), timeout: TIMEOUT_MS,
    }, res => {
      let data = '', bytes = 0
      res.setEncoding('utf8')
      res.on('data', c => { bytes += Buffer.byteLength(c); if (bytes > MAX_RESPONSE_BYTES) { r.destroy(new TransportError('응답 크기 한도 초과')); return }; data += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    })
    r.on('timeout', () => r.destroy(new TransportError(`시간 초과 ${TIMEOUT_MS}ms`)))
    r.on('error', reject)
    r.end(req.body)
  })
}

export function splunkWire(s: SplunkSettings): Wire {
  if (s.tls.kind === 'fingerprint') return pinnedHttpsWire(s.tls.sha256, TIMEOUT_MS, MAX_RESPONSE_BYTES)
  if (s.tls.kind === 'ca') {
    if (!fs.existsSync(s.tls.file)) throw new Error(`SPLUNK_CA_FILE 이 없다: ${s.tls.file}`)
    return verifiedHttpsWire(fs.readFileSync(s.tls.file))
  }
  return verifiedHttpsWire(undefined)
}

export function splunkTransport(s: SplunkSettings, wire: Wire = splunkWire(s)) {
  return new SearchTransport({ searchBase: s.searchBase, token: s.token, approved: {}, tenants: {} }, wire)
}

export const tlsLabel = (s: SplunkSettings) => s.tls.kind === 'fingerprint' ? '인증서 지문 고정' : s.tls.kind === 'ca' ? `지정 CA (${path.basename(s.tls.file)})` : '시스템 CA'

export interface SourceCheck { ref: string; provider: string; index: string; sourcetype: string; events: number; latest: string | null; tenantFiltered: boolean }
export interface SplunkCheck { ok: boolean; error?: string; sources: SourceCheck[] }

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * 연결 점검: 검색 작업 하나(tstats)로 인증, 인증서, 출처별 최근 7일 이벤트 수와 마지막 시각을 본다.
 * tenant 필드로 거르는 출처는 index 전체 수다(tstats 는 원문 필드를 보지 않는다).
 */
export async function checkSplunk(transport: SearchTransport, w: Workspace, waitMs = 60_000): Promise<SplunkCheck> {
  const where = w.sources.map(s => `(index=${q(s.index)} sourcetype=${q(s.sourcetype)})`).join(' OR ')
  const spl = `| tstats count max(_time) AS latest WHERE (${where}) earliest=-7d latest=now BY index sourcetype`
  let sid: string
  try { sid = await transport.createJob(spl, 60) } catch (err) { return { ok: false, error: describe(err), sources: [] } }
  try {
    const until = Date.now() + waitMs
    for (;;) {
      const st = await transport.jobStatus(sid)
      if (st.isFailed) return { ok: false, error: `검색 실패: ${st.messages.join('; ') || st.dispatchState}`, sources: [] }
      if (st.isDone) break
      if (Date.now() > until) return { ok: false, error: `검색이 ${waitMs / 1000}초 안에 끝나지 않았다`, sources: [] }
      await new Promise(r => setTimeout(r, 500))
    }
    const { rows } = await transport.results(sid, 0, 1000)
    const found = new Map(rows.map(r => [`${r.index}|${r.sourcetype}`, r]))
    return {
      ok: true,
      sources: w.sources.map(s => {
        const r = found.get(`${s.index}|${s.sourcetype}`)
        const latest = r?.latest ? new Date(Number(r.latest) * 1000).toISOString() : null
        return { ref: s.ref, provider: s.provider, index: s.index, sourcetype: s.sourcetype, events: Number(r?.count ?? 0), latest, tenantFiltered: 'field' in s.isolation }
      }),
    }
  } catch (err) {
    return { ok: false, error: describe(err), sources: [] }
  } finally {
    await transport.cancel(sid).catch(() => undefined)
  }
}

function describe(err: unknown) {
  if (err instanceof TransportError && (err.status === 401 || err.status === 403)) return `토큰이 거절됐다 (${err.status}). SPLUNK_TOKEN 과 계정의 검색 권한을 확인한다`
  const e = err as NodeJS.ErrnoException
  const code = e?.code ?? ''
  if (code === 'ECONNREFUSED') return '연결 거부. SPLUNK_URL 의 주소와 포트(검색 REST, 보통 8089)를 확인한다'
  if (code === 'ENOTFOUND') return 'SPLUNK_URL 의 호스트 이름을 찾지 못했다'
  if (code === 'ETIMEDOUT' || /시간 초과/.test(e?.message ?? '')) return '응답이 없다. 방화벽이나 보안그룹이 이 PC 를 막는지 확인한다'
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|altnames/i.test(code + (e?.message ?? ''))) return `인증서 확인 실패 (${code || e.message}). 사설 인증서면 SPLUNK_CA_FILE 이나 SPLUNK_TLS_SHA256 을 둔다`
  return e?.message ?? String(err)
}
