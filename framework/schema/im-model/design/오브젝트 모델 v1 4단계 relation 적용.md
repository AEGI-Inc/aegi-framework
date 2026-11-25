# 오브젝트 모델 v1 4단계: relation 적용

타입 수준 관계 초안을 생성했다. ID 참조의 존재와 권한 관계의 의미 확정은 구분한다. 대상이 같은 공간 쌍이라는 이유만으로 Relation의 방향과 의미가 증명되지는 않는다.

작성일: 2026-10-19. 기준은 고정한 `Relation_Schema_v3.md.source`의 닫힌 어휘 17종이다.

## 적용 결과

| 대상 | 결과 |
| --- | --- |
| Object 타입 후보 | 1,973개, 인터페이스와 구조 근거 보존 |
| 필드 참조 | 5,293개, 대상별 조건과 원래 필드 슬롯 보존 |
| 부모 포함 규칙 | 430개, 실행 시 scope 또는 references.parent 일치 필요 |
| 기존 Profile | 20개 문서 블록, 참조와 3항 배정 적용 66개 |
| Cartography 비교 | 128개 선언, 타입 템플릿 호환 30개. 끝점 또는 템플릿 검토 7개와 의미 매핑 미선언 92개는 사용자 결정 완료 |

## 적용 기준

`owned_by`의 세 템플릿은 각각 짝을 이룬다. 예를 들어 Resource가 Tenant에 owned_by인 것으로 넓혀 읽지 않는다. `has_role_on`에는 Policy인 role 슬롯이 반드시 남아야 한다. `contained_in`은 단순 필드 참조가 아니라 실제 scope 또는 parent를 증명해야 한다.

기존 Profile은 호환 11개, tenant 범위 참조 17개, 3항 배정 2개, no_relation 3개, 명시적 어휘 공백 4개, 매핑 미선언 23개, 끝점 미정 3개와 범위 근거 검토 3개다. `relation_type` 없음, 명시적 null, `no_relation`은 각각 미검토, 어휘 공백, 관계가 아님으로 구분한다. 이 초안에서 비어 있는 매핑을 검토 완료한 Profile null로 취급하지 않는다.

## 사용자 결정 (2026-10-19)

배정 의미 18개, Cartography 끝점 7개, Profile 33개를 모두 권고대로 결정했다. 결정은 `relation_decisions_step4.json`에 검토 ID별로 남기고 `model_v1.py`가 대장, 타입, Profile과 Cartography 행에 붙인다. 결정과 맞는 검토 항목이 없으면 생성이 실패한다.

| 묶음 | 결정 |
| --- | --- |
| 배정 의미 18 | 배정 유지 12. Assignment를 빼고 다른 interface만 남김 3(Okta AD 연결, 워크로드 연결, 인증 수단 등록). 기록이나 속성으로 내림 3(Google Drive 승인, Okta 역할 출처, IGA 요청). 이 중 interface가 남지 않은 2개는 `demoted_by_user_decision`이다 |
| Cartography 끝점 7 | Okta 네트워크 영역 2개는 조건 참조로만 보존. Jira 권한 줄과 프로젝트 역할 3개, Salesforce 사용자 역할 1개는 역할 슬롯이 있는 has_role_on. Salesforce 역할 계층은 ParentRoleId 근거의 contained_in |
| Profile 33 | Slack trigger는 Endpoint, Google ASP는 Credential. GitHub 조직 owner는 대상별로 나눈다. contained_in 3개 인정. 매핑 18개 선언, 관계 아님 3개, ASP parent는 authenticates_with에 합침 |
| aegi-schema 제안 | D2, E11. Slack 워크플로 → 앱 owned_by(기존 템플릿 안), Okta 그룹 소유자 owned_by Principal → Principal 추가 |

Cartography 매핑 미선언 92개도 권고대로 결정했다. 역할 배정 19(그중 기존 배정 3항에 흡수 6), 회원 4, 소속 13, 소유와 적용 6, relation 아님 17, Effective Access 계산 3, 보류 6(패키지와 저장소, 기기 소유 2, 의존성 파생 3), v1 밖 24다. Okta 앱 배정은 앱별 기본 접근 Policy를 역할 칸에 둔다.

