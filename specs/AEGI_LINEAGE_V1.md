# AEGI 기능 C 데이터 계보 v1 (1단계)

> 2026-10-20 | 코드 `src/lineage/`, `scripts/lineage/`
> **상태:** 설계안 「기능 C 데이터 계보 설계안(OpenLineage 기반)」의 1단계를 구현했다. 엔진의 F(데이터 흐름) 간선과 관찰로 OpenLineage 이벤트를 만들고 공식 JSON Schema 로 검사한다. 화면은 아직 없다.

## 1. 범위

기능 C 는 데이터가 어디서 와서 어떻게 바뀌어 어디까지 갔는지라는 **사실만** 만든다. 그 이동이 허용됐는지, 얼마나 민감한지는 기능 D 가 정한다.

- 저장 형식은 OpenLineage 2-0-2(RunEvent, JobEvent)이고, 관계의 뜻은 W3C PROV-O 용어(used, wasGeneratedBy, wasDerivedFrom)를 따른다.
- AEGI 온톨로지에 새 관계를 넣지 않는다. Dataset 의 `symlinks` facet 에 AEGI 객체 키를 적어 권한 그래프와 잇는다.
- 실측 데이터로만 만든다. 합성 데이터셋은 빌드의 회귀 검사 입력으로만 쓰고, 합성 데이터셋 폴더에는 계보 파일을 쓰지 않는다.

## 2. 무엇을 데이터로 보나

엔진의 F 간선 양 끝과 관찰에 나온 객체를 셋으로 나눈다. 계보는 데이터에서 처리를 거쳐 다시 데이터로 가는 선이라, 가운데의 처리하는 것도 Job 으로 남긴다.

| 나눔 | 객체 종류 | OpenLineage |
| --- | --- | --- |
| 데이터 | Drive 파일, 폼, Slack 메시지, 채널, Slack 파일, GitHub 저장소, 커밋, PR, 아티팩트 | Dataset |
| 객체가 없는 데이터 | Google 사용자 디렉터리(`Directory/users`), 그룹 디렉터리, 메일함(`Mailbox/<사용자>`), 메일 전달 주소 | Dataset |
| 데이터를 옮기는 것 | Apps Script, Slack 수신 웹훅, Slack 명령 주소, GitHub 워크플로, GitHub 웹훅, 관찰의 실행(에이전트 실행 등) | Job |
| 버림 | 계정, 인증 요소, 조직, 역할 등 나머지 전부. Drive 의 Apps Script 파일은 Job 의 코드라 데이터로 보지 않는다 | 없음 |

목록은 `src/lineage/build.ts` 의 `DATASET_TYPES`, `JOB_TYPES`, `SCOPE_DATASETS` 다. Slack 명령으로 Okta MFA 를 초기화한 이동처럼 끝이 계정이나 인증 요소이면 계보에 들어가지 않는다. 사용자 디렉터리는 계정 정보지만, 통째로 읽어 내보내면 개인정보 목록이 옮겨진 것이라 데이터로 본다.

## 3. 이벤트를 만드는 규칙

- **Run(RunEvent):** 관찰로 뒷받침된 이동이다. 관찰 하나가 Run 하나다(관찰이 없으면 결과물 하나). 같은 결과물 간선을 나눠 가진 관찰은 한 Run 으로 묶고, 근거 수준은 그중 약한 것을 따른다. 결과물을 낸 Job 에서 거슬러 올라가며 이어진 Job 을 모아 Job 하나로 묶고(Apps Script 다음 webhook), 그 순서를 `aegi_jobSteps` 에 남긴다.
- **Run 의 입력은 그 Run 의 관찰이 남긴 간선만 따라가 정한다.** 엔진은 같은 간선(시트에서 Apps Script)을 여러 실행에서 합치므로, 그대로 따라가면 다른 실행이 읽은 데이터가 섞인다.
- **엔진이 데이터 흐름 간선을 만들지 않는 관찰도 Run 으로 만든다.**
  - 웹훅 없이 봇 토큰으로 올린 전달: 자동화에서 메시지로 간다. 예는 웹앱이 비공개 채널에 올린 글이다.
  - 슬래시 명령이 만든 결과물: 요청한 채널에서 명령 주소를 거쳐 커밋으로 간다. 성공한 요청만 Run 이 되고, 결과물이 계정이면 빠진다.
