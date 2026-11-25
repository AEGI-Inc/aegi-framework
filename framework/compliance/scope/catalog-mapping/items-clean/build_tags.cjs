// 11-09 태그 사전(최소 집합)과 167개 항목의 태그를 만들고 검사한다.
// 출력: tags.json, item-tags.v2.tsv, bob/aegi/compliance-tags-20261109.md
const fs = require('fs')
const path = require('path')
const O = __dirname
const rd = f => fs.readFileSync(path.join(O, f), 'utf8').split('\n').filter(Boolean).map(JSON.parse)

// [태그, 뜻, 넣는 것, 넣지 않는 것, 옛 태그, 예시 종류]
const TAGS = [
  ['account', '계정', '사람·서비스·봇 계정 객체', '그룹, 권한 부여', ['account'], 'okta User, gws User, salesforce User, slack member·bot, github user'],
  ['group', '사용자 묶음', '그룹, 팀, 조직 단위(OU)', '그룹 소속 자체(access_grant)', ['group', 'org_structure(OU)'], 'okta Group, salesforce Group, atlassian Group, gws OrgUnit'],
  ['provisioning', '계정 자동 생성·삭제 경로', 'SCIM·디렉터리 동기화·JIT, 프로필 매핑, 그룹 자동 배정 규칙', '계정 자체', ['provisioning'], 'okta ProfileMapping·ProvisioningConnection·GroupRule'],
  ['access_role', '권한 정의', '역할, 권한 묶음, 권한 체계(무엇을 할 수 있나)', '누구에게 줬나(access_grant)', ['access_policy'], 'salesforce PermissionSet·Profile, gws Role, okta IamRole, atlassian PermissionScheme·ProjectRole, github organization-role'],
  ['access_grant', '권한 부여', '역할 배정, 그룹 소속, 앱 배정, 파일·공간 권한(ACL). has_role_on·member_of 관계', '권한 정의(access_role)', ['access_grant'], 'gws RoleAssignment·Permission·AclRule, salesforce PermissionSetAssignment·GroupMember, okta AppUser'],
  ['admin_access', '관리자 권한', '관리자 역할 정의와 그 배정, 관리자 API 토큰. access_role·access_grant·credential 중 하나와 같이 붙는다', '일반 권한', ['privileged_role', 'admin_grant', 'admin_credential'], 'gws Role(ADMIN)·RoleAssignment(admin), okta IamRole·CustomRole·ApiToken, salesforce 관리자 Profile'],
  ['sharing', '외부·공개 공유', '조직 밖이나 불특정 다수에게 열린 권한, 링크 공유, 공유 정책 설정', '조직 안 권한', ['sharing'], 'gws Permission·AclRule, gws Policy(drive_and_docs), atlassian SharePermission, salesforce ContentDocumentLink'],
  ['authentication', '로그인 방법', '로그인·MFA 정책, 인증기, 사용자 인증 수단 등록, SSO·IdP 설정', '비밀번호 규칙(password_policy), 세션(session_policy)', ['auth_policy', 'auth_factor'], 'okta Policy·Authenticator·UserFactor, gws Policy(security.*), salesforce SamlSsoConfig·AuthProvider'],
  ['password_policy', '비밀번호 규칙', '비밀번호 길이·복잡도·변경 주기, 로그인 실패 잠금', '', ['password_policy'], 'gws Policy(security.password), okta password Policy·UserLockoutSettings'],
  ['session_policy', '세션 설정', '세션 유지 시간, 유휴 종료, 동시 접속 제한', '', ['session_policy'], 'gws Policy(security.session_controls), okta sign-on Policy'],
  ['network_policy', '접속 위치 제한', 'IP 허용 목록, 네트워크 구역, 신뢰 출처(CORS·CSP)', '', ['network_policy'], 'okta NetworkZone·TrustedOrigin, salesforce CspTrustedSite'],
  ['device', '단말', '등록 기기, 기기 관리(MDM) 설정', '', ['device'], 'gws Device, gws Policy(devices.*), okta Device'],
  ['credential', '비밀값', 'API 토큰, PAT, 시크릿, 배포 키, 이름 있는 자격증명(값은 수집하지 않고 존재만)', '사용자가 앱에 준 OAuth 승인(integration)', ['credential', 'admin_credential'], 'github actions-secret·personal-access-tokens·deploy-key, okta ApiToken, salesforce NamedCredential'],
  ['encryption', '암호화', '암호화 설정, 암호 키 관리(BYOK·EKM), 서명·암호화 키', '', ['encryption_setting', 'crypto_key'], 'gws Policy(gmail S/MIME·confidential_mode), okta JsonWebKey'],
  ['integration', '연결된 외부 앱', '설치 앱, 연결 앱, OAuth 클라이언트, 사용자가 허용한 OAuth 토큰, 앱 접근 제어 설정', '테넌트 안 자동화(automation)', ['integration', 'oauth_grant', 'app_identity'], 'github installation, gws Application·Token, okta Application, salesforce ConnectedApplication·OauthToken, slack app'],
  ['automation', '테넌트 안 자동화', '워크플로, 자동화 규칙, 스크립트, 예약 작업, 봇 정의, CI 워크플로', '외부 앱(integration)', ['automation'], 'atlassian AutomationRule, github workflow, gws Apps Script, salesforce Flow·ApexClass·CronTrigger'],
  ['data_flow', '테넌트 밖과 데이터가 오가는 통로', '웹훅, 외부 호스트, 메일 전달, 이벤트 훅, 원격 사이트, 수신 주소·폼', '', ['data_flow', 'external_endpoint', 'inbound_endpoint'], 'github org-hook, okta EventHook, gws MailForwarding, salesforce RemoteSiteSetting·WebToLead'],
  ['data_resource', '업무 데이터', '파일, 메일함, 채널·메시지, 페이지·스페이스, 프로젝트, 저장소, CRM 레코드·보고서', '데이터에 대한 설정(각 설정 태그)', ['data_resource', 'record(메시지)'], 'gws File·Mailbox, slack conversation·Message, atlassian page·Project, salesforce Lead·Report'],
  ['data_classification', '데이터 등급·라벨', '민감도 라벨, 필드 분류, 보안 수준', '유출 방지 규칙(dlp)', ['data_classification'], 'salesforce FieldSecurityClassification, atlassian SecurityScheme'],
  ['dlp', '유출 방지', 'DLP 규칙, 마스킹·필드 숨김, 다운로드·복사 제한', '', ['dlp'], 'gws Policy(rule.dlp)'],
  ['data_region', '데이터 저장 위치', '데이터 지역(residency) 설정', '', ['data_region'], 'gws Policy(data_regions)'],
  ['retention_backup', '데이터 수명', '보존 기간, 삭제·파기 설정, 보관(vault·legal hold), 백업·내보내기', '', ['retention_backup'], 'gws Policy(vault·takeout), github check-immutable-releases'],
  ['monitoring', '기록·감시 설정', '감사 로그 설정·보관, 알림 규칙과 알림, 이상 행위 탐지, 로그 전달', '로그 자체(객체 종류가 아니라 이벤트)', ['monitoring'], 'gws Alert·Policy(alerts), okta ThreatInsightConfiguration·BehaviorRule'],
  ['code_repo', '소스 저장소', '저장소, 브랜치, 커밋', '', ['code_repo', 'record(커밋)'], 'github Repository·branches·commit'],
  ['code_access', '소스 저장소 접근', '저장소 협업자·팀 권한, 배포 키', '', ['code_access'], 'github deploy-key, 저장소 권한 관계'],
  ['code_security', '코드 보안 검사', '코드·시크릿 스캔, 의존성 경고, 보안 구성', '', ['code_security'], 'github code-security-configuration'],
  ['change_control', '변경 통제', '브랜치 보호, 룰셋, 다중 승인, 불변 릴리스', '', ['change_control'], 'github repository-ruleset·branch-with-protection, gws Policy(multi_party_approval)'],
  ['tenant', '테넌트 자체', '조직·워크스페이스·엔터프라이즈 객체, 도메인', '테넌트 설정(tenant_policy)', ['tenant', 'org_structure(도메인)'], 'gws Customer·Domains, okta OrgSetting, salesforce Organization, slack team, github Enterprise'],
  ['tenant_policy', '테넌트 보안 설정 전체', '모든 테넌트 설정 객체. 구체 태그(session_policy 등)가 붙은 설정에도 같이 붙는다', '', ['tenant_policy'], 'gws Policy, atlassian Policy, okta OrgSetting, salesforce Organization'],
  ['malware', '악성코드·피싱 방어', '첨부 파일 검사, 링크 보호, 스푸핑 방지', '', ['malware'], 'gws Policy(gmail.email_attachment_safety 등)'],
  ['ownership', '소유·책임', 'owned_by 관계, 소유자 필드', '', ['ownership'], 'owned_by 관계'],
]

