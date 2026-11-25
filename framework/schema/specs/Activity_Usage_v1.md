# 사건으로 본 출처와 사용 v1 (초안)

관계(Relation)는 「설정상 가능하다」를 적는다. 사건 기록([Activity](Activity_Schema_v1.md))은 「실제로 했다」를 적는다. 이 문서는 둘을 섞지 않고 잇는 칸을 정한다. 관계 행의 **출처**(누가 언제 줬나)와 **사용**(언제 몇 번 썼나), EA 행과 격차의 「실제로 쓰였나」, 그리고 로그로 엔진을 재는 점수판 지표다.

상태: 초안. 2026-11-11 작성. Activity 명세 「단계」의 2단계다. 판정(관계 행, 간선, EA `level`, 위협과 Access Gap 벤)은 바꾸지 않는다. 칸만 더한다.

근거: 11-04 운영 수집본 로그 418종 17,231건을 그래프와 대 본 측정(2026-11-11). 관계 행에 「누가·언제 줬나」를 담을 칸이 없어 바뀜 사건 284종 3,903건이 갈 곳이 없었다. 간선은 `observed` 참·거짓 하나뿐이라(2,905개 중 37개 참) 로그로 실제 지나간 권한 간선 50개 중 49개가 「안 쓰인 것」과 구별되지 않았다. 테넌트 관리자급 역할 13개 중 4개(31%)가 기간 안 안 쓰였다.

## 원칙

1. **설정상 가능과 실제 사용을 나눈다.** 관계, 간선, EA `level` 은 설정(스냅샷)으로만 정한다. 사용은 그 옆 칸(`usage`, `exercised`)에만 적는다. 「썼다」가 「가능하다」를 만들지 않고, 「안 썼다」가 「가능하다」를 지우지 않는다.
2. **로그에 없음 ≠ 권한 없음.** 로그는 보관 기간이 짧고(Okta 90일, GWS 6개월, Slack 감사 로그는 요금제마다), 수집하지 않은 호출이 있고, 벤더가 아예 안 적는 행위가 있다(Okta 앱 안의 쓰기, Salesforce 레코드 쓰기). 사건이 없는 관계는 「관측 창 안에서 사용이 보이지 않음」일 뿐이다.
3. **「안 썼다」는 회수 추천으로만 쓴다.** 늘 관측 창(`window`)과 함께 낸다. 위협의 심각도나 Access Gap 판정에 넣지 않는다.
4. **로그가 없는 환경은 결과가 같다.** 사건이 0 건이면 이 문서의 칸은 하나도 생기지 않고, 다른 출력은 바이트 단위로 같다(엔진 시험).
5. **수집기 자신의 활동은 뺀다.** Activity `self` 와 같은 기준(환경 registry 의 수집기 자격증명 식별자, 엔진 `AEGI_GWS_SELF_CLIENT_IDS`)이다. 수집기가 읽은 것을 「사용」으로 세면 모든 읽기 권한이 쓰인 것처럼 보인다.

## 관계 행에 붙는 칸

| 칸 | 모양 | 뜻 |
| --- | --- | --- |
| `provenance` | `{granted_by, granted_at, evidence[]}` | 이 관계를 만든 사건. `granted_by` 는 그 사건의 행위자(그래프 객체 키, 못 찾으면 `unmatched`), `granted_at` 은 시각, `evidence` 는 Activity id 목록(마지막 부여가 앞) |
| `usage` | `{first_at, last_at, count, window: {from, to}, source}` | 관측 창 안에서 이 관계를 쓴 사건의 처음·마지막 시각과 수. `source` 는 `activity`(사건 기록) 또는 `observation`(기존 관측) |

- **출처를 뽑는 사건**: 사전(`activity_types.yaml`)에서 효과가 `relation_created`(또는 `relation_modified`)이고 두 끝(`refs.from`, `refs.to`)을 다 찾은 사건이, 같은 두 끝과 같은 `relation_type` 의 관계 행에 붙는다. 같은 쌍에 여럿이면 마지막 부여가 `granted_*` 이고 나머지는 `evidence` 뒤에 둔다. 마지막이 `relation_removed` 인데 스냅샷에 관계가 있으면(다시 부여됐거나 다른 경로) 출처를 붙이지 않고 점수판의 「어긋남」으로 센다.
- **사용으로 세는 사건**: 성공한 사건(`success`, `success_implied`)만. 사건의 행위를 그래프 질의로 물었을 때(아래 「점수판」의 능력 대응) 근거 경로가 지난 간선이 그 사건을 쓴 것이다. 그 간선을 만든 관계 행(간선 `refs` 의 relation)이 같은 사건을 `usage` 에 센다. 사전의 효과가 `exercised` 인 사건은 두 끝 관계에 바로 센다.
- **「의도된 손실」을 고친 자리**: [Relation_Schema_v3](Relation_Schema_v3.md) 「`Assignment`는 어떤 template의 끝점도 아니다」는 `inviter`·`added_by`·`dismissed_by` 를 「한 행위의 기록이지 소유가 아니다」라며 관계에서 뺐다. 그 판단은 그대로다(이것들은 관계가 아니다). 다만 그 행위는 이제 Activity 로 남고, 관계 행의 `provenance.granted_by` 가 그것을 가리킨다. 행위 기록은 관계가 아니라 관계의 **출처**다.

