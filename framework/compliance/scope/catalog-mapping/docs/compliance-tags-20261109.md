# 컴플라이언스 태그 사전 (2026-11-09)

태그 31개로 167개 항목을 모두 표현했다(옛 어휘 41개에서 줄임). 태그는 하나의 어휘이고, 항목에 붙이면 「이 항목의 대상」, 객체 종류에 붙이면 「이 종류의 성격」이다. 둘이 겹치면 (항목, 종류)가 이어진다.

- 최소 기준: 어떤 항목이 A 는 대상으로 하고 B 는 대상으로 하지 않으면 A 와 B 는 다른 태그다. 어느 항목에서도 갈리지 않는 두 태그는 합친다. 지금 31개는 모든 쌍이 적어도 한 항목에서 갈린다(스크립트로 검사).
- 설정에 대한 항목(파기, 암호화 등)은 그 설정 태그만 붙이고 데이터 전체(data_resource)를 붙이지 않는다. data_resource 는 데이터 자체가 대상인 항목(분류, 자산 목록, 분리 보관)에만 붙인다.
- tenant_policy 는 「테넌트 설정 전체」 우산이다. 구체 태그가 붙은 설정 종류에도 같이 붙여, 구성 관리 항목(ISO 8.9, ISMS-P 2.10.2-02·04)이 설정 전체를 가리키게 한다.
- @obj: 관계는 빼고 객체만(자산 목록 항목 1.2.1-01·03).
- @type=<태그>: 그 태그로 걸리는 대상은 객체 하나하나가 아니라 종류(테이블) 단위다. ISMS-P 안내서가 데이터 자산을 「데이터베이스·테이블·정보 항목」 단위로 목록화하라고 해서, 자산 목록·분류 항목(ISMS-P 1.2.1-01~03, ISO 5.9, 5.12, 5.34)의 data_resource 에 붙였다. 게시할 때 레코드마다가 아니라 「종류 + 객체 수」를 대상으로 삼는다.
- 1.2.1-01·03 에서 account 를 뺐다(11-09 사용자 확인). 안내서의 자산 유형에 계정은 없고, 계정은 2.5.1 에서 다룬다.

## 태그로 못 가리는 것

- 로그·접속기록 자체: 객체 종류가 아니라 이벤트다. 로그 항목은 monitoring(로그 설정, 보관, 알림)까지만 잇고, 기록 내용 확인은 이벤트 쪽 몫이다. 옛 record 태그(커밋, 메시지)는 없앴다. 커밋은 code_repo, 메시지는 data_resource 다.
- 개인정보가 있는지, 어느 테넌트가 시험용인지 같은 인스턴스·회사 사실: 태그로 못 가른다. 그런 항목은 conditional 이고 회사 입력이 필요하다.
- 한 종류 안에서 성격이 갈리는 것(gws Policy, okta Policy, 관리자 역할): 종류에 태그를 붙일 때 이름·속성 조건으로 나눈다(다음 단계).

## 사전