// 항목 → 태그. @obj = 관계는 빼고 객체만
const T = {
  'ISO27001:5.11': 'account access_grant ownership credential integration',
  'ISO27001:5.12': '@type=data_resource data_classification data_resource',
  'ISO27001:5.13': 'data_classification',
  'ISO27001:5.14': 'sharing dlp data_flow',
  'ISO27001:5.15': 'access_role access_grant',
  'ISO27001:5.16': 'account group provisioning',
  'ISO27001:5.17': 'credential authentication password_policy',
  'ISO27001:5.18': 'access_grant admin_access provisioning',
  'ISO27001:5.23': 'tenant tenant_policy integration',
  'ISO27001:5.3': 'access_role admin_access',
  'ISO27001:5.33': 'monitoring retention_backup',
  'ISO27001:5.34': '@type=data_resource data_resource data_classification access_grant dlp',
  'ISO27001:5.9': '@type=data_resource tenant data_resource code_repo integration ownership',
  'ISO27001:6.7': 'network_policy authentication session_policy device',
  'ISO27001:7.14': 'device',
  'ISO27001:7.9': 'device',
  'ISO27001:8.1': 'device',
  'ISO27001:8.10': 'retention_backup data_resource',
  'ISO27001:8.11': 'dlp data_classification',
  'ISO27001:8.12': 'dlp sharing',
  'ISO27001:8.13': 'retention_backup',
  'ISO27001:8.15': 'monitoring',
  'ISO27001:8.16': 'monitoring',
  'ISO27001:8.19': 'integration automation',
  'ISO27001:8.2': 'admin_access',
  'ISO27001:8.22': 'network_policy tenant_policy',
  'ISO27001:8.24': 'encryption',
  'ISO27001:8.25': 'code_security change_control code_repo',
  'ISO27001:8.28': 'code_security',
  'ISO27001:8.29': 'code_security automation',
  'ISO27001:8.3': 'access_role access_grant sharing',
  'ISO27001:8.30': 'code_access account',
  'ISO27001:8.31': 'tenant code_repo',
  'ISO27001:8.32': 'change_control',
  'ISO27001:8.33': 'data_resource data_classification',
  'ISO27001:8.34': 'admin_access access_grant',
  'ISO27001:8.4': 'code_access change_control',
  'ISO27001:8.5': 'authentication password_policy session_policy',
  'ISO27001:8.7': 'malware',
  'ISO27001:8.8': 'code_security code_repo',
  'ISO27001:8.9': 'tenant tenant_policy',
  'ISMS-P:1.2.1-01': '@obj @type=data_resource tenant data_resource integration code_repo device automation',
  'ISMS-P:1.2.1-02': '@type=data_resource data_resource data_classification',
  'ISMS-P:1.2.1-03': '@obj @type=data_resource tenant data_resource integration code_repo device automation',
  'ISMS-P:1.2.2-01': 'data_flow integration automation',
  'ISMS-P:1.2.2-02': '@type=data_resource data_flow integration data_resource',
  'ISMS-P:1.2.2-03': '@type=data_resource data_flow integration data_resource',
  'ISMS-P:2.1.3-01': 'data_classification dlp data_resource',
  'ISMS-P:2.1.3-02': 'ownership',
  'ISMS-P:2.10.1-02': 'admin_access',
  'ISMS-P:2.10.1-04': 'tenant_policy',
  'ISMS-P:2.10.1-05': 'tenant_policy',
  'ISMS-P:2.10.2-02': 'tenant_policy admin_access tenant',
  'ISMS-P:2.10.2-03': 'admin_access authentication monitoring',
  'ISMS-P:2.10.2-04': 'tenant_policy monitoring',
  'ISMS-P:2.10.5-02': 'data_flow encryption integration',
  'ISMS-P:2.11.3-01': 'monitoring',
  'ISMS-P:2.2.1-02': 'admin_access account',
  'ISMS-P:2.2.1-03': 'account access_grant',
  'ISMS-P:2.2.2-01': 'access_role admin_access',
  'ISMS-P:2.2.5-02': 'account access_grant provisioning integration',
  'ISMS-P:2.3.1-01': 'integration account',
  'ISMS-P:2.3.4-01': 'account access_grant integration',
  'ISMS-P:2.5.1-01': 'account provisioning access_grant',
  'ISMS-P:2.5.1-02': 'access_role access_grant group',
  'ISMS-P:2.5.2-01': 'account',
  'ISMS-P:2.5.2-02': 'account',
  'ISMS-P:2.5.3-01': 'authentication password_policy',
  'ISMS-P:2.5.3-02': 'authentication network_policy',
  'ISMS-P:2.5.4-01': 'password_policy',
  'ISMS-P:2.5.4-02': 'password_policy',
  'ISMS-P:2.5.4-03': 'authentication credential',
  'ISMS-P:2.5.5-01': 'admin_access',
  'ISMS-P:2.5.5-02': 'admin_access account',
  'ISMS-P:2.5.6-01': 'monitoring',
  'ISMS-P:2.5.6-02': 'access_grant admin_access account',
  'ISMS-P:2.6.2-02': 'session_policy',
  'ISMS-P:2.6.3-01': 'access_role access_grant',
  'ISMS-P:2.6.3-02': 'session_policy',
  'ISMS-P:2.6.3-03': 'admin_access authentication',
  'ISMS-P:2.6.3-05': 'dlp access_role',
  'ISMS-P:2.6.6-03': 'network_policy authentication session_policy device tenant_policy',
  'ISMS-P:2.7.1-02': 'encryption',
  'ISMS-P:2.7.2-02': 'encryption',
  'ISMS-P:2.8.3-01': 'tenant code_repo',
  'ISMS-P:2.8.3-02': 'change_control monitoring',
  'ISMS-P:2.8.4-01': 'data_resource',
  'ISMS-P:2.8.4-02': 'data_resource retention_backup',
  'ISMS-P:2.8.5-01': 'code_access',
  'ISMS-P:2.8.5-02': 'code_repo change_control',
  'ISMS-P:2.8.5-03': 'code_repo change_control',
  'ISMS-P:2.9.4-01': 'monitoring',
  'ISMS-P:2.9.4-02': 'monitoring admin_access',
  'ISMS-P:2.9.4-03': 'monitoring retention_backup tenant_policy',
  'ISMS-P:3.1.3-01': 'dlp data_resource',
  'ISMS-P:3.2.5-04': 'data_resource access_grant',
  'ISMS-P:3.2.5-05': 'retention_backup data_resource',
  'ISMS-P:3.3.1-05': 'sharing data_flow',
  'ISMS-P:3.3.1-06': 'access_grant sharing integration',
  'ISMS-P:3.3.4-04': 'data_region data_flow integration',
  'ISMS-P:3.4.1-02': 'retention_backup data_resource',
  'ISMS-P:3.4.1-03': 'retention_backup data_resource',
  'ISMS-P:3.4.2-01': 'retention_backup data_resource',
  'ISMS-P:3.4.2-02': 'retention_backup data_resource',
  'ISMS-P:3.4.2-03': 'access_role access_grant data_resource',
  'ISMS-P:3.4.2-04': 'access_grant',
  'PIPA:admin-73464:article-8:p1': 'sharing integration',
  'PIPA:admin-73464:article-8:p2': 'integration data_flow',
  'PIPA:admin-73464:article-10:p1': 'retention_backup data_resource',
  'PIPA:admin-73464:article-11:p1': 'retention_backup data_resource',
  'PIPA:admin-73464:article-15:p1': 'access_grant account',
  'PIPA:admin-73464:article-15:p2': 'access_role access_grant',
  'PIPA:admin-73464:article-15:p3': 'access_grant provisioning',
  'PIPA:admin-73464:article-17:p0': 'integration access_grant',
  'PIPA:admin-73493:article-5:p1': 'access_role access_grant',
  'PIPA:admin-73493:article-5:p2': 'access_grant provisioning',
  'PIPA:admin-73493:article-5:p3': 'monitoring retention_backup',
  'PIPA:admin-73493:article-5:p4': 'account',
  'PIPA:admin-73493:article-5:p5': 'authentication',
  'PIPA:admin-73493:article-5:p6': 'password_policy authentication',
  'PIPA:admin-73493:article-6:p1': 'network_policy monitoring',
  'PIPA:admin-73493:article-6:p2': 'authentication network_policy',
  'PIPA:admin-73493:article-6:p3': 'sharing',
  'PIPA:admin-73493:article-6:p4': 'session_policy',
  'PIPA:admin-73493:article-6:p5': 'device',
  'PIPA:admin-73493:article-6-2:p1': 'network_policy admin_access',
  'PIPA:admin-73493:article-7:p2': 'encryption',
  'PIPA:admin-73493:article-7:p3': 'encryption',
  'PIPA:admin-73493:article-7:p4': 'encryption',
  'PIPA:admin-73493:article-7:p5': 'device encryption',
  'PIPA:admin-73493:article-7:p6': 'encryption',
  'PIPA:admin-73493:article-8:p1': 'monitoring retention_backup',
  'PIPA:admin-73493:article-8:p2': 'monitoring',
  'PIPA:admin-73493:article-8:p3': 'monitoring',
  'PIPA:admin-73493:article-11:p0': 'retention_backup',
  'PIPA:admin-73493:article-12:p1': 'access_grant admin_access',
  'PIPA:admin-73493:article-13:p1': 'retention_backup data_resource',
  'PIPA:admin-73493:article-13:p2': 'retention_backup data_resource',
  'PIPA:admin-73493:article-13:p3': 'retention_backup',
  'PIPA:admin-73493:annex-1:p0': 'access_role dlp',
  'PIPA:law-011357:article-17:p1': 'sharing integration data_flow',
  'PIPA:law-011357:article-17:p4': 'sharing integration',
  'PIPA:law-011357:article-18:p1': 'sharing integration',
  'PIPA:law-011357:article-18:p5': 'integration data_flow',
  'PIPA:law-011357:article-19:p0': 'integration',
  'PIPA:law-011357:article-21:p1': 'retention_backup data_resource',
  'PIPA:law-011357:article-21:p2': 'retention_backup data_resource',
  'PIPA:law-011357:article-21:p3': 'retention_backup data_resource',
  'PIPA:law-011357:article-23:p2': 'encryption data_classification',
  'PIPA:law-011357:article-24:p3': 'encryption data_classification',
  'PIPA:law-011357:article-24-2:p2': 'encryption',
  'PIPA:law-011357:article-26:p5': 'integration sharing',
  'PIPA:law-011357:article-28:p1': 'access_grant account',
  'PIPA:law-011357:article-28-2:p2': 'sharing',
  'PIPA:law-011357:article-28-4:p1': 'data_resource access_grant',
  'PIPA:law-011357:article-28-5:p2': 'retention_backup data_resource',
  'PIPA:law-011357:article-28-8:p1': 'data_region data_flow integration',
  'PIPA:law-011357:article-28-8:p4': 'data_region',
  'PIPA:law-011357:article-29:p0': 'access_role access_grant authentication encryption monitoring',
  'PIPA:law-011357:article-34-2:p1': 'sharing dlp',
  'PIPA:law-011468:article-14-2:p1': 'sharing encryption',
  'PIPA:law-011468:article-16:p1': 'retention_backup data_resource',
  'PIPA:law-011468:article-21:p1': 'encryption access_grant',
  'PIPA:law-011468:article-21-2:p1': 'encryption',
  'PIPA:law-011468:article-29-5:p1': 'data_resource access_grant',
  'PIPA:law-011468:article-29-10:p1': 'data_region',
  'PIPA:law-011468:article-30:p1': 'access_role access_grant authentication encryption monitoring session_policy network_policy',
}

