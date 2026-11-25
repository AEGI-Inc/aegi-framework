import fs from 'node:fs'
import path from 'node:path'
import { resolveReasoningEffort, type ProviderName, type ReasoningEffort } from '../vendor/dashboard/src/assistant/reasoning.ts'
import { atomicUpdateEnvFile, parseEnvFile } from '../vendor/engine/scripts/collect/config.ts'
import { DATA_DIR, ENV_FILE, HOME } from './paths.ts'

/** 대시보드 UI(/__aegi/local-token, /__aegi/oauth/*)가 읽거나 쓸 수 있는 SaaS 자격증명·식별값 환경변수 화이트리스트 */
export const ALLOWED_ENV_KEYS = new Set([
  // Okta
  'OKTA_ORG_URL',
  'OKTA_API_TOKEN',
  'OKTA_COLLECTOR_CLIENT_ID',
  'OKTA_COLLECTOR_CLIENT_SECRET',
  'OKTA_COLLECTOR_KEY_ID',
  'OKTA_COLLECTOR_PRIVATE_KEY',
  'OKTA_COLLECTOR_REFRESH_TOKEN',
  'OKTA_SCOPES',
  // Salesforce
  'SALESFORCE_INSTANCE_URL',
  'SALESFORCE_COLLECTOR_CLIENT_ID',
  'SALESFORCE_COLLECTOR_CLIENT_SECRET',
  'SALESFORCE_COLLECTOR_REFRESH_TOKEN',
  'SALESFORCE_API_VERSION',
  // Google Workspace
  'GWS_ADMIN_SUBJECT',
  'GWS_COLLECTOR_SA_KEY',
  'GWS_COLLECTOR_CLIENT_ID',
  'GWS_COLLECTOR_CLIENT_SECRET',
  'GWS_COLLECTOR_REFRESH_TOKEN',
  'GWS_GRANTED_SCOPES',
  'GWS_DRIVE_USERS',
  'GWS_REPORT_APPLICATIONS',
  // GitHub
  'GITHUB_ORG',
  'GITHUB_ORGS',
  'GITHUB_ENTERPRISE',
  'GITHUB_REPOS',
  'GITHUB_APP_ID',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_APP_ENTERPRISE_INSTALLATION_ID',
  'GITHUB_APP_PRIVATE_KEY',
  'GITHUB_ENTERPRISE_APP_ID',
  'GITHUB_ENTERPRISE_APP_INSTALLATION_ID',
  'GITHUB_ENTERPRISE_APP_PRIVATE_KEY',
  'GITHUB_OWNER_TOKEN',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'GITHUB_COLLECTOR_OAUTH_TOKEN',
  'GITHUB_COLLECTOR_REFRESH_TOKEN',
  'GITHUB_OAUTH_SCOPES',
  // Slack
  'SLACK_TEAM_ID',
  'SLACK_ENTERPRISE_ID',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_COLLECTOR_USER_TOKEN',
  'SLACK_COLLECTOR_BOT_TOKEN',
  'SLACK_CONFIG_TOKEN',
  'SLACK_CONFIG_REFRESH_TOKEN',
  'SLACK_COLLECTOR_REFRESH_TOKEN',
  'SLACK_OAUTH_SCOPES',
  'SLACK_EXTRA_CHANNELS',
  'SLACK_INTEGRATION_LOGS',
  // Atlassian
  'ATLASSIAN_SITE_URL',
  'ATLASSIAN_SITE_URLS',
  'ATLASSIAN_CLOUD_ID',
  'ATLASSIAN_COLLECTOR_EMAIL',
  'ATLASSIAN_COLLECTOR_API_TOKEN',
  'ATLASSIAN_COLLECTOR_CLIENT_ID',
  'ATLASSIAN_COLLECTOR_CLIENT_SECRET',
  'ATLASSIAN_COLLECTOR_REFRESH_TOKEN',
  'ATLASSIAN_OAUTH_SCOPES',
  'ATLASSIAN_ORG_ID',
  'ATLASSIAN_COLLECTOR_ORG_API_KEY',
  'ATLASSIAN_ORG_AUDIT_API_KEY',
  // GCP (Gemini Enterprise)
  'GCP_COLLECTOR_CLIENT_ID',
  'GCP_COLLECTOR_CLIENT_SECRET',
  'GCP_COLLECTOR_REFRESH_TOKEN',
  'GCP_PROJECTS',
  'GCP_DISCOVER_PROJECTS',
  'GCP_DISCOVERY_LOCATIONS',
  'GCP_REGIONS',
  // 1Password
  'ONEPASSWORD_SERVICE_ACCOUNT_TOKEN',
  'ONEPASSWORD_EVENTS_TOKEN',
  'ONEPASSWORD_ACCOUNT_ID',
  'ONEPASSWORD_EVENTS_HOST',
  // Microsoft 365 (Entra ID)
  'M365_TENANT_ID',
  'M365_CLIENT_ID',
  'M365_CLIENT_SECRET',
  // Snowflake (엔진 머지 대기 — 입력 칸 선반영)
  'SNOWFLAKE_ACCOUNT',
  'SNOWFLAKE_HOST',
  'SNOWFLAKE_COLLECTOR_USER',
  'SNOWFLAKE_COLLECTOR_PRIVATE_KEY',
  // AWS
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_ACCOUNT_ID',
  // Splunk
  'SPLUNK_URL',
  'SPLUNK_TOKEN',
  'SPLUNK_TLS_SHA256',
  'SPLUNK_CA_FILE',
  'SPLUNK_SOURCES_FILE',
  // AI
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'AEGI_ASSISTANT_PROVIDER',
  'AEGI_ASSISTANT_MODEL',
  'AEGI_ASSISTANT_API_KEY',
  'AEGI_ASSISTANT_REASONING_EFFORT',
])

