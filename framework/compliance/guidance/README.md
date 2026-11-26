# 컴플라이언스 기준 근거 카드

컴플라이언스 화면과 AI 추천이 참조하는 기준별 근거 카드 정본이다.

## 파일

| 파일 | 설명 |
| --- | --- |
| `pipa.guidance.jsonl` | 개인정보의 안전성 확보조치 기준(PIPA) 16개 항목 근거 카드 |
| `pipa.recommendations.jsonl` | PIPA 16개 항목 AI 추천 조치, 사람 검토 전 AI 초안 |
| `isms-p.guidance.jsonl` | ISMS-P 인증기준 27개 항목 근거 카드 |
| `isms-p.recommendations.jsonl` | ISMS-P 27개 항목 AI 추천 조치, 사람 검토 전 AI 초안 |
| `iso27001.guidance.jsonl` | ISO/IEC 27001:2022 Annex A 19개 항목 근거 카드 |
| `iso27001.recommendations.jsonl` | ISO 27001 19개 항목 AI 추천 조치, 사람 검토 전 AI 초안 |

## 카드 구조

| 칸 | 설명 |
| --- | --- |
| `item_key` | `compliance/scope/` 와 같은 기준 항목 키 |
| `framework` | 기준 약칭 (`PIPA`) |
| `location` | 고시 조문 위치 |
| `requirement` | 법령과 고시 요구사항 요약 (`text`, `src`) |
| `auditor_checks` | 심사, 점검에서 확인하는 사항 (`text`, `src`) |
| `evidence_examples` | 증적 예시 (`text`, `src`, 해설서에 없으면 빈 배열) |
| `common_gaps` | 자주 나타나는 미조치, 결함 사례 (`text`, `src`, 해설서에 없으면 빈 배열) |
| `saas_controls` | 요구사항을 SaaS finding 에 연결한 AEGI 자체 매핑 (`text`, `finding_ids`, `basis`, `src`) |
| `sources` | 공식 출처 목록 (`title`, `publisher`, `version`, `url`, `locator`) |
| `review` | 검토 상태 (`검토 전` 등) |

## 출처 규칙

- 고시 원문, 개인정보보호위원회, KISA 공식 안내서 등 공공기관 공식 자료만 출처로 쓴다.
- 모든 `text` 항목은 `sources` 배열 번호(`src`)를 1개 이상 가진다.
- `saas_controls` 는 AEGI 해석이며 `basis: "aegi_mapping"` 으로 표시한다. 안내서 원문에 특정 SaaS 이름이 나오지 않아, 인용한 안내서 조문 해설(`src`)을 근거로 요구사항과 SaaS finding 을 연결했다.
- `locator` 에는 실제 확인한 조항 번호나 안내서 인쇄 쪽 번호를 적는다. 인쇄 쪽은 PIPA 해설서가 PDF 쪽 - 8, ISMS-P 안내서(2023.11)가 PDF 쪽 - 5다.
- ISO 카드는 표준 원문 없이 통제 번호, 우리 요약, 공개 자료(ISMS-P 안내서 대응 확인사항, NIST 대응표)만 쓴다.
- `finding_ids` 는 해당 항목에 연결된 허용 finding 목록 안에서만 고른다.

## 추천 파일 (`*.recommendations.jsonl`)

- `pipa.recommendations.jsonl` 은 근거 카드와 조치 카드를 요약해 미리 만든 AI 초안이며 사람 검토 전 상태(`basis: "ai_draft"`, `review: "검토 전"`)다.
- 칸: `item_key`, `framework`, `overview`(1~2개), `actions`(2~6개, `finding_ids` 포함), `human_checks`(0~4개), `basis`, `model`, `generated_at`, `review`.
- `ref` 문법: 같은 `item_key` 근거 카드 문장을 가리키는 `guidance:<칸>[<번호>]` (`requirement`, `auditor_checks`, `evidence_examples`, `common_gaps`, `saas_controls`, 번호 0부터) 또는 조치 카드를 가리키는 `remediation:<finding_id>`.
- 모든 문장은 `ref` 를 1개 이상 가지며, `actions` 의 각 항목은 근거 카드 `ref` 1개 이상과 `finding_ids` 에 대응하는 `remediation:<id>` 를 함께 가진다.
