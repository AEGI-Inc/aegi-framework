# ir2: 수집과 정규화 (IR 설계.md 구현)

`IR 설계.md` 3절의 개체 11종(source, operation, shape, key_decl, id_format, ref_decl, binding, catalog, grant, instance, hole)으로 8개 provider 자료를 옮긴다. 옛 파이프라인(`../normalize_*.py`, `../out/`)은 그대로 두고 건드리지 않는다.

## Microsoft 365 정보 지도 (2026-11-20)

M365(Microsoft Graph v1.0)를 8개 SaaS와 같이 문서, IR, 정보 지도, ID 공간 순서로 더했다. 고정 모델 V3.2 는 고치지 않았다. Cartography Microsoft 모델은 그대로 두고 대조 기준으로만 쓴다.

```bash
python run_m365.py --twice        # 등록부 -> norm_m365 -> validate m365, 두 번 돌려 결정론 확인
python map3.py m365               # 정보 지도 (python -I 로 돌리면 같은 폴더 모듈을 못 찾는다)
python dup_audit.py m365          # 같은 실체 (--send 없이: 캐시, 규칙, 사람 결정만)
python carto_audit.py m365        # Cartography 노드 대조 -> out2/carto_audit_m365.json
python -m unittest test_norm_m365 test_map3_navigation
```

- 출처(`collect/catalog.yaml` 의 `m365_*`): Graph v1.0 OpenAPI 와 CSDL, Graph 문서의 권한 표, Management Activity 스키마, Copilot 감사 스키마, Purview 감사 활동, Entra 감사 활동. 원문 스냅샷은 저장소 밖 로컬 폴더(`m365-docs/snapshot_2026-11-20`, 출처별 커밋은 그 폴더 manifest)에 있다.
- 범위(`lexicons/m365.yaml`): 신원과 접근, 메일, OneDrive, SharePoint, Teams, 기기, 보안. OneNote, Planner, Forms, Loop, Lists 는 사용자 결정(11-20)으로 뺐다. `/me` 는 `/users/{id}` 별칭이라 뺐다.
- `norm_m365.py`: 키는 CSDL `Key`(BaseType 사슬)와 `AlternateKeys`, EntitySet/Singleton 이면 global. 싱글턴에서 단일 포함 탐색만 거쳐 컬렉션 하나로 끝나는 타입은 global(transform). 바인딩은 `x-ms-docs-key-type`, 권한은 문서 권한 표, 감사는 카탈로그. 테넌트 실측(4순위) 폴더가 있으면 `tenant_log.ingest` 로 넣는다.
- 결과(실측 포함): 동작 12,422, 모양 31,653, 키 1,236. 정보 지도 공간 995, 객체 후보 722, 실측 ID 값 참조 51. Cartography Microsoft 노드 17개 중 14개가 공간에 닿고, 2개(IntuneDetectedApp, M365ServicePlan)는 파생, 1개(DefenderMachine)는 Graph 가 아닌 Defender API 다.

공용 코드 변경(다른 provider 출력은 바뀌지 않는다. 그 근거는 각 항목):

- `openapi2.py`: Graph 확장 이름을 ext 에 남긴다. `x-ms-navigationProperty` 가 있는 속성에 `navigation: true`(ir_schema `PROP_KEYS` 에 추가). 인라인 모양 id 가 이름 있는 스키마 id 와 겹칠 때만 `#inline` 을 붙인다. 셋 다 Graph 확장이나 겹침이 없으면 동작이 같다.
- `map3.py`: (1) `navigation` 속성은 펼치지 않고 대상 공간 참조로 센다. Graph 응답은 `$expand` 없이는 이 속성을 주지 않는다. 펼치면 동작마다 엔티티 그래프 전체를 돌아 80분 넘게 끝나지 않았다. (2) 판별자 하위 모양 간선은 기반 모양이 「어떤 동작이 돌려주는 모양에서 판별자 하위로 닫은 집합」에 있을 때만 만든다. Graph `entity` 같은 공통 뿌리가 위치 없는 타입 70개를 한 공간으로 묶었다. (3) 0 과 하이픈만으로 된 값(빈 GUID)은 식별 값이 아니다. (4) mapping 단계의 `props_of` 결과를 캐시한다(결과 같음, 시험).
- `carto_audit.py`: provider 인자(`python carto_audit.py m365`, 없으면 전부)와 Microsoft 노드 17개. `build_registry.py`: 파일이 없는 출처는 `missing: true` 로 남기고 멈추지 않는다. `validate.py`: provider 목록에 m365.

사람 결정(`same_entity_decisions.json` m365, 2026-11-20): directoryRole 과 unifiedRoleDefinition 은 같은 실체(roleTemplateId = 역할 정의 id, 실측 3/3). application 과 servicePrincipal 은 다른 실체로 두고 appId 로 잇는 관계는 객체 단계에서 다룬다. subscribedSku.skuId 처럼 키가 아닌 고유 속성을 가리키는 참조(licenseDetails.skuId)는 정보 지도 규칙으로 잡히지 않아 객체 단계로 넘긴다.

