# Profile binding 기반 정규화

## GitHub webhook의 Apps Script 수신 대상

GH-15는 공식 HTTPS Apps Script 웹앱 주소에서 배포 ID를 추출한 뒤 URL을 host/sha256로 축약한다. 원본 URL과 query는 출력에 보존하지 않는다. Group/Profile 규칙과 별개로 GitHub Webhook Profile은 `url_host`, `target_deployment_id`를 전달하고, Knowledge의 `request_target` 선언을 읽는 공통 crosswalk가 GWS Project 배포 목록과 비교한다.

생성 방향은 수신 자동화(Project) → 요청을 보내는 webhook(Endpoint)의 `triggered_by`다. 활성 webhook이며 정확한 호스트와 배포 ID가 일치하는 경우만 연결한다. 같은 ID가 여러 Project를 가리키면 이 선언의 `unique_match`에 따라 보류한다. 기존 Slack 요청 주소 규칙과 다른 다대다 규칙의 동작은 유지한다.

이 변경 전에 수집된 webhook에는 배포 ID가 없을 수 있다. SHA-256만으로 ID를 복원하지 않으며, 새 수집 또는 별도 검증된 읽기 근거가 필요하다. 운영 스냅샷은 코드 변경만으로 갱신되지 않는다.

회귀: `node --test scripts/collect/profile-binding/runner/webhook-receiver.test.mjs`. 공식 주소/위장 주소, 비활성, 미수집, 다중 후보, 중복 페이지, 실제 Profile 정규화와 방향을 검사한다.

**full-catalog Profile 1,977개와 수집 원본을 처리하는 Profile 기반 정규화 실행기다.** `profiles/`는 객체 Profile과 API binding, `overlays/`는 기존 판정 규칙을 새 Profile 형식으로 옮긴 보정이다. raw 수집물과 정규화 출력은 로컬에서만 사용하며 Git에 넣지 않는다.

검증한 코호트에서는 객체 744개, 관계 677개, Link 9개, 관측 306개, 증거 연결 47개가 생성됐다. 식별자 실패와 미지원 규칙은 없었다. 남은 참조 20건과 관계 3건은 연결 대상 원본 행이 없어 미해결 사유와 함께 남겼다.

**2026-10-26 실측 범위 수정 완료:** 기본 출력은 객체 744개·관계 677개·Link 9개·관측 306개·증거 연결 47개다. 식별자 실패는 0건이며, 출력 검사 22개와 원본 대조 검사 20개를 통과했다. 이 수치는 이관 당시 기록이며 원본 대조 보고서는 이 저장소에 포함되지 않았다. 모든 타입의 데이터가 수집됐다는 뜻은 아니다.

정규화의 유일한 실행 명령은 `npm run normalize`다. 수집 폴더·완료된 run·출력 폴더를 명시한다. 모델의 기본 위치는 sibling `aegi-knowledge/schema/im-model/model/v3.2`이며 `--model` 또는 `IM_MODEL_DIR`로 바꾼다. SaaS API를 호출하지 않는다.

```bash
npm run normalize -- --raw collected --run <수집-run-ID> --out src/data/aegi_inc_measured_profiles
npm run normalize -- --raw collected --run <수집-run-ID> --out src/data/aegi_inc_measured_profiles --check
node scripts/collect/profile-binding/runner/verify-output.mjs --dataset src/data/aegi_inc_measured_profiles
```

`--run`은 출력 별칭이 아니라 실제 수집 run ID다. `--check`는 모든 추출·산출물 검증을 실행하되 파일을 쓰지 않는다. 출력은 입력 폴더와 분리해야 하며, 기존 폴더는 IM 실행기가 만든 데이터셋일 때만 재사용한다. 이전 손코드 데이터셋에는 새 출력 폴더를 사용한다.

[단일 경로와 산출물 계약](../../../docs/IM_PROFILE_PIPELINE.md)에 제거한 진입점, 공통 모듈, 검증 범위를 정리했다. 앞의 744개 객체 등은 과거 코호트 결과이며 새 실행의 결과를 보장하지 않는다.

## 방법