### 사건으로만 아는 관계 — `basis: logged` (3단계, 이번에 만들지 않음)

스냅샷에 없고 사건으로만 아는 관계가 있다. 설치자(`registered_by`), SSO 신뢰(`trusts`), 기간 안에 생겼다 사라진 부여(측정에서 5쌍), 그리고 권한 목록 API 가 없는 SaaS(Notion 지면 시험: grants 대부분)다. 이것은 `basis: logged` 로 따로 표시해 만든다.

- `logged` 관계는 **관측 창**을 함께 적는다: `observed_window: {from, retention}`. `from` 은 그 provider 로그의 가장 이른 사건 시각, `retention` 은 벤더 보관 기간(모르면 비움). 창 밖은 「모름」이다
- `logged` 관계는 그 뒤에 `relation_removed` 사건이 있으면 효력이 없다(`validity.state: inactive`)
- 스냅샷이 같은 관계를 주면 `stated` 가 이기고 `logged` 는 `provenance` 로 내려간다
- 이번 단계는 `basis` 값을 늘리지 않는다(검사 `relation_basis_present` 는 그대로 `stated | computed | flag`)

## 간선의 사용

엔진 간선은 지금 `observed: boolean` 하나다. 그 옆에 `usage: {count, first_at, last_at, actors}` 를 더한다. `actors` 는 그 간선을 지난 사건의 행위자 수다. `observed` 는 뜻을 바꾸지 않는다(관측·증거로 뒷받침되는 연동 간선). 간선을 만드는 규칙(관계 → 간선 효과 표)은 손대지 않는다. 사용은 간선을 다 만든 **뒤에** 붙이는 별도 단계다.

## EA 행 (`Effective_Access_Schema_v1`)

| 칸 | 모양 | 뜻 |
| --- | --- | --- |
| `exercised` | `{count, last_at, activities[]}` | 행의 출발 주체가 행의 대상에 한 성공 사건. `activities` 는 Activity id(최근 5개까지) |
| `unused_in` | `{window: {from, to}}` | 그 provider 의 사건이 있는 창 안에서 이 행을 쓴 사건이 없다. 창이 없으면(그 provider 로그 없음) 칸을 두지 않는다 |

`level` 은 바꾸지 않는다. `exercised` 가 있다고 `indeterminate` 가 `computed` 가 되지 않는다(쓴 것은 「이번에 됐다」이지 「구조상 늘 된다」가 아니다).

**어디에 두나.** `effective_access.json` 은 게시와 검증이 다시 계산해 바이트로 견주는 저장소다(같은 함수 하나가 만든다). 사용은 로그에 따라 달라지므로 그 파일에 넣지 않는다. 엔진은 판정 결과 옆 표(`activityUsage.effective_access`, EA 행 `id` → `{exercised | unused_in}`)로 낸다. 행과는 `id` 로 잇는다.

## 접근 격차

