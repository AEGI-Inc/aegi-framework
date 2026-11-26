/**
 * 원본을 디스크에 쓰기 전에 거치는 정리 단계 (계획서 2절 원칙 3·4, 7.3절).
 *
 * 1. 비밀값: 토큰·웹훅 URL·개인 키처럼 보이는 문자열은 SHA-256 지문으로 바꾼다.
 *    지문은 일치 문자열 전체의 sha256 hex 다 — Worker 가 D1 에 남긴 웹훅 URL 지문과 그대로 대조된다.
 * 2. 내용: 메시지 본문·커밋 메시지·PR 본문·스크립트 코드는 지문·길이·URL 참조만 남긴다.
 *    diff(`patch`)·Slack blocks 처럼 내용 그 자체인 필드는 버린다.
 * 3. 상관 ID(`AEGI-<A~D>-<UUID>`): 정답 라벨로 따로 빼고 원본에서는 지운다 (D-12).
 *    탐지 입력에 섞이지 않게 하려고 정규화가 아니라 여기서 지운다.
 *
 * 같은 입력이면 언제나 같은 출력이 나온다 (시각·난수를 쓰지 않는다).
 */
import crypto from 'crypto'

export const sha256Hex = (text: string): string => crypto.createHash('sha256').update(text, 'utf8').digest('hex')

/** 계획서 7.4절 Stage 8 패턴 + GitHub 설치 토큰·OAuth 토큰·JWT. 순서가 중요하다(긴 패턴 먼저). */
export const SECRET_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'slack_webhook', re: /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9/_-]+/g },
  { kind: 'slack_token', re: /xox[a-z]-[A-Za-z0-9-]{10,}/g },
  { kind: 'slack_config_token', re: /xoxe(?:\.xox[a-z])?-[A-Za-z0-9-]{10,}/g },
  { kind: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g },
  { kind: 'github_pat', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'okta_ssws', re: /SSWS [A-Za-z0-9_-]{20,}/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Okta Workflows API 끝점(…workflows.okta.com/api/flo/<흐름>/invoke?clientToken=…)의 호출 토큰. 이 값만 있으면 누구나 흐름을 부른다.
  // Okta 이벤트 훅(OK-17), GitHub 웹훅, Slack 명령·워크플로 주소에 들어 있다. 주소(조직·흐름 id)는 남기고 토큰 값만 지문으로 바꾼다
  { kind: 'okta_workflows_token', re: /(?<=[?&]clientToken=)[A-Za-z0-9._~%-]{8,}/g },
]