1. 타입의 원문 shape(Profile `binding.paths` + 연구 레코드 `source_shapes_bundle`)에서 IR shape 그래프를 거꾸로 올라가 읽기 응답 root를 찾는다. 읽기 판정은 V3 bridge와 같다(REST GET, GraphQL read, RPC는 write scope 없음).
2. 대표 API(이 타입을 원래 읽는 API)를 고른다: 활성 > 범용 진입점(GraphQL node·search·relay 등) 아님 > 직접 조회(응답 root 또는 root 배열 원소, 다른 객체 안에 박힌 사본 아님) > 수집되고 레코드 있음 > 수집됨 > REST(GraphQL은 조직·엔터프라이즈·저장소 진입점 순) > 목록 조회 > 응답 안 경로가 짧음 > 경로 변수 적음 > 원문 순위. 후보는 (operation, shape) 쌍이라, 여러 shape를 묶은 타입은 대표와 다른 shape의 수집된 직접 조회를 `sources`에 둔다.
3. endpoint는 원문 `raw_path`로 만든다. 읽기는 GET과 본문 조회용 POST(`/read`, `/list`, `/search` 등)다. 수집된 API면 기준 모델(기본 V3.2)의 실측 연결(`evidence/observation-operation-links.jsonl`)의 수집 호출 ID를 `call`에 넣고, 수집됐지만 박힌 사본인 출처는 `observed_sources`에 둔다. 타입 판정(non_object, 인터페이스)은 기준 모델 `objects/object-types.jsonl`을 따른다.
4. 시범 6개는 손으로 넣은 binding을 그대로 두고 `operation_id`만 더한다.

## 상태값

| status | 뜻 |
| --- | --- |
| `pilot_manual` | 시범 6개. 손으로 만든 binding |
| `collected_with_records` | 고른 API가 2026-10-23 코호트에서 수집됐고 레코드가 있다. `call`이 있다 |
| `collected_empty` | 고른 API는 수집됐지만 레코드가 0건이다 |
| `path_parameter` | 응답 본문이 아니라 URL 경로 변수로만 나오는 ID(`parent:orgs/{}/…`). `id_from`에 경로 변수 |
| `non_object` | V3.1 판정 non_object. binding을 채우지 않는다 |
| `embedded_only_collected` | 대표 직접 조회는 미수집이고, 다른 객체 안에 박힌 사본만 수집됐다(`observed_sources`, `partial: true`) |
| `documented_not_collected` | 문서상 읽기 API는 있으나 수집하지 않았다. `call: null` |
| `write_response_only` | 이 shape는 생성·수정 응답에만 나온다 |
| `no_source_shape` | 원문 shape가 없고 경로 공간도 아니다 |
| `no_read_operation` | IR 읽기 응답에서 닿는 경로가 없다 |

`selection: tie_needs_review`는 순서 기준이 모두 같은 2순위가 있어 이름순으로 고른 것이다. 대안은 `alternatives`(최대 25개)에 있다.

## 한계

- 타입 ID는 full-catalog와 V3.1이 같다. V3.1에만 있는 공간(`confluence:SpacePermission` 등)은 Profile이 없어 채우지 않았다. V3.1의 관계·동일성 결정은 binding 범위 밖이다.
- 레코드 수는 고른 API 응답의 레코드 수다. 박힌 경로의 이 타입 원소 수는 세지 않았다.
- 문서 기준 선택은 실측으로 확인하지 않았다. GraphQL 진입점은 인자(조직 login 등)가 필요하다.

## 실행기 (runner/)

**binding이 채워진 Profile로 수집 원본에서 객체와 관계를 직접 만든다.** 손코드 정규화기(engine normalize-v2)를 쓰지 않는다. 출력은 Loader 데이터셋 형식이며 기본 그래프 외에 effective_access, coverage, lineage_events를 함께 만든다.

```bash
npm run normalize -- --raw collected --run <수집-run-ID> --out src/data/aegi_inc_measured_profiles
node scripts/collect/profile-binding/runner/verify-output.mjs --dataset src/data/aegi_inc_measured_profiles
```

