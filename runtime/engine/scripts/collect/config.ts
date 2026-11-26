/**
 * 수집기 설정과 자격증명.
 *
 * - collector.config.json (git 제외, 예시는 collector.config.example.json): 조직·채널·저장소·기간 같은 식별값. 비밀값 없음.
 * - .env.collector (git 제외, 예시는 .env.collector.example): 수집용 읽기 전용 자격증명 (계획서 4.1절).
 *   `NAME_FILE=경로` 로 주면 파일에서 읽는다. 세팅용 .env.setup 은 읽지 않는다 (수집·세팅 자격증명 분리).
 */
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export interface CollectorConfig {
  /** 수집 기간 시작 (ISO). 로그 스트림은 커서가 있으면 커서부터 */
  since: string
  github: {
    org: string
    orgs?: string[]
    enterprise: string
    /** 비우면 조직 저장소 전부 */
    repos?: string[]
    /** 커밋 상세(GH-11)를 받을 최대 커밋 수 (저장소마다) */
    maxCommitDetails?: number
  }
  okta: {
    /** 수집 앱에 실제로 허용된 scope. 여기 없는 scope 가 필요한 호출은 skipped(scope_not_granted) */
    scopes: string[]
    policyTypes: string[]
    /** 이 회차의 Okta org 호스트(예: trial-1234567.okta.com). 자격증명 OKTA_ORG_URL 이 다른 org 면 Okta 를 수집하지 않는다 (선택) */
    orgHost?: string
  }
  slack: {
    teamId: string
    enterpriseId: string
    /**
     * 채널 발견 힌트 (선택). 채널은 봇 목록(conversations.list)과 관리자 검색으로 찾고, 메시지(SL-05)는 수집 봇이 든 채널 전부에서 받는다.
     * 관리자 검색에도 안 나오는 채널만 적는다
     */
    extraChannels?: string[]
    /** 앱 발견 힌트 (선택). 앱은 봇 사용자, 봇 정보, 승인 앱 목록에서 찾는다 */
    appIds?: string[]
    /** 멤버(SL-15)를 받을 사용자 그룹 id (선택). IdP 그룹은 usergroups.list 에 안 나와
        감사 로그(SL-11)에서 찾는데, 로그는 커서 이후만 받으므로 이미 아는 id 를 여기 적어 둔다 */
    usergroupIds?: string[]
    /** 조직 IdP 그룹 id (선택). SL-13 기본 채널 조회와 SL-15 멤버 조회용. 일반 워크스페이스 그룹은 넣지 않는다 */
    idpUsergroupIds?: string[]
    /** team.integrationLogs(SL-09)를 부른다. ORG 토큰에 admin scope 가 있어야 한다(B경로). 기본 끔 */
    integrationLogs?: boolean
  }
  gws: {
    /** DWD 로 가장할 읽기 전용 관리자 */
    adminSubject: string
    /** Drive 파일·권한(GW-07)을 볼 사용자 (선택). 비우면 디렉터리(GW-03)의 활성 사용자 전부 */
    driveUsers?: string[]
    /** Form 발견 힌트 (선택). Form 은 Drive 목록(GW-07)의 Form 파일에서 찾는다 */
    forms?: Array<{ id: string; owner: string }>
    /**
     * Apps Script 발견 힌트 (선택). 독립 스크립트는 Drive 목록(GW-07)에서 찾는다.
     * 문서에 묶인 스크립트(container-bound)는 Drive 에도 Apps Script API 에도 목록이 없어 여기 적어야만 본다(수집 완결성에 남는다)
     */
    scripts?: Array<{ id: string; owner: string }>
    reportApplications: string[]
    /** DWD 클라이언트에 추가로 허용한 scope 이름 (예: script.deployments.readonly). 없는 scope 가 필요한 호출은 skipped(scope_not_granted) */
    grantedScopes?: string[]
    /** 라이선스 배정(GW-25)을 받을 제품 ID (선택). 기본 ['Google-Apps'] (Google Workspace). 제품 ID 는 Enterprise License Manager 「Products and SKUs」 */
    licenseProducts?: string[]
  }
  /** 없으면 Salesforce 호출은 skipped */
  salesforce?: {
    /** REST API 판 (예: 61.0) */
    apiVersion: string
    /** 이 회차의 Salesforce My Domain 호스트(예: example.my.salesforce.com). 자격증명이 다른 조직이면 Salesforce 를 수집하지 않는다 (선택) */
    instanceHost?: string
    /** 설정 감사 기록(SF-90)을 받을 일수. 기본 180 */
    auditDays?: number
  }
  /** 없으면 Jira·Confluence 호출은 skipped. 사이트 주소와 자격증명은 .env.collector */
  atlassian?: {
    jira: boolean
    confluence: boolean
    /** Jira 감사 기록(JI-90)을 받는다. Jira 관리자 권한이 필요하다 */
    audit?: boolean
    /** 조직 관리 API 의 {orgId}. 없으면 조직 API 레지스트리 호출은 skipped(config_missing) */
    orgId?: string
    /**
     * Atlassian 조직 감사 기록(AT-90, Guard). 없으면 skipped. orgId 는 조직 ID, since 는 이보다 앞은 받지 않는 시각이다
     * (웹훅으로 이미 Splunk 에 들어온 기간을 다시 보내지 않으려고 둔다). 키는 CRED-AT-ORG-02
     */
    orgAudit?: { orgId: string; since?: string }
  }
  worker: {
    baseUrl: string
    tables: string[]
    /** Optional read-only Cloudflare control-plane collection for the deployed Worker. */
    cloudflare?: { accountId: string; scriptName: string }
  }
  aws?: {
    region: string
    accountId?: string
  }
  gcp?: {
    /** 받을 프로젝트(ID 또는 번호). 이 프로젝트의 Gemini Enterprise 와 IAM 을 받는다. 비우면 discoverProjects 가 켜져 있어야 한다 */
    projects?: string[]
    /** projects 가 비었을 때 호출 계정이 볼 수 있는 활성 프로젝트를 찾아 받는다(projects.search). 기본 꺼짐 */
    discoverProjects?: boolean
    /** Discovery Engine 위치. 기본 ['global']. 호스트를 아는 위치(global, us)만 받고 나머지는 기록만 남긴다 */
    discoveryLocations?: string[]
    /** Agent Platform(reasoningEngines)을 볼 지역. 에이전트가 가리키는 지역은 자동으로 더한다 */
    regions?: string[]
  }
  onepassword?: {
    /** 기대하는 계정 UUID. 있으면 op whoami 결과와 다를 때 멈춘다 */
    accountId?: string
    /** Events API 호스트. 기본 https://events.1password.com (ca, eu, ent 는 계정 지역에 따라) */
    eventsHost?: string
  }
  microsoft?: {
    tenantId: string
    maxDriveItems?: number
  }
}

