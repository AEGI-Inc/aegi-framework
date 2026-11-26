import type { FixtureObject, ObjectReferenceWrapper } from '../model/object'

/**
 * Compliance 검사 두 개(2.10.2 관리자 인증 보호, 2.11.3 관리자 권한 부여 경고 설정)를 브라우저에서 돌린다.
 * 엔진 scripts/compliance/admin_auth_compliance.py, admin_privilege_alert.py 를 그대로 옮긴 것이다(판정 규칙, 문구, 결과 모양 같음).
 * 둘 다 Profile 로 정규화된 객체(그래프)를 읽는다. 결과는 인증 적합성 판정이 아니다.
 * 같은 가명 데이터셋으로 Python 결과와 맞는지 scripts/browserChecks.test.ts 가 본다. 규칙을 바꾸려면 엔진 쪽을 먼저 바꾸고 여기와 그 시험의 기준 파일을 맞춘다.
 */
type Props = Record<string, unknown>
type Norm = { provider: string; kind: string; properties: Props; key: string; observed_at: string | null; references: Record<string, ObjectReferenceWrapper> }
export type CompanyPolicy = Record<string, unknown>

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const rec = (x: unknown): Record<string, unknown> => (isRecord(x) ? x : {})
/** Python 의 None: 없는 값과 null 을 같이 null 로 */
const n = <T>(v: T | undefined | null): T | null => (v === undefined ? null : v)
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)

const SOURCES = {
  gws: ['CIS GWS 1.4.0 4.1.1.1', 'Google small business checklist 2', 'Google Security health: Two-step verification for admins'],
  okta: ['DISA Okta STIG OKTA-APP-000560', 'Okta HealthInsight MFA for the Admin Console', 'DISA Okta STIG OKTA-APP-000190'],
}

function normalize(o: FixtureObject): Norm {
  const c = o.canonical
  const times = new Set((c.source?.observations ?? []).map(x => x.collected_at).filter((t): t is string => !!t))
  return { provider: c.provider, kind: c.object_type, properties: c.properties ?? {}, key: o.fixture_key, observed_at: times.size === 1 ? [...times][0] : null, references: c.references ?? {} }
}

function evaluateGws(objects: Norm[]) {
  const rows: Record<string, unknown>[] = []
  for (const o of objects) {
    if (o.provider !== 'gws' || o.kind !== 'User') continue
    const p = o.properties
    // 표시가 없다고 관리자가 아니라고 볼 수 없다
    const admin = p.isAdmin, delegated = p.isDelegatedAdmin, suspended = p.suspended, enforced = p.isEnforcedIn2Sv
    if (suspended === true || (admin === false && delegated === false)) continue
    let status: string, reason: string
    if (suspended !== false || (admin !== true && delegated !== true)) { status = 'unknown'; reason = '관리자 또는 활성 여부를 확인할 수 없습니다.' }
    else if (enforced === true) { status = 'pass'; reason = '2단계 인증이 강제됩니다.' }
    else if (enforced === false) { status = 'fail'; reason = '2단계 인증이 강제되지 않습니다.' }
    else if (enforced === undefined || enforced === null) { status = 'not_collected'; reason = '2단계 인증 강제 여부가 수집되지 않았습니다.' }
    else { status = 'unknown'; reason = '2단계 인증 강제 값을 해석할 수 없습니다.' }
    rows.push({ target: o.key, status, message: reason, enforced: n(p.isEnforcedIn2Sv), enrolled: n(p.isEnrolledIn2Sv), observed_at: o.observed_at, sources: SOURCES.gws,
      scope: '관리자별 2단계 인증 강제 여부; 실제 로그인 성공이나 인증수단 강도는 확인하지 않음' })
  }
  return rows
}

const OKTA_MESSAGE: Record<string, string> = { pass: '최우선 활성 규칙이 MFA를 요구합니다.', fail: '최우선 활성 규칙이 MFA를 요구하지 않습니다.', not_collected: 'MFA 요구 설정을 수집하지 못했습니다.', unknown: 'MFA 요구 여부를 확인할 수 없습니다.' }