다리 단위 옛 격차의 옆 표(`activityUsage.gaps`, 격차 사람의 `exercised_by[]`, 끊기의 `active_users`)는 옛 격차와 함께 2026-11-17 지웠다(aegi-adapter-engine#452). Access Gap 은 위협마다 벤이다(aegi-adapter-engine `docs/spec/AEGI_THREAT_JUDGMENT_V2.md` 8절 「Access Gap」). 벤 사람에 사용을 붙일지는 「정할 것」에 둔다.

## 새 판정 — `unexplained_activity` (명세만, 3단계)

성공한 사건인데 그래프가 행위자에게 그 능력을 주지 않는 것. 원인은 셋 가운데 하나다.

1. **관계 누락**: 관계를 덜 모았다(수집 구멍, 정규화 누락)
2. **효과 표 구멍**: 관계는 있는데 간선으로 바꾸는 규칙(`relation_semantics.yaml`)이 비었다. 11-04 측정에서 설명 안 된 22% 의 약 90% 가 여기였다(Atlassian 조직 관리자 216건, Okta 앱 scope 동의 236건, 벤더 기본 허용 56건)
3. **숨은 경로**: 그래프에 없는 길로 했다(위협 후보)

판정 조건:

- 사건 `outcome` 이 `success` 또는 `success_implied`, `self` 가 아님, 행위자와 대상(관리 행위는 그 provider 테넌트)을 그래프에서 찾음
- 원래 권한(`M*·G·U⁻¹*`), 실행 신원(`A*` 뒤 권한), 연동(위협 판정의 파생 접근, 2026-11-17 옛 연동 원인 질의 `T·A*`, `T·E` 대체), 호출(`T`) 어느 것으로도 `no`
- `authenticate` 사건(토큰 발급, SSO 로그인)은 묻지 않는다. 「인증」으로 따로 센다. 토큰 발급은 이후 쓰기의 수단이지 테넌트 쓰기 자체가 아니다

이번 단계는 점수판(`gt:logs`)이 묶음으로 세기만 한다. 위협으로 내지 않는다.

## 점수판 지표 (엔진 `gt:logs`, `gt:board` 요약 줄)

| 지표 | 정의 |
| --- | --- |
| 로그 설명률 | 성공 행위 중 두 끝을 찾은 것을 원래 권한 / 연동으로만 / 길 없음 / 못 붙음 으로 나눈 비율, SaaS 별. 인증(`authenticate`)은 따로 |
| 부여 사건 vs 스냅샷 | (출발, 도착, 관계 종류) 쌍마다 마지막 사건이 부여면 스냅샷에 있나, 제거면 없나. 일시 부여(창 안 부여 뒤 제거) 쌍 수. 없는 쌍 가운데 사전이 `snapshot_gap` 으로 까닭을 적은 것은 까닭(`kind`)별로 따로 센다. 적지 않은 채 없는 쌍이 사전을 다시 볼 곳이다 |
| 안 쓰인 관리자 권한 | 테넌트 관리자급 권한 간선(`G` rank 5, 설정 출처)을 가진 계정 가운데 창 안 그 SaaS 관리 행위가 하나도 설명되지 않은 비율, 창과 함께 |
| 간선 사용 | 사용이 붙은 간선 수와 그 가운데 `observed` 인 것 |
| unexplained 묶음 | 위 판정 조건에 맞는 사건을 (provider, 사건 종류, 능력)으로 묶은 수와 원인 짐작 |

### 행위 → 물을 능력

| 행위(`action.verb`) | 묻는 것 |
| --- | --- |
| read, export | 대상에 read |
| write, send | 대상에 write |
| create, delete | 대상 또는 그 provider 테넌트에 write(둘 중 좋은 답. 만든 객체 자신에는 아직 권한이 없다) |
| grant, revoke, configure, activate | 그 provider 테넌트 또는 대상에 admin(둘 중 좋은 답) |
| execute | 대상 자동화를 부를 수 있나(`T`) 또는 읽기 |
| request | 테넌트 구성원인가(`M*`) |
| authenticate | 묻지 않음(인증) |

대상은 `targets[]` 가운데 자리가 `target`, `object`, `container`, `destination` 이고 그래프에서 찾은 것이다.

사전 줄에 `self_service` 가 있고 자기 계정에 한 행위면(`actor`, 또는 `target` 이고 대상이 행위자) 위 표 대신 테넌트 구성원인가(`M*`)를 묻는다. 누구나 자기 비밀번호, MFA, 내 정보를 바꿀 수 있어서다(벤더 기본값. 조직이 막았으면 사건이 실패로 남는다). 남의 계정에 한 같은 행위는 위 표대로 묻는다.

## 정할 것

- 관계 행 `provenance`, `usage` 와 EA 옆 표를 화면에 실을지. 위협마다 Access Gap 벤 사람에 실제 사용을 붙일지. 지금은 판정 때 계산만 하고(`activityUsage.relations`, 관계 `fixture_key` 로 잇는다) `relations.json`·게시 내용(D1)은 그대로다. 화면 담당과 정한 뒤 싣는다
- `logged` 관계 만들기(3단계)와 관측 창의 벤더별 보관 기간 표
- `unexplained_activity` 를 위협으로 낼 조건(효과 표 구멍 묶음을 먼저 메운 뒤)