객체 단계(2026-11-20, 사용자 지시로 Jev 채점 진행):

```bash
python dup_audit.py m365 --send          # 같은 실체 227쌍 (공개 명세의 이름·경로·필드 이름만 보낸다)
python iface_judge.py jev m365 --send    # 인터페이스 722 공간
python iface_judge.py judge m365         # out2/iface_calibration.json, out2/object_audit.json 은 이전 기준값·정답표
python model_v1.py build m365            # out2/m365/objects/ (out2/v1 은 건드리지 않음)
```

- 같은 실체: 같음 15, 다름 44, 하위 유형과 변형 181. applicationTemplate(id 가 1st-party 앱 appId 와 같음)과 servicePrincipal 은 application 과 같은 기준으로 다른 실체로 기록했다.
- 인터페이스: object 474, not_object 118, undecided 130. 객체 타입 468(검토 필요 1), 참조 3,085, 포함 803. Jev 판정과 V3.2 선례가 갈린 6개는 선례로 정했다(`v2/research_overrides_v2.json` M365-I1~I6: namedLocation=Policy, device, managedDevice, administrativeUnit=Resource, domain=Tenant, subscription=Endpoint). 다시 볼 대상이다.
- 공용 변경: `iface_judge.py judge <p>` 는 그 provider 에 적용되는 원문 사실만 해시 검사한다(관계된 원문이 바뀌면 지금처럼 멈춘다). `model_v1.py build <p>` 는 provider 하나만 돌고 없는 이전 산출물은 `skipped_inputs` 에 적는다(인자 없으면 동작 같음). v2 인터페이스 결정이 원래 undecided 인 후보에 걸리면 review_id 없이 적용된다(전에는 KeyError, 8개 SaaS 실행은 V2-T1 이 undecided 가 아니라 이 경로를 타지 않았다).
- `test_model_v1.py` 의 기존 시험 7개는 이 저장소에 없는 `out2/v1`, 다른 SaaS 원문 전사가 필요해 main 에서도 실패한다(이번 변경 전과 같음).

남은 일: 같은 실체 미정은 Jev 판정 뒤에도 남은 묶음 검토, `"default"` 값이 profilePhoto id 와 겹친 오탐 2건(원문이 enum 으로 선언하지 않은 문자열), Graph beta, Exchange Online PowerShell 전용 정보(메일함 위임, 전달 규칙). 테넌트 실측 수집기는 SaaS API 를 부르는 코드라 이 저장소에 넣지 않았다.

> **잔여 relation 조사 갱신 (2026-10-19):** 직접 쌍 오판 2개를 고쳐 86개로 정정했다. 남은 42개는 D 18, E 24의 생성 규칙과 수집 계약으로 정리했다. 로컬 연산 또는 파서 13개 관계, 수집 계약 29개 관계이며 실제 테넌트 수집은 하지 않았다. Okta 미정 3개와 기존 공간 없음 1개도 원문으로 정리했다. 아래의 이전 실행 기록 수치는 해당 시점의 결과다.

<!-- model-v1-run:begin -->
## 현재 모델 연구 (2026-10-19)

8개 SaaS 2,993개 후보의 채점을 완료했고 응답 대기는 0건이다. 검토 대장은 사용자 결정으로 해소했고 2026-10-19 v1으로 고정했다(보류 1개). 현재 기록은 저장소 루트의 `오브젝트 모델 v1 진행 현황.md`를 따른다. 아래의 기존 수치는 각 실행 시점의 기록이다.

```bash
python verify_stage2.py
python verify_model_v1.py
python report_model_v1.py
```

세 명령은 추가 모델 요청 없이 캐시와 고정 소스로만 결과를 재생성한다. 회귀 검사 71개, IR 8개, 두 해시 시드의 파일 64개 일치 결과와 모든 산출물 해시는 `out2/v1/verification.json`, `manifest.json`에 남긴다. 출력 `out2`는 로컬 연구 산출물이므로 소스, 고정 입력과 유효 응답 캐시도 함께 보존해야 재현할 수 있다.
<!-- model-v1-run:end -->

## 실행

```bash
pip install pyyaml openpyxl pypdf requests
python collect/fetch.py            # 새 주소 받기 (targets.yaml, 사다리 9절). 이미 받은 것은 건너뛴다
python collect/inbox.py            # 사람이 inbox/<provider>/ 에 넣은 파일 등록 (4단)
python run_all.py                  # 등록부 -> 정규화 8개 -> 검증 -> 옛 IR 대조
python run_all.py --twice          # 두 번 돌려 out2 파일 sha256 비교 (out2/determinism.json)
```

