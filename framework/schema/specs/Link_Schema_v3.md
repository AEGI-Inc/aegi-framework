# Link Schema v3

**서로 다른 provider의 Object가 같은 실체를 가리킨다는 판단**을 담는다. 관계와는 다른 파일, 다른 저장소다.

- Object 행의 모양은 `Object_Schema_v4.1.md`
- 한 provider 안의 권한 관계는 `Relation_Schema_v3.md`
- 수집 방법은 `Profile_Schema_v4.2.md`

```yaml
Link
├ set_id            동일성 집합
├ members[]         그 집합에 속한 Object 참조
├ edges[]           그 판단을 만든 근거 하나하나
└ source            언제 만들었나
```

---

## 왜 관계와 분리하는가

어휘 17종은 전부 **권한 사실**이다. "같은 사람이다"는 권한 사실이 아니라 **추정**이다.

섞으면 이렇게 된다.

```
okta:00u1 --same_principal--> slack:U1     email 로 추정
slack:U1  --has_role_on-->    team T1      확실

질의: 00u1 이 무엇을 할 수 있나
답:   T1 의 owner
```

**추정 하나가 권한 경로를 만들어낸다.** 그리고 답에는 어느 구간이 추정이었는지 안 남는다.

그래서 Link는 **질의가 명시적으로 켜야** 넘어간다.

```
"이 사람이 할 수 있는 것"                    -> Link 를 안 탄다
"이 사람이 할 수 있는 것 (교차 SaaS 포함)"     -> Link 를 탄다. 경로에 단계가 표시된다
```

---

## 노드를 병합하지 않는다

`Object_Schema_v4.1.md`의 동일성 키에 **provider가 들어 있다.** Okta 사용자와 Slack 사용자는 구조적으로 한 노드가 될 수 없다. 이건 제약이 아니라 의도다.

### 형식적 이유

OWL 2가 `sameAs`를 이렇게 정의한다.

```
eq-trans      x~y, y~z  ->  x~z
eq-rep-s/p/o  x~x'      ->  x 에 대한 모든 진술이 x' 로 복제된다
```

**전이일 뿐 아니라 속성까지 갈아탄다.** 잘못된 엣지 하나가 두 동치류를 통째로 합치고 양쪽 속성을 서로 오염시킨다. 조금만 병합하는 것이 불가능하다.

### 측정된 이유

Linked Data에서 실제로 일어난 일이다.

```
주장된 sameAs        558,943,116 건
전이 폐쇄 시          35,201,120,188 건
그중 약 90%          단 하나의 클러스터에서 나온다

그 클러스터          177,794 개 이름
                    알베르트 아인슈타인, 전 세계 국가들, 빈 문자열이 한 덩어리
```

잘못된 엣지 **두 개**가 78개 용어를 네트워크 전체와 잘못 동일시한 사례도 기록돼 있다.

야생의 오류율은 **2.8%~20%**, 자동 매처 정밀도는 **67~86%**다. 그 비율에서 전이 병합은 구성상 안전하지 않다.

### 업계도 안 한다

Senzing, Neo4j, TigerGraph, Reltio, Quantexa 전부 **원본 레코드와 해석된 실체를 2층으로 두고 레코드를 병합하지 않는다.** Reltio는 골든 레코드를 "즉석에서 실체화되는 뷰"라고 부른다.

---

## 단계와 전이 정책

```yaml
levels:
  disclosed_relation: { transitive: within_hub_only }
  resolved:           { transitive: within_hub_only }
  possibly_same:      { transitive: false }
  possibly_related:   { transitive: false }
  different:          { transitive: false }
```

| 단계 | 뜻 | 예 |
| --- | --- | --- |
| `disclosed_relation` | **벤더가 포인터를 줬다.** 우리가 맞춘 게 아니다 | SCIM `externalId`, Okta `AppUser.externalId` |
| `resolved` | 결정적인 규칙이 확정했다 | IdP 프로비저닝 + 유일키, 같은 email(2026-11-03), 같은 조직이 DNS 로 확인한 별칭 도메인의 같은 앞부분 email(2026-11-14) |
| `possibly_same` | 약한 키로 맞췄다 | username |
| `possibly_related` | 더 약하다 | 같은 표시 이름 |
| `different` | **아니라고 판정했다** | 사람이 검토함 |

`transitive`는 **같은 단계의 간선끼리** 이어 새 쌍을 만들 수 있는지다. 강한 두 단계(`disclosed_relation`, `resolved`)는 허브 안에서 잇는다. 약한 간선 하나를 강한 간선 너머로 옮기는 것은 아래 「두 계정 사이의 단계」를 따른다.

> **2026-10-26 고침.** 앞 판은 `disclosed_relation`을 전이 금지로 두고, 단계가 다른 간선을 한 폐쇄에 넣지 말라고 했다. 정답 대조로 다시 정했다(아래). 엔진은 이미 쌍마다 경로의 가장 약한 단계를 쓰고 있었다(aegi-adapter-engine `src/detection/v2/identity.ts` `linkPairGrade`).