기존 interface 기준표와 다른 71개도 권고대로 결정했다([판단표](https://claude.ai/artifact/AT3hAJ1hojkvRRpMfAjaW2)). interface를 정한 60개, Object에서 뺀 10개, 보류 1개다. 결정은 같은 대상 묶음의 모든 보기에 적용하고 모델 판정은 `model_verdict`, `model_interfaces`로 남긴다. 기기는 Resource, Okta NetworkZone은 Policy가 됐다. 그래서 B1(PolicyRule excludes NetworkZone)은 템플릿에 맞게 됐지만 「조건 참조로만 보존」 결정은 그 행에 그대로 붙어 있다.

interface 미정 389개도 권고대로 결정했다([판단표](https://claude.ai/artifact/ErJBqTUB6cFW9kzQnH4ZCT)). 남김 29개, Object에서 뺌 359개(Salesforce 233), 보류 1개(Salesforce SfdcPartnerTenant)다. 한 보기를 빼는 결정은 그 보기에만 적용한다. 예를 들어 Google 메일 위임 이메일을 빼도 Google User는 남는다. 이로써 검토 대장의 열린 항목은 0개다.

결정은 타입 수준의 의미다. 실제 Relation 행 생성과 aegi-schema Profile 수정은 아직 하지 않았다.

## 의미 검토에서 확인할 사항

| 묶음 | 권고와 필요한 근거 |
| --- | --- |
| GitHub ADMIN, MAINTAIN, READ, TRIAGE, WRITE와 SaaS HAS_ROLE | 출발 주체, 적용 대상과 별도 Policy 역할을 결합한 has_role_on을 검토한다. 기존 2항 간선을 역할 없이 이름만 바꾸지 않는다 |
| Jira PermissionGrant와 ProjectRole | 배정 레코드 자체는 Principal이나 Policy가 아니다. holder 조건으로 주체를 고르고 permission과 프로젝트를 role, target에 연결해야 한다 |
| Salesforce UserRole 계층 | Policy를 Principal로 강제해 member_of를 통과시키지 않는다. 역할 배정과 역할 상속은 별개 의미로 검토한다 |
| OAuth AUTHORIZED | 사용자, 테넌트 등록 앱과 scope 또는 권한 Policy의 결합을 검토한다. 전역 clientId만으로 테넌트 Integration을 만들지 않는다 |
| CREATED, CREATED_BY, LAST_UPDATED_BY, COMMITTED_TO, DISMISSED_BY | 변경 기록을 권한 관계로 바꾸지 않는다. 명세가 no_relation이라고 한 Slack creator는 그 판정을 유지하고 다른 필드에도 근거를 확인한다 |
| HAS_RULE, BRANCH, HAS_ENVIRONMENT, HAS_WORKFLOW 등 | 실제 Object의 scope나 parent 근거가 있으면 contained_in을 검토한다. 소속처럼 보이는 라벨만으로 적용하지 않는다 |
| OWNS, OWNER_OF, MEMBER_OF 역할 | 대상이 Principal, Policy, Resource 중 무엇인지와 소유자 역할 의미를 확인한다. 소유자라는 이유만으로 일반 member_of를 새로 만들지 않는다 |
| 네트워크 조건과 Factor, ReplyURI | 현재 Endpoint, Policy, Credential 인터페이스의 계약과 방향을 함께 확인한다. 템플릿이 안 맞는 항목을 확정 간선으로 세지 않는다 |

Cartography 잔여 42개는 2단계에서 D 18개, E 24개로 정의와 생성 근거를 확보했다. 로컬 연산 13개와 수집 계약 29개를 실제 입력 수집 완료로 바꾸지 않는다. Action, CODEOWNERS를 포함한 E 24개는 기존 사용자 결정에 따라 v1 확정 범위 밖의 별도 수집 과제로 유지한다.

## 산출물

`candidate-extraction/ir2/out2/v1/relation_types.json`에 17종 어휘, 참조, 부모 규칙, Profile 적용과 Cartography 방향을 함께 기록했다. 의미 미정은 `review_queue.json`에 남겼다. `verify_model_v1.py`는 타입 참조 누락, 조건 누출, 역할 생략과 허용 어휘를 검사한다. 이 검증을 실제 Relation 행의 관측이나 최종 의미 승인으로 취급하지 않는다.