provider 하나만: `python norm_github.py`, `python validate.py github`, `python compare_v2.py github`.

## 파일

### 2단계 relation 조사 (최신 2026-10-19)

```bash
python map3.py github okta slack gws salesforce jira confluence atlassian
python dup_audit.py github okta slack gws jira confluence  # 로컬 캐시와 사람 결정만 사용
python rel_audit.py
python rel_audit.py profiles
python -W ignore::ResourceWarning -m unittest discover -s . -p test_map3.py -v
```

`same_entity_decisions.json`의 Q1~Q3은 자동 판정보다 먼저 적용한다. Cartography 공간 쌍 대조는 88개이며 관계 방향과 모든 include/exclude 의미의 검증은 별도 범위다. 원인 B는 직접 공간 쌍 12개와 D로 정정한 1개, 원인 C는 범위로 정한 5개를 반영했다. 결과는 저장소 루트의 `오브젝트 모델 v1 2단계 relation 조사.md` 11절을 따른다.

`source_reference_facts.json`은 원문이 명시한 참조 14개, 다름 근거 1개와 파생 관계 근거를 출처와 해시에 고정한다. 원문 단락의 전사이며 설명 전체를 자동 해석하지 않는다. 원문 참조는 값과 모델 판정보다 우선한다. 스냅샷, 필드와 대상이 달라지면 실패한다. 조건부 참조는 정보 항목의 `cases`에 남기고, `Map3.reference_values(shape, path, record)`가 판별값과 같은 배열 원소를 확인해 실제 대상을 고른다.

`jev_judge.py reffields <provider> --shapes <모양 이름...> --targets <공간 이름...>`은 지정한 모양만 재판정하고 완료한 다른 판정은 보존한다. `--send`가 없으면 캐시만 읽는다. 요청은 공개 필드와 grade example 값만 쓰며, 두 단계 모두 0.7 이상인 결과만 model 참조로 적용한다. 중복 후보용 `dup_audit.py --send`는 별도 데이터 범위 검토가 필요하다.

중복 판정 본문은 경로 템플릿, 스키마명, 필드명과 질문만 포함한다. `duplicate_state`는 공유 문자열을 양쪽 스키마 필드 이름과 대조해 예시 값과 자격증명 원문을 제외한다. 사용자 승인 후 Okta 52건 전송과 응답 캐시를 완료했다. 요청 본문은 `out2/okta/map/dup_send_payloads.json`, 전송 기록은 `dup_send_review.json`을 따른다. Okta 묶음은 19개이며 미정 3개와 기존 공간 없음 1개를 구분한다. `Permission.permissionType`의 역할 병합 오판은 원문 다름 근거로 고쳤고 이전 모델 응답은 보존한다.

회귀 검사 20개는 `out2`의 정규화와 대조 결과가 있어야 한다. 검사 결과, 8개 IR 검증과 두 해시 시드의 지도 및 대조 파일 28개 일치 결과는 `out2/stage2_verification.json`에 남겼다.

| 파일 | 하는 일 |
| --- | --- |
| `ir_schema.py` | 개체 11종과 공통 머리(id, src, grade, life, ext)의 필드, 허용 값, 행 검사 |
| `core.py` | 경로(HERE, NEMO), 출처 등록부 읽기, 개체 모음 `IR`, 경로 위치 계산, REST 동작 종류 규칙, 정렬 쓰기 |
| `openapi2.py` | OpenAPI 3.0, 3.1, Swagger 2.0 변환. union 보존, allOf 합치기(ext.allOf), 예시 instance, links 바인딩 |
| `sdl2.py` | GraphQL SDL 토큰 파서. 지시어(@deprecated)까지 읽는다 |
| `example_shape.py` | 예시와 실측 값에서 모양 만들기 (origin example_derived) |
| `pdftext.py` | PDF 읽기 (pypdf). 쪽 글자를 `cache/` 에 PDF 해시별로 저장 |
| (지움) `curated.py` | 2026-10-15 사전 판단을 빼며 지웠다 (IR 설계.md 11절) |
| `norm_github.py` `norm_okta.py` `norm_slack.py` `norm_salesforce.py` `norm_gws.py` `norm_atlassian.py` | provider 변환기. 맨 위 설명에 자료와 규칙 |
| `validate.py` | 4.2절 게이트. 출력 `out2/<p>/validation.json`, `out2/<p>/issues.jsonl` (8절 형식) |
| `compare_v2.py` | 옛 IR 대조. 출력 `out2/<p>/compare_v2.json`, `out2/compare_v2.md` |
| `run_all.py` | 전체 실행, 결정론 확인 |
| `collect/catalog.yaml` | 출처 정의 (id, kind, rank, naming, 파일) |
| `collect/build_registry.py` | 받은 목록(manifest.jsonl)과 정의를 합쳐 `collect/registry.json` |
| `collect/targets.yaml` `collect/fetch.py` | 새로 받을 주소와 수집 사다리 (0 기계용 원본, 1 HTTP, 2 헤드리스, 3 실제 브라우저, 4 사람) |
| `collect/browser.py` | 브라우저 어댑터 `fetch(url) -> {status, final_url, body, network_json[], method}` |
| `collect/inbox.py` | 4단: 사람이 받은 파일 등록 (sha256) |
| `collect/snapshots/snapshot_2026-10-15/` | 이번에 받은 파일과 manifest (fetch_method, ladder 기록) |