### 두 계정 사이의 단계 — 경로에서 가장 약한 간선

허브 구조에서 같은 집합의 두 계정은 간선 둘로 이어질 수 있다(계정 → IdP 허브 → 계정). **그 둘의 단계는 경로에서 가장 약한 간선의 단계다.**

| 경로 | 두 계정의 단계 |
| --- | --- |
| 강한 간선만 (`disclosed_relation`, `resolved`) | 강함. 허브를 거쳐도 그대로 |
| 약한 간선 하나, 나머지는 강한 간선 | 그 약한 간선의 단계 |
| 약한 간선 둘 이상 | 그 경로로 잇지 않는다(2026-10-29 정함, 아래 「정한 것」) |

강한 간선은 "두 계정이 같은 주체다"라는 판단이다. 그래서 약한 간선 하나를 그 너머로 옮겨도 틀릴 수 있는 곳은 그 약한 간선 하나뿐이고, 오류가 쌓이지 않는다. 약한 간선 둘은 다르다. 서로 다른 약한 키(이메일과 표시 이름 같은)로 맞춘 두 간선을 이으면 틀릴 수 있는 곳이 둘이 된다.

정답 대조(2026-10-26, aegi-adapter-engine `src/data/aegi_inc_measured_model_v1`과 시험 환경 g2 정답의 사람 13명):

| 두 계정의 경로 | 쌍 | 정답에서 같은 사람 | 정답에서 다른 사람 |
| --- | ---: | ---: | ---: |
| 강한 간선 하나 | 11 | 8 | 0 |
| 약한 간선 하나 (이메일) | 7 | 7 | 0 |
| 약한 간선 하나 + 강한 간선 하나 | 9 | 7 | 0 |
| 강한 간선 둘 | 2 | 0 | 0 |
| 약한 간선 둘 | 0 | - | - |

정답에 없는 계정이 있는 쌍은 세지 못했다(위 차이. 강한 간선 둘인 2쌍은 모두 정답 밖이다). 약한 간선을 강한 간선 너머로 옮긴 쌍이 바로 잇는 약한 간선만큼 맞았다. 앞 판처럼 막으면 같은 사람 7쌍을 잃고 얻는 것이 없다. 다만 시험 환경은 이메일을 맞춰 만들었으니 실제 조직보다 높게 나왔을 수 있다. 약한 간선 둘인 경우는 데이터가 없어 확인하지 못했다.

### 기본이 전이 금지인 이유

W3C가 같은 결정을 했다. SKOS 규격에서 `skos:exactMatch`는 전이이고 `skos:closeMatch`는 전이가 **아니다.** 규격이 이유를 적어 놨다 — 여러 개념 체계에 걸쳐 매핑을 이을 때 **복합 오류**가 생길 가능성을 피하기 위해서다. 약한 간선끼리 잇지 않는 이유가 이것이다.

### 단계를 섞어서 닫지 않는다

`sameas.org` 모음이 강한 링크와 약한 링크를 한 폐쇄에 넣고 그 안을 모두 같은 것으로 봐서 "의미적으로 건전하지 않다"는 비판을 받았다. 약한 쪽의 오류가 강한 쪽으로 번진 것이다.

그래서 한 집합에 단계가 다른 간선이 있어도 **한 단계로 뭉치지 않는다.** 쌍마다 위 「두 계정 사이의 단계」를 남긴다. 강한 간선만으로 이어진 쌍은 강한 그대로이고, 약한 간선을 지난 쌍만 약하다. 집합 전체의 단계를 하나로 적어야 하면 가장 약한 간선의 단계를 쓴다.

---

## 허브 구조 — 폭발 반경을 묶는다

provider를 직접 잇지 않는다. **허브를 통해서만 잇는다.** 허브는 **계정을 내주는 디렉터리**다 — IdP(Okta 등) 또는 메일 디렉터리(Google Workspace, Microsoft 365).

> **2026-11-13 고침.** 앞 판은 허브를 IdP 로만 적었다. 그래서 IdP 가 없는 회사에서는 같은 사람 Link 가 하나도 안 생겼다(아래 「잰 것」). 허브의 목적은 모든 연결이 계정 하나에서 시작하게 해 묶음 크기를 provider 수로 막는 것이다. 허브가 IdP 일 까닭은 없다. 메일 디렉터리도 회사가 계정(주소)을 내주고, 사람들은 그 주소로 다른 SaaS 에 가입한다.

```
직접    Slack-GitHub, Slack-Google, GitHub-Google, ...   5곳이면 쌍 10개
허브    허브-Slack, 허브-GitHub, 허브-Google, 허브-SF     5곳이면 4개
```

개수만 주는 게 아니다. **경로 길이가 최대 2로 묶인다.**

```
직접 매칭   email 체인이 무한히 길어진다  ->  17만 개짜리 클러스터가 가능하다
허브 매칭   provider <-> 허브 뿐         ->  집합 크기 = provider 수
```