/** 관리자 콘솔 정책에 속한 규칙만 받는다 */
function evaluateOktaPolicy(rules: Norm[]): Record<string, unknown> {
  if (rules.some(r => !(['ACTIVE', 'INACTIVE'] as unknown[]).includes(r.properties.status))) return { status: 'unknown', message: '규칙 활성 상태를 확인할 수 없습니다.', sources: SOURCES.okta }
  const active = rules.filter(r => r.properties.status === 'ACTIVE')
  if (!active.length || active.some(r => !isInt(r.properties.priority))) return { status: 'unknown', message: '활성 규칙 또는 우선순위를 확인할 수 없습니다.', sources: SOURCES.okta }
  const priority = Math.min(...active.map(r => r.properties.priority as number))
  const selected = active.filter(r => r.properties.priority === priority)
  if (selected.length !== 1) return { status: 'unknown', message: '최우선 규칙이 여러 개입니다.', sources: SOURCES.okta }
  const r = selected[0]
  const method = rec(rec(rec(r.properties.actions).appSignOn).verificationMethod)
  const factor = method.factorMode
  const status = factor === '2FA' ? 'pass' : factor === '1FA' ? 'fail' : factor === undefined || factor === null ? 'not_collected' : 'unknown'
  const constraints = method.constraints
  const phishing = Array.isArray(constraints) ? constraints.filter(isRecord).map(c => n(rec(c.possession).phishingResistant)) : []
  const total = Array.isArray(constraints) ? constraints.length : 0
  const phishingStatus = !phishing.length || phishing.length !== total || phishing.some(x => x === null) ? 'unknown' : phishing.every(x => x === 'REQUIRED') ? 'pass' : 'fail'
  return { target: r.key, status, factor_mode: n(factor), phishing_resistant_status: phishingStatus, message: OKTA_MESSAGE[status], observed_at: r.observed_at, sources: SOURCES.okta,
    scope: '관리자 콘솔의 최우선 활성 규칙만 확인하며 모든 관리자 적용 여부는 확인하지 않습니다.' }
}

function evaluateOkta(objects: Norm[]): Record<string, unknown> {
  const policies = objects.filter(o => o.provider === 'okta' && o.kind === 'Policy' && o.properties.name === 'Okta Admin Console' && o.properties.type === 'ACCESS_POLICY')
  if (policies.length !== 1) return { status: 'unknown', message: '관리자 콘솔 정책을 유일하게 확인할 수 없습니다.', sources: SOURCES.okta }
  const policy = policies[0]
  const rules: Norm[] = []
  let ambiguous = false
  for (const o of objects) {
    if (o.provider !== 'okta' || o.kind !== 'PolicyRule') continue
    const targets = o.references.parent?.targets ?? []
    const keys = targets.filter(t => t.identifier_type === 'primary' && !t.status).map(t => t.value)
    if (keys.includes(policy.key) && keys.length === 1) rules.push(o)
    else if (!keys.length || keys.includes(policy.key)) ambiguous = true
  }
  if (ambiguous) return { status: 'unknown', message: '일부 규칙의 정책 연결이 불명확합니다.', sources: SOURCES.okta }
  return evaluateOktaPolicy(rules)
}

/** 기준 및 적용 대상을 모르면 인증 설정을 회사 기준 위반으로 해석하지 않는다 */
function comparePolicy(observed: unknown, required: boolean | undefined, applicable: boolean) {
  if (!applicable) return 'unknown'
  if (observed === null || observed === undefined) return 'not_collected'
  if (required === undefined) return observed === true ? 'pass' : 'fail'
  if (required === false) return 'not_required'
  return observed === true ? 'compliant' : 'noncompliant'
}

/** 등록 관측은 강제 정책이나 관리자 전체의 적용 여부와 다르다 */
function auxiliaryEnrollment(objects: Norm[], provider: string, field: string) {
  const rows: Record<string, unknown>[] = []
  for (const item of objects) {
    if (item.provider !== provider) continue
    const props = item.properties
    if (!(field in props) || props[field] === null || props[field] === undefined) continue
    if (provider === 'slack' && !['is_admin', 'is_owner', 'is_primary_owner'].some(flag => props[flag] === true)) continue
    rows.push({ target: item.key, value: props[field], observed_at: item.observed_at })
  }
  return rows
}