/** 비밀값이 아닌 식별자·URL 키 (UI 입력창 초기 힌트 표시용) */
export const NON_SECRET_HINT_KEYS = new Set([
  'OKTA_ORG_URL',
  'OKTA_COLLECTOR_CLIENT_ID',
  'OKTA_COLLECTOR_KEY_ID',
  'OKTA_SCOPES',
  'GWS_GRANTED_SCOPES',
  'GITHUB_OAUTH_SCOPES',
  'SLACK_OAUTH_SCOPES',
  'ATLASSIAN_OAUTH_SCOPES',
  'SALESFORCE_INSTANCE_URL',
  'SALESFORCE_COLLECTOR_CLIENT_ID',
  'GWS_COLLECTOR_CLIENT_ID',
  'GWS_ADMIN_SUBJECT',
  'GITHUB_ORG',
  'GITHUB_ORGS',
  'GITHUB_ENTERPRISE',
  'GITHUB_APP_ID',
  'GITHUB_APP_INSTALLATION_ID',
  'GITHUB_OAUTH_CLIENT_ID',
  'SLACK_TEAM_ID',
  'SLACK_ENTERPRISE_ID',
  'SLACK_CLIENT_ID',
  'ATLASSIAN_SITE_URL',
  'ATLASSIAN_SITE_URLS',
  'ATLASSIAN_CLOUD_ID',
  'ATLASSIAN_COLLECTOR_EMAIL',
  'ATLASSIAN_COLLECTOR_CLIENT_ID',
  'ATLASSIAN_ORG_ID',
  'GCP_COLLECTOR_CLIENT_ID',
  'GCP_PROJECTS',
  'GCP_DISCOVER_PROJECTS',
  'GCP_DISCOVERY_LOCATIONS',
  'GCP_REGIONS',
  'ONEPASSWORD_ACCOUNT_ID',
  'ONEPASSWORD_EVENTS_HOST',
  'M365_TENANT_ID',
  'M365_CLIENT_ID',
  'SNOWFLAKE_ACCOUNT',
  'SNOWFLAKE_HOST',
  'SNOWFLAKE_COLLECTOR_USER',
  'AWS_REGION',
  'AWS_ACCOUNT_ID',
  'SPLUNK_URL',
  'SPLUNK_TLS_SHA256',
  'SPLUNK_CA_FILE',
  'SPLUNK_SOURCES_FILE',
  'AEGI_ASSISTANT_PROVIDER',
  'AEGI_ASSISTANT_MODEL',
  'AEGI_ASSISTANT_REASONING_EFFORT',
])