- **권한 범위로만 아는 입력:** Apps Script 가 디렉터리 읽기 권한(`admin.directory.user.readonly` 등)을 받았고 Run 에 기록된 입력이 없으면 디렉터리를 입력으로 두고 Run 은 구조상 가능이다. 기록된 입력이 있으면 그 Run 의 근거를 끌어내리지 않게, 디렉터리는 같은 Job 의 정적 계보 입력으로 따로 낸다.
- **슬래시 명령의 입력:** 요청 본문은 지문으로만 저장되므로 요청한 채널을 입력으로 둔다. 본문이 결과물에 들어갔는지 모르므로 정황이다.
- **필드 단위 계보는 모든 관찰을 본 뒤 남은 입력에만 붙인다.** 같은 Run 의 다른 관찰이 원본을 모른다고 하면 붙이지 않는다.
- **정적 계보(JobEvent):** 설정으로는 흐를 수 있지만 실행 기록이 없는 것이다.
  - 워크플로가 저장소를 읽을 수 있음, 웹훅이 채널에 올릴 수 있음이 여기 든다. 같은 Job 이 이미 그 채널 안 메시지를 Run 으로 냈으면 중복이라 내지 않는다.
  - **폼 응답:** 폼과 연결 시트(`linkedSheetId`, 또는 전달 관찰의 `source_form`, `source_file`)다. 응답 시트의 열은 질문 제목(`question_titles`)과 같다고 보고 필드를 잇되, 시트 머리줄을 수집하지 않으므로 필드 근거는 추정(`inferred`)이다.
  - **Gmail 자동 전달:** 메일함에서 전달 주소로 간다. 실제 전달 기록이 아니라 설정이다. 주소 원문은 계보에 두지 않고 `email://<도메인>` 이름공간에 주소 지문만 둔다.
- **필드 단위 계보:** 전달 관찰이 필드 목록(`delivered_fields`)을 남겼을 때만 결과 메시지에 `columnLineage` 를 붙인다. 가공 없이 그대로 간 필드는 `DIRECT`, `IDENTITY`, `masking: false` 다.
- runId 는 같은 입력이면 같은 값이 나오게 만든다. 같은 데이터셋이면 같은 파일이 나온다.

## 4. 근거 수준

모든 Run 과 정적 계보에 근거 수준을 붙인다. 경로의 수준은 가장 약한 근거를 따르고, 근거가 하나도 없으면 미확인 구간이다. 내용이 비슷하다고 복제가 증명되지는 않으므로 내용 일치와 정황은 확정으로 올리지 않는다.

| 근거 수준 | 코드 | 1단계에서 붙는 경우 |
| --- | --- | --- |
| 확정 | `run_record` | 전달 관찰이 웹훅 지문 일치로 이어졌을 때. 합성 픽스처의 전달처럼 관찰이 이동을 직접 적었을 때 |
| 내용 일치 | `content_match` | 4단계(내용 비교)부터 |
| 정황 | `correlation` | 실행과 메시지의 시각 대조로 이은 전달, 근거를 모르는 실측 전달, 에이전트 실행, 슬래시 명령, 정규화가 추정으로 남긴 입력, 관찰 없이 증거 링크로만 이은 이동 |
| 구조상 가능 | `structural` | 정적 계보 전부. 입력을 권한 범위로만 아는 Run |
| 미확인 구간 | `unverified` | 결과물은 있는데 입력을 모름. 전달에 원본 데이터가 담겼는지 모름(`contains_source_data: false`) |

근거 수준을 정한 이유는 `aegi_evidence.reasons` 에 코드로 남긴다.

| 이유 코드 | 뜻 |
| --- | --- |
| `matched_by_time` | 실행과 메시지의 시각 대조 |
| `delivery_basis_unknown` | 실측 전달인데 어떻게 이었는지 기록이 없음 |
| `derived_content_unverified` | 결과물 내용이 입력에서 왔는지 확인 못 함 |
| `request_content_unverified` | 요청 내용이 결과물에 들어갔는지 확인 못 함 |
| `input_inferred` | 정규화가 추정으로 남긴 입력 |
| `input_from_scope` | 입력을 권한 범위로만 앎 |
| `no_observation` | 관찰 없이 증거 링크로만 이음 |
| `flow_not_observed` | 설정으로만 흐를 수 있음 |
| `form_link_setting` | 폼과 응답 시트 연결 설정 |
| `forwarding_setting`, `forwarding_not_accepted` | 메일 자동 전달 설정, 전달 주소가 수락하지 않음 |

