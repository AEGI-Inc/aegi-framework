# 자격증명 피해범위 계산 v1

자격증명 하나가 새면 공격자가 어디까지 닿는지 그래프에서 계산한다. 구현은 `src/detection/v2/blastRadius.ts`다.

저장소 안내: aegi-schema 는 `aegi-schema-deprecated` 로 보관됐고 지금 스키마는 aegi-knowledge `schema/` 에 있다. 본문의 옛 저장소 이름은 당시 기준이다.

## 요약

- 대상은 `Credential` 인터페이스가 붙은 객체다. 실측 v2에서 48개다(Okta Refresh Token 10, Okta UserFactor 17, GWS Token 13, Slack bot-token 5, Slack incoming-webhook 3).
- GitHub `Credential Authorization`, `Organization Programmatic Access Grant`는 넣지 않는다. aegi-schema가 둘을 비밀값이 없는 승인 기록(Assignment)으로 판정했다.
- 두 가정을 따로 계산한다. **토큰 권한만**은 scope가 허락하는 것만 쓴다. **소유 계정 장악**은 자격증명 주인(사람 계정 또는 앱)을 차지했다고 본다.
- 확산은 저장된 관계, Link, Effective Access 행으로만 한다. 홉마다 근거 관계 키, Link 수준, EA 행 id를 남긴다.

## 홉 종류

| 홉 | 근거 | 얻는 것 |
| --- | --- | --- |
| holder | `authenticates_with` (계정 → 자격증명) | 주인 계정으로 행동 |
| owner_app | `owned_by` (자격증명 → 앱) | 앱으로 행동 |
| acts_as | `acts_as` (앱 → 봇 계정) | 봇 계정으로 행동 |
| delivers_to | `receives_into` (웹훅 → 채널) | 채널에 쓰기 |
| member_of | `member_of` | 그룹 역할 상속, 채널 읽기/쓰기, 조직 소속 |
| role | `has_role_on` | 역할 수준의 권한 |
| contains | `contained_in` (역방향) | 폴더 권한이 안의 파일로 |
| runs_as | `runs_as` (역방향) | 그 계정 권한으로 도는 자동화를 바꿈 |
| sso | Okta 앱 할당 + Link | 그 앱으로 로그인하는 다른 SaaS 계정 |
| takeover | 조직 관리 역할 | 다른 계정의 비밀번호, 인증 요소 초기화 |
| automation_link | 자동화 Link | 같은 자동화가 다른 SaaS에 가진 신원 |
| effective_access | EA 행 | 탐지 룰이 계산한 교차 경로 |

## 규칙

1. **SaaS 경계는 Link만으로 넘지 않는다.** 같은 사람이라는 판단은 접근 수단이 아니다. Okta SSO 앱 할당, 같은 자동화 런타임, EA 행처럼 넘는 수단이 있을 때 Link는 "어느 계정인지"만 정한다.
2. **약한 Link는 전이하지 않는다.** `resolved`, `disclosed_relation`만 확정이다. `possibly_same` 등 약한 간선을 거친 노드는 추정이고, 거기서 다시 Link를 타지 않는다(`weak_link_stopped`).
3. **추정은 물려준다.** 추정 노드에서 나간 홉은 모두 추정이다. 권한 목록을 수집하지 않은 사용자 정의 역할(Okta IamRole)도 추정이다.
4. **확정 경로를 먼저 펼친다.** 같은 노드에 여러 경로가 있으면 확정, 높은 권한, 짧은 경로 순으로 하나를 남긴다.
5. **노드 400개에서 멈춘다.** 멈추면 `truncated`를 남긴다.

## 토큰 권한만 (scope 해석)

| 자격증명 | scope | 쓰는 것 |
| --- | --- | --- |
| Okta Refresh Token | `okta.*.read` | 주인의 Okta 조직 역할을 읽기로 |
| | `okta.*.manage` | 주인의 조직 역할을 그대로. `okta.users.manage`, `okta.factors.manage`면 계정 장악 |
| | `openid`, `profile`만 | 없음 (`scope_identity_only`) |
| GWS Token | `admin.directory.*` | 주인의 GWS 관리 역할. `.readonly`면 읽기 |
| | `drive`, `drive.readonly` | 주인의 파일 권한 |
| | `gmail`, `script.external_request` 등 | 그래프에 노드가 없어 메모만 (`scope_outside_graph`) |
| Slack bot-token | `chat:write` | 봇이 있는 채널에 쓰기 |
| | `channels:history` 등 | 봇이 있는 채널 읽기 |
| Slack incoming-webhook | 없음 | 받는 채널에 쓰기만 |
| Okta UserFactor | 없음 | 단독으로는 로그인 불가 (`factor_alone`) |

토큰 가정에서 SSO 로그인은 하지 않는다. API 토큰으로는 Okta 세션을 얻지 못한다. 단, 사용자 관리 scope로 다른 계정을 초기화하면 그 계정은 완전히 차지한 것으로 보고 SSO까지 펼친다.

## 역할 수준

- GitHub, Drive 역할 이름은 `access.ts`의 순위표를 쓴다(admin, owner = 관리, write = 쓰기, read = 읽기).
- Okta 표준 관리 역할, Slack owner/admin은 관리다. `READ_ONLY_ADMIN`은 읽기다.
- GWS 역할 객체는 `isSuperAdminRole`이면 관리, 권한이 전부 조회(`_RETRIEVE`, `_READ`)면 읽기, 나머지는 쓰기다.
- 계정 장악: Okta `SUPER_ADMIN`, `ORG_ADMIN`은 모든 사람 계정, `HELP_DESK_ADMIN`, `USER_ADMIN`은 관리 역할이 없는 계정, GWS 최고 관리자는 모든 계정.

## 실측 v2 결과 (2026-10-02 계산)

- `okta.users.manage` scope Refresh Token 3개는 토큰 가정에서도 GWS 최고 관리자에 확정 경로로 닿는다. 토큰 → Okta 최고 관리자 계정 → 다른 Okta 관리자 계정 초기화 → Okta SSO 앱과 벤더 공개 연결(`disclosed_relation`) → GWS 계정 → `_SEED_ADMIN_ROLE`.
- 읽기 scope Refresh Token 7개는 토큰 가정에서 Okta 조직 읽기만, 계정 장악 가정에서 네 SaaS 48개 객체까지 퍼진다.
- 인증 요소는 토큰 가정에서 퍼지지 않는다.
- Slack MFA Reset 봇 토큰은 앱 장악 가정에서 자동화 Link(약함)로 Okta 헬프데스크 역할까지 추정 경로로 닿는다.

## 한계

- Okta 사용자 정의 역할의 권한 목록을 수집하지 않아 수준을 쓰기로 짐작한다.
- Okta 앱이 어느 SaaS로 로그인하는지는 OIN 앱 이름(google, slack, github, ghe…)으로 정한다.
- GWS 메일, 캘린더, 외부 요청 scope는 그래프 노드가 없어 메모로만 남긴다.
- EA 행은 탐지 룰이 물은 쌍만 있다. 행이 없다고 경로가 없다는 뜻이 아니다.