export function loadConfig(file: string): CollectorConfig {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} 이 없다. scripts/collect/collector.config.example.json 을 복사해 채운다`)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CollectorConfig
}

/** .env 형식 (KEY=VALUE, # 주석). 값의 따옴표는 벗긴다 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

export function loadEnv(file: string): Record<string, string> {
  return fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, 'utf8')) : {}
}

/**
 * 한 줄로 넣은 PEM(줄바꿈을 `\n` 두 글자로 적은 것)을 여러 줄로 되돌린다.
 * Vault pull-env 와 .env 파서가 한 줄 값만 다뤄서, 개인키를 값으로 넣으려면 이렇게 적는다. PEM 이 아니면 그대로 둔다.
 */
export function inlinePem(value: string): string {
  return value.startsWith('-----BEGIN ') && !value.includes('\n') ? value.replace(/\\n/g, '\n') : value
}

export type CredentialPersist = (updates: Record<string, string>, meta?: { expiresAt?: string }) => Promise<void>

/**
 * .env 파일을 원자적으로 갱신한다 (임시 파일 작성 → 권한 제한 → renameSync).
 * 주석과 기존 줄 순서를 보존하고, 여러 줄 값(PEM 등)은 `\n` 한 줄 형식으로 인코딩한다.
 */
export function atomicUpdateEnvFile(file: string, updates: Record<string, string | undefined>): void {
  const entries = Object.entries(updates)
  if (!entries.length) return
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const lines = existing ? existing.split(/\r?\n/) : []
  const encodeVal = (v: string) => v.replace(/\r?\n/g, '\\n')
  const seen = new Set<string>()
  const nextLines: string[] = []
  for (const line of lines) {
    const m = /^\s*(#?\s*)([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && Object.prototype.hasOwnProperty.call(updates, m[2])) {
      const key = m[2]
      const val = updates[key]
      if (!m[1].trim().startsWith('#')) {
        seen.add(key)
        if (val !== undefined && val !== '') nextLines.push(`${key}=${encodeVal(val)}`)
        else nextLines.push(`${key}=`)
        continue
      }
      if (!seen.has(key) && val !== undefined && val !== '') {
        seen.add(key)
        nextLines.push(`${key}=${encodeVal(val)}`)
        continue
      }
    }
    nextLines.push(line)
  }
  for (const [key, val] of entries) {
    if (!seen.has(key) && val !== undefined && val !== '') {
      nextLines.push(`${key}=${encodeVal(val)}`)
    }
  }
  const text = nextLines.join('\n').replace(/\n*$/, '\n')
  const dir = path.dirname(path.resolve(file))
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 })
  if (process.platform === 'win32' && process.env.USERNAME) {
    try {
      execFileSync('icacls', [tmp, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:(R,W)`], { stdio: 'ignore' })
    } catch {
      // Windows 권한 설정 실패 시에도 파일 교체는 계속 진행한다
    }
  }
  fs.renameSync(tmp, file)
}