**틀려도 그 사람 하나에서 멈춘다.** 위에서 인용한 파국이 구조적으로 안 일어난다. 허브가 둘이어도 같다 — 아래 허브는 위 허브 사람에 합쳐질 뿐 허브끼리 사슬을 만들지 않는다.

허브가 못 잡는 것이 있다. **허브를 안 거친 계정이다.** Slack 실측에서 봇·앱 계정 21건은 email이 아예 없어서 어떤 방법으로도 안 이어진다.

### 허브가 둘일 때

허브 목록과 순서는 crosswalk.yaml `hubs` 에 적는다. 위가 먼저다. 엔진은 SaaS 이름을 보지 않고 이 표대로 묶는다(aegi-adapter-engine `scripts/collect/shared/join.ts` `groupPeople`).

| 순서 | 허브 | 계정 | Link 이름 칸 | 이 계정에서 나가는 줄 |
| --- | --- | --- | --- | --- |
| 1 | IdP | Okta `User` | `login` | M1 앱 배정 `externalId`, M2 SAML · 앱 배정 이름, M3 `login` 메일 |
| 2 | 메일 디렉터리 | GWS `User` | `primaryEmail` | M3 주 메일 · `aliases` · `nonEditableAliases` ↔ Slack · Salesforce · Atlassian 사람 계정 메일, GitHub 조직 확인 메일 |
| 3 (2026-11-20) | 메일 디렉터리 | Microsoft 365(Entra) `User` | `userPrincipalName` | M3 `userPrincipalName` · `mail`(손님 계정 `userType Guest` 는 뺀다). `proxyAddresses` 는 `smtp:` 를 떼는 transform 이 없어 아직 읽지 않는다 |
| 맨 아래 | 주소 (2026-11-14) | 계정이 아니라 정규화한 주소 하나 | 그 주소 | 없음 — `natural_key` 의 이메일 칸(그 계정 자신의 주소)을 읽는다. 아래 「주소 허브」 |

IdP 가 위인 까닭: IdP 는 벤더가 준 포인터(M1)와 로그인 신원(M2)을 가진다. 메일 디렉터리는 주소(M3)만 준다.

합치는 규칙.

1. 위 허브가 아래 허브 계정을 이었으면(Okta ↔ GWS 연결) 둘은 같은 사람이다. 아래 허브가 이은 계정을 그 사람 Link 에 더한다. Link 는 하나다.
2. 위 허브에 안 이어진 아래 허브 계정은 그 계정 하나에서 Link 를 만든다(IdP 가 없는 회사, IdP 에 없는 사람).
3. SaaS 마다 계정 하나(`link_one_per_provider`)는 합친 Link 에도 지킨다. 그 사람이 위 허브로 이미 이은 SaaS 는 위 허브 것이 남는다. 같은 계정이면 조용히 건너뛰고, 다른 계정이면 더하지 않고 「연결 충돌」로 적는다.
4. 아래 허브가 이은 계정이 이미 위 허브의 다른 사람 Link 에 있으면 더하지 않고 「연결 충돌」로 적는다. 아래 허브 계정 하나를 위 허브 사람 둘 이상이 이었어도 합치지 않고 「연결 충돌」이다.
5. 같은 순위 허브끼리는 지금 Okta 와 같다 — 같은 계정이 두 사람에 들 수 있다(공용 주소는 엮고 표시만 남긴다).
6. 충돌은 정규화 보고서(`runner-report.json`) notes 에 「교차: 연결 충돌(까닭) …」 한 줄씩 남는다. 그 계정은 위 허브가 정한 대로다.

**「Google 로 로그인」, 「Microsoft 로 로그인」(SAML · OIDC 의 IdP 가 메일 디렉터리).** 11-04 운영 수집본에는 재료가 없다. SAML 발급자는 모두 Okta 였다(GitHub 감사 기록 GH-17 · GH-19 의 issuer, Salesforce `SamlSsoConfig` 의 LoginUrl). 생기면 M2 줄을 이 모양으로 더한다.

```yaml
- {kind: federated_subject, side: a, provider: gws, object_type: User, path: properties.primaryEmail, transform: [email_address], to: {provider: github, object_type: User Account}}
# b 쪽은 이미 있는 GitHub ExternalIdentity name_id 줄을 같이 쓴다. Salesforce 는 FederationIdentifier · Username 줄
```

GitHub 외부 신원 재료에는 발급자 칸이 없다. IdP 가 둘 다 있으면 GWS 줄이 Okta 가 낸 nameId 도 맞춘다. nameId 가 같은 주소면 같은 사람이라 틀리지는 않지만, 발급자를 가르려면 수집기가 그 IdP 의 issuer 를 재료에 남겨야 한다.

**잰 것 (2026-11-13, 11-04 운영 수집본, 엔진 `normalize --without okta,github:GH-20` 으로 Okta 를 뺀 회사).**

