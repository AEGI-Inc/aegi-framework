# r1 개정 도구: IM Object Model V3를 만든 파이프라인

**[V3.2 고정본](../../model/v3.2/README.md)을 만든 Node.js 스크립트와 판정 설정이다.** 실측 수집 envelope를 pinned IR(out2)의 operation·shape에 연결한다. 그 근거로 동일성, 고아 정보, Object, Relation을 정리한 뒤 V3 계열로 고정한다. SaaS API를 부르지 않는다. 동일성 재생성 단계만 [ir2/dup_audit.py](../ir2/dup_audit.py)를 캐시로 실행한다(`--send` 없음).

상태: 2026-10-25 기록. 원 작업 공간은 로컬 `bob/aegi/im-model-revision/`이다. 스크립트의 입력 경로는 그 PC 기준 절대 경로이므로 다시 돌리려면 `config/bridge-config.json`의 `cohort.root`, `ir_root`, 각 스크립트의 지식 저장소 경로를 맞춘다.

## 입력

| 입력 | 위치(원 PC) | 저장소에 있는가 |
| --- | --- | --- |
| 수집 코호트 run `20261023T070520Z-42c1` | aegi-adapter-engine `collected/v3-refresh-20261023/` | 없음(실측 원자료) |
| pinned IR | `ir2/out2/` | 없음(테넌트 실측 값이 섞여 git 제외) |
| v2 결정, rulebook | [ir2/v2/](../ir2/v2/) | 있음 |
| 현행 규격 | [specs](../../../specs/) | 있음 |

## 순서

`node scripts/run-all.mjs`가 아래를 차례로 실행하고, `node scripts/freeze-v3.mjs`가 고정본을 만든다.

| 스크립트 | 하는 일 | 산출물(V3 안 위치) |
| --- | --- | --- |
| `bridge.mjs` | envelope → IR operation, record selector, 요청 parameter binding | `evidence/observation-operation-links.jsonl` |
| `regenerate-same-entity.mjs` | out2 사본에서 v2 결정을 반영한 same_entity 재생성 | `identity/same-entity/` |
| `identity-pilot.mjs` | Drive, GitHub, Okta 동일성 실측 대조, 결정 R1-D01~D10 반영 | `identity/`, Drive binding |
| `observed-ir.mjs` | 실측 instance(비공개)와 선언 shape 대조 | `evidence/observed-ir-*`, `shape-conflicts.jsonl` |
| `orphan-observation.mjs`, `orphan-triage.mjs` | 고아 정보 4,669항목 귀속 | `information/` |
| `duplicate-dispositions.mjs` | 중복 판단 323쌍의 출처 연결 | `identity/duplicate-dispositions.jsonl` |
| `graph-orphans.mjs` | 정규화 스냅샷 그래프 고아 분류 | `graph/` |
| `object-decisions-full.mjs` | v1 Object 타입 기준선 + r1 결정 | `objects/` |
| `relation-bindings-full.mjs` | 결정 기반 binding, typed reference 처리, 어휘 대조 | `relations/` |
| `verify.mjs` | 보존·분모·재현·비유출 검사 26개 | `verification.json` |

판정 설정은 `config/`에 있다. 결정 R1-D01~D14(`decisions.json`), 원문 기반 규칙(`source-rules.json`), 고아 판정표, 그래프 고아 대응표, bridge 설정이다. 실측 값과 비식별 토큰 키는 원 PC의 `private/`에만 있고 이 저장소에 넣지 않았다.