/** ISMS-P 2.10.2 관리자 인증 보호. companyPolicy 는 { require_mfa?: boolean } 만 받는다 */
export function evaluateAdminAuth(objects: FixtureObject[], companyPolicy?: CompanyPolicy | null) {
  const normalized = objects.filter(o => o.fixture_key).map(normalize)
  const policy = companyPolicy ?? {}
  if (Object.keys(policy).some(k => k !== 'require_mfa') || ('require_mfa' in policy && typeof policy.require_mfa !== 'boolean')) throw new Error('company policy requires a boolean require_mfa')
  const required = policy.require_mfa as boolean | undefined
  const gws = evaluateGws(normalized)
  for (const row of gws) {
    const raw = row.status as string
    row.observation_status = raw
    row.status = raw === 'unknown' || raw === 'not_collected' ? raw : comparePolicy(row.enforced, required, true)
    row.basis = required === undefined ? 'CIS GWS 4.1.1.1 및 Google 체크리스트의 관리자 MFA 강제' : '입력된 회사 MFA 강제 기준'
  }
  const okta = evaluateOkta(normalized)
  okta.observation_status = okta.status
  okta.basis = 'DISA Okta STIG 및 Okta HealthInsight 관리자 콘솔 규칙'
  okta.company_comparison_scope = '정책이 모든 관리자에게 적용되는지는 별도 확인이 필요합니다.'
  if (required !== undefined) okta.company_status = 'unknown'
  const github: Record<string, unknown>[] = []
  for (const o of normalized) {
    if (o.provider === 'github' && (o.kind === 'Organization' || o.kind === 'organization-full')) {
      const value = o.properties.two_factor_requirement_enabled
      github.push({ target: o.key, status: value === true ? 'pass' : value === false ? 'fail' : 'not_collected', organization_2fa_required: n(value), observed_at: o.observed_at,
        scope: '조직 구성원 MFA 요구 설정. 관리자별 실제 사용 및 적용은 확인하지 못함', sources: ['CIS GitHub 1.2.0 1.3.5', 'GitHub Docs Secure accounts / 2FA organization'] })
    }
  }
  const slackEnrollment = auxiliaryEnrollment(normalized, 'slack', 'has_2fa')
  const salesforceEnrollment = auxiliaryEnrollment(normalized, 'salesforce', 'mfa_methods')
  return {
    criterion: '2.10.2', check: '관리자 인증 보호',
    decision_basis: { company_require_mfa: n(required), default_check: '기존 공개 기준에 따른 MFA 강제 여부', recommendation: '관리자 MFA 강제', recommendation_sources: ['CIS GWS 1.4.0 4.1.1.1', 'DISA Okta STIG OKTA-APP-000560'], recommendation_is_company_policy: false },
    gws,
    gws_coverage: !gws.length ? '대상 또는 수집 범위를 확인할 수 없습니다.' : '수집된 관리자 후보만 확인',
    okta,
    github: github.length ? github : [{ status: 'not_collected', scope: '조직 인증 설정을 수집한 Object가 없습니다.' }],
    slack: { status: slackEnrollment.length ? 'unknown' : 'not_collected', scope: '관리자 인증 강제 정책 미확인; 등록 상태는 강제 여부와 다름', enrollment_observations: slackEnrollment },
    salesforce: { status: 'not_collected', scope: '사용자와 Profile·권한 세트 관계가 있으나 관리자 판별 및 MFA 강제 값을 확인하지 못함', enrollment_observations: salesforceEnrollment, // rules-ok: 엔진 scripts/compliance 판정 문구와 글자까지 같아야 한다
      next_step: '관리자 정의와 권한 범위를 정하고 MFA 강제 설정의 수집·정규화 여부를 확인' }, // rules-ok: 엔진 scripts/compliance 판정 문구와 글자까지 같아야 한다
    atlassian: { status: 'not_collected', scope: '사용자·그룹·프로젝트 역할 관계가 있으나 조직 관리자 인증 강제 값을 확인하지 못함', next_step: '조직 관리자 범위와 인증 정책을 확인할 데이터 경로를 조사' }, // rules-ok: 엔진 scripts/compliance 판정 문구와 글자까지 같아야 한다
    scope: '관측된 설정의 일부 결과이며 ISMS-P 항목 전체의 적합성 판정이 아닙니다.',
  }
}

const RULE_NAME = 'User granted Admin privilege'
const aggregate = (statuses: string[]) => statuses.includes('fail') ? 'fail' : statuses.includes('unknown') ? 'unknown' : statuses.includes('not_collected') ? 'not_collected' : 'pass'