| | Okta 있음 (main) | Okta 없음, 허브 IdP 만 (main) | Okta 없음, 허브 둘 |
| --- | ---: | ---: | ---: |
| 사람 Link (든 계정) | 9 (41) | 0 (0) | 9 (31) |
| 사람 (판정 그래프, 같은 사람 묶음) | 26 | 47 | 25 |
| V2 위협 (켬) | 45 | 36 | 35 |
| 같은 사람의 다른 계정이 이미 닿는데 새 접근으로 잡힌 주체 (확정) | 0 | 23 (23) | 17 (1) |

Okta 가 있을 때 허브 둘은 원래와 같다 — Link · 객체 · 관계 파일이 바이트까지 같고, GWS 줄이 이은 22개는 모두 Okta 가 이미 같은 사람에 이은 계정이다(충돌 0). Okta 가 없을 때 남은 17개 주체 가운데 16개는 미확정이다. 모두 GitHub 확인 메일 도메인이 GWS 주 메일 도메인과 달라 도메인 별칭(`possibly_same`)으로만 이어진 사람이다. Okta 가 있으면 앱 배정 이름으로 확정되던 연결이다. 확정 1개도 그 약한 GitHub 연결을 거친 사람이다(판정이 약한 연결을 거친 계정을 확정으로 남긴 경우, 위협 판정 쪽 후속).

### 주소 허브 — 디렉터리가 없을 때 (2026-11-14)

IdP 도 메일 디렉터리도 수집하지 않은 회사가 있다. 그래도 사람들은 회사 주소 하나로 여러 SaaS 에 가입한다. 그래서 맨 아래 허브는 **계정이 아니라 정규화한 주소 하나**다(crosswalk.yaml `hubs` 의 `{role: address, kind: natural_key}`).

- 읽는 칸: `kind` 의 이메일 칸(`transform: [email_address]`) 가운데 `end` 가 없는 칸 — 그 계정 자신의 주소다. 앱 배정 이름처럼 다른 계정을 가리키는 칸은 안 읽는다. 칸 표시 `where`, `skip_if`, 키 종류 `where`(봇 · 시스템 사용자 거름)는 그 계정 하나에 대 본다.
- 묶는 것: 위 허브가 사람 Link 에 넣지 않은 계정 가운데 같은 주소를 쓰는 계정. 그 주소를 SaaS 둘 이상이 써야 한다(한 SaaS 안 계정끼리만 같으면 안 묶는다). 같은 조직이 DNS 로 확인한 도메인 묶음(`email_match.domain_alias`)은 한 주소 공간이라, 앞부분이 같으면 같은 주소로 본다(2026-11-14).
- **사슬 없음.** 다른 키(사용자 이름 등)와 섞지 않고, 주소끼리도 잇지 않는다. 묶음은 「그 주소를 쓰는 계정들」을 넘지 않는다 — 허브 목적(틀려도 그 사람 하나에서 멈춘다)이 그대로다. 주소 둘을 가진 계정(GitHub 확인 메일 여럿)은 두 Link 에 다 들 수 있다(같은 순위 허브끼리 규칙 5).
- 위 허브와: 그 주소를 쓰는 계정이 위 허브 사람 하나에 있으면 남은 계정을 그 사람에 합친다(규칙 1 · 3). 위 허브 사람 둘 이상에 있으면 합치지 않고 「연결 충돌(hub_claimed)」. 위 허브 사람 판단은 주소 묶음을 보기 전 것으로 한다 — 앞 주소가 합친 계정을 다음 주소가 다리로 쓰지 않게.
- 출처: 디렉터리 확인이 없다. Link 에 `meta.hub: address`, 간선마다 `hub: address` 를 남긴다. Link id 는 `LNK-ADDR-<주소 sha256 앞 12자>`, 이름은 그 주소다.
- 단계: 같은 주소라 11-03 결정(같은 이메일 = 같은 사람)대로 `resolved`. 별칭 도메인 주소끼리는 `domain_alias.level`(2026-11-14 `resolved`)이고 간선에 `domain_alias` 를 남긴다. 공용으로 보이는 주소(앞부분이 공용 메일함 이름이거나 한 SaaS 안 여러 계정)는 묶고 `shared_mailbox_suspected` 만 남긴다.

**잰 것 (2026-11-14, 11-04 운영 수집본, 정답 aegi-men-r2, 위협 판정 켬).** 「Okta · GWS 없음」은 엔진 `normalize --without okta,github:GH-20,gws`.

| | Okta 있음 | Okta 없음 (허브 둘) | Okta · GWS 없음 main | Okta · GWS 없음 주소 허브 |
| --- | ---: | ---: | ---: | ---: |
| 사람 Link (든 계정) | 9 (41) | 9 (31) | 0 (0) | 6 (16) |
| 사람 (판정 그래프, 같은 사람 묶음) | 26 | 25 | 36 | 26 |
| V2 위협 켬 / 끔 | 45 / 40 | 35 / 31 | 28 / 23 | 27 / 23 |
| 같은 사람의 다른 계정이 이미 닿는데 새 접근으로 잡힌 주체 (확정) | 0 | 17 (1) | 19 (19) | 17 (17) |
| 점수판 격차 사람 (확실 / 추정) | 7 (3 / 4) | 7 (1 / 6) | 11 (0 / 11) | 8 (0 / 8) |

