# 객체 타입 보안 관련성 시험 v1

2026-11-01에 고정했다. 정규화 출력의 객체 타입이 보안 분석에 쓰이는지 세 시험으로 가른다. **아직 삭제 기준이 아니다.** 세 시험을 모두 실패한 타입은 사람이 검토할 후보 목록으로만 쓴다.

## 배경

V3.2 객체 타입 1,991개 가운데 1,981개가 `object`이고 모두 interface를 받았다. V3.2는 「interface를 줄 수 있으면 object」로 판정했고 그 판정을 LLM이 했다. 그래서 interface만으로는 보안과 무관한 객체를 거를 수 없다. 이 시험은 LLM 없이 파일만 읽어 다른 근거 셋을 댄다.

## 시험

| 시험 | 재료 | 통과 조건 |
| --- | --- | --- |
| T1 접근 구조 | `framework/schema/ontology/relation_semantics.yaml` effects, 엔진이 실제로 쓰는 IM Profile 관계 선언(aegi-knowledge `schema/validation/check_im_relations.py`의 `engine_model`, `declarations`), 정규화 출력의 실제 관계 | 접근(G, M) 또는 신뢰(A, F, T) 효과를 내는 관계의 끝. 또는 정책 의미 관계(`applies_to`, `excludes`, `evaluates`, `permits`, `trusts`, `authenticates_with`)의 끝. 구조(U)만 내는 연결은 근거에서 뺀다 |
| T2 보안 속성 | Profile 필드 이름, 타입 이름 | 이름을 낱말로 나눴을 때 낱말 하나나 이어진 낱말 묶음이 [t2_words.py](t2_words.py) 사전에 있다 |
| T3 소비처 | knowledge ontology, groundtruth와 engine 판정, 접근 규칙, 이벤트, 연결 규칙 파일(211개, 2026-11-19) | provider와 타입 이름이 같은 파일에 함께 나온다 |

## 돌리는 법

스크립트가 읽는 `schema/validation/check_im_relations.py`와 `groundtruth/`는 이 저장소에 없다. aegi-knowledge 저장소 루트에서 돌리세요.

```bash
pip install pyyaml
AEGI_ENGINE=<aegi-adapter-engine 클론> python schema/im-model/relevance/check_object_relevance.py \
  --dataset <정규화 출력 폴더> --out <결과 json>
```

정규화 출력은 엔진 `npm run normalize`의 출력 폴더(`objects.json`, `relations.json`)다. 실측 데이터라 저장소에 넣지 않는다.

## T2 사전이 바뀐 과정 (v1까지)

처음 판은 부분 문자열 정규식이었다. TimeZone의 zone, FormFactor의 factor, Associated의 sso처럼 낱말 우연으로 붙었다. v1은 낱말 단위로 맞춘다. 뜻이 넓은 낱말(zone, factor, share)은 묶음으로만 받는다(`network zone`, `factor type`, `share type`).

| 단계 (10-30 데이터) | 세 시험 모두 실패 | 아래 「놓친 보안 객체」 10개 가운데 실패 |
| --- | --- | --- |
| 부분 문자열 | 64 타입 / 551 객체 | 10 |
| 낱말 단위 | 66 / 526 | 10 |
| + 타입 이름 | 58 / 488 | 6 |
| + 낱말 security, policy, provisioning, behavior, claim과 묶음 send as, resource set (v1) | **50 / 395** | **1** |

낱말 단위로 바꾸며 떨어진 6개는 모두 낱말 우연이었다(`BusinessHours`, `SystemInfoEntity`, `ServerInformation`, `UserAppInfo`, `AppDefinition`, `UiFormulaRule`). 새로 붙은 4개는 관리자 필드였다(`AppMenuItem.IsUsingAdminAuthorization`, `branch-protection.enforce_admins`, `simple-user.site_admin`, `board.admins`).

**과적합 주의:** 마지막 단계의 낱말은 10-30 데이터의 놓친 객체를 보고 더했다. 다른 tenant나 다음 수집에서 다시 재야 한다.

## 결과 v1

| 데이터 | 타입 | 객체 | 세 시험 모두 실패 | 통과 타입 T1 / T2 / T3 |
| --- | --- | --- | --- | --- |
| 10-27 운영 스냅샷 `20261027T021841Z-314ccc69-e85107` | 101 | 956 | 6 타입 / 101 객체 | 63 / 64 / 57 |
| 10-30 2회차 수집 run `20261030T093906Z-e2e6` 정규화 | 196 | 2,181 | 50 타입 / 395 객체 | 74 / 112 / 62 |

엔진은 aegi-adapter-engine `356b910`, knowledge는 `8fb8c6c`에서 쟀다.

## 놓친 보안 객체 기록