// 옛 태그 → 새 태그 (S1R 대상 태그와 비교할 때 쓴다)
const OLD2NEW = {}
for (const [tag, , , , olds] of TAGS) for (const o of olds) OLD2NEW[o.replace(/\(.*\)$/, '')] ??= tag
Object.assign(OLD2NEW, { privileged_role: 'admin_access', admin_grant: 'admin_access', admin_credential: 'credential', record: null, org_structure: 'group' })

const items = rd('saas-items.jsonl')
const names = new Set(TAGS.map(t => t[0]))
const errs = []
const keys = new Set(items.map(r => r.item_key))
for (const k of Object.keys(T)) if (!keys.has(k)) errs.push(`없는 항목: ${k}`)
const tagsOf = {}
for (const r of items) {
  const s = T[r.item_key]
  if (!s) { errs.push(`태그 없음: ${r.item_key}`); continue }
  const list = s.split(/\s+/)
  for (const t of list) if (!t.startsWith('@') && !names.has(t)) errs.push(`사전에 없는 태그 ${t}: ${r.item_key}`)
  tagsOf[r.item_key] = list.filter(t => !t.startsWith('@'))
}
// 각 태그를 쓰는 항목
const use = {}
for (const [k, l] of Object.entries(tagsOf)) for (const t of l) (use[t] ||= []).push(k)
for (const n of names) if (!use[n]) errs.push(`안 쓰는 태그: ${n}`)
// 최소성: 두 태그가 어느 항목에서도 갈리지 않으면 합칠 수 있다
const merge = []
const arr = [...names]
for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
  const a = arr[i], b = arr[j]
  const split = Object.values(tagsOf).some(l => l.includes(a) !== l.includes(b))
  if (!split) merge.push(`${a}+${b}`)
}
if (merge.length) errs.push(`갈리지 않는 태그 쌍: ${merge.join(', ')}`)
// S1R 대상 태그(옛 이름)를 새 이름으로 옮겨 비교
let same = 0
const diffs = []
for (const r of items) {
  const s1r = new Set(r.targets.map(t => OLD2NEW[t]).filter(Boolean))
  const now = new Set(tagsOf[r.item_key])
  const add = [...now].filter(t => !s1r.has(t)), rem = [...s1r].filter(t => !now.has(t))
  if (!add.length && !rem.length) same++
  else diffs.push({ key: r.item_key, add, rem })
}
if (errs.length) { console.error(errs.join('\n')); process.exit(1) }