- **입력:** `profiles/`(생성 Profile), `overlays/<provider>/<같은 파일명>.yaml`(보정: 깊은 병합, 배열은 통째 교체, `null`은 키 삭제), `overlays/<provider>/new-*.yaml`(새 Profile), `runtime-config.json`(순서·색인·타입 대응). 기준 모델은 `--model` 또는 `IM_MODEL_DIR`, 보정 폴더는 `--overlays`로 지정한다.
- **객체:** 페이지의 operation(과 alternates)에 binding된 Profile마다 binding 경로로 레코드를 꺼낸다. 대표·`sources`·`observed_sources`(partial) 순으로 합친다. 식별자는 `identity.primary` 전부로 만든다(복합 키). `$req.<이름>`은 수집기 요청 값, `$path.<이름>`은 URL 경로 변수(IR 이름), `$req.parent_id`는 부모 경로 변수, `$record_hash`는 레코드 해시다.
- **속성:** 선언 필드만 넣는다. 선언 밖 최상위 키는 이름만 격리 목록에 둔다. `privacy`(비밀 잎 이름, 비밀 경로, write-only 경로, 객체 규칙, 토큰 모양)를 재귀로 지운다. `row_contracts`의 상수는 `judged`로, `constants`는 `fixture_meta.im_profile.profile_constants`로 나눈다.
- **참조:** 같은 provider의 대상 Profile(단일 primary)로 키를 만들어 있으면 연결하고, 없거나 여러 개면 `native` 값과 사유(`unresolved`, `ambiguous`)를 남긴다. 보정 `emit.merge_into`로 합친 타입을 가리키는 참조는 대표 타입 객체에서 찾는다.
- **검토된 추출 규칙:** 변환기는 기존 카탈로그의 객체·관계·보충 규칙을 새 Profile의 `runtime_rules`로 보존한다. 규칙마다 identity·vars·where·require·sources를 따로 쓰므로 Drive 파일/드라이브 권한처럼 한 타입에 여러 API가 있는 경우에도 식별자가 섞이지 않는다. `group_by`, `create`, on-demand 객체, 참조 키, 보충 필드, 색인과 실행 순서를 지원한다. 원본을 읽는 실행 시에는 새 Profile과 복사된 설정을 사용하며 기존 SaaS 정규화 함수를 호출하지 않는다.
- **관계:** 일반 Profile의 `relation_plans`와 검토된 `runtime_rules`의 관계 선언을 실행한다. 식은 공통 `expr.ts`를 사용한다. parent 참조를 보존하는 것만으로 새 관계를 만들지는 않는다. V3.2에 포함된 R1-D01에 따라 Drive owner 권한은 기존 소유 관계의 `via_assignment` 근거로 남긴다.
- **Link·관측·증거:** 객체 생성 후 기존 공통 ontology·증거 처리기를 재사용한다. Profile 타입명과 키를 공통 처리기에 대응시킨 뒤 출력 키로 돌려놓는다. 대시보드 그래프·증거 로더와 Effective Access 계산으로 소비 가능 여부를 검사한다.
- **객체를 만들지 않는 Profile:** 보정에 `emit: reference_only`를 두면 레코드를 읽고 식별자까지 확인하지만 객체는 만들지 않는다(실행 보고서 `per_profile[].reference_only`에 센다). 이름이 API 경로 조각(`parent:user/{}` 등)이거나 속성이 하나도 남지 않는 타입에 쓴다. 이유는 같은 보정의 `emit_basis`에 적는다.
- **검증:** `verify-output.mjs`는 형식·타입이 맞는 참조·Link/증거 끝점·개인 토큰 패턴과 모델 버전을 검사한다. 이름에 `parent:`와 `{}`가 함께 있는 타입(`no_api_path_object_types`), 스텁을 뺀 객체가 모두 속성이 빈 타입(`no_property_less_types`)도 실패로 본다. `verify-collected.mjs`는 선택한 raw run에서 권한 쌍·협업자·묶음·누락 대상을 독립적으로 대조하고 그래프·증거 로더와 Effective Access 계산도 확인한다.
