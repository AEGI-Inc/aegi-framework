# 항목과 엔진 공개 기준 점검 연결

`item-findings.jsonl`은 컴플라이언스 항목 167개(`../items-clean/saas-items.jsonl`)마다 그 항목 요구의 일부를 직접 보여 주는 엔진 점검(`runtime/engine/scripts/standards/defs/findings_unique_all.json`의 `finding_id`) 목록을 담는다. 한 줄 형식은 `{item_key, finding_ids, note}`이다.

## 구축 및 정비 이력

- **초기 분류 (2026-11-09)**: 항목 요약과 점검 이름을 기준으로 초기 매핑을 생성했으며, ISMS-P 23개 항목은 사전 검토된 기존 연결(`runtime/dashboard/src/config-findings/ismsMapping.snapshot.json`)을 포함했다.
- **1차 정밀 검토 (2026-11-10)**: 자동 추가된 958개 연결을 항목별로 재검토해 179개를 제외했다(1,371개 → 1,192개, 연결 항목 137개 → 123개).
  - 항목 전체 제외: SaaS 설정으로 판정할 수 없는 PIPA 조항(제3자 제공 동의·목적 외 제공 제한, 수탁자 의무, 국외 이전 요건, 추가적 이용 기준) 및 미국 정부 기준 전용 점검(`gws-242`, `gws-243`).
  - 개별 제외: 자산 목록의 SBOM, 저장 암호화의 인증서 키 크기·만료, 로그 기록의 Chat 대화 기록, 직무 분리의 슈퍼 관리자 일상 사용, 모니터링의 로그 보존 기간·위험 기반 MFA, 백업의 Vault 활동 감사, 접근 권한의 캘린더·그룹 공유 기본값 등.
- **2차 본뜻 검토 (2026-11-11)**: 확정된 범위 안 62개 항목(ISO 19, ISMS-P 27, PIPA 16)의 연결 811개를 「점검이 항목의 본뜻 일부를 직접 판정하는가」 기준으로 재검토해 주제 불일치 점검 29개를 제외했다(검토 기록: `item-findings-review-1111.jsonl`).
- **ISO 독립 연결 원칙 (2026-11-11)**: ISO 27001 항목은 `ismsp_links`로 연결된 ISMS-P 점검을 자동 상속하지 않고 자기 연결만 사용한다. `ismsp_links`는 대시보드의 「연결 기준」 이동에만 쓴다.
- **AEGI 자체 점검 연결 (2026-11-11)**: `runtime/engine/scripts/standards/aegi_*.py`의 계정·기기 점검(`<SaaS>-9xx`)을 ISO 5.16·8.1, ISMS-P 2.5.1-01·2.2.5-02, PIPA 안전성 확보조치 기준 제5조제2항·제6조제5항·제7조제5항에 연결하고, 데이터 판정이 가능해진 6개 항목을 자동 판정으로 승격했다.
- **관계 기반 점검 추가 (2026-11-13)**: `relation-rules.yaml`에 7개 핵심 통제(R1 관리자 권한 집중, R2 권한 부여 범위, R3 비활성 계정 잔존 접근, R4 조직 밖 주체 접근, R5 비인간 신원·연동 앱 권한, R6 사람 계정 다중 인증, R7 공용 계정)를 그래프 interface·관계·엔진 간선으로 정의했다. `runtime/engine/scripts/standards/relation_checks.ts`가 이 파일과 정규화 데이터셋을 읽어 `<SaaS>-951`~`957` 및 수동 확인 대상 `<SaaS>-958`을 판정한다(항목 43개에 연결 294개 추가). 보안 의미가 약한 GWS 정책 7종은 값별 태그를 비워 대상에서 제외했다(`../value-tags/value-tags.jsonl`).
- **대시보드 연동**: 대시보드는 `runtime/dashboard/src/compliance/checkLinks.snapshot.json`을 통해 「자동 검사 가능」 여부와 관련 점검 결과를 표시한다.