/** 남아 있으면 안 되는 패턴 (검증용). PEM 은 머리글만으로도 걸리게 한다. */
export const LEAK_PATTERNS: RegExp[] = [/xox[a-z]-/, /\bghp_/, /\bghs_/, /\bgithub_pat_/, /SSWS /, /hooks\.slack\.com\/services\//, /-----BEGIN/, /[?&]clientToken=(?!\[secret:)/]

export const CORRELATION_RE = /\bAEGI-([A-D])-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi
export const CORRELATION_PLACEHOLDER = '[correlation-id]'

export interface Fingerprint {
  $fp: string
  len: number
  /** 본문에 있던 링크. 비밀 링크(웹훅)는 host·지문만 */
  urls?: UrlRef[]
}

export interface UrlRef {
  host: string
  sha256: string
  /** Slack 메시지 링크: https://<ws>.slack.com/archives/<channel>/p<ts> */
  slack?: { channel: string; ts: string }
  /** GitHub 링크: https://github.com/<owner>/<repo>/(pull|issues|commit)/<n|sha>, 또는 REST 주소 https://api.github.com/repos/<owner>/<repo>/... (kind api, ref 없음) */
  github?: { repo: string; kind: string; ref?: string }
}

export interface LabelHit {
  correlation_id: string
  scenario: string
  json_path: string
}

export interface SanitizeStats {
  secrets: number
  content_fields: number
  dropped_fields: number
  correlation_ids: number
}

export interface SanitizeRules {
  /** 값이 문자열이면 지문으로 바꿀 키 (내용 필드) */
  contentKeys: Set<string>
  /** 통째로 버릴 키 */
  dropKeys: Set<string>
}

/** 모든 SaaS 공통 규칙. 호출마다 더할 수 있다. */
export const DEFAULT_RULES: SanitizeRules = {
  // signature·payload: 커밋 서명 검증 필드 (공개 서명이지만 PEM 머리글이 Stage 8 에 걸리고, payload 에는 커밋 메시지가 있다)
  // Apps Script 코드(`source`)는 GW-09 호출에서만 더한다 — GitHub 룰셋의 `source` 는 저장소 이름이다
  contentKeys: new Set(['message', 'body', 'text', 'plain_text', 'preview', 'fallback', 'signature', 'payload']),
  dropKeys: new Set(['patch', 'blocks', 'attachments', 'preview_highlight', 'preview_plain_text', 'edit_link', 'raw_response_text']),
}

export function mergeRules(base: SanitizeRules, extra?: Partial<{ contentKeys: string[]; dropKeys: string[]; keepKeys: string[] }>): SanitizeRules {
  if (!extra) return base
  const contentKeys = new Set([...base.contentKeys, ...(extra.contentKeys ?? [])])
  const dropKeys = new Set([...base.dropKeys, ...(extra.dropKeys ?? [])])
  for (const k of extra.keepKeys ?? []) { contentKeys.delete(k); dropKeys.delete(k) }
  return { contentKeys, dropKeys }
}

const URL_RE = /https?:\/\/[^\s<>"'|)\]}]+/g

export function urlRef(url: string): UrlRef {
  let host = ''
  try { host = new URL(url).host } catch { host = 'invalid' }
  const ref: UrlRef = { host, sha256: sha256Hex(url) }
  const slack = /\/archives\/([CDG][A-Z0-9]+)\/p(\d{10})(\d{6})/.exec(url)
  if (slack && host.endsWith('slack.com')) ref.slack = { channel: slack[1], ts: `${slack[2]}.${slack[3]}` }
  const gh = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(pull|issues|commit)\/([0-9a-f]+)/i.exec(url)
  if (gh) ref.github = { repo: gh[1], kind: gh[2], ref: gh[3] }
  // REST 주소의 저장소(owner/repo)는 비밀이 아니다. 다른 SaaS 의 자동화가 요청을 보내는 저장소를 잇는 재료다(crosswalk request_resource)
  const api = /^https:\/\/api\.github\.com\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:[/?#]|$)/i.exec(url)
  if (!gh && api) ref.github = { repo: api[1], kind: 'api' }
  return ref
}

export class Sanitizer {
  stats: SanitizeStats = { secrets: 0, content_fields: 0, dropped_fields: 0, correlation_ids: 0 }
  labels: LabelHit[] = []

  constructor(private rules: SanitizeRules = DEFAULT_RULES) {}

  /** 문자열 안의 상관 ID 를 라벨로 옮기고 자리표시자로 바꾼다 */
  private stripCorrelation(text: string, path: string): string {
    return text.replace(CORRELATION_RE, (_m, scenario: string, uuid: string) => {
      this.stats.correlation_ids++
      this.labels.push({ correlation_id: `AEGI-${scenario.toUpperCase()}-${uuid.toLowerCase()}`, scenario: scenario.toUpperCase(), json_path: path })
      return CORRELATION_PLACEHOLDER
    })
  }

  private stripSecrets(text: string): string {
    let out = text
    for (const { kind, re } of SECRET_PATTERNS) {
      out = out.replace(re, m => {
        this.stats.secrets++
        return `[secret:${kind}:sha256:${sha256Hex(m)}]`
      })
    }
    return out
  }

  /** 내용 필드: 원문 지문 + 길이 + 링크 참조. 상관 ID 는 지문 전에 라벨로 뺀다(지문은 원문 기준). */
  fingerprint(text: string, path: string): Fingerprint {
    this.stats.content_fields++
    this.stripCorrelation(text, path)
    const urls = [...new Set(text.match(URL_RE) ?? [])].map(u => {
      const ref = urlRef(u)
      if (SECRET_PATTERNS.some(p => new RegExp(p.re.source).test(u))) {
        this.stats.secrets++
        return { host: ref.host, sha256: ref.sha256 }
      }
      return ref
    })
    const fp: Fingerprint = { $fp: `sha256:${sha256Hex(text)}`, len: text.length }
    if (urls.length) fp.urls = urls
    return fp
  }

  string(text: string, path: string): string {
    return this.stripCorrelation(this.stripSecrets(text), path)
  }

  value(value: unknown, path = '$'): unknown {
    if (typeof value === 'string') return this.string(value, path)
    if (Array.isArray(value)) return value.map((v, i) => this.value(v, `${path}[${i}]`))
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const p = `${path}.${k}`
        if (this.rules.dropKeys.has(k)) {
          this.stats.dropped_fields++
          continue
        }
        if (this.rules.contentKeys.has(k) && typeof v === 'string' && v.length > 0) {
          out[k] = this.fingerprint(v, p)
          continue
        }
        out[k] = this.value(v, p)
      }
      return out
    }
    return value
  }
}

/** 검증용: 정리된 결과에 비밀 패턴이 남았는지 */
export function findLeaks(serialized: string): string[] {
  return LEAK_PATTERNS.filter(re => re.test(serialized)).map(re => re.source)
}
