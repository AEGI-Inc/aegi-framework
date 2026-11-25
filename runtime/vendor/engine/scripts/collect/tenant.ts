/**
 * 테넌트 확인: 자격증명이 설정의 조직·워크스페이스를 가리키는지 본다. 다르면 그 SaaS 를 수집하지 않는다.
 *
 * 회차마다 SaaS 조직이 바뀐다(예: 2회차 aegi.men 은 Slack AEGI Company, 1회차 aegi.site 는 Sandbox 2).
 * 자격증명과 설정이 다른 회차를 가리키면 다른 조직의 원본이 섞여 Cross-SaaS 연결과 게시 결과가 틀어진다.
 *
 * - Okta: 자격증명 OKTA_ORG_URL 의 호스트를 설정 okta.orgHost 와 견준다(요청 없이). 다르면 Okta 호출 전부 skipped.
 * - Salesforce: 자격증명 SALESFORCE_INSTANCE_URL 의 호스트를 설정 salesforce.instanceHost 와 견준다(요청 없이).
 * - Slack: SL-00 이 team.info(봇 토큰)와 auth.test(조직 토큰) 응답을 저장 전에 slack.teamId·enterpriseId 와 견준다.
 *   다르면 SL-00 이 failed(tenant_mismatch)이고 Runner 가 남은 Slack 호출(수집 API 목록 호출 포함)을 건너뛴다.
 */
import type { CallDef } from './lib/runner'
import { normalizeOktaOrgUrl } from './lib/auth'
import type { CollectorConfig, Credentials } from './config'

export function oktaTenantMismatch(config: CollectorConfig, creds: Credentials): string | null {
  const want = config.okta.orgHost?.trim().toLowerCase()
  const url = creds.get('OKTA_ORG_URL')
  if (!want || !url) return null
  let host: string
  try { host = new URL(normalizeOktaOrgUrl(url)).host.toLowerCase() } catch { return `tenant_mismatch:okta org url 을 읽을 수 없음 (설정 ${want})` }
  return host === want ? null : `tenant_mismatch:okta ${host} != 설정 ${want}`
}

export function salesforceTenantMismatch(config: CollectorConfig, creds: Credentials): string | null {
  const want = config.salesforce?.instanceHost?.trim().toLowerCase()
  const url = creds.get('SALESFORCE_INSTANCE_URL')
  if (!want || !url) return null
  let host: string
  try { host = new URL(url.trim()).host.toLowerCase() } catch { return `tenant_mismatch:salesforce instance url 을 읽을 수 없음 (설정 ${want})` }
  return host === want ? null : `tenant_mismatch:salesforce ${host} != 설정 ${want}`
}

/** 정적으로 알 수 있는 테넌트 불일치가 있는 SaaS 의 호출을 모두 실행 불가로 만든다 */
export function guardTenants(calls: CallDef[], config: CollectorConfig, creds: Credentials): CallDef[] {
  const reasons: Partial<Record<string, string>> = { okta: oktaTenantMismatch(config, creds) ?? undefined, salesforce: salesforceTenantMismatch(config, creds) ?? undefined }
  if (!reasons.okta && !reasons.salesforce) return calls
  return calls.map(c => (reasons[c.provider] ? { ...c, unavailable: () => reasons[c.provider]! } : c))
}

/** team.info 응답: team.id 가 설정 팀이고, 엔터프라이즈 id 가 있으면 그것도 같아야 한다 */
export function slackTeamInfoMismatch(body: any, s: CollectorConfig['slack']): string | null {
  const team = body?.team
  if (!team?.id) return null
  if (team.id !== s.teamId) return `slack team ${team.id} != 설정 ${s.teamId}`
  if (team.enterprise_id && s.enterpriseId && team.enterprise_id !== s.enterpriseId) return `slack enterprise ${team.enterprise_id} != 설정 ${s.enterpriseId}`
  return null
}

/** auth.test 응답: 조직 설치 토큰은 enterprise_id, 워크스페이스 토큰은 team_id 로 견준다 */
export function slackAuthTestMismatch(body: any, s: CollectorConfig['slack']): string | null {
  if (body?.ok !== true) return null
  if (body.enterprise_id) return s.enterpriseId && body.enterprise_id !== s.enterpriseId ? `slack enterprise ${body.enterprise_id} != 설정 ${s.enterpriseId}` : null
  if (body.team_id && body.team_id !== s.teamId && body.team_id !== s.enterpriseId) return `slack team ${body.team_id} != 설정 ${s.teamId}`
  return null
}