출력: `out2/<provider>/ir/<종류>.jsonl` 11개, `ir/manifest.json`(수, id 충돌, removed 로 뺀 것), `normalize_issues.jsonl`(변환기가 남긴 문제), `validation.json`, `issues.jsonl`, `compare_v2.json`.

## 지킨 것

- 이름은 원문 그대로 둔다. 옛 IR 의 인자 이름 바꾸기(param_rename)는 하지 않는다.
- description 은 읽지 않는다. 예외는 GraphQL `@deprecated(reason)` 안의 「Removal on 날짜」 하나다(1절 수명 근거).
- 원문이 말하지 않은 것은 grade transform 이고 근거 규칙을 locator 나 ext.kind_rule 에 쓴다 (REST 동작 종류, Salesforce sObject 동작).
- 사전 판단(이름 규약 키, 접두사 표, 동사 표, 래퍼 이름 표)은 쓰지 않는다. 사전 파일에서 읽는 것은 자료 위치와 경로 접두사 벗기기 같은 변환 설정뿐이다.
- 같은 사실을 출처 둘이 말하면 둘 다 남긴다 (Slack 구판 OpenAPI 와 문서, GitHub 감사 목록 두 판). 검증기가 높은 순위 출처의 판이 오래된 것을 보고한다.
- 출력은 id 순, 키 정렬. 두 번 돌려 바이트가 같다.

## 브라우저 단 (2, 3단) 설치

Playwright 는 설치하지 않았다. 필요할 때:

```bash
pip install playwright
python -m playwright install chromium
```

3단(사람이 쓰는 Chrome): 사람이 `chrome --remote-debugging-port=9222 --user-data-dir=<별도 폴더>` 로 띄우고 `AEGI_CDP_ENDPOINT=http://127.0.0.1:9222` 를 준다. 에이전틱 브라우저는 `AEGI_AGENT_BROWSER_CMD` 에 `{url}` 을 받아 JSON 을 내는 명령을 준다. `python collect/browser.py` 가 쓸 수 있는 어댑터를 보인다. CAPTCHA 풀기, 지문 위장, 프록시 돌리기는 하지 않는다.

## 알아 둘 것

- PyMuPDF(fitz)가 이 PC 에서 Windows 보안에 막혀 Salesforce PDF 는 pypdf 로 읽는다. 첫 실행은 쪽 글자 추출에 몇 분 걸리고, 이후는 `cache/` 를 쓴다 (`cache/` 는 다시 만들 수 있는 파생물이다).
- `collect/registry.json` 의 출처 id 를 변환기가 쓴다. 자료를 더하면 `catalog.yaml` 에 적고 `build_registry.py` 를 돌린다.

## 잔여 관계 생성 규칙과 로컬 연산

- `relation_contracts.py`: 정확한 Cartography 클래스와 변환 함수에서 전사한 42개 계약. 원문 해시, 방향, 입력, 보류 조건과 호환 간선을 검증한다. `out2/relation_resolution.json`, `out2/relation_resolution.md` 생성.
- `relation_ops.py`: 스냅샷 안 유일 조인, 그룹 상속, 일부 API 투영, 워크플로 참조 파서와 OCI 구조 연산. 운영 수집기가 아니며 계약마다 구현 범위를 표시한다.
- `test_relation_contracts.py`: 계약의 출처 무결성과 파생 연산의 실패 조건 검사. 기존 `test_map3.py`와 합계 39개.
- `verify_stage2.py`: 기존 IR와 모델 캐시로 두 해시 시드에서 30개 파일 재생성, 8개 IR 검증과 Q1~Q3 검사. `--send`를 쓰지 않는다.

```bash
python verify_stage2.py
```

직접 대조 86개는 공간 쌍 존재 확인이다. 남은 42개 계약의 `source_backed`는 실측 관계 확인을 의미하지 않는다. 13개는 로컬 연산이나 참조 파서, 29개는 수집 계약이며 입력 38종은 `not_collected`다. API 노드와 파생 값 노드, OCI/AWS 외부 키를 같은 ID 공간으로 합치지 않는다. 상세 범위는 루트 2단계 relation 조사 문서 12절을 따른다.