/** .env 하나에 모든 설정을 둔다. 프로세스 환경변수가 있으면 그것이 이긴다 */
export function loadEnv(file = ENV_FILE): Record<string, string> {
  const fromFile = fs.existsSync(file) ? parseEnvFile(fs.readFileSync(file, 'utf8')) : {}
  const out: Record<string, string> = { ...fromFile }
  for (const k of Object.keys(fromFile)) if (process.env[k]) out[k] = process.env[k]!
  for (const [k, v] of Object.entries(process.env)) if (v && /^(AEGI_|ANTHROPIC_|GEMINI_|OPENAI_|SPLUNK_)/.test(k)) out[k] = v
  return out
}

/**
 * 허용된 SaaS 자격증명 키만 검증한 뒤 원자적(임시 파일 + 0600/icacls + rename)으로 .env 파일에 저장하고
 * 실행 중인 서버의 메모리 env 객체에도 즉시 반영한다.
 */
export function saveEnvValues(updates: Record<string, string>, targetEnv?: Record<string, string>, file = ENV_FILE): void {
  const clean: Record<string, string> = {}
  for (const [key, rawVal] of Object.entries(updates)) {
    if (!ALLOWED_ENV_KEYS.has(key)) {
      const err = new Error(`허용되지 않은 환경변수 키입니다: ${key}`) as Error & { code?: string }
      err.code = `key_not_allowed:${key}`
      throw err
    }
    let val = String(rawVal ?? '').trim()
    if (key === 'GWS_COLLECTOR_SA_KEY' && val) {
      try {
        val = JSON.stringify(JSON.parse(val))
      } catch {
        // leave as-is if not standard JSON
      }
    }
    clean[key] = val
  }
  if (Object.keys(clean).length === 0) return
  if ('ATLASSIAN_ORG_AUDIT_API_KEY' in clean && !('ATLASSIAN_COLLECTOR_ORG_API_KEY' in clean)) {
    clean.ATLASSIAN_COLLECTOR_ORG_API_KEY = clean.ATLASSIAN_ORG_AUDIT_API_KEY
  } else if ('ATLASSIAN_COLLECTOR_ORG_API_KEY' in clean && !('ATLASSIAN_ORG_AUDIT_API_KEY' in clean)) {
    clean.ATLASSIAN_ORG_AUDIT_API_KEY = clean.ATLASSIAN_COLLECTOR_ORG_API_KEY
  }
  atomicUpdateEnvFile(file, clean)
  if (targetEnv) {
    for (const [k, v] of Object.entries(clean)) {
      if (!v) delete targetEnv[k]
      else targetEnv[k] = v
    }
  }
}

/** 자식 프로세스 수집 후 회전된 토큰 등 디스크 .env 의 최신 값을 메모리 env 에 동기화한다 */
export function reloadEnvFromDisk(targetEnv: Record<string, string>, file = ENV_FILE): void {
  if (!fs.existsSync(file)) return
  const fromFile = parseEnvFile(fs.readFileSync(file, 'utf8'))
  for (const [k, v] of Object.entries(fromFile)) {
    if (ALLOWED_ENV_KEYS.has(k)) targetEnv[k] = v
  }
}

export interface AiTestRecord {
  ok: boolean
  provider: string
  model: string
  effort?: ReasoningEffort | null
  at: string
  message?: string
}