/** ISMS-P 2.11.3 관리자 권한 부여 경고 설정. 회사 기준을 받지 않는다 */
export function evaluateAdminPrivilegeAlert(objects: FixtureObject[], companyPolicy?: CompanyPolicy | null) {
  if (companyPolicy && Object.keys(companyPolicy).length) throw new Error('this check accepts no company policy')
  const rows: Record<string, unknown>[] = []
  for (const raw of objects) {
    if (!raw.fixture_key) continue
    const item = normalize(raw)
    const props = item.properties
    const value = props.setting_value
    if (item.provider !== 'gws' || item.kind !== 'Policy' || props.setting_type !== 'settings/rule.system_defined_alerts' || !isRecord(value) || value.displayName !== RULE_NAME) continue
    const action = value.action
    const alert = isRecord(action) ? action.alertCenterAction : null
    const conf = isRecord(alert) ? alert.alertCenterConfig : null
    const recipients = isRecord(alert) ? alert.recipients : null
    const state = value.state
    const severity = isRecord(conf) ? n(conf.severity) : null
    const recipient = Array.isArray(recipients) ? recipients.some(r => isRecord(r) && r.allSuperAdmins === true) : null
    const anyRecipient = Array.isArray(recipients) ? recipients.length > 0 : null
    const conditions = [
      { name: '규칙 활성화', value: n(state), expected: 'ACTIVE', status: state === undefined || state === null ? 'not_collected' : state === 'ACTIVE' ? 'pass' : state === 'INACTIVE' ? 'fail' : 'unknown' },
      { name: '심각도', value: severity, expected: 'MEDIUM', status: severity === null ? 'not_collected' : severity === 'MEDIUM' ? 'pass' : typeof severity === 'string' ? 'fail' : 'unknown' },
      { name: '전체 최고 관리자 수신', value: recipient, expected: true, status: recipient === null ? 'not_collected' : recipient ? 'pass' : 'fail' },
    ]
    const status = aggregate(conditions.map(x => x.status))
    // CIS 결과는 그대로 두고, SaaS 공통 기준선은 활성화와 수신 대상 존재만 본다(CIS 의 심각도, 수신 범위는 보지 않음)
    const scubaConditions = [conditions[0], { name: '수신 대상 존재', value: anyRecipient, expected: true, status: anyRecipient === null ? 'not_collected' : anyRecipient ? 'pass' : 'fail' }]
    const scubaStatus = aggregate(scubaConditions.map(x => x.status))
    rows.push({ target: item.key, status, observed_at: item.observed_at, conditions, common_status: scubaStatus, common_conditions: scubaConditions,
      references: [{ source: 'CISA SCuBA GWS.COMMONCONTROLS.13.1', status: scubaStatus, scope: '전체 시스템 규칙 중 이 규칙의 활성화와 수신 대상만 확인한 부분 결과', conditions: scubaConditions }] })
  }
  return {
    criterion: '2.11.3', check: '관리자 권한 부여 경고 설정', source: 'CIS Google Workspace 1.4.0 6.4',
    scope: 'Google Workspace의 해당 경고 규칙 설정만 확인합니다. 실제 경고 전달, 이벤트 발생과 대응 여부는 확인하지 않습니다.',
    gws: rows.length ? rows : [{ status: 'not_collected', conditions: [], message: '해당 경고 규칙이 수집된 데이터에 없습니다.' }],
    other_saas: '다른 SaaS의 관리자 권한 부여 경고 설정 검사는 아직 연결하지 않았습니다.',
    other_providers: [
      { name: 'Okta', status: 'not_supported', reason: '기존 목록에서 동일한 권한 부여 경고 설정 검사를 찾지 못했습니다. System Log 이벤트 수집은 경고 설정과 별도입니다.' },
      { name: 'GitHub', status: 'not_supported', reason: '기존 목록의 알림 검사는 다른 대상이며 감사 로그 검토는 경고 설정 확인과 다릅니다.' },
      { name: 'Slack', status: 'not_supported', reason: '관리자 역할 변경 감사 이벤트와 경고 규칙 설정은 다릅니다. 해당 설정의 수집 경로를 확인하지 못했습니다.' },
      { name: 'Salesforce', status: 'not_supported', reason: '기존 설정 모니터링 항목은 수동 검사이며 관리자 권한 부여 경고 설정은 확인하지 못했습니다.' },
      { name: 'Atlassian', status: 'not_supported', reason: '의심 활동 알림은 미수집으로 기록되어 있고 관리자 권한 부여에 적용되는지 확인하지 못했습니다.' },
    ],
  }
}
