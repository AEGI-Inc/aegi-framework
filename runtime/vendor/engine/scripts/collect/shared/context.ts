/**
 * 정규화 설정과 SaaS 사이에 넘기는 색인.
 *
 * 설정은 collector.config.json 의 `normalize` 절이다 (git 제외, 예시는 collector.config.example.json).
 */

export interface NormalizeConfig {
  /** 역할 → Okta 로그인 이메일 (계획서 3.2절). Identity Link 의 사람 이름에 쓴다. 범용 정규화는 비운다 */
  people?: Record<string, string>
  /** 역할 → 각 SaaS 계정 (태그용, 없으면 생략) */
  accounts?: Record<string, { github?: string; slack?: string }>
  /** 민감 경로 (6.5.1절). 범용 정규화는 비운다 */
  sensitivePaths?: string[]
  /**
   * 측정 도구 계정 — 수집하려고 채널에 넣은 수집 봇처럼 우리가 만든 계정. 그 계정의 채널·그룹 멤버십은
   * 그래프에서 빼고 보고서에 남긴다(탐지 룰이 수신자·채널 멤버로 세지 않게). 객체 자체는 남긴다.
   * 값은 원천 id (Slack 은 봇 사용자 id U… 또는 봇 id B…)
   */
  measurementPrincipals?: { slack?: string[] }
}

export class NormalizeContext {
  customRoles = new Map<string, string>()
  github?: { orgKey: string; byLogin: Map<string, string>; repoByName: Map<string, string> }
  okta?: { orgKey?: string; userByLogin: Map<string, string>; appsByName: Map<string, string[]> }
  slack?: { workspaceKey?: string; userByEmail: Map<string, string>; botUserToBot: Map<string, string> }
  gws?: { customerKey?: string; userByEmail: Map<string, string>; userByAlias?: Map<string, string> }

  private roleByEmail = new Map<string, string>()
  private roleByAccount = new Map<string, string>()

  config: NormalizeConfig & { people: Record<string, string>; sensitivePaths: string[] }

  constructor(config: NormalizeConfig, public slackTeamId = '') {
    this.config = { ...config, people: config.people ?? {}, sensitivePaths: config.sensitivePaths ?? [] }
    for (const [role, email] of Object.entries(this.config.people)) this.roleByEmail.set(email.toLowerCase(), role)
    for (const [role, acc] of Object.entries(config.accounts ?? {})) {
      if (acc.github) this.roleByAccount.set(`github:${acc.github}`, role)
      if (acc.slack) this.roleByAccount.set(`slack:${acc.slack}`, role)
    }
  }

  get sensitivePaths(): string[] {
    return this.config.sensitivePaths
  }

  /** 사람의 역할 글자 (admin, A~F, target) */
  roleOfEmail(email: string | undefined | null): string | undefined {
    return email ? this.roleByEmail.get(email.toLowerCase()) : undefined
  }

  roleOfAccount(provider: 'github' | 'slack', account: string | undefined): string | undefined {
    return account ? this.roleByAccount.get(`${provider}:${account}`) : undefined
  }

  isMeasurementPrincipal(provider: 'slack', id: string | undefined): boolean {
    return !!id && (this.config.measurementPrincipals?.[provider] ?? []).includes(id)
  }
}