| 태그 | 뜻 | 넣는 것 | 넣지 않는 것 | 쓰는 항목 | 옛 태그 | 예시 종류 |
|---|---|---|---|---|---|---|
| `account` | 계정 | 사람·서비스·봇 계정 객체 | 그룹, 권한 부여 | 16 | account | okta User, gws User, salesforce User, slack member·bot, github user |
| `group` | 사용자 묶음 | 그룹, 팀, 조직 단위(OU) | 그룹 소속 자체(access_grant) | 2 | group, org_structure(OU) | okta Group, salesforce Group, atlassian Group, gws OrgUnit |
| `provisioning` | 계정 자동 생성·삭제 경로 | SCIM·디렉터리 동기화·JIT, 프로필 매핑, 그룹 자동 배정 규칙 | 계정 자체 | 6 | provisioning | okta ProfileMapping·ProvisioningConnection·GroupRule |
| `access_role` | 권한 정의 | 역할, 권한 묶음, 권한 체계(무엇을 할 수 있나) | 누구에게 줬나(access_grant) | 13 | access_policy | salesforce PermissionSet·Profile, gws Role, okta IamRole, atlassian PermissionScheme·ProjectRole, github organization-role |
| `access_grant` | 권한 부여 | 역할 배정, 그룹 소속, 앱 배정, 파일·공간 권한(ACL). has_role_on·member_of 관계 | 권한 정의(access_role) | 30 | access_grant | gws RoleAssignment·Permission·AclRule, salesforce PermissionSetAssignment·GroupMember, okta AppUser |
| `admin_access` | 관리자 권한 | 관리자 역할 정의와 그 배정, 관리자 API 토큰. access_role·access_grant·credential 중 하나와 같이 붙는다 | 일반 권한 | 16 | privileged_role, admin_grant, admin_credential | gws Role(ADMIN)·RoleAssignment(admin), okta IamRole·CustomRole·ApiToken, salesforce 관리자 Profile |
| `sharing` | 외부·공개 공유 | 조직 밖이나 불특정 다수에게 열린 권한, 링크 공유, 공유 정책 설정 | 조직 안 권한 | 14 | sharing | gws Permission·AclRule, gws Policy(drive_and_docs), atlassian SharePermission, salesforce ContentDocumentLink |
| `authentication` | 로그인 방법 | 로그인·MFA 정책, 인증기, 사용자 인증 수단 등록, SSO·IdP 설정 | 비밀번호 규칙(password_policy), 세션(session_policy) | 14 | auth_policy, auth_factor | okta Policy·Authenticator·UserFactor, gws Policy(security.*), salesforce SamlSsoConfig·AuthProvider |
| `password_policy` | 비밀번호 규칙 | 비밀번호 길이·복잡도·변경 주기, 로그인 실패 잠금 |  | 6 | password_policy | gws Policy(security.password), okta password Policy·UserLockoutSettings |
| `session_policy` | 세션 설정 | 세션 유지 시간, 유휴 종료, 동시 접속 제한 |  | 7 | session_policy | gws Policy(security.session_controls), okta sign-on Policy |
| `network_policy` | 접속 위치 제한 | IP 허용 목록, 네트워크 구역, 신뢰 출처(CORS·CSP) |  | 8 | network_policy | okta NetworkZone·TrustedOrigin, salesforce CspTrustedSite |
| `device` | 단말 | 등록 기기, 기기 관리(MDM) 설정 |  | 9 | device | gws Device, gws Policy(devices.*), okta Device |
| `credential` | 비밀값 | API 토큰, PAT, 시크릿, 배포 키, 이름 있는 자격증명(값은 수집하지 않고 존재만) | 사용자가 앱에 준 OAuth 승인(integration) | 3 | credential, admin_credential | github actions-secret·personal-access-tokens·deploy-key, okta ApiToken, salesforce NamedCredential |
| `encryption` | 암호화 | 암호화 설정, 암호 키 관리(BYOK·EKM), 서명·암호화 키 |  | 17 | encryption_setting, crypto_key | gws Policy(gmail S/MIME·confidential_mode), okta JsonWebKey |
| `integration` | 연결된 외부 앱 | 설치 앱, 연결 앱, OAuth 클라이언트, 사용자가 허용한 OAuth 토큰, 앱 접근 제어 설정 | 테넌트 안 자동화(automation) | 25 | integration, oauth_grant, app_identity | github installation, gws Application·Token, okta Application, salesforce ConnectedApplication·OauthToken, slack app |
| `automation` | 테넌트 안 자동화 | 워크플로, 자동화 규칙, 스크립트, 예약 작업, 봇 정의, CI 워크플로 | 외부 앱(integration) | 5 | automation | atlassian AutomationRule, github workflow, gws Apps Script, salesforce Flow·ApexClass·CronTrigger |
| `data_flow` | 테넌트 밖과 데이터가 오가는 통로 | 웹훅, 외부 호스트, 메일 전달, 이벤트 훅, 원격 사이트, 수신 주소·폼 |  | 11 | data_flow, external_endpoint, inbound_endpoint | github org-hook, okta EventHook, gws MailForwarding, salesforce RemoteSiteSetting·WebToLead |
| `data_resource` | 업무 데이터 | 파일, 메일함, 채널·메시지, 페이지·스페이스, 프로젝트, 저장소, CRM 레코드·보고서 | 데이터에 대한 설정(각 설정 태그) | 32 | data_resource, record(메시지) | gws File·Mailbox, slack conversation·Message, atlassian page·Project, salesforce Lead·Report |
| `data_classification` | 데이터 등급·라벨 | 민감도 라벨, 필드 분류, 보안 수준 | 유출 방지 규칙(dlp) | 9 | data_classification | salesforce FieldSecurityClassification, atlassian SecurityScheme |
| `dlp` | 유출 방지 | DLP 규칙, 마스킹·필드 숨김, 다운로드·복사 제한 |  | 9 | dlp | gws Policy(rule.dlp) |
| `data_region` | 데이터 저장 위치 | 데이터 지역(residency) 설정 |  | 4 | data_region | gws Policy(data_regions) |
| `retention_backup` | 데이터 수명 | 보존 기간, 삭제·파기 설정, 보관(vault·legal hold), 백업·내보내기 |  | 23 | retention_backup | gws Policy(vault·takeout), github check-immutable-releases |
| `monitoring` | 기록·감시 설정 | 감사 로그 설정·보관, 알림 규칙과 알림, 이상 행위 탐지, 로그 전달 | 로그 자체(객체 종류가 아니라 이벤트) | 18 | monitoring | gws Alert·Policy(alerts), okta ThreatInsightConfiguration·BehaviorRule |
| `code_repo` | 소스 저장소 | 저장소, 브랜치, 커밋 |  | 9 | code_repo, record(커밋) | github Repository·branches·commit |
| `code_access` | 소스 저장소 접근 | 저장소 협업자·팀 권한, 배포 키 |  | 3 | code_access | github deploy-key, 저장소 권한 관계 |
| `code_security` | 코드 보안 검사 | 코드·시크릿 스캔, 의존성 경고, 보안 구성 |  | 4 | code_security | github code-security-configuration |
| `change_control` | 변경 통제 | 브랜치 보호, 룰셋, 다중 승인, 불변 릴리스 |  | 6 | change_control | github repository-ruleset·branch-with-protection, gws Policy(multi_party_approval) |
| `tenant` | 테넌트 자체 | 조직·워크스페이스·엔터프라이즈 객체, 도메인 | 테넌트 설정(tenant_policy) | 8 | tenant, org_structure(도메인) | gws Customer·Domains, okta OrgSetting, salesforce Organization, slack team, github Enterprise |
| `tenant_policy` | 테넌트 보안 설정 전체 | 모든 테넌트 설정 객체. 구체 태그(session_policy 등)가 붙은 설정에도 같이 붙는다 |  | 9 | tenant_policy | gws Policy, atlassian Policy, okta OrgSetting, salesforce Organization |
| `malware` | 악성코드·피싱 방어 | 첨부 파일 검사, 링크 보호, 스푸핑 방지 |  | 1 | malware | gws Policy(gmail.email_attachment_safety 등) |
| `ownership` | 소유·책임 | owned_by 관계, 소유자 필드 |  | 3 | ownership | owned_by 관계 |