/**
 * 자격증명 읽기. NAME 이 비었으면 NAME_FILE 경로의 파일 내용을 쓴다 (앞뒤 공백 제거).
 * 상대 경로는 baseDir 기준. envFile 이 주어지면 set() 호출 시 원자적으로 파일에도 기록한다 (갱신 토큰 회전용).
 */
export class Credentials {
  constructor(
    private env: Record<string, string | undefined>,
    private baseDir: string,
    private readFile: (p: string) => string = p => fs.readFileSync(p, 'utf8'),
    private envFile?: string,
    /** 갱신한 자격증명을 env 파일 밖(KV 금고, 로컬 암호화 저장소)에 쓰는 함수. setMany 가 부른다 */
    private persist?: CredentialPersist,
  ) {}

  /** 여러 값을 한 번에 바꾼다. env 파일이 있으면 한 번에 원자 갱신하고, persist 가 있으면 그것도 부른다. 저장이 실패하면 throw 하지만 메모리 값은 새 것으로 둔다 */
  async setMany(updates: Record<string, string>, meta?: { expiresAt?: string }): Promise<void> {
    for (const [k, v] of Object.entries(updates)) this.env[k] = v
    if (this.envFile) atomicUpdateEnvFile(this.envFile, updates)
    if (this.persist) await this.persist(updates, meta)
  }

  get(name: string): string | undefined {
    const direct = this.env[name]
    if (direct) return inlinePem(direct)
    const file = this.env[`${name}_FILE`]
    if (file) {
      const resolved = path.isAbsolute(file) ? file : path.join(this.baseDir, file)
      try {
        const content = this.readFile(resolved).trim()
        if (content) return content
      } catch {
        // ignore
      }
    }
    if (name === 'GITHUB_APP_PRIVATE_KEY' || name === 'GITHUB_APP_ID') {
      const proc = process.env[name]
      if (proc) return inlinePem(proc)
    }
    return undefined
  }

  set(name: string, value: string): void {
    this.env[name] = value
    if (this.envFile) atomicUpdateEnvFile(this.envFile, { [name]: value })
  }

  require(name: string): string {
    const v = this.get(name)
    if (!v) throw new Error(`Missing credential ${name}`)
    return v
  }

  has(...names: string[]): boolean {
    return names.every(n => !!this.get(n))
  }
}

/** 이름과 자격증명 ID (계획서 4.1절) */
export const CREDENTIAL_KEYS = {
  'CRED-GH-01': ['GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'],
  'CRED-GH-01-ENT': ['GITHUB_APP_ID', 'GITHUB_APP_ENTERPRISE_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY'],
  'CRED-GH-02': ['GITHUB_OWNER_TOKEN'],
  'CRED-OK-01': ['OKTA_ORG_URL', 'OKTA_COLLECTOR_CLIENT_ID', 'OKTA_COLLECTOR_KEY_ID', 'OKTA_COLLECTOR_PRIVATE_KEY'],
  'CRED-SL-01': ['SLACK_COLLECTOR_USER_TOKEN'],
  'CRED-SL-02': ['SLACK_COLLECTOR_BOT_TOKEN'],
  'CRED-SL-03': ['SLACK_CONFIG_TOKEN'],
  'CRED-GW-01': ['GWS_COLLECTOR_SA_KEY'],
  'CRED-SF-01': ['SALESFORCE_INSTANCE_URL', 'SALESFORCE_COLLECTOR_CLIENT_ID', 'SALESFORCE_COLLECTOR_CLIENT_SECRET'],
  'CRED-AT-01': ['ATLASSIAN_SITE_URL', 'ATLASSIAN_COLLECTOR_EMAIL', 'ATLASSIAN_COLLECTOR_API_TOKEN'],
  // 조직 관리 API. admin.atlassian.com 의 읽기 범위만 준 SCOPED 조직 API 키 (Bearer)
  'CRED-AT-ORG-01': ['ATLASSIAN_COLLECTOR_ORG_API_KEY'],
  'CRED-AT-ORG-02': ['ATLASSIAN_ORG_AUDIT_API_KEY'],
  'CRED-WK-01': ['WORKER_COLLECTOR_TOKEN'],
  'CRED-CF-01': ['CLOUDFLARE_API_TOKEN'],
  'CRED-AWS-01': ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'],
  // 사람이 동의한 OAuth 갱신 토큰(범위 cloud-platform). GCP_COLLECTOR_CLIENT_SECRET 은 클라이언트가 요구할 때만 둔다
  'CRED-GCP-01': ['GCP_COLLECTOR_CLIENT_ID', 'GCP_COLLECTOR_REFRESH_TOKEN'],
  // 1Password 서비스 계정 토큰. 금고마다 Read Items 만 준다. op CLI·SDK 에 OP_SERVICE_ACCOUNT_TOKEN 으로 넘긴다
  'CRED-OP-01': ['ONEPASSWORD_SERVICE_ACCOUNT_TOKEN'],
  // 1Password Events Reporting 토큰 (감사 이벤트)
  'CRED-OP-02': ['ONEPASSWORD_EVENTS_TOKEN'],
  'CRED-M365-01': ['m365/collector-app.json'],
} as const