빈 구간은 `aegi_evidence.gaps` 에 남긴다. `source_unknown` 은 입력이 없음, `source_not_confirmed` 는 원본이 담겼는지 모름이다.

## 5. Facet

| Facet | 붙는 곳 | 종류 |
| --- | --- | --- |
| `symlinks` | Dataset | 표준 1-0-1. `aegi://objects` 이름공간에 AEGI 객체 키 |
| `columnLineage` | 출력 Dataset | 표준 1-2-0. 필드별 원본 필드와 변환 |
| `aegi_evidence` | Run, 정적 Job | AEGI 전용 |
| `aegi_actor` | Run | AEGI 전용 |
| `aegi_jobSteps` | Job | AEGI 전용 |

이름 규칙: 데이터와 객체 Job 은 `<provider>://<환경>` 이름공간에 `<객체 종류>/<객체 키>` 다(예: `gws://aegi-inc` + `File/GWS-FILE-CUSTOMER-RESPONSES`). 관찰의 실행은 `aegi://<환경>` 이름공간에 `<관찰 종류>/<관찰 id>` 다.

AEGI 전용 facet 의 스키마는 `scripts/lineage/schema/AegiFacets.json` 이고 공식 스키마와 같이 검사한다.

### aegi_evidence

| 칸 | 뜻 |
| --- | --- |
| `level` | 근거 수준 코드 (4장) |
| `observations` | 근거가 된 관찰 id |
| `reasons` | 근거 수준을 정한 이유 코드 (4장) |
| `fields` | 필드 대응의 근거. `confirmed` 관찰이 필드 목록을 남김, `inferred` 구조로 추정, `unknown` 모름 |
| `gaps` | 확인이 필요한 구간 코드 |

### aegi_actor

| 칸 | 뜻 |
| --- | --- |
| `account` | 실행한 계정의 객체 키 (관찰의 `caller`) |
| `initiatedBy` | 실행을 시킨 사람의 객체 키 (관찰의 `initiated_by_object`, 슬래시 명령의 요청자) |

### aegi_jobSteps

| 칸 | 뜻 |
| --- | --- |
| `steps` | Job 하나로 묶은 자동화 단계. 상류부터 `key`, `type`, `name` |

## 6. 파일과 명령

- **결과 파일:** 데이터셋 폴더의 `lineage_events.json`. `format`(`aegi-lineage/v1`), `spec`, `created_at`(원본 정규화 시각), `source_sha256`(만든 데이터의 지문), `counts`, `events` 를 담는다.
- **만드는 곳:** IM Profile 정규화(`npm run normalize`)가 끝에 만든다. 이미 정규화된 폴더에는 `npm run lineage` 로 붙인다.
  - `npm run lineage -- --dataset <폴더>`: 다른 데이터셋
  - `npm run lineage -- --ndjson <파일>`: 이벤트를 한 줄에 하나씩 따로 내보낸다. Marquez 같은 도구가 그대로 읽는다
  - `npm run lineage -- --check`: 쓰지 않고 검사와 요약만
- **실패할 때:** 예전 `lineage_events.json` 을 먼저 지우고 만든다. 공식 스키마 검사에서 문제가 하나라도 나오면 쓰지 않고 실패하므로, 새 데이터 옆에 예전 계보가 남지 않는다.
- **운영 반영:** `npm run publish -- --env production --dataset <폴더>`가 `lineage_events.json`을 D1 스냅샷 문서로 저장하고 Dashboard가 D1 번들에서 읽는다. 계보 파일에는 만든 데이터 파일(`manifest`, `objects`, `relations`, `links`, `observations`, `evidence_links`)의 sha256 을 `source_sha256` 으로 남기고, 게시할 때 지금 파일의 지문과 다르면 막는다. 정규화 시각(`created_at`)은 원본 수집 시각이라 다시 정규화해도 같아서 쓰지 않는다. 화면은 계산하지 않고 번들에서 읽기만 한다(3단계).
- **공식 스키마 검사:** `scripts/lineage/schema/` 에 OpenLineage 1.53.0 태그의 `spec/OpenLineage.json`(2-0-2), `ColumnLineageDatasetFacet.json`(1-2-0), `SymlinksDatasetFacet.json`(1-0-1)을 그대로 두고 ajv 로 검사한다. `npm run test:collect`가 합성 데이터셋으로 같은 검사를 돌린다.

