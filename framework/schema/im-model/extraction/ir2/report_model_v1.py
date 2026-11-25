"""Write the current review documents from verified type-level artifacts.

Keeps earlier research records; replaces only marked current-status sections.
"""
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
OUT=HERE/"out2"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path,text):
    path.write_text(text.rstrip()+"\n",encoding="utf-8")


def section(path,key,text):
    begin,end=f"<!-- {key}:begin -->",f"<!-- {key}:end -->"
    current=path.read_text(encoding="utf-8")
    block=begin+"\n"+text.rstrip()+"\n"+end
    if begin in current:
        start=current.index(begin)
        stop=current.index(end,start)+len(end)
        current=current[:start]+block+current[stop:]
    else:
        head,tail=current.split("\n",1)
        current=head+"\n\n"+block+"\n\n"+tail
    write(path,current)


def main():
    s=load(OUT/"v1/summary.json")
    v=load(OUT/"v1/verification.json")
    stage2=load(OUT/"stage2_verification.json")
    verified_files=stage2["determinism"]["files"]+v["determinism"]["files"]
    interfaces=load(OUT/"iface_summary.json")
    assert v["tests_passed"] and v["current_model_response_pending"]==0
    table="| SaaS | 후보 | Object 후보 | Object 제외 | 인터페이스 미정 | 응답 대기 |\n| --- | ---: | ---: | ---: | ---: | ---: |\n"
    for p in ("github","okta","slack","gws","jira","confluence","salesforce","atlassian"):
        r=interfaces[p]
        counts=r["verdict"]
        table+=f"| {p} | {r['candidates']:,} | {counts.get('object',0):,} | {counts.get('not_object',0):,} | {counts.get('undecided',0):,} | {r['model_pending']} |\n"
    table+=f"| 합계 | {s['candidate_spaces']:,} | {s['candidate_verdicts']['object']:,} | {s['candidate_verdicts']['not_object']:,} | {s['undecided_interfaces']:,} | {s['model_pending']} |\n"
    stage_table=f"""| 단계 | 현재 상태 | 종료 또는 남은 범위 |
| --- | --- | --- |
| 1 후보와 누락 조사 | 기존 사용자 결정으로 종료 | 1단계 문서 13.6. GitHub 파생 노드는 별도 수집 과제 |
| 2 같은 대상과 관계 대조 | 조사, 재생성 검증 완료 | Q1~Q3 유지. 직접 쌍 86, 나머지 42의 정의와 생성 계약 확보. 실측 완료를 뜻하지 않음 |
| 3 인터페이스 | 8개 SaaS 전수 채점과 타입 계약 점검 완료 | 인터페이스 미정 {s['undecided_interfaces']}개. 기존 기준과 차이 71개, 배정 의미 18개는 사용자 결정 완료 |
| 4 관계 적용 | 타입 수준 초안 생성, 의미 판단 58건 결정 | 참조 5,293개, 부모 규칙 430개. Cartography 의미 {s['cartography_semantics']['compatible_type_application']}개 호환, 끝점 7개, Profile 33개, 매핑 92개 결정 |
| 5 고정과 대시보드 적용 | v1 고정(2026-10-19, PR #117) | 실행 카탈로그와 고정 연구 묶음을 배포. 4개 SaaS 실측 적용 완료, 나머지 SaaS는 수집 Profile 추가 필요 |
"""
    artifacts="""| 산출물 | 내용 |
| --- | --- |
| [object_types.json](candidate-extraction/ir2/out2/v1/object_types.json) | 같은 대상 묶음을 반영한 Object 타입 후보, 인터페이스, 원본 모양과 식별 근거 |
| [candidate_inventory.json](candidate-extraction/ir2/out2/v1/candidate_inventory.json) | 제외와 미정을 포함한 모든 후보, 판정별 근거와 현재 요청 해시 |
| [relation_types.json](candidate-extraction/ir2/out2/v1/relation_types.json) | 고정 어휘 17종, 조건부 참조, 부모 규칙, Profile과 Cartography 적용 초안 |
| [review_queue.json](candidate-extraction/ir2/out2/v1/review_queue.json) | 미정, 기존 기준과 차이, 배정 의미, 관계 매핑을 검토할 개별 항목 |
| [verification.json](candidate-extraction/ir2/out2/v1/verification.json) | 테스트와 참조 무결성, 두 해시 시드의 일치 결과 |
| [manifest.json](candidate-extraction/ir2/out2/v1/manifest.json) | 입력, 소스, 캐시, 코드와 산출물의 SHA-256 |
"""
    review_table="| 검토 종류 | 항목 수 |\n| --- | ---: |\n"
    names={"undecided_interface":"인터페이스 미정","existing_reference_disagreement":"기존 기준표와 차이",
           "assignment_permission_semantics":"연결 레코드의 배정 의미","semantic_mapping_not_declared":"Cartography 관계 매핑 미선언",
           "template_or_endpoint_review":"Cartography 템플릿 또는 끝점","profile_semantic_mapping_not_declared":"Profile 관계 매핑 미선언",
           "profile_reviewed_vocabulary_gap":"Profile에서 명시한 어휘 공백","profile_endpoint_interface_unresolved":"Profile 끝점 인터페이스",
           "profile_needs_scope_or_parent_evidence":"Profile 범위 근거"}
    for k,n in s["review_categories"].items():
        review_table+=f"| {names.get(k,k)} | {n} |\n"
    current=f"""# 오브젝트 모델 v1 진행 현황

8개 SaaS {s['candidate_spaces']:,}개 후보의 전수 채점을 끝내고, 타입과 관계를 검토할 스냅샷을 생성했다. 2026-10-19 사용자 결정으로 v1을 고정했다(PR #117). 검토 대장의 열린 항목은 {s['open_review_items']}개이고 보류는 {s['undecided_interfaces']}개다. 팀 작업의 시작점은 [오브젝트 모델 v1 안내](docs/spec/AEGI_OBJECT_MODEL_V1.md)다.

작성일: 2026-10-19. 모든 수치는 타입 수준이다. 실제 Object 또는 Relation 행을 새로 수집한 수는 0개다.

## 1~5단계

{stage_table}
## 현재 판정

{table}
같은 대상 묶음과 기존 자격증명 결정을 반영한 Object 타입 후보는 {s['canonical_object_type_candidates']:,}개다. API 보기마다 받은 판정 {s['candidate_verdicts']['object']:,}개와 서로 다른 수치다. 설치 × 자격증명 종류를 적용한 묶음 {s['credential_kind_groups']}개에는 갱신과 회전 응답을 상태 보기로 포함한다. 별도 식별자로 승격했던 외부 이메일과 OAuth client locator 2개는 독립 테넌트 Object에서 제외하고 참조 근거를 보존했다.

## 검토할 항목

{review_table}
대장 {s['review_items']}개 중 {s['decided_review_items']}개는 2026-10-19 사용자가 권고대로 결정했고([relation 58건 판단표](https://claude.ai/artifact/QEUxigR97CPhuDHbGrP255), [Cartography 92건 판단표](https://claude.ai/artifact/Hw3wHgPD4ZSRdvdxqWz3xq), `candidate-extraction/ir2/relation_decisions_step4.json`), 위 표는 열린 {s['open_review_items']}개다. 한 공간이 여러 검토 종류에 들어갈 수 있으므로 서로 다른 Object 수라는 뜻은 아니다. 미정 항목에는 상위 인터페이스 확률, 기준값 차이, 제외 진술, 현재 요청 해시와 필요한 근거를 붙였다. 기존 기준표도 해석이 섞여 있어 자동으로 정답으로 취급하지 않는다.

## 검증

- 회귀 검사 {v['tests']}개와 8개 IR 검증 통과. 두 해시 시드에서 2단계 {stage2['determinism']['files']}개, 3~4단계 {v['determinism']['files']}개 파일이 일치했다.
- 참조가 가리키는 타입 누락 0건. 조건부 대상 분리, 방향, 역할 슬롯, 9개 인터페이스와 17개 관계 어휘를 검사했다. Q1~Q3 사람 결정도 유지한다.
- 원본에 URL, 권한 목록이나 비밀값 필드가 있다는 사실은 분리 과제다. 실제로 투영하지 않은 Object 행을 계약 통과로 세지 않았다. 연구 코드와 문서 범위에서 검사했으며 대시보드 빌드, 기능 검사와 배포는 수행하지 않았다.

## 산출물과 재실행

{artifacts}
```bash
cd candidate-extraction/ir2
python verify_stage2.py
python verify_model_v1.py
python report_model_v1.py
```

검증 명령은 네트워크와 모델을 호출하지 않는다. 전송 완료한 본문과 해시는 `out2/stage3_interface_send_review.json`, `stage3_okta_refresh_payloads.json`, `final_refresh_send_review.json`, `duplicate_refresh_send_review.json`에 보존했다. 새 스냅샷 작성에 사용한 추가 채점은 최초 1,941건, Okta 갱신 3건, 최종 갱신 14건과 중복 갱신 67건이다. 이전 Okta 중복 52건은 별도 기록이다.
"""
    write(ROOT/"오브젝트 모델 v1 진행 현황.md",current)
    stage3=f"""## 현재 결과 (2026-10-19)

8개 SaaS {s['candidate_spaces']:,}개 후보를 모두 현재 요청 해시로 채점했다. 모델 응답 대기 0건, Object 후보 {s['candidate_verdicts']['object']:,}개, 제외 {s['candidate_verdicts']['not_object']:,}개, 인터페이스 미정 {s['undecided_interfaces']}개다. 아래의 2026-10-18 기록은 당시 4개 SaaS의 1차 결과다.

{table}
원본 모양이 없는 부모 위치, 참조 ID 형식, 자격증명 값 자리는 구조 근거를 함께 보존했다. 같은 대상 묶음의 대표 판정은 직접 읽는 엔티티 정의를 먼저 보고, 배정 레코드의 참조 ID에 붙은 Assignment가 User 같은 실제 대상 타입을 바꾸지 않게 했다.

### 이번 수정

- 예전 공간명만 같은 점수는 재사용하지 않는다. 현재 공개 요청 본문 해시가 같고 13개 진술과 10개 선택지의 응답이 모두 유효할 때만 완료로 센다. HTTP 인증, 호출 제한 오류와 연속 실패는 전송을 멈춘다.
- 식별자 부재 N2를 Credential 규칙보다 먼저 적용한다. Git commit의 SHA, tree와 parents, 별도 생성과 읽기 API를 원문으로 확인해 실행 이벤트 오판을 고쳤다. 외부 이메일과 OAuth client locator는 독립 테넌트 Object에서 제외한다.
- 인터페이스 계약과 Object v4.1을 고정 소스에 묶었다. 원본 필드의 권한, URL, 비밀값은 관계, Endpoint와 감춤 대상으로 분리할 과제로 기록한다. 실제 투영 행의 계약 검사 통과는 0개이며 미수집이다.

임계값은 기존 4개 SaaS의 포함 기준표 229개 공간으로 맞췄다. 같은 기준표에 대한 완전 일치는 158/229이며 독립 검증 정확도가 아니다. 다른 4개 SaaS에는 같은 기준을 적용했지만 별도 정답표가 없다. 낮은 확률의 판정을 반복 호출해 확정으로 바꾸지 않았다.

구체적 근거와 다음 확인은 [진행 현황](오브젝트%20모델%20v1%20진행%20현황.md), `out2/v1/review_queue.json`, `out2/iface_contract_audit.json`을 따른다. 남은 {s['undecided_interfaces']}개를 인터페이스 확정으로 세지 않는다.

## 이전 1차 기록
"""
    section(ROOT/"오브젝트 모델 v1 3단계 interface 판정.md","model-v1-current",stage3)
    stage4=f"""# 오브젝트 모델 v1 4단계: relation 적용

타입 수준 관계 초안을 생성했다. ID 참조의 존재와 권한 관계의 의미 확정은 구분한다. 대상이 같은 공간 쌍이라는 이유만으로 Relation의 방향과 의미가 증명되지는 않는다.

작성일: 2026-10-19. 기준은 고정한 `Relation_Schema_v3.md.source`의 닫힌 어휘 17종이다.

## 적용 결과

| 대상 | 결과 |
| --- | --- |
| Object 타입 후보 | {s['canonical_object_type_candidates']:,}개, 인터페이스와 구조 근거 보존 |
| 필드 참조 | {s['typed_references']:,}개, 대상별 조건과 원래 필드 슬롯 보존 |
| 부모 포함 규칙 | {s['containment_rules']:,}개, 실행 시 scope 또는 references.parent 일치 필요 |
| 기존 Profile | 20개 문서 블록, 참조와 3항 배정 적용 66개 |
| Cartography 비교 | 128개 선언, 타입 템플릿 호환 {s['cartography_semantics']['compatible_type_application']}개. 끝점 또는 템플릿 검토 7개와 의미 매핑 미선언 92개는 사용자 결정 완료 |

## 적용 기준

`owned_by`의 세 템플릿은 각각 짝을 이룬다. 예를 들어 Resource가 Tenant에 owned_by인 것으로 넓혀 읽지 않는다. `has_role_on`에는 Policy인 role 슬롯이 반드시 남아야 한다. `contained_in`은 단순 필드 참조가 아니라 실제 scope 또는 parent를 증명해야 한다.

기존 Profile은 호환 11개, tenant 범위 참조 17개, 3항 배정 2개, no_relation 3개, 명시적 어휘 공백 4개, 매핑 미선언 23개, 끝점 미정 3개와 범위 근거 검토 3개다. `relation_type` 없음, 명시적 null, `no_relation`은 각각 미검토, 어휘 공백, 관계가 아님으로 구분한다. 이 초안에서 비어 있는 매핑을 검토 완료한 Profile null로 취급하지 않는다.

## 사용자 결정 (2026-10-19)

배정 의미 18개, Cartography 끝점 7개, Profile 33개를 모두 권고대로 결정했다. 결정은 `relation_decisions_step4.json`에 검토 ID별로 남기고 `model_v1.py`가 대장, 타입, Profile과 Cartography 행에 붙인다. 결정과 맞는 검토 항목이 없으면 생성이 실패한다.

| 묶음 | 결정 |
| --- | --- |
| 배정 의미 18 | 배정 유지 12. Assignment를 빼고 다른 interface만 남김 3(Okta AD 연결, 워크로드 연결, 인증 수단 등록). 기록이나 속성으로 내림 3(Google Drive 승인, Okta 역할 출처, IGA 요청). 이 중 interface가 남지 않은 {s['demoted_by_user_decision']}개는 `demoted_by_user_decision`이다 |
| Cartography 끝점 7 | Okta 네트워크 영역 2개는 조건 참조로만 보존. Jira 권한 줄과 프로젝트 역할 3개, Salesforce 사용자 역할 1개는 역할 슬롯이 있는 has_role_on. Salesforce 역할 계층은 ParentRoleId 근거의 contained_in |
| Profile 33 | Slack trigger는 Endpoint, Google ASP는 Credential. GitHub 조직 owner는 대상별로 나눈다. contained_in 3개 인정. 매핑 18개 선언, 관계 아님 3개, ASP parent는 authenticates_with에 합침 |
| aegi-schema 제안 | {', '.join(s['schema_proposals'])}. Slack 워크플로 → 앱 owned_by(기존 템플릿 안), Okta 그룹 소유자 owned_by Principal → Principal 추가 |

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
"""
    write(ROOT/"오브젝트 모델 v1 4단계 relation 적용.md",stage4)
    stage5=f"""# 오브젝트 모델 v1 5단계: 검토 스냅샷과 검증

타입 수준 결과를 다시 만들 수 있는 검토 스냅샷을 생성하고 {v['tests']}개 회귀 검사를 통과했다. 기존 계획에서 5단계의 정확한 정의를 확인하지 못했으므로 이 문서는 검증 결과이며 기존 단계의 최종 완료 선언은 아니다.

작성일: 2026-10-19. 상태: v1 고정(사용자 결정 2026-10-19, PR #117). 이후 변경은 v2로 따로 진행한다. 실제 Relation 행의 관측은 실측 수집에서 쌓는다.

## 현재 단계

{stage_table}
## 검증 결과

| 검사 | 결과 |
| --- | --- |
| Python 회귀 검사 | {v['tests']}개 통과, 건너뜀 없음 |
| IR 검증 | SaaS 8개 통과 |
| 2단계 재생성 | 해시 시드 1, 2에서 {stage2['determinism']['files']}개 파일 일치 |
| 3~4단계 재생성 | 해시 시드 1, 2에서 {v['determinism']['files']}개 파일 일치 |
| Q1~Q3 | 기존 사람 결정 유지 |
| 타입 식별자와 참조 | 중복 없음, 존재하지 않는 타입 참조 0건 |
| 조건부 필드 | 각 대상과 같은 레코드의 조건만 유지 |
| 인터페이스와 관계 어휘 | 9종, 17종 이외의 확정 타입 없음 |
| 오프라인 재검증 | 추가 모델 요청 0건, 캐시 불변 |
| 신규 실측 인스턴스 | 0개 |

계약 필드가 필요한 타입에는 `requires_projected_row`를 남긴다. 타입 이름이나 원본의 필드만으로 만료일, 기한 없음, 권한, 실행 신원을 지어내지 않는다. Profile 문서도 고정한 세 파일에서 읽고 SHA-256이 달라지면 실패한다.

## 열려 있는 결정

{review_table}
미정 {s['undecided_interfaces']}개를 없애려면 현재 공개 명세의 지속 식별자, 테넌트 범위와 각 인터페이스 판별 기준을 원문으로 더 확인해야 한다. 끝점 7개, 배정 18개, Profile 33개, Cartography 매핑 92개는 사용자 결정을 마쳤다. 이 항목들은 자동 작업 실패나 응답 대기와 별개이며, 기존 판정을 보존한 검토 대장으로 전달한다.

## 전달 파일

{artifacts}
검토의 시작점은 [전체 진행 현황](오브젝트%20모델%20v1%20진행%20현황.md)이다. `verify_stage2.py`, `verify_model_v1.py`, `report_model_v1.py` 순으로 실행한다. 실제 테넌트 자료 수집, 운영 그래프 변경과 배포는 이 스냅샷에 포함되지 않는다.
"""
    write(ROOT/"오브젝트 모델 v1 5단계 검증.md",stage5)
    stage2_note=f"""## 13. 전수 재생성과 원문 보정 (2026-10-19)

8개 SaaS의 중복 결과까지 모두 현재 공개 요청 형식과 맞춰 다시 만들었다. GitHub 10개, Jira 1개, Slack 14개와 Salesforce 53개 중복 요청을 추가 채점했으며 응답 대기는 없다. Google의 이메일과 OAuth clientId는 외부 locator로 보존한다. source_same과 source_distinct는 모델보다 먼저 적용하고 Q1~Q3 사람 결정이 최우선이다.

원문으로 고친 항목은 GitHub 조직 초대와 User의 분리, 팀의 username과 repo 대상, Google DeviceUser와 Meet Member의 자기 키, Delegate 이메일 대상과 외부 forwarding 이메일, OAuth client locator, Jira issue type 대상, Atlassian accountId 자기 키다. Slack의 같은 usergroups.list 응답을 두 명세가 각각 usergroup와 objs_subteam으로 부른 부분도 원문 같음 근거로 묶었다. 이전 모델 응답은 남겨 둔다.

직접 공간 쌍은 86개이며 나머지 42개의 D 18, E 24 분류와 생성 계약도 유지한다. 해시 시드 1, 2에서 지도, 모든 중복과 대조 {stage2['determinism']['files']}개 파일이 일치했고 8개 IR 검증을 통과했다. 전체 연구 회귀 검사는 {v['tests']}개이며 [현재 단계](오브젝트%20모델%20v1%20진행%20현황.md)와 [4단계 적용](오브젝트%20모델%20v1%204단계%20relation%20적용.md)에 이어진다.
"""
    section(ROOT/"오브젝트 모델 v1 2단계 relation 조사.md","model-v1-followup",stage2_note)
    for relative in ("README.md","context.md","docs/project.md"):
        path=ROOT/relative
        text=path.read_text(encoding="utf-8")
        prefix="../" if relative.startswith("docs/") else ""
        summary=f"> **오브젝트 모델 조사 갱신 (2026-10-19):** 8개 SaaS {s['candidate_spaces']:,}개 후보의 채점을 완료했다. Object 후보 {s['candidate_verdicts']['object']:,}개, 제외 {s['candidate_verdicts']['not_object']:,}개, 인터페이스 미정 {s['undecided_interfaces']}개이며 응답 대기는 없다. 같은 대상과 자격증명 종류를 묶은 타입 후보 {s['canonical_object_type_candidates']:,}개와 참조 {s['typed_references']:,}개의 검토 초안을 생성했다. 회귀 검사 {v['tests']}개, IR 8개와 두 시드의 파일 {verified_files}개 일치를 확인했다. 2026-10-19 v1으로 고정했다. [단계와 검토 대장]({prefix}오브젝트%20모델%20v1%20진행%20현황.md)."
        # Replace the earlier summary wherever it sits; other updates may have
        # been prepended above it since the last report.
        blocks=[b for b in text.split("\n\n") if not (b.startswith("> **연구용 relation 잔여 조사") or b.startswith("> **오브젝트 모델 조사 갱신"))]
        text=summary+"\n\n"+"\n\n".join(blocks)
        write(path,text)
    section(HERE/"README.md","model-v1-run",f"""## 현재 모델 연구 (2026-10-19)

8개 SaaS {s['candidate_spaces']:,}개 후보의 채점을 완료했고 응답 대기는 0건이다. 검토 대장은 사용자 결정으로 해소했고 2026-10-19 v1으로 고정했다(보류 {s['undecided_interfaces']}개). 현재 기록은 저장소 루트의 `오브젝트 모델 v1 진행 현황.md`를 따른다. 아래의 기존 수치는 각 실행 시점의 기록이다.

```bash
python verify_stage2.py
python verify_model_v1.py
python report_model_v1.py
```

세 명령은 추가 모델 요청 없이 캐시와 고정 소스로만 결과를 재생성한다. 회귀 검사 {v['tests']}개, IR 8개, 두 해시 시드의 파일 {verified_files}개 일치 결과와 모든 산출물 해시는 `out2/v1/verification.json`, `manifest.json`에 남긴다. 출력 `out2`는 로컬 연구 산출물이므로 소스, 고정 입력과 유효 응답 캐시도 함께 보존해야 재현할 수 있다.
""")
    write(OUT/"v1/README.md","# 타입 수준 검토 스냅샷\n\nv1 고정본(2026-10-19)이다. 상태와 한계는 저장소 루트의 `오브젝트 모델 v1 진행 현황.md`를 따른다. `summary.json`이 수치를, `review_queue.json`이 미결 항목을, `verification.json`과 `manifest.json`이 검사와 해시를 기록한다.")
    print("Updated current stage-2/3 records, stage-4/5 drafts, status report and project summaries.")


if __name__=="__main__":
    main()
