# 항목 ↔ 엔진 공개 기준 점검 연결 (2026-11-09 AI 분류, 11-10 Claude 검토)

`item-findings.jsonl`: 컴플라이언스 항목 167개(`items-clean/saas-items.jsonl`)마다 그 항목 요구의 일부를 직접 보여 주는 엔진 점검(`aegi-adapter-engine` `scripts/standards/defs/findings_unique_all.json` 의 `finding_id`) 목록. 한 줄에 `{item_key, finding_ids, note}`.

- 만든 방법: Gemini(flash)가 항목 요약과 점검 이름을 보고 분류했다. ISMS-P 23개 항목은 사람이 검토한 기존 연결(dashboard `src/config-findings/ismsMapping.snapshot.json`)을 그대로 포함한다.
- 11-10 검토: AI 가 더한 958개 연결을 항목별로 읽고 179개를 뺐다(1,371 → 1,192개, 연결 있는 항목 137 → 123개). 기존 검토 연결(ISMS-P 2.10.2-02 의 119개 포함)은 건드리지 않았다.
  - 항목 전체를 비운 곳: SaaS 설정으로 볼 수 없는 PIPA 요구(제3자 제공 동의와 목적 외 제공 제한, 수탁자 의무, 국외 이전 요건, 추가적 이용 기준). `gws-242`, `gws-243`(데이터 지역 미국 여부)은 미국 정부 기준이라 국외 이전 항목에서 뺐다.
  - 개별로 뺀 것: 자산 목록 ← SBOM, 저장 암호화 ← 인증서 키 크기와 만료, 로그 기록 ← Chat 대화 기록, 직무 분리 ← 슈퍼 관리자 일상 사용, 모니터링 ← 로그 보존 기간과 위험 기반 MFA, 백업 ← Vault 활동 감사, 접근 권한 ← 캘린더와 그룹 공유 기본값 등.
  - 아직 사람(보안 담당) 확인은 거치지 않았다.
- 11-11 검토(Claude, 범위 확정 뒤): 범위 안 62개 항목(ISO 19, ISMS-P 27, PIPA 16)의 연결 811개를 「점검이 그 항목의 본뜻 일부를 판정하는가」로 다시 봤다. 다른 주제의 점검 29개를 뺐다(감사 로그 정기 검토를 로그 기록 항목에서, 경보와 브라우저 설정을 비밀번호 규칙에서, 공유 기본값을 권한 부여에서, 미국 데이터 지역 등). 기록 `item-findings-review-1111.jsonl`, 반영 `apply_link_review_1111.py`. 범위 밖 항목의 연결은 보지 않았다(화면에 나오지 않는다).
- **ISO 항목은 ISMS-P 연결을 물려받지 않는다(11-11).** 전에는 `ismsp_links` 가 가리키는 ISMS-P 항목의 연결을 합쳐 ISO 범위 안 19개에 295개가 더 붙었고, 그중 45개는 범위 밖 ISMS-P 항목(3.3.1-06, 2.8.5-03 등)에서 왔다. ISO 는 자기 연결만 쓰고 `ismsp_links` 는 화면의 「연결 기준」 이동에만 쓴다.
- **AEGI 자체 점검 연결(11-11)**: engine `scripts/standards/aegi_*.py` 의 계정, 기기 점검(finding `<SaaS>-9xx`)을 ISO 5.16, 8.1, ISMS-P 2.5.1-01, 2.2.5-02, PIPA 안전성 확보조치 기준 제5조제2항, 제6조제5항, 제7조제5항에 이었다. 이 점검으로 데이터 판정이 생긴 근거 제공 항목 6개는 자동 판정으로 올렸다. 반영 `apply_aegi_checks_1111.py`(그 뒤 `items-clean/apply_scope_1111.py`).
- 대시보드는 `scripts/importComplianceCheckLinks.mjs` 로 이 파일을 `src/compliance/checkLinks.snapshot.json` 에 가져와 「자동 검사 가능」 여부와 관련 점검 결과를 보인다.
- **관계 점검(11-13)**: `relation-rules.yaml` 에 항목이 반복해서 묻는 통제 7개(R1 관리자 권한 집중, R2 권한 부여 범위, R3 비활성 계정에 남은 접근, R4 조직 밖 주체의 접근, R5 비인간 신원과 연동 앱의 권한, R6 사람 계정의 다중 인증, R7 공용 계정)를 그래프 interface, 관계, 엔진 간선으로 정의했다. engine `scripts/standards/relation_checks.ts` 가 이 파일과 정규화 데이터셋을 읽어 판정하고, finding id 는 `<SaaS>-951`~`957`(패턴마다 SaaS 6개), 사람 확인 항목 9개의 대상 객체는 `<SaaS>-958`(manual) 이다. 반영 `apply_relation_rules_1113.py`(항목 43개에 연결 294개). 배경: 11-13 운영 그래프에서 미점검 객체 1,363개 중 1,203개가 엔진 간선에 걸린다는 측정. 같은 스크립트가 GWS 정책 중 보안 의미가 약한 설정 종류 7개(앱 차단 안내 문구, Classroom 보호자 접근, iOS Apple Intelligence, iOS 날짜와 시간, 디렉터리 자원 종류 표시, 라이선스 없는 사용자의 Gemini 앱, Sites 만들기)의 값 → 태그를 비워 항목 대상에서 뺐다(`value-tags/value-tags.jsonl` 의 note).
