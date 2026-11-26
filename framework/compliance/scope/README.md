# 컴플라이언스 대상 판정 규격

세 기준(ISMS-P, PIPA, ISO 27001) 항목별 SaaS 적용 여부(`*.scope.jsonl`)와 대상 판정 규칙(`rules/`)의 정본이다. 판정 모델(Jev) 점수는 매핑 작업 기록으로 `catalog-mapping/type-tags/`, `catalog-mapping/value-tags/`의 `*scores*.jsonl`에 있다. 특정 테넌트의 실측 대상 설명과 모델 캐시·키는 이 저장소에 두지 않는다.

## 파일

| 파일 | 설명 | 형식(칸) |
| --- | --- | --- |
| `isms-p.scope.jsonl` | ISMS-P 기준 항목별 SaaS 적용 여부 | JSONL(`framework`, `item_id`, `saas_scope`, `reason`, `target_statement_en`, `targets`, `company_input`, `previous_status`, `changed`, `change_reason`) |
| `pipa.scope.jsonl` | 개인정보보호법(PIPA) 기준 항목별 SaaS 적용 여부 | JSONL(`framework`, `item_id`, `saas_scope`, `reason`, `target_statement_en`, `targets`, `company_input`, `previous_status`, `changed`, `change_reason`) |
| `iso27001.scope.jsonl` | ISO 27001 기준 항목별 SaaS 적용 여부 | JSONL(`framework`, `item_id`, `saas_scope`, `reason`, `target_statement_en`, `targets`, `company_input`, `previous_status`, `changed`, `change_reason`) |
| `rules/kind-tags.json` | 객체와 관계 종류별 태그 부여 규칙 | JSON(`_note`, `objects`: [패턴, 이름패턴, 태그목록], `relations`: 종류별 추가/상속/조건부 태그) |
| `rules/item-tags.tsv` | 항목별 허용 태그와 제약 규칙(@obj, !태그, *) | TSV(`항목_키`, `허용_태그_목록`) |
| `rules/bundle-overrides.tsv` | 묶음(항목, 대상 종류)별 사람 판정 결과 | TSV(`항목_키`, `대상_종류_라벨`, `판정(in/out/review)`) |
| `rules/item-status.tsv` | 해당 0건 항목의 확인 상태와 사유 | TSV(`항목_키`, `상태`, `사유`) |
| `rules/group-decisions.tsv` | 점수가 없을 때 쓰는 묶음별 판정, 대표 점수로 결정 | TSV(`묶음(grp)`, `항목_키`, `판정(in/out)`) |
| `rules/config.json` | 판정 점수 임계값 lo, hi 설정 | JSON(`_note`, `lo`, `hi`) |

## 카탈로그 매핑

`catalog-mapping/`은 2026-11-09부터 적용한 방식이다. 개별 인스턴스마다 판정하는 대신 카탈로그 객체 종류와 컴플라이언스 항목 사이의 매핑을 미리 정의한다. 스냅샷 게시 시 이 매핑을 스냅샷 객체 종류에 맞춰 `(항목, 종류, 객체 수)`로 `compliance_scope` 테이블에 적재한다.

## 판정 순서

1. **규칙 밖**: 항목 허용 태그와 매칭되지 않으면 제외(`out`), 근거는 `rule`이다.
2. **규칙 안, 대상 점수 있음**: 대상 점수 `p`가 `hi` 이상이면 해당(`in`), `lo` 미만이면 제외(`out`), 그 사이는 검토(`review`)이며, 근거는 `model`이다.
3. **규칙 안, 대상 점수 없음**: `group-decisions.tsv`에 있으면 그 값(`in`/`out`), 없으면 검토(`review`)이며, 근거는 `model`이다.
4. **검토 재판정**: 판정 결과가 검토(`review`)이고 `bundle-overrides.tsv`에 `(항목, 대상 종류)`가 있으면 그 사람 판정 값(`in`/`out`/`review`)을 적용하고, 근거는 `human`이다.

## 근거 등급

- `rule`: 규칙 매칭 결과로만 결정 (규칙 밖 제외).
- `model`: 판정 모델(Jev) 점수 또는 대표 점수 기반 묶음 판정으로 결정.
- `human`: 사람의 수동 판정(`bundle-overrides`)으로 결정.

## 소비자

- 런타임 엔진(`runtime/engine/`)의 스냅샷 게시 및 컴플라이언스 평가 단계가 `catalog-mapping/`의 종류별 항목 매핑과 값별 태그 표를 읽는다.
- 판정 결과는 SQLite(또는 D1) 표 `compliance_scope`와 `compliance_scope_runs`에 저장된다.
