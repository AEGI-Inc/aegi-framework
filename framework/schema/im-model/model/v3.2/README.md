# AEGI IM Object Model V3.2

**2026-10-25에 V3.1의 누락 두 가지를 고쳐 고정한 IM Object Model이다. Object 판정만 바뀌었고 Relation, 참조, 고아, 동일성 결과는 V3.1과 같다.** Object 타입 행 1,991개(Object 1,981, non_object 10), 이번 run 실측 77개(+조건부 alias 경유 1개)다.

고정 상태는 저장소 루트에서 `npm run verify:freeze`로 확인한다(파일 40개). 만든 과정은 원 작업 공간 `im-model-revision/`(revision `r3`)에 있고 이 저장소에는 없다. 검증 검사 30개 통과.

## 1. V3.1에서 고친 것

| 결정 | 문제 | V3.2 |
| --- | --- | --- |
| R3-D01 | Slack RPC 메서드는 문서 view가 둘이다(legacy, docs_methods). 실측 연결은 대표 view 하나의 record shape만 셌다. `users.list`(SL-02) 38건은 어떤 타입의 shape도 아닌 legacy view가 대표로 뽑혀 Slack 사용자 타입(`200.members[*]`)이 미관측이었다 | 다른 view(`operation.alternates`)의 record shape로도 관측을 센다. Slack 사용자 38건 관측, 대화 14건에서 32건, 사용자 그룹 2건에서 4건 |
| R3-D02 | engine의 model-v1은 연구 묶음과 실행 카탈로그(`docs/spec/model-v1/runtime-catalog.json`) 두 판으로 2026-10-19 동결됐다. V3와 V3.1은 연구 묶음만 읽었다 | 실행 판정 19개를 반영한다(아래) |

R3-D02로 반영한 실행 판정:

- **인터페이스 변경 6개(reviewed_override):** GitHub `personal-access-tokens`는 Credential에서 Assignment로, Okta `SecurityEventsProviderResponse`는 Endpoint로, Slack `credential-row:oauth:xoxb`(bot-token)는 Credential에서 Policy로, GWS `Project`는 Resource와 Automation으로, GWS `AllowlistedDomain`은 Endpoint에서 Policy로, Salesforce `OauthToken`은 Credential에서 Assignment로 바꿨다. 원래 값은 `baseline_interfaces`에 남겼다.
- **연구 타입 없는 Object 12개(record_projection):** Okta `AppUser`, `ApplicationGroupAssignment`, Slack `Message`, `workflow-collaborator`(V2-P2), GWS `Member`, `Token`, `Delegate`(V2-R1), Atlassian `SpecialPrincipal`(G4-Q03), 실행 투영 `*:NamedRole`, `*:RoutedEndpoint`. Confluence `SpacePermission`(G4-Q01)과 Slack `SlashCommandRequestEndpoint`는 V3에서 더한 행에 합쳤다. 이 행들은 `object_type_id`가 없고 `runtime_type_id`(예: `model-v1:okta:AppUser`)를 쓴다.
- **신원 Link 재료 1개(link_only):** GitHub `ExternalIdentity`(GF1)는 non_object다.

## 2. 나머지

구성, 상태 축, 한계, 사용법은 [V3 README](../v3/README.md)와 같다. 다른 점:

- 타입 식별자는 연구 타입이면 `object_type_id`(full-catalog Profile `model.research_type`과 같음), 실행 판정 타입이면 `runtime_type_id`다.
- `*:NamedRole`, `*:RoutedEndpoint`는 관계와 속성에서 실행 투영이 만드는 타입이라 관측 상태가 `derived_by_runtime`이다. Atlassian `SpecialPrincipal`은 SpacePermission 행의 접근 등급에서 만들어져 shape 관측으로는 `not_observed`로 남는다.
- 결정 R2-D01, R3-D01, R3-D02는 사용자 요청 아래 이 세션이 정했다. 다음 버전에서 사람이 다시 볼 대상이다.