/** 대시보드 UI 에 전달할 설정 여부(boolean)와 비민감 식별값 힌트(hints)만 만든다 (비밀값·토큰 원문은 절대 포함하지 않음) */
export function localTokenStatus(env: Record<string, string>, aiTest: AiTestRecord | null = null): {
  configured: Record<string, boolean>
  hints: Record<string, string>
  aiReady: boolean
  aiModel?: string
  aiProvider?: string
  aiEffort: ReasoningEffort | null
  aiEffortSetting: string
  aiTest: AiTestRecord | null
} {
  const configured: Record<string, boolean> = {}
  const hints: Record<string, string> = {}
  for (const key of ALLOWED_ENV_KEYS) {
    const isSet = Boolean((env[key] && env[key]!.trim()) || (env[`${key}_FILE`] && env[`${key}_FILE`]!.trim()))
    configured[key] = isSet
    if (isSet && NON_SECRET_HINT_KEYS.has(key) && env[key]) {
      hints[key] = env[key]!
    }
  }
  const ai = assistantEnv(env)
  const provider = (ai.AEGI_ASSISTANT_PROVIDER || env.AEGI_ASSISTANT_PROVIDER || 'anthropic') as ProviderName
  const model = ai.AEGI_ASSISTANT_MODEL || defaultModel(provider)
  const aiEffortSetting = env.AEGI_ASSISTANT_REASONING_EFFORT || ''
  const aiEffort = resolveReasoningEffort(provider, model, aiEffortSetting)
  return {
    configured,
    hints,
    aiReady: Boolean(ai.AEGI_ASSISTANT_API_KEY),
    aiModel: model,
    aiProvider: provider,
    aiEffort,
    aiEffortSetting,
    aiTest: aiTest ?? null,
  }
}

/** AI 설정. AEGI_ASSISTANT_* 가 없으면 흔한 이름(ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY)에서 고른다 */
/** 127.0.0.1 밖으로 열 때 쓰는 접속 비밀번호. 예전 이름 AEGI_DEMO_PASSWORD 도 읽는다 */
export function accessPassword(env: Record<string, string>): string {
  return env.AEGI_PASSWORD || env.AEGI_DEMO_PASSWORD || ''
}

export function assistantEnv(env: Record<string, string>) {
  if (env.AEGI_ASSISTANT_API_KEY) {
    return { AEGI_ASSISTANT_API_KEY: env.AEGI_ASSISTANT_API_KEY, AEGI_ASSISTANT_MODEL: env.AEGI_ASSISTANT_MODEL || defaultModel(env.AEGI_ASSISTANT_PROVIDER),
      AEGI_ASSISTANT_PROVIDER: env.AEGI_ASSISTANT_PROVIDER, AEGI_ASSISTANT_BASE_URL: env.AEGI_ASSISTANT_BASE_URL,
      AEGI_ASSISTANT_REASONING_EFFORT: env.AEGI_ASSISTANT_REASONING_EFFORT }
  }
  const pick = env.ANTHROPIC_API_KEY ? 'anthropic' : env.GEMINI_API_KEY ? 'gemini' : env.OPENAI_API_KEY ? 'openai' : null
  if (!pick) return {}
  const key = pick === 'anthropic' ? env.ANTHROPIC_API_KEY : pick === 'gemini' ? env.GEMINI_API_KEY : env.OPENAI_API_KEY
  return { AEGI_ASSISTANT_API_KEY: key, AEGI_ASSISTANT_PROVIDER: pick, AEGI_ASSISTANT_MODEL: env.AEGI_ASSISTANT_MODEL || defaultModel(pick),
    AEGI_ASSISTANT_REASONING_EFFORT: env.AEGI_ASSISTANT_REASONING_EFFORT }
}

export function defaultModel(provider?: string) {
  if (provider === 'gemini') return 'gemini-3.6-flash'
  if (provider === 'openai') return 'gpt-5.5'
  return 'claude-sonnet-5-5'
}