fs.writeFileSync(path.join(O, 'tags.json'), JSON.stringify({
  version: '2026-11-09',
  note: '태그 하나의 어휘. 항목에 붙으면 「이 항목의 대상」, 객체 종류에 붙으면 「이 종류의 성격」. 둘이 겹치면 (항목, 종류)가 이어진다. 항목 쪽 @obj = 관계는 빼고 객체만, @type=<태그> = 그 태그로 걸린 대상은 종류(테이블) 단위.',
  tags: TAGS.map(([tag, name, includes, excludes, old, examples]) => ({ tag, name, includes, excludes, old, examples, items: use[tag].length })),
}, null, 1) + '\n')
fs.writeFileSync(path.join(O, 'item-tags.v2.tsv'), '# item_key\ttags (2026-11-09, tags.json 기준)\n' + items.map(r => `${r.item_key}\t${T[r.item_key]}`).join('\n') + '\n')

// 문서
const byKey = new Map(items.map(r => [r.item_key, r]))
const short = k => k.replace('ISO27001:', 'ISO ').replace('ISMS-P:', 'ISMS-P ').replace(/^PIPA:/, '')
let md = `# 컴플라이언스 태그 사전 (2026-11-09)\n\n`
md += `태그 ${TAGS.length}개로 167개 항목을 모두 표현했다(옛 어휘 41개에서 줄임). 태그는 하나의 어휘이고, 항목에 붙이면 「이 항목의 대상」, 객체 종류에 붙이면 「이 종류의 성격」이다. 둘이 겹치면 (항목, 종류)가 이어진다.\n\n`
md += `- 최소 기준: 어떤 항목이 A 는 대상으로 하고 B 는 대상으로 하지 않으면 A 와 B 는 다른 태그다. 어느 항목에서도 갈리지 않는 두 태그는 합친다. 지금 ${TAGS.length}개는 모든 쌍이 적어도 한 항목에서 갈린다(스크립트로 검사).\n`
md += `- 설정에 대한 항목(파기, 암호화 등)은 그 설정 태그만 붙이고 데이터 전체(data_resource)를 붙이지 않는다. data_resource 는 데이터 자체가 대상인 항목(분류, 자산 목록, 분리 보관)에만 붙인다.\n`
md += `- tenant_policy 는 「테넌트 설정 전체」 우산이다. 구체 태그가 붙은 설정 종류에도 같이 붙여, 구성 관리 항목(ISO 8.9, ISMS-P 2.10.2-02·04)이 설정 전체를 가리키게 한다.\n`
md += `- @obj: 관계는 빼고 객체만(자산 목록 항목 1.2.1-01·03).\n`
md += `- @type=<태그>: 그 태그로 걸리는 대상은 객체 하나하나가 아니라 종류(테이블) 단위다. ISMS-P 안내서가 데이터 자산을 「데이터베이스·테이블·정보 항목」 단위로 목록화하라고 해서, 자산 목록·분류 항목(ISMS-P 1.2.1-01~03, ISO 5.9, 5.12, 5.34)의 data_resource 에 붙였다. 게시할 때 레코드마다가 아니라 「종류 + 객체 수」를 대상으로 삼는다.\n`
md += `- 1.2.1-01·03 에서 account 를 뺐다(11-09 사용자 확인). 안내서의 자산 유형에 계정은 없고, 계정은 2.5.1 에서 다룬다.\n\n`
md += `## 태그로 못 가리는 것\n\n`
md += `- 로그·접속기록 자체: 객체 종류가 아니라 이벤트다. 로그 항목은 monitoring(로그 설정, 보관, 알림)까지만 잇고, 기록 내용 확인은 이벤트 쪽 몫이다. 옛 record 태그(커밋, 메시지)는 없앴다. 커밋은 code_repo, 메시지는 data_resource 다.\n`
md += `- 개인정보가 있는지, 어느 테넌트가 시험용인지 같은 인스턴스·회사 사실: 태그로 못 가른다. 그런 항목은 conditional 이고 회사 입력이 필요하다.\n`
md += `- 한 종류 안에서 성격이 갈리는 것(gws Policy, okta Policy, 관리자 역할): 종류에 태그를 붙일 때 이름·속성 조건으로 나눈다(다음 단계).\n\n`
md += `## 사전\n\n| 태그 | 뜻 | 넣는 것 | 넣지 않는 것 | 쓰는 항목 | 옛 태그 | 예시 종류 |\n|---|---|---|---|---|---|---|\n`
for (const [tag, name, inc, exc, old, ex] of TAGS) md += `| \`${tag}\` | ${name} | ${inc} | ${exc} | ${use[tag].length} | ${old.join(', ')} | ${ex} |\n`
md += `\n## 옛 태그 41개에서 바뀐 것\n\n`
md += `- 합침: privileged_role + admin_grant + admin_credential → admin_access (관리자 역할 정의만 또는 배정만 가리키는 항목이 없다)\n`
md += `- 합침: auth_policy + auth_factor → authentication (MFA 항목은 정책과 등록 수단을 같이 본다)\n`
md += `- 합침: encryption_setting + crypto_key → encryption\n`
md += `- 합침: integration + oauth_grant + app_identity → integration\n`
md += `- 합침: external_endpoint + inbound_endpoint + data_flow → data_flow\n`
md += `- 이름만 바꿈: access_policy → access_role (권한 정의. 인증 정책과 헷갈려서)\n`
md += `- 없앰: record(커밋은 code_repo, 메시지는 data_resource), org_structure(OU 는 group, 도메인은 tenant), admin_credential(credential + admin_access)\n`
md += `- 그대로 둠(항목이 갈라서): access_role 와 access_grant(퇴직·인사이동 회수 항목은 배정만 본다), password_policy·session_policy 와 authentication, data_classification 와 dlp, tenant 와 tenant_policy(자산 목록은 테넌트 자체만 본다), automation 와 integration(제3자 제공 항목은 외부 앱만 본다)\n\n`
md += `## S1R 대상 태그와 비교\n\nS1R(Gemini) 이 고른 대상 태그를 새 이름으로 옮겨 비교했다. 같음 ${same}, 다름 ${diffs.length}. 다름은 대부분 아래 두 가지다.\n\n`
md += `- 설정 항목에서 data_resource 를 뺐다(파기, 암호화, 백업 등)\n- 구체 태그가 있는데 붙어 있던 tenant_policy 를 뺐다(세션, 기기 등)\n\n`
md += `| 항목 | 더함 | 뺌 |\n|---|---|---|\n`
for (const d of diffs) md += `| ${short(d.key)} | ${d.add.join(', ')} | ${d.rem.join(', ')} |\n`
md += `\n## 항목별 태그\n\n| 항목 | 제목 | 판정 | 태그 |\n|---|---|---|---|\n`
for (const r of items) md += `| ${short(r.item_key)} | ${r.title} | ${r.decision} | ${T[r.item_key]} |\n`
fs.writeFileSync(path.join(O, '..', 'docs', 'compliance-tags-20261109.md'), md)
console.log({ tags: TAGS.length, items: items.length, same, diff: diffs.length })
console.log(Object.entries(use).map(([t, l]) => `${t}:${l.length}`).join(' '))