export type CredentialId = keyof typeof CREDENTIAL_KEYS

/** OAuth 동의(refresh_token / oauth_token) 경로일 때의 자격증명 키 조합 */
export const CREDENTIAL_OAUTH_KEYS: Partial<Record<CredentialId, readonly string[]>> = {
  'CRED-OK-01': ['OKTA_ORG_URL', 'OKTA_COLLECTOR_CLIENT_ID', 'OKTA_COLLECTOR_REFRESH_TOKEN'],
  'CRED-SF-01': ['SALESFORCE_INSTANCE_URL', 'SALESFORCE_COLLECTOR_CLIENT_ID', 'SALESFORCE_COLLECTOR_REFRESH_TOKEN'],
  'CRED-GW-01': ['GWS_COLLECTOR_CLIENT_ID', 'GWS_COLLECTOR_REFRESH_TOKEN'],
  'CRED-GH-01': ['GITHUB_COLLECTOR_OAUTH_TOKEN'],
  'CRED-AT-01': ['ATLASSIAN_SITE_URL', 'ATLASSIAN_CLOUD_ID', 'ATLASSIAN_COLLECTOR_CLIENT_ID', 'ATLASSIAN_COLLECTOR_CLIENT_SECRET', 'ATLASSIAN_COLLECTOR_REFRESH_TOKEN'],
}

/** 현재 설정된 인증 경로(기본 키 vs OAuth 토큰)에 맞는 필수 키 목록을 돌려준다 */
export function credentialKeyNames(creds: Credentials, id: CredentialId): readonly string[] {
  if (id === 'CRED-OK-01' && creds.get('OKTA_API_TOKEN')) {
    return ['OKTA_ORG_URL', 'OKTA_API_TOKEN']
  }
  if (id === 'CRED-OK-01' && creds.get('OKTA_COLLECTOR_REFRESH_TOKEN') && !creds.get('OKTA_COLLECTOR_PRIVATE_KEY')) {
    return CREDENTIAL_OAUTH_KEYS['CRED-OK-01']!
  }
  if (id === 'CRED-SF-01' && creds.get('SALESFORCE_COLLECTOR_REFRESH_TOKEN')) {
    return CREDENTIAL_OAUTH_KEYS['CRED-SF-01']!
  }
  if (id === 'CRED-GW-01' && creds.get('GWS_COLLECTOR_REFRESH_TOKEN') && !creds.get('GWS_COLLECTOR_SA_KEY')) {
    return CREDENTIAL_OAUTH_KEYS['CRED-GW-01']!
  }
  if (id === 'CRED-GH-01' && creds.get('GITHUB_COLLECTOR_OAUTH_TOKEN') && !creds.get('GITHUB_APP_PRIVATE_KEY')) {
    return CREDENTIAL_OAUTH_KEYS['CRED-GH-01']!
  }
  if (id === 'CRED-AT-01' && creds.get('ATLASSIAN_COLLECTOR_REFRESH_TOKEN') && !creds.get('ATLASSIAN_COLLECTOR_API_TOKEN')) {
    return CREDENTIAL_OAUTH_KEYS['CRED-AT-01']!
  }
  if (id === 'CRED-AT-ORG-01' && !creds.get('ATLASSIAN_COLLECTOR_ORG_API_KEY') && creds.get('ATLASSIAN_ORG_AUDIT_API_KEY')) {
    return ['ATLASSIAN_ORG_AUDIT_API_KEY']
  }
  return CREDENTIAL_KEYS[id]
}

export function missingCredential(creds: Credentials, id: CredentialId): string | null {
  const missing = credentialKeyNames(creds, id).filter(k => !creds.get(k))
  return missing.length ? `credential_missing:${id} (${missing.join(', ')})` : null
}