처음 판에서 세 시험을 모두 실패했지만 보안 분석에 쓰이는 타입이다. 주원인은 관계 선언이 없는 것이다(AEGI-Inc/aegi-knowledge#158).

| provider | 타입 | v1에서 붙은 근거 | 남은 일 |
| --- | --- | --- | --- |
| github | `actions-secret` | 타입 이름 secret | 관계 선언 |
| salesforce | `PermissionSetGroup` | 타입 이름 permission | 관계 선언(권한 세트 묶음에서 사용자로) |
| salesforce | `CspTrustedSite` | 타입 이름 trusted | |
| okta | `AuthenticatorMethodBase` | 타입 이름 authenticator | |
| okta | `PolicyMapping` | 타입 이름 policy | 관계 선언(정책에서 앱으로) |
| okta | `ResourceSetResource` | 타입 이름 resource set | 관계 선언(리소스 세트에서 대상으로) |
| okta | `BehaviorRule` | 타입 이름 behavior | |
| okta | `ProvisioningConnectionResponse` | 타입 이름 provisioning | |
| atlassian | `SecurityScheme` | 필드 defaultSecurityLevelId, 타입 이름 security | |
| okta | `DeviceWithProviders` | **없음. v1에서도 실패** | 관계 선언 또는 사전. 기기는 보안 대상이다 |

v1에서 새로 붙은 다른 보안 객체: Okta `OAuth2Claim`(필드 claimType), GWS `SendAs`(필드 sendAsEmail, 메일 대리 발신), SF `ServiceSetupProvisioning`.

## 검토 후보 (10-30, 세 시험 모두 실패 50 타입)

| 분류 | 타입 수 | 객체 수 |
| --- | --- | --- |
| aegi-adapter-engine PR #220이 지움(빈 타입, 중복 타입) | 5 | 108 |
| 판단 필요 | 11 | 40 |
| 보안 무관 후보 | 34 | 247 |

**PR #220이 지움:** atlassian `parent:user/{}` 51, `features` 50, `200.filter` 3, `ProjectDetails` 3, okta `PublicAppleAppSiteWellKnownURI` 1

**판단 필요**

| provider | 타입 | 객체 | 메모 |
| --- | --- | --- | --- |
| salesforce | `GenAiFunctionDefinition` | 11 | AI 에이전트 동작 정의 |
| salesforce | `UserLicense` | 11 | 라이선스 |
| salesforce | `GenAiPlannerFunctionDef` | 4 | AI 에이전트 동작 정의 |
| salesforce | `GenAiPluginDefinition` | 4 | AI 에이전트 동작 정의 |
| github | `branch-with-protection` | 4 | 보호 규칙은 `branch-protection`이 가진다 |
| salesforce | `BotDefinition` | 1 | 봇 정의 |
| salesforce | `BotVersion` | 1 | 봇 버전 |
| okta | `DeviceWithProviders` | 1 | 기기(놓친 보안 객체) |
| salesforce | `Entitlement` | 1 | 계약 권리 |
| salesforce | `GenAiPlannerDefinition` | 1 | AI 에이전트 정의 |
| github | `branches` | 1 | 브랜치 목록 |

**보안 무관 후보:** salesforce `FlowDefinitionView` 106, `UiFormulaCriterion` 13, `UiFormulaRule` 13, `MacroInstruction` 9, `UserAppInfo` 7, `DuplicateRule` 5, `FlowRecordElement` 4, `ProcessNode` 4, `MatchingRule` 3, `EmailServicesFunction` 2, `PresenceConfigDeclineReason` 2, `PresenceUserConfigProfile` 2, `ProcessDefinition` 2, `QueueRoutingConfig` 2, `AppDefinition` 1, `BusinessHours` 1, `ManagedContentChannel` 1, `PresenceUserConfigUser` 1, `QueueSobject` 1, `SlaProcess` 1, `WaveAutoInstallRequest` 1 / atlassian `ContentTemplate` 16, `screens` 14, `IssueTypeWithStatus` 11, `tabs` 6, `NotificationScheme` 3, `issuetypescreenscheme` 2, `quickfilter` 2, `DefaultWorkflowEditorResponse` 1, `SoftwareInfoDTO` 1, `SystemInfoEntity` 1, `TimeTrackingProvider` 1, `priorityscheme` 1 / gws `Version` 7

## 다음 단계

1. 관계 처분 절차(AEGI-Inc/aegi-knowledge#158). 관계가 채워지면 T1이 정확해진다.
2. 다른 수집에서 v1을 다시 재서 사전 과적합을 확인한다.
3. 「보안 무관 후보」는 사람이 확인한 뒤 「목록 전용」(그래프에서 뺌)으로 돌린다. 어디에 표시할지는 아직 정하지 않았다.
