# 데이터 계보 저장 규격 v1

구현 상태(2026-10-28): 아래 lineage_jobs/runs/edges는 전용 색인 테이블 설계다. 현재 엔진 그래프 마이그레이션에서 이 전용 테이블은 생성하지 않는다. 실제 저장은 lineage_events.json을 스냅샷 문서/번들로 보존하는 경로이며 아래 설계가 배포 완료됐다는 뜻이 아니다.

데이터 계보(기능 C)를 D1에 실을 때의 테이블 모양이다. 결정 기록은 `docs/decisions/LINEAGE_OBJECTS_2026-10-21.md`, 이벤트를 만드는 규칙은 aegi-adapter-engine `docs/spec/AEGI_LINEAGE_V1.md`에 있다.

## 원칙

- 계보는 관계 어휘가 아니다. 엔진의 데이터 흐름(F) 간선과 관찰에서 파생된 기록이다. relation 17종에 넣지 않고 `graph_relations`에도 넣지 않는다.
- 모든 끝점은 `graph_objects.id`(AEGI 객체 키)다. 객체 키가 없는 칸은 싣지 않는다.
- 원본은 OpenLineage 2-0-2 이벤트다. 테이블은 화면과 그래프 조회용 색인이고, 이벤트 전체는 `detail`(JSON)에 둔다. `graph_objects`와 같은 방식이다.
- 근거 수준 코드와 이유 코드는 계보 설계 §4의 값만 쓴다.

## 테이블

### lineage_jobs — 데이터를 옮기는 것

| 열 | 형 | 뜻 |
|---|---|---|
| `id` | TEXT PK | Job 객체 키. 여러 단계를 하나로 묶은 Job은 가장 하류 단계의 키 |
| `steps` | TEXT | `aegi_jobSteps.steps`의 객체 키 배열(JSON). 상류부터 |
| `detail` | TEXT NOT NULL | OpenLineage Job과 facet 전체(JSON) |
| `updated_at` | TEXT NOT NULL | |

`id`와 `steps`의 객체는 Automation 또는 중계 Endpoint여야 한다.

### lineage_runs — 관찰로 뒷받침된 실행

| 열 | 형 | 뜻 |
|---|---|---|
| `id` | TEXT PK | runId. 같은 입력이면 같은 값 |
| `job_id` | TEXT NOT NULL | `lineage_jobs.id` |
| `level` | TEXT NOT NULL | 근거 수준 (`run_record`, `content_match`, `correlation`, `structural`, `unverified`) |
| `actor_key` | TEXT | `aegi_actor.account`의 객체 키 |
| `initiated_by_key` | TEXT | `aegi_actor.initiatedBy`의 객체 키 |
| `observations` | TEXT | 근거 관찰 id 배열(JSON) |
| `event_time` | TEXT | RunEvent의 eventTime |
| `detail` | TEXT NOT NULL | RunEvent 전체(JSON) |
| `updated_at` | TEXT NOT NULL | |

### lineage_edges — 데이터 하나가 Job을 거쳐 데이터 하나로 간 것

| 열 | 형 | 뜻 |
|---|---|---|
| `id` | TEXT PK | `<run_id 또는 job_id>:<input_key>:<output_key>` |
| `kind` | TEXT NOT NULL | `run` 실행 기록 / `static` 설정으로만 흐를 수 있음(JobEvent) |
| `run_id` | TEXT | `kind=run`일 때 `lineage_runs.id` |
| `job_id` | TEXT NOT NULL | `lineage_jobs.id` |
| `input_key` | TEXT | 입력 Dataset 객체 키. 입력을 모르면 NULL(`source_unknown`) |
| `output_key` | TEXT NOT NULL | 출력 Dataset 객체 키 |
| `level` | TEXT NOT NULL | 근거 수준. `static`은 `structural` |
| `reasons` | TEXT | 이유 코드 배열(JSON) |
| `gaps` | TEXT | 빈 구간 코드 배열(JSON) |
| `field_basis` | TEXT | 필드 대응 근거 (`confirmed`, `inferred`, `unknown`). 필드 계보가 없으면 NULL |
| `detail` | TEXT NOT NULL | 이 간선의 `columnLineage`와 `aegi_evidence`(JSON) |
| `updated_at` | TEXT NOT NULL | |

색인: `input_key`, `output_key`, `job_id`, `run_id`.

## Dataset으로 쓸 수 있는 객체

| interface | 조건 |
|---|---|
| Resource | 전부 |
| Endpoint | 데이터가 도착하는 곳일 때만(예: GWS `ForwardingAddress`) |

Principal, Tenant, Credential, Assignment, Policy, Integration은 Dataset이 될 수 없다. Policy(예: `AutoForwarding`)와 권한 범위는 `reasons`, `detail`의 근거로만 남긴다.

## 싣지 않는 것

- 실행한 object를 알 수 없는 관찰의 실행(`aegi://<환경>` 이름공간의 Job)
- 주소 원문. 전달 주소는 `ForwardingAddress` 객체 키로만 가리킨다