## 옛 태그 41개에서 바뀐 것

- 합침: privileged_role + admin_grant + admin_credential → admin_access (관리자 역할 정의만 또는 배정만 가리키는 항목이 없다)
- 합침: auth_policy + auth_factor → authentication (MFA 항목은 정책과 등록 수단을 같이 본다)
- 합침: encryption_setting + crypto_key → encryption
- 합침: integration + oauth_grant + app_identity → integration
- 합침: external_endpoint + inbound_endpoint + data_flow → data_flow
- 이름만 바꿈: access_policy → access_role (권한 정의. 인증 정책과 헷갈려서)
- 없앰: record(커밋은 code_repo, 메시지는 data_resource), org_structure(OU 는 group, 도메인은 tenant), admin_credential(credential + admin_access)
- 그대로 둠(항목이 갈라서): access_role 와 access_grant(퇴직·인사이동 회수 항목은 배정만 본다), password_policy·session_policy 와 authentication, data_classification 와 dlp, tenant 와 tenant_policy(자산 목록은 테넌트 자체만 본다), automation 와 integration(제3자 제공 항목은 외부 앱만 본다)

## S1R 대상 태그와 비교

S1R(Gemini) 이 고른 대상 태그를 새 이름으로 옮겨 비교했다. 같음 61, 다름 106. 다름은 대부분 아래 두 가지다.

- 설정 항목에서 data_resource 를 뺐다(파기, 암호화, 백업 등)
- 구체 태그가 있는데 붙어 있던 tenant_policy 를 뺐다(세션, 기기 등)