## 7. 실측 결과 (2026-10-02 정규화 실측)

| 항목 | 값 |
| --- | --- |
| Run | 6 (정황 4, 구조상 가능 1, 미확인 구간 1) |
| 정적 계보 | 6 (구조상 가능) |
| 데이터 | 16 |
| 공식 스키마 검사 | 문제 0 |

세팅 정답(`groundtruth/g2/manual.json`)의 데이터 이동 4개가 모두 나온다.

| 정답의 이동 | 계보 |
| --- | --- |
| 고객 설문 → Slack 채널 (Customer Intake Sync) | 폼에서 응답 시트(정적, 질문 7개를 필드로 추정), 시트에서 Apps Script 와 webhook 을 거쳐 메시지(정황). 같은 webhook 의 다른 메시지는 원본이 담겼는지 몰라 미확인 구간 |
| 웹앱 → 비공개 채널 메시지 (Team Directory) | 사용자 디렉터리에서 Apps Script 를 거쳐 메시지. 메시지는 시각 대조, 디렉터리는 권한 범위로만 알아 구조상 가능 |
| DevBot: Slack 명령 → GitHub 저장소 쓰기 | 요청 채널에서 명령 주소를 거쳐 커밋 3개(정황) |
| Gmail 자동 전달 → 조직 밖 개인 메일 | 메일함에서 전달 주소(정적) |

정답은 Customer Intake Sync 가 폼을 읽는다고 적는데, 계보는 스크립트가 붙은 응답 시트를 입력으로 둔다. 둘 다 폼에서 시작해 하류는 같다.

**시트에서 메시지로 간 필드는 알 수 없다.** 실측 정규화는 Slack 메시지 본문과 Apps Script 코드를 지문(sha256, 길이)으로만 저장하고, 실측 전달 관찰에는 필드 목록이 없다. 합성 데이터에만 있는 필드 6개(`delivered_fields`)는 실측에서 나오지 않는다. 필드 단위 계보는 4단계(내용 비교)에서 다시 다룬다.

## 8. 1단계에서 하지 않은 것

- 설계안의 facet 중 `lifecycleStateChange`(삭제), `version`(판), `ownership`(소유자), `lineage`(Job), `aegi_contentMatch`, `aegi_classification` 은 넣지 않았다. 삭제 기록은 감사 로그 어댑터(4단계), 분류는 기능 D 기준이 정해진 뒤에 넣는다.
- 저장은 `lineage_events.json`(감싼 객체)이고 ndjson 은 `--ndjson` 내보내기로만 둔다. 번들이 JSON 파일을 읽기 때문이다.
- Run 마다 COMPLETE 이벤트 하나만 낸다. 지난 기록을 다시 만드는 것이라 START 는 두지 않는다.
- 미확인 구간도 Run 으로 낸다. 결과물이 생긴 실행은 기록에 있고 입력만 모르므로, 간선을 지우지 않고 `gaps` 로 표시한다.

## 9. 다음 단계와 열린 질문

1. **분석 5개:** 출처, 확산, 변환, 잔존, 영향 범위 질의. 위협 8개마다 맞는 예와 안 맞는 예를 가짜 감사 로그로 검사한다(가짜 로그는 테스트에만 쓴다).
2. **기능 D 연결과 화면:** 사실 묶음(`LineageFact`, 무엇이, 어느 데이터에서, 어떤 경로로, 어떤 필드가, 얼마나 확실하게)을 기능 D 와 합의한다. 지금 타입은 임시다. 화면 자리는 팀이 정한다.
3. **감사 로그와 내용 비교:** Drive, Slack, GitHub 감사 로그 어댑터와 해시 비교. 시트 머리줄 수집은 Google 권한을 넓혀야 해서 이때 정한다.
