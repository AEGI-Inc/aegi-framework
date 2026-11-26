/**
 * 계정 객체 한 줄의 속성만 읽어 정한 계정 상태(상태, 관리자 여부, 2단계 인증, 마지막 로그인).
 *
 * 그래프 이웃(역할 관계, 인증 요소 객체)은 보지 않는다. AI 도구 서버가 객체 한 줄만 읽기 때문이다.
 * Explorer의 accountFacts도 속성 판단은 이 함수를 쓰고, 역할과 인증 요소 이웃 판단만 따로 한다.
 * 속성이 없으면 false가 아니라 null(모름)이다.
 */
import type { FixtureObject } from '../model/object'

export interface AccountState {
  /** active, suspended, deactivated, deleted, staged, provisioned, locked_out, password_expired, recovery. 모르면 null */
  status: string | null
  /** 속성으로 알 수 있는 관리자 여부. 역할로만 알 수 있는 SaaS(Okta, GitHub)는 null */
  admin: boolean | null
  /** 2단계 인증 등록 여부 */
  mfa: boolean | null
  /** ISO 시각. 로그인 기록 없음이 명시돼 있으면 'never' */
  lastLogin: string | null
}

/** 사람이나 자동화가 로그인하는 계정 객체 종류 */
export const ACCOUNT_TYPES: ReadonlySet<string> = new Set(['User', 'user', 'User Account'])

const yes = (v: unknown) => v === true || v === 'true'
const no = (v: unknown) => v === false || v === 'false'
const flag = (v: unknown) => (yes(v) ? true : no(v) ? false : null)

/** 로그인 시각. Google Workspace는 한 번도 로그인하지 않은 계정을 1970-01-01로 준다 */
function loginTime(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const t = Date.parse(v)
  if (Number.isNaN(t)) return null
  return t <= 0 ? 'never' : new Date(t).toISOString()
}

/* 문서에 없는 Okta 상태 값은 받은 그대로 둔다 */
const OKTA_STATUS: Record<string, string> = {
  ACTIVE: 'active', SUSPENDED: 'suspended', DEPROVISIONED: 'deactivated', STAGED: 'staged', PROVISIONED: 'provisioned',
  LOCKED_OUT: 'locked_out', PASSWORD_EXPIRED: 'password_expired', RECOVERY: 'recovery',
}

/** 계정 객체의 상태. 계정 객체가 아니면 undefined */
export function accountState(object: FixtureObject): AccountState | undefined {
  return ACCOUNT_TYPES.has(object.canonical.object_type) ? principalState(object) : undefined
}

/**
 * 객체 종류를 가리지 않고 SaaS마다 같은 속성 규칙으로 읽은 상태. 실측 수집기는 원본 종류 이름(Slack 200.members[*], 200.bot)을 그대로 쓰므로
 * AI 도구는 그룹이 아닌 Principal 객체에 이 함수를 쓴다
 */
export function principalState(object: FixtureObject): AccountState {
  const p = (object.canonical.properties ?? {}) as Record<string, unknown>
  const state: AccountState = { status: null, admin: null, mfa: null, lastLogin: null }

  switch (String(object.canonical.provider).toLowerCase()) {
    case 'gws':
    case 'google-workspace': {
      const suspended = flag(p.suspended)
      if (suspended !== null) state.status = suspended ? 'suspended' : 'active'
      state.admin = yes(p.isAdmin) || yes(p.isDelegatedAdmin) ? true : no(p.isAdmin) ? false : null
      state.mfa = flag(p.isEnrolledIn2Sv)
      state.lastLogin = loginTime(p.lastLoginTime)
      break
    }
    case 'okta': {
      const s = typeof p.status === 'string' ? p.status : ''
      if (s) state.status = OKTA_STATUS[s] ?? s
      state.lastLogin = loginTime(p.lastLogin)
      break
    }
    case 'slack': {
      const deleted = flag(p.deleted)
      if (deleted !== null) state.status = deleted ? 'deleted' : 'active'
      state.admin = yes(p.is_primary_owner) || yes(p.is_owner) || yes(p.is_admin) ? true : no(p.is_admin) ? false : null
      break
    }
    case 'atlassian': {
      const active = flag(p.active)
      if (active !== null) state.status = active ? 'active' : 'deactivated'
      break
    }
    case 'salesforce': {
      const active = flag(p.is_active)
      if (active !== null) state.status = active ? 'active' : 'deactivated'
      state.lastLogin = loginTime(p.last_login)
      break
    }
    // GitHub 계정 속성에는 상태, 로그인 기록이 없다. site_admin은 GitHub 직원 표시라 조직 관리자 여부가 아니다
  }
  return state
}