| 항목 | 더함 | 뺌 |
|---|---|---|
| ISO 5.11 | integration | provisioning |
| ISO 5.13 |  | data_resource |
| ISO 5.14 |  | tenant_policy |
| ISO 5.18 |  | group |
| ISO 5.33 | monitoring | access_role |
| ISO 5.9 | integration |  |
| ISO 8.1 |  | access_role |
| ISO 8.11 |  | data_resource |
| ISO 8.12 |  | tenant_policy |
| ISO 8.13 |  | data_resource |
| ISO 8.16 |  | tenant_policy |
| ISO 8.19 | automation | tenant_policy |
| ISO 8.2 |  | credential, access_role |
| ISO 8.22 | tenant_policy |  |
| ISO 8.28 |  | code_repo |
| ISO 8.29 |  | code_repo |
| ISO 8.3 | sharing | data_resource |
| ISO 8.30 |  | code_repo, access_grant |
| ISO 8.32 |  | code_security, automation |
| ISO 8.34 |  | account |
| ISO 8.4 | change_control | code_repo, code_security, credential |
| ISO 8.7 |  | tenant_policy |
| ISO 8.8 |  | monitoring |
| ISO 8.9 | tenant | access_role, authentication |
| ISMS-P 1.2.1-01 | code_repo, device, automation | account |
| ISMS-P 1.2.1-03 | code_repo, device, automation | account |
| ISMS-P 1.2.2-03 | data_resource | sharing, change_control |
| ISMS-P 2.1.3-01 |  | access_role |
| ISMS-P 2.1.3-02 |  | data_resource, account |
| ISMS-P 2.10.1-02 |  | access_role |
| ISMS-P 2.10.1-04 | tenant_policy | access_role, admin_access |
| ISMS-P 2.10.1-05 | tenant_policy | access_role, monitoring |
| ISMS-P 2.10.2-02 | tenant | access_role |
| ISMS-P 2.10.2-03 | monitoring |  |
| ISMS-P 2.10.2-04 |  | change_control |
| ISMS-P 2.10.5-02 | integration | sharing |
| ISMS-P 2.11.3-01 |  | data_flow |
| ISMS-P 2.2.1-03 |  | data_resource |
| ISMS-P 2.2.5-02 | integration |  |
| ISMS-P 2.3.4-01 | integration | data_flow |
| ISMS-P 2.5.1-01 |  | credential |
| ISMS-P 2.5.2-01 |  | authentication |
| ISMS-P 2.5.2-02 |  | tenant_policy |
| ISMS-P 2.5.3-01 | password_policy |  |
| ISMS-P 2.5.3-02 | network_policy |  |
| ISMS-P 2.5.4-01 |  | authentication |
| ISMS-P 2.5.4-02 |  | authentication |
| ISMS-P 2.5.4-03 | credential |  |
| ISMS-P 2.5.5-01 |  | access_role |
| ISMS-P 2.5.6-01 |  | access_grant |
| ISMS-P 2.6.2-02 |  | tenant_policy |
| ISMS-P 2.6.3-02 |  | tenant_policy |
| ISMS-P 2.6.3-03 | authentication | access_role |
| ISMS-P 2.6.3-05 |  | data_resource |
| ISMS-P 2.6.6-03 | network_policy, session_policy, device | sharing |
| ISMS-P 2.7.1-02 |  | tenant_policy |
| ISMS-P 2.7.2-02 |  | credential |
| ISMS-P 2.8.3-01 |  | access_role |
| ISMS-P 2.8.3-02 | change_control | data_resource, access_role |
| ISMS-P 2.8.4-01 |  | dlp |
| ISMS-P 2.8.5-01 |  | code_repo, access_role |
| ISMS-P 2.8.5-02 | change_control | code_security, tenant_policy |
| ISMS-P 2.9.4-01 |  | data_flow |
| ISMS-P 2.9.4-02 | monitoring |  |
| ISMS-P 2.9.4-03 | retention_backup |  |
| ISMS-P 3.1.3-01 |  | tenant_policy |
| ISMS-P 3.2.5-04 | access_grant | access_role |
| ISMS-P 3.3.1-06 | integration | data_flow |
| ISMS-P 3.3.4-04 | integration |  |
| ISMS-P 3.4.1-02 | data_resource | tenant_policy |
| ISMS-P 3.4.1-03 | data_resource | tenant_policy |
| ISMS-P 3.4.2-03 | access_grant |  |
| ISMS-P 3.4.2-04 |  | access_role, admin_access |
| admin-73464:article-10:p1 | data_resource |  |
| admin-73464:article-15:p1 | account | access_role |
| admin-73464:article-15:p2 |  | admin_access |
| admin-73464:article-17:p0 | access_grant | access_role |
| admin-73493:article-5:p1 |  | admin_access |
| admin-73493:article-5:p3 | retention_backup |  |
| admin-73493:article-5:p6 | password_policy |  |
| admin-73493:article-6:p1 | monitoring |  |
| admin-73493:article-6:p5 |  | tenant_policy |
| admin-73493:article-7:p2 |  | data_resource |
| admin-73493:article-8:p1 | retention_backup |  |
| admin-73493:article-13:p1 | data_resource |  |
| admin-73493:article-13:p2 | data_resource |  |
| admin-73493:article-13:p3 |  | data_resource |
| admin-73493:annex-1:p0 | dlp | admin_access, automation |
| law-011357:article-19:p0 |  | access_grant |
| law-011357:article-21:p1 | data_resource |  |
| law-011357:article-21:p2 | data_resource |  |
| law-011357:article-23:p2 | data_classification | access_role, data_resource |
| law-011357:article-24:p3 | data_classification | data_resource |
| law-011357:article-24-2:p2 |  | data_resource |
| law-011357:article-28:p1 |  | access_role |
| law-011357:article-28-2:p2 |  | data_resource |
| law-011357:article-28-4:p1 |  | encryption |
| law-011357:article-28-5:p2 | data_resource |  |
| law-011357:article-28-8:p1 | data_flow | tenant, sharing |
| law-011357:article-28-8:p4 |  | tenant, encryption |
| law-011468:article-16:p1 | data_resource |  |
| law-011468:article-21:p1 | access_grant | access_role, data_resource |
| law-011468:article-21-2:p1 |  | data_resource |
| law-011468:article-29-5:p1 |  | access_role |
| law-011468:article-29-10:p1 |  | tenant, encryption |
| law-011468:article-30:p1 | network_policy |  |