- Okta 있음, Okta 없음은 주소 허브를 넣어도 Link · 객체 · 관계 파일이 바이트까지 같다. 위 허브가 남긴 계정 가운데 같은 주소를 SaaS 둘이 쓰는 것이 없었다(연결 충돌 0).
- Okta · GWS 없음의 Link 6개는 모두 Atlassian · Slack(그리고 Salesforce) 계정이다. 하나는 공용으로 보이는 관리자 주소라 `shared_mailbox_suspected` 가 붙었다.
- 남은 확정 17개는 모두 GitHub 때문이었다. GitHub 확인 메일이 회사 주 도메인과 다른 별칭 도메인이다. 아래 「별칭 도메인 단계」로 풀렸다.
- 점수판(라벨 1/2/8, 위협 확실·추정 1/2, 첫 끊기 6/6)과 로그 설명률(켬 91%)은 main 과 같다.

**별칭 도메인 단계 (2026-11-14, crosswalk.yaml `decided.alias_domain_level`).** 같은 조직이 DNS 로 확인한 도메인끼리 앞부분이 같은 주소를 `possibly_same` 에서 `resolved` 로 올렸다. 주소 허브도 그 묶음을 한 주소로 본다. 같은 수집본, 엔진 main c0ab864(위협 판정이 연결 없음 · 약한 연결을 미확정으로 보는 판, aegi-adapter-engine#409) 기준.

| | Okta 있음 | Okta 없음 앞 → 뒤 | Okta · GWS 없음 앞 → 뒤 |
| --- | ---: | ---: | ---: |
| 사람 Link (든 계정) | 9 (41) 같음 | 9 (31) 같음 | 6 (16) → 7 (20) |
| 사람 (같은 사람 묶음) | 26 같음 | 25 같음 | 26 → 23 |
| 잘못 잡힌 주체 (확정) | 0 같음 | 17 (0) → 0 | 13 (4) → 0 |
| 라벨 맞음 / 틀림 / 못 찾음 | 7 / 0 / 6 같음 | 3 / 2 / 7 → 5 / 0 / 7 | 1 / 2 / 8 → 3 / 0 / 8 |
| 정답 위협 확실·추정 맞음 | 4/5 같음 | 2/4 → 3/4 | 1/2 → 2/2 |
| gt:threat 정밀도(라벨 사람만) | 9/11 같음 | 8/14 → 8/10 | 5/10 → 5/6 |

- Okta 있음은 Link · 객체 · 관계 파일과 점수판, gt:threat 가 끔 · 켬 모두 바이트까지 같다. 별칭으로 맞는 GitHub 계정은 Okta 앱 배정 이름(같은 별칭 주소)으로 이미 `resolved` 였다.
- 별칭으로 맞춘 간선 3개(Okta 없음은 GWS → GitHub, Okta · GWS 없음은 주소 허브)는 모두 Okta 있는 원래 Link 에서도 같은 사람이다. 두 데이터셋의 사람 간선 전부(22개, 13개)가 원래 Link 와 같은 사람이다.
- 걱정: 같은 조직의 두 도메인에서 앞부분만 같은 다른 사람. 11-04 수집본에는 없었다(맞춘 3개 모두 같은 사람). 생기면 링크의 `domain_alias` 표시로 가려 본다.

---

## 쌍이 아니라 집합을 저장한다

```
쌍 폐쇄를 저장    집합 크기의 제곱.  10만 개 집합 -> 100억 쌍
집합을 저장       선형
```

5억 건 규모를 다룬 연구가 내린 결론이고, 우리도 같은 이유로 집합을 저장한다.

```yaml
- set_id: idset_00001
  members:
    - { provider: okta,  object_type: user, value: 00u1ero7vZFVEIYLWPBN }
    - { provider: slack, object_type: user, value: U0BTGPEHEB1 }
  edges:
    - a: okta:user:00u1ero7vZFVEIYLWPBN
      b: slack:user:U0BTGPEHEB1
      level: disclosed_relation
      rule: scim_external_id
      matched_on: [externalId]
      reciprocal: false
      note: 서버 미검증. 프로비저닝 클라이언트가 단독으로 정한 값
  source:
    view_version: 3
    first_seen_at: 2026-09-21T10:00:00Z
    last_seen_at:  2026-09-21T10:00:00Z
    removed_at: null
```

**엣지를 지우지 않는다.** 집합에서 빠져도 근거는 남는다. 왜 한때 같다고 봤는지를 되짚을 수 있어야 한다.

`reciprocal`은 양쪽이 서로를 가리키는지다. 5억 건 실측에서 양방향 주장이 68%였고 신뢰도 신호로 쓰였다.

---

## 숫자 신뢰도를 쓰지 않는다

`confidence: 0.7` 같은 값을 쓰지 않는다. W3C 워크숍 논문이 정확히 그걸 경고한다 — 그 실수가 **어디서 나오는지 근거가 없고** 확률론과의 관계도 불분명하다는 것이다.

대신 **규칙 식별자와 무엇이 일치했는지**를 적는다.

```yaml
rule: scim_external_id          # 어느 규칙이 발동했나
matched_on: [externalId]        # 어느 값이 일치했나
```

단계(`level`)가 등급이고, `rule`이 근거다. **둘 다 사람이 읽고 반박할 수 있다.** 0.7은 반박할 수 없다.

---

## 아니라는 기록도 남긴다

```
owl:differentFrom   약 3,600 건
owl:sameAs          558,943,116 건
```

**아무도 "다르다"를 기록하지 않는다.** 보안 그래프에서는 그게 아깝다. 사람이 한 번 검토해서 아니라고 판정하면 그건 영구 자산이다. 안 남기면 다음 수집 때 같은 오판을 반복한다.

```yaml
- a: slack:user:U0BTGPEHEB1
  b: okta:user:00u9zzz
  level: different
  rule: manual_review
  reviewed_at: 2026-09-21
```

`different` 엣지는 같은 집합에 두 끝점이 들어오는 것을 **막는다.**

---

## 맞추는 방법

| | 방법 | 키 | 단계 | 전제 |
| --- | --- | --- | --- | --- |
| M1 | 벤더 외래키 | SCIM `externalId`, Okta `AppUser.externalId` | `disclosed_relation` | IdP가 프로비저닝해야 채워진다. **실측 확인** — 아래 |
| M2 | IdP 허브 | 앱 ↔ 대상 테넌트 | `resolved` | IdP를 거친 계정만 |
| M3 | 자연키 | email, username | email 끼리면 `resolved`(2026-11-03), 그 밖은 `possibly_same` | 재사용 안 됨을 가정 |
| M4 | 인증 상관 | SSO subject, 감사 로그 행위자 | `possibly_same` | 로그 보존 기간 |
| M5 | 사람이 쓴 표 | — | `resolved` 또는 `different` | 유지 비용 |

### M3이 위험한 근거

```
Google    삭제 후 20일 안에 같은 주소를 다른 사람에게 재할당 가능
GitHub    로그인 이름은 90일 뒤 누구나 가져간다
Okta      username 은 바뀔 수 있고 email 은 유일하지 않다
```

그래서 M3에는 **유효창이 필수다.** 언제부터 언제까지 그 값이 그 사람이었는지 없이 쓰면, 권한이 엉뚱한 사람에게 붙는다.

> **정함 (2026-11-03, Relation 주담당) — 같은 이메일이면 같은 사람(`resolved`)으로 잇는다.** SaaS 를 가리지 않고, admin@ 같은 공용 주소, 한 SaaS 안 여러 계정이 같은 주소인 것도 잇는다. 사후 분석에 그 연결이 있는 편이 낫다는 판단이다. 위 재사용 위험은 받아들이고, 공용으로 보이는 주소는 링크 간선에 `shared_mailbox_suspected` 만 남긴다(판정은 그대로). 비교는 대소문자, 앞뒤 공백을 가리지 않고 빈 값, 가린 값, 자리표시 값은 일치로 보지 않는다. 규칙은 `ontology/crosswalk.yaml` `email_match`(두 끝 칸이 다 `transform: email_address`)와 `decided.email_same_person` 이다. Salesforce Username 처럼 이메일 칸이 아닌 M3 줄은 `possibly_same` 그대로다

```yaml
- level: possibly_same
  rule: natural_key_email
  matched_on: [email]
  valid_from: 2026-08-01
  valid_to: null
```

### M1의 전제가 실측으로 확인됐다

"IdP가 프로비저닝해야 채워진다"는 단서가 **실제로 그대로 나왔다**(`reports/EA_Validation_Report_v2.md` §3.7).

Okta 테넌트에 GitHub 연동 앱이 있고 그 앱은 GitHub 조직을 **이름으로** 가리킨다.

```json
{ "label": "Github Enterprise Cloud - Organization",
  "settings": { "app": { "githubOrg": "AEGI-org" } } }
```

그런데 그 앱에 배정된 5명이 전부 이렇다.

```json
{ "externalId": null, "scope": "USER", "syncState": "DISABLED" }
```

**`externalId`가 5건 전부 `null`이고 `syncState`가 `DISABLED`다.** 앱은 연결돼 있는데 프로비저닝이 꺼져 있어서 **M1이 쓸 값이 하나도 없다.** 자리는 있고 값이 없는 것이 Slack 실측(32명 전원 빈 값)에 이어 두 번째다.

> **`disclosed_relation`은 프로비저닝이 켜진 앱에서만 나온다.** 앱이 연결돼 있다는 것과 외래키가 채워진다는 것은 다른 사실이다.

### 벤더가 준 연결의 상대편이 실제로 있는가

같은 앱이 `githubOrg: "AEGI-org"`로 GitHub 조직을 가리키는데, **GitHub에 그런 조직이 없다** — `GET /orgs/AEGI-org` → **404**.

**벤더가 준 연결이라도 대상이 없을 수 있다.** 설정 문자열은 오타가 나도, 조직이 이름을 바꿔도, 나중에 지워져도 그대로 남는다.

> **미결 —** 끊긴 연결을 어떻게 적나. Link를 아예 안 만들거나, `status: unresolved`로 만들어 두거나 둘 중 하나다. 앞은 "연결이 있었다"는 사실이 사라지고, 뒤는 존재하지 않는 대상을 가리키는 집합이 생긴다.

---

## 규칙은 provider 쌍이 아니라 방법 단위로 쓴다

provider 쌍마다 규칙을 두면 5곳에 10개, 10곳에 45개가 된다. 그리고 대부분 빈다.

```yaml
# crosswalk.yaml
links:
  - method: external_id
    from: { provider: slack, path: externalId }
    to:   { provider: "@hub", object_type: user, match: id }
    level: disclosed_relation

  - method: natural_key
    key: email
    normalize: [lowercase, trim]
    level: possibly_same
    require_validity_window: true
    exclude_when: { is_bot: true }        # 봇은 email 이 없다. 실측 21/21
```

**provider가 늘어도 규칙이 제곱으로 안 는다.** 새 provider는 어느 방법에 해당하는지만 적는다.

---

## 지금 Slack 데이터의 상태

```
SCIM externalId      32명 전원 비어 있음      IdP 가 프로비저닝을 안 한다
email                고유 32개, 전부 1:1     충돌 0
email 없는 레코드      61건 중 34건
봇·앱 계정            21건, email 있는 것 0건
```

**M1의 자리는 있는데 값이 없다.** 지금 테넌트에서 쓸 수 있는 건 M3뿐이고, M3은 약하다.

그래서 **`crosswalk.yaml`은 비워 둔다.** 조인할 상대가 생기기 전에 규칙을 쓰면 provider 하나로 일반화하는 것이 된다. 두 번째 provider를 실제로 수집한 뒤에 채운다.

---

## 이 파일이 지켜야 할 것

- `set_id`는 유일하다
- 한 Object는 같은 `level` 계열의 집합에 두 번 안 들어간다
- `members[]`의 모든 항목이 실재하는 Object다. 없으면 `Object_Schema_v4.1.md`의 껍데기 규칙을 따른다
- `edges[]`의 두 끝점이 전부 `members[]`에 있다
- `edges[].level`은 다섯 값 중 하나다
- `level: different`인 두 끝점은 같은 집합에 없다
- `edges[].rule`이 있다. 숫자만 있는 신뢰도는 쓰지 않는다
- `level: possibly_same`이고 `rule`이 자연키면 `valid_from`이 있다
- 단계가 다른 간선이 한 집합에 있으면 쌍마다 경로의 가장 약한 간선 단계를 쓴다. 집합을 한 단계로 뭉치지 않는다
- 약한 간선 둘 이상을 거쳐야 이어지는 두 계정은 그 경로로 잇지 않는다(2026-10-29 정함). 엔진에서 지금 이것을 따르는 곳은 EA 계산뿐이다(「정한 것」)
- `set` 안의 provider가 전부 다르다. 같은 provider의 두 Object가 한 집합에 있으면 그건 Link가 아니라 Object 병합 문제다. 다만 같은 이메일로 맞은 같은 provider 계정은 함께 든다(2026-11-03 `decided.same_provider_accounts`, `email_same_person`). 그 간선에는 `shared_mailbox_suspected` 를 남긴다
- `source.view_version`이 있다
- 관계 질의는 기본으로 Link를 타지 않는다

---

## 정한 것 (2026-10-29, Relation 담당 결정)

- **약한 간선 둘 이상을 거친 두 계정 — 막는다.** (2026-11-03 부터 이메일 일치는 강한 간선이라, 이메일로만 이어진 계정들은 이 규칙에 걸리지 않는다.) 예: Slack 계정 ~ IdP 허브(이메일) ~ GWS 계정(이메일). 고른 것은 잇지 않는다 / 더 약한 단계(`possibly_related`)로 잇는다 / 같은 키로 맞춘 두 간선이면 바로 잇는 약한 간선과 같게 본다 셋이었다. **다시 볼 조건:** 정규화 보고서가 이 규칙으로 막은 쌍 수를 세고(aegi-adapter-engine#168, 10-30 머지. 정규화 실행 보고서 `runner-report.json` 의 `identity_link_pairs.blocked`), 0이 아니면 다시 본다. 정답 대조 데이터(위 「두 계정 사이의 단계」)에는 이런 쌍이 없지만, 10-29에 받은 대시보드 D1 current(10-27 게시)의 링크에는 47쌍 가운데 14쌍이다(링크 5개, 약한 간선은 모두 natural_key `possibly_same`. 10-03 정규화본은 33쌍 가운데 1쌍). 보고서도 이와 같이 센다. EA 경로에 걸렸는지와 상관없이 사람 링크와 자동화 링크 안의 계정 쌍을 링크마다 센다(엔진 `linkPairCounts`). 보고서가 있는 10-03 정규화본은 33쌍 가운데 1쌍(slack-slack)이고, D1 current 는 정규화 산출이 아닌 보충 판이라 보고서가 없다. 그래서 이 조건은 이미 0이 아니다. 10-31에 엔진 main `9755454`로 다시 쟀다(수만 셈). D1 current 는 링크 9개 전부로 47쌍, 사람 링크 8개로 46쌍이고, 막힌 쌍은 둘 다 14다. 14쌍 모두 natural_key 약한 간선 둘을 거친다. natural_key 의 허브 쪽 칸은 crosswalk 에서 늘 Okta `login` 이라, 위 셋째 선택지(같은 키로 맞춘 두 간선)를 고르면 14쌍이 모두 풀린다. 다만 그 가운데 1쌍은 Salesforce 계정 둘이다. 풀면 이 파일 「이 파일이 지켜야 할 것」의 「`set` 안의 provider가 전부 다르다」와 부딪친다(crosswalk `decided.service_account_email` 도 같은 문제). 10-03 보고서의 막힌 1쌍(slack-slack)도 같은 provider 쌍이다. 원본 없이 객체만으로 지금 crosswalk 에 다시 이어 본 추정도 있다. 이때 Link 재료와 기록 출처 간선은 다시 만들지 못한다. 저장소 `aegi_inc_measured_v2` 는 46쌍 가운데 14쌍으로 같은 모양이다. 원본에 GitHub SAML 재료가 있었다면 GitHub 자리를 그 강한 간선이 차지해 8쌍까지 줄 수 있다. D1 객체로는 15쌍 가운데 0쌍이다. 10-26 수집에서 Okta login 이 다른 도메인 값으로 바뀌어 있어(SaaS 계정 가운데 GWS 와만 8개가 같음) natural_key 간선 15개가 사라지고, 이은 쌍(strong, one_weak)이 32에서 15로 준다. 그래서 막힌 쌍이 0이어도 사람을 덜 이어서일 수 있다(아래 「아직 안 정한 것」). 지금 막는 곳은 EA 계산뿐이고, 엔진의 다른 곳(`linkPairGrade`를 쓰는 격차 판정, 영향 범위, 범용 접근 엔진, 시나리오 질문의 계정 찾기)은 아직 약하게 잇는다. 시나리오 질문의 계정 찾기는 같은 기준으로 가기로 정했다(`Path_Rule_Schema_v1` 「정한 것」)

## 아직 안 정한 것

- **「약한 간선 둘 이상을 거친 두 계정」의 다시 볼 조건에, 이은 쌍이 줄어드는 것도 넣을지.** 지금 조건은 막힌 쌍(`identity_link_pairs.blocked`)이 0이 아닌지만 본다. 10-31 D1 객체를 지금 crosswalk 로 다시 이으면 막힌 쌍은 0이지만, 이은 쌍(strong, one_weak)은 32에서 15로 준다. 그 15 가운데 8은 새로 생긴 쌍이라 합계만 보면 잃은 쌍을 가린다. 그래서 SaaS 짝마다 잃은 쌍을 봐야 하는데, 보고서는 지난 실행 값을 남기지 않는다. 데이터셋 링크를 지금 crosswalk 와 견주는 게시 때 점검(aegi-adapter-engine 의 link-staleness, 머지 전)이 이 일을 한다. Relation 담당이 정한다
- **RFC 9493 subject identifier**가 교차 provider 안정 식별자를 주는지. 확인 못 함
- 상용 제품(Veza OAA 등)이 local user와 identity를 어떻게 나누는지. 확인 못 함
- 허브를 안 거친 계정(봇·서비스 계정)을 어떻게 이을지. **현재 방법 없음**
- 집합이 나중에 쪼개질 때(`different`가 뒤늦게 들어올 때) 이미 답한 질의를 어떻게 정정할지
- **그룹 push 매핑을 연결 근거로 받을 때 Slack 쪽 id 를 어디서 얻나.** Okta `/api/v1/apps/{id}/group-push/mappings` 가 `sourceGroupId`(Okta 그룹)와 `targetGroupId` 를 주는데, **`targetGroupId` 는 Okta 안의 그림자 그룹(`APP_GROUP`)이고 Slack id(`S…`)가 아니다.** Slack 쪽에서도 조직 단위 IdP 그룹 목록은 SCIM 권한(쓰기 포함 `admin`) 없이는 못 본다. 실측에서는 사람이 Slack 관리 화면에서 id 를 읽었다(`reports/EA_Validation_Report_v2.md` §7.5). **벤더가 준 교차 연결인데 양쪽 API 어디에도 이어 붙일 키가 없다.** 벤더가 매핑을 줬으니 `disclosed_relation` 성격이지만 키가 끊겨 있어 단계를 못 정한다. 선택지 — SCIM 읽기를 수집 범위에 넣는다 / 그룹 이름으로 맞춘다(`possibly_same`) / 사람이 확인한다(`resolved` 또는 M5)
- **끊긴 벤더 연결의 표기.** 위 「벤더가 준 연결의 상대편이 실제로 있는가」