## 항목별 태그

| 항목 | 제목 | 판정 | 태그 |
|---|---|---|---|
| ISO 5.11 | 자산 반납 | conditional | account access_grant ownership credential integration |
| ISO 5.12 | 정보 분류 | conditional | @type=data_resource data_classification data_resource |
| ISO 5.13 | 정보 표시 | conditional | data_classification |
| ISO 5.14 | 정보 전송 | apply | sharing dlp data_flow |
| ISO 5.15 | 접근 통제 | apply | access_role access_grant |
| ISO 5.16 | ID 관리 | apply | account group provisioning |
| ISO 5.17 | 인증 정보 | apply | credential authentication password_policy |
| ISO 5.18 | 접근 권한 | apply | access_grant admin_access provisioning |
| ISO 5.23 | 클라우드 서비스 이용 시 정보보호 | apply | tenant tenant_policy integration |
| ISO 5.3 | 직무 분리 | conditional | access_role admin_access |
| ISO 5.33 | 기록 보호 | apply | monitoring retention_backup |
| ISO 5.34 | 개인정보 보호 | conditional | @type=data_resource data_resource data_classification access_grant dlp |
| ISO 5.9 | 정보와 관련 자산 목록 | apply | @type=data_resource tenant data_resource code_repo integration ownership |
| ISO 6.7 | 원격 근무 | apply | network_policy authentication session_policy device |
| ISO 7.14 | 장비 안전 폐기·재사용 | conditional | device |
| ISO 7.9 | 외부 반출 자산 보호 | conditional | device |
| ISO 8.1 | 사용자 단말 | apply | device |
| ISO 8.10 | 정보 삭제 | apply | retention_backup data_resource |
| ISO 8.11 | 데이터 마스킹 | conditional | dlp data_classification |
| ISO 8.12 | 데이터 유출 방지 | apply | dlp sharing |
| ISO 8.13 | 정보 백업 | apply | retention_backup |
| ISO 8.15 | 로그 기록 | apply | monitoring |
| ISO 8.16 | 모니터링 | apply | monitoring |
| ISO 8.19 | 운영 시스템 소프트웨어 설치 | apply | integration automation |
| ISO 8.2 | 특수 접근 권한 | apply | admin_access |
| ISO 8.22 | 네트워크 분리 | conditional | network_policy tenant_policy |
| ISO 8.24 | 암호 사용 | apply | encryption |
| ISO 8.25 | 안전한 개발 생명주기 | apply | code_security change_control code_repo |
| ISO 8.28 | 시큐어 코딩 | apply | code_security |
| ISO 8.29 | 개발·인수 보안 시험 | apply | code_security automation |
| ISO 8.3 | 정보 접근 제한 | apply | access_role access_grant sharing |
| ISO 8.30 | 외주 개발 | conditional | code_access account |
| ISO 8.31 | 개발·시험·운영 환경 분리 | conditional | tenant code_repo |
| ISO 8.32 | 변경 관리 | apply | change_control |
| ISO 8.33 | 시험 정보 | conditional | data_resource data_classification |
| ISO 8.34 | 감사 시험 중 정보시스템 보호 | conditional | admin_access access_grant |
| ISO 8.4 | 소스 코드 접근 | apply | code_access change_control |
| ISO 8.5 | 안전한 인증 | apply | authentication password_policy session_policy |
| ISO 8.7 | 악성코드 대응 | apply | malware |
| ISO 8.8 | 기술 취약점 관리 | apply | code_security code_repo |
| ISO 8.9 | 구성 관리 | apply | tenant tenant_policy |
| ISMS-P 1.2.1-01 | 정보자산 식별 | apply | @obj @type=data_resource tenant data_resource integration code_repo device automation |
| ISMS-P 1.2.1-02 | 정보자산 식별 | conditional | @type=data_resource data_resource data_classification |
| ISMS-P 1.2.1-03 | 정보자산 식별 | apply | @obj @type=data_resource tenant data_resource integration code_repo device automation |
| ISMS-P 1.2.2-01 | 현황 및 흐름분석 | apply | data_flow integration automation |
| ISMS-P 1.2.2-02 | 현황 및 흐름분석 | conditional | @type=data_resource data_flow integration data_resource |
| ISMS-P 1.2.2-03 | 현황 및 흐름분석 | conditional | @type=data_resource data_flow integration data_resource |
| ISMS-P 2.1.3-01 | 정보자산 관리 | conditional | data_classification dlp data_resource |
| ISMS-P 2.1.3-02 | 정보자산 관리 | conditional | ownership |
| ISMS-P 2.10.1-02 | 보안시스템 운영 | apply | admin_access |
| ISMS-P 2.10.1-04 | 보안시스템 운영 | apply | tenant_policy |
| ISMS-P 2.10.1-05 | 보안시스템 운영 | apply | tenant_policy |
| ISMS-P 2.10.2-02 | 클라우드 보안 | apply | tenant_policy admin_access tenant |
| ISMS-P 2.10.2-03 | 클라우드 보안 | apply | admin_access authentication monitoring |
| ISMS-P 2.10.2-04 | 클라우드 보안 | apply | tenant_policy monitoring |
| ISMS-P 2.10.5-02 | 정보전송 보안 | apply | data_flow encryption integration |
| ISMS-P 2.11.3-01 | 이상행위 분석 및 모니터링 | apply | monitoring |
| ISMS-P 2.2.1-02 | 주요 직무자 지정 및 관리 | conditional | admin_access account |
| ISMS-P 2.2.1-03 | 주요 직무자 지정 및 관리 | conditional | account access_grant |
| ISMS-P 2.2.2-01 | 직무 분리 | conditional | access_role admin_access |
| ISMS-P 2.2.5-02 | 퇴직 및 직무변경 관리 | conditional | account access_grant provisioning integration |
| ISMS-P 2.3.1-01 | 외부자 현황 관리 | apply | integration account |
| ISMS-P 2.3.4-01 | 외부자 계약 변경 및 만료 시 보안 | conditional | account access_grant integration |
| ISMS-P 2.5.1-01 | 사용자 계정 관리 | apply | account provisioning access_grant |
| ISMS-P 2.5.1-02 | 사용자 계정 관리 | apply | access_role access_grant group |
| ISMS-P 2.5.2-01 | 사용자 식별 | apply | account |
| ISMS-P 2.5.2-02 | 사용자 식별 | apply | account |
| ISMS-P 2.5.3-01 | 사용자 인증 | apply | authentication password_policy |
| ISMS-P 2.5.3-02 | 사용자 인증 | apply | authentication network_policy |
| ISMS-P 2.5.4-01 | 비밀번호 관리 | apply | password_policy |
| ISMS-P 2.5.4-02 | 비밀번호 관리 | conditional | password_policy |
| ISMS-P 2.5.4-03 | 비밀번호 관리 | apply | authentication credential |
| ISMS-P 2.5.5-01 | 특수 계정 및 권한 관리 | apply | admin_access |
| ISMS-P 2.5.5-02 | 특수 계정 및 권한 관리 | conditional | admin_access account |
| ISMS-P 2.5.6-01 | 접근권한 검토 | apply | monitoring |
| ISMS-P 2.5.6-02 | 접근권한 검토 | apply | access_grant admin_access account |
| ISMS-P 2.6.2-02 | 정보시스템 접근 | apply | session_policy |
| ISMS-P 2.6.3-01 | 응용프로그램 접근 | apply | access_role access_grant |
| ISMS-P 2.6.3-02 | 응용프로그램 접근 | apply | session_policy |
| ISMS-P 2.6.3-03 | 응용프로그램 접근 | apply | admin_access authentication |
| ISMS-P 2.6.3-05 | 응용프로그램 접근 | conditional | dlp access_role |
| ISMS-P 2.6.6-03 | 원격접근 통제 | apply | network_policy authentication session_policy device tenant_policy |
| ISMS-P 2.7.1-02 | 암호정책 적용 | apply | encryption |
| ISMS-P 2.7.2-02 | 암호키 관리 | apply | encryption |
| ISMS-P 2.8.3-01 | 시험과 운영 환경 분리 | conditional | tenant code_repo |
| ISMS-P 2.8.3-02 | 시험과 운영 환경 분리 | conditional | change_control monitoring |
| ISMS-P 2.8.4-01 | 시험 데이터 보안 | conditional | data_resource |
| ISMS-P 2.8.4-02 | 시험 데이터 보안 | conditional | data_resource retention_backup |
| ISMS-P 2.8.5-01 | 소스 프로그램 관리 | apply | code_access |
| ISMS-P 2.8.5-02 | 소스 프로그램 관리 | apply | code_repo change_control |
| ISMS-P 2.8.5-03 | 소스 프로그램 관리 | apply | code_repo change_control |
| ISMS-P 2.9.4-01 | 로그 및 접속기록 관리 | apply | monitoring |
| ISMS-P 2.9.4-02 | 로그 및 접속기록 관리 | apply | monitoring admin_access |
| ISMS-P 2.9.4-03 | 로그 및 접속기록 관리 | conditional | monitoring retention_backup tenant_policy |
| ISMS-P 3.1.3-01 | 주민등록번호 처리 제한 | conditional | dlp data_resource |
| ISMS-P 3.2.5-04 | 가명정보 처리 | conditional | data_resource access_grant |
| ISMS-P 3.2.5-05 | 가명정보 처리 | conditional | retention_backup data_resource |
| ISMS-P 3.3.1-05 | 개인정보 제3자 제공 | conditional | sharing data_flow |
| ISMS-P 3.3.1-06 | 개인정보 제3자 제공 | conditional | access_grant sharing integration |
| ISMS-P 3.3.4-04 | 개인정보 국외이전 | conditional | data_region data_flow integration |
| ISMS-P 3.4.1-02 | 개인정보 파기 | apply | retention_backup data_resource |
| ISMS-P 3.4.1-03 | 개인정보 파기 | apply | retention_backup data_resource |
| ISMS-P 3.4.2-01 | 처리목적 달성 후 보유 시 조치 | conditional | retention_backup data_resource |
| ISMS-P 3.4.2-02 | 처리목적 달성 후 보유 시 조치 | conditional | retention_backup data_resource |
| ISMS-P 3.4.2-03 | 처리목적 달성 후 보유 시 조치 | conditional | access_role access_grant data_resource |
| ISMS-P 3.4.2-04 | 처리목적 달성 후 보유 시 조치 | conditional | access_grant |
| admin-73464:article-8:p1 | 개인정보의 목적 외 이용ㆍ제공 | conditional | sharing integration |
| admin-73464:article-8:p2 | 개인정보의 목적 외 이용ㆍ제공 | conditional | integration data_flow |
| admin-73464:article-10:p1 | 개인정보의 파기방법 및 절차 | apply | retention_backup data_resource |
| admin-73464:article-11:p1 | 법령에 따른 개인정보의 보존 | apply | retention_backup data_resource |
| admin-73464:article-15:p1 | 개인정보취급자에 대한 감독 | apply | access_grant account |
| admin-73464:article-15:p2 | 개인정보취급자에 대한 감독 | apply | access_role access_grant |
| admin-73464:article-15:p3 | 개인정보취급자에 대한 감독 | conditional | access_grant provisioning |
| admin-73464:article-17:p0 | 개인정보 보호 조치의무 | conditional | integration access_grant |
| admin-73493:article-5:p1 | 접근 권한의 관리 | apply | access_role access_grant |
| admin-73493:article-5:p2 | 접근 권한의 관리 | conditional | access_grant provisioning |
| admin-73493:article-5:p3 | 접근 권한의 관리 | apply | monitoring retention_backup |
| admin-73493:article-5:p4 | 접근 권한의 관리 | apply | account |
| admin-73493:article-5:p5 | 접근 권한의 관리 | apply | authentication |
| admin-73493:article-5:p6 | 접근 권한의 관리 | apply | password_policy authentication |
| admin-73493:article-6:p1 | 접근통제 | apply | network_policy monitoring |
| admin-73493:article-6:p2 | 접근통제 | apply | authentication network_policy |
| admin-73493:article-6:p3 | 접근통제 | apply | sharing |
| admin-73493:article-6:p4 | 접근통제 | apply | session_policy |
| admin-73493:article-6:p5 | 접근통제 | conditional | device |
| admin-73493:article-6-2:p1 | 인터넷망의 차단 조치 등 | conditional | network_policy admin_access |
| admin-73493:article-7:p2 | 개인정보의 암호화 | apply | encryption |
| admin-73493:article-7:p3 | 개인정보의 암호화 | apply | encryption |
| admin-73493:article-7:p4 | 개인정보의 암호화 | apply | encryption |
| admin-73493:article-7:p5 | 개인정보의 암호화 | conditional | device encryption |
| admin-73493:article-7:p6 | 개인정보의 암호화 | apply | encryption |
| admin-73493:article-8:p1 | 접속기록의 보관 및 점검 | apply | monitoring retention_backup |
| admin-73493:article-8:p2 | 접속기록의 보관 및 점검 | apply | monitoring |
| admin-73493:article-8:p3 | 접속기록의 보관 및 점검 | apply | monitoring |
| admin-73493:article-11:p0 | 재해ㆍ재난 대비 안전조치 | apply | retention_backup |
| admin-73493:article-12:p1 | 출력ㆍ복사시 안전조치 | conditional | access_grant admin_access |
| admin-73493:article-13:p1 | 개인정보의 파기 | apply | retention_backup data_resource |
| admin-73493:article-13:p2 | 개인정보의 파기 | apply | retention_backup data_resource |
| admin-73493:article-13:p3 | 개인정보의 파기 | apply | retention_backup |
| admin-73493:annex-1:p0 | 위험을 감소시킬 수 있는 보호조치 예시 (제6조의2 관련) | apply | access_role dlp |
| law-011357:article-17:p1 | 개인정보의 제공 | conditional | sharing integration data_flow |
| law-011357:article-17:p4 | 개인정보의 제공 | conditional | sharing integration |
| law-011357:article-18:p1 | 개인정보의 목적 외 이용ㆍ제공 제한 | conditional | sharing integration |
| law-011357:article-18:p5 | 개인정보의 목적 외 이용ㆍ제공 제한 | conditional | integration data_flow |
| law-011357:article-19:p0 | 개인정보를 제공받은 자의 이용ㆍ제공 제한 | conditional | integration |
| law-011357:article-21:p1 | 개인정보의 파기 | apply | retention_backup data_resource |
| law-011357:article-21:p2 | 개인정보의 파기 | apply | retention_backup data_resource |
| law-011357:article-21:p3 | 개인정보의 파기 | apply | retention_backup data_resource |
| law-011357:article-23:p2 | 민감정보의 처리 제한 | apply | encryption data_classification |
| law-011357:article-24:p3 | 고유식별정보의 처리 제한 | apply | encryption data_classification |
| law-011357:article-24-2:p2 | 주민등록번호 처리의 제한 | apply | encryption |
| law-011357:article-26:p5 | 업무위탁에 따른 개인정보의 처리 제한 | conditional | integration sharing |
| law-011357:article-28:p1 | 개인정보취급자에 대한 감독 | apply | access_grant account |
| law-011357:article-28-2:p2 | 가명정보의 처리 등 | conditional | sharing |
| law-011357:article-28-4:p1 | 가명정보에 대한 안전조치의무 등 | apply | data_resource access_grant |
| law-011357:article-28-5:p2 | 가명정보 처리 시 금지의무 등 | apply | retention_backup data_resource |
| law-011357:article-28-8:p1 | 개인정보의 국외 이전 | conditional | data_region data_flow integration |
| law-011357:article-28-8:p4 | 개인정보의 국외 이전 | conditional | data_region |
| law-011357:article-29:p0 | 안전조치의무 | apply | access_role access_grant authentication encryption monitoring |
| law-011357:article-34-2:p1 | 노출된 개인정보의 삭제ㆍ차단 | apply | sharing dlp |
| law-011468:article-14-2:p1 | 개인정보의 추가적인 이용ㆍ제공의 기준 등 | conditional | sharing encryption |
| law-011468:article-16:p1 | 개인정보의 파기방법 | apply | retention_backup data_resource |
| law-011468:article-21:p1 | 고유식별정보의 안전성 확보 조치 | apply | encryption access_grant |
| law-011468:article-21-2:p1 | 주민등록번호 암호화 적용 대상 등 | apply | encryption |
| law-011468:article-29-5:p1 | 가명정보에 대한 안전성 확보 조치 | apply | data_resource access_grant |
| law-011468:article-29-10:p1 | 개인정보의 국외 이전 시 보호조치 등 | conditional | data_region |
| law-011468:article-30:p1 | 개인정보의 안전성 확보 조치 | apply | access_role access_grant authentication encryption monitoring session_policy network_policy |
