# 05. 위협 판정, 연결 규칙, 컴플라이언스

AEGI는 정규화된 Cross-SaaS 그래프 위에서 위협 유형 4종 판정, Cross-SaaS 연결 확인 규칙 260개, SaaS 객체별 위협 매핑, 국내외 컴플라이언스 판정을 수행한다. 컴플라이언스 기준은 ISMS-P, PIPA, ISO 27001이다.

## 1. 위협 판정 V2: 위협 유형 4종

범용 접근 엔진(`AccessEngine`)이 저장된 그래프를 내부 계산 간선 7종(`M`, `U`, `G`, `T`, `A`, `F`, `E`)으로 색인한 뒤, 경로와 근거를 조합해 위협 유형 4종을 판정한다.

| 위협 유형 (`threat_types.yaml`) | 판정 대상 |
| --- | --- |
| **`data_exfiltration`** (데이터 반출) | 사내 데이터가 외부 계정, 웹훅, 자동화, 개인 메일 등으로 빠져나갈 경로 |
| **`privilege_escalation`** (권한 상승) | 낮은 권한 주체가 자동화, 앱, 역할 위임을 통해 더 높은 권한을 행사하는 경로 |
| **`unauthorized_access`** (비인가 접근) | 퇴사자, 외부 게스트, 미관리 계정이나 과도한 공유를 통한 보호 자원 접근 |
| **`accountability_loss`** (추적성 상실) | 공유 계정, 익명 토큰, 감사 로그 누락 등으로 행위 주체를 추적할 수 없는 상태 |

각 위협마다 차단 지점(`cut`), Access Gap(기준선 대비 초과 권한), 피해 범위(Blast Radius)를 함께 계산한다.
- 온톨로지 정의: [threat_types.yaml](../../framework/schema/ontology/threat_types.yaml)
- 위협 판정 V2 명세: [AEGI_THREAT_JUDGMENT_V2.md](../../specs/AEGI_THREAT_JUDGMENT_V2.md)
- 범용 접근 엔진 명세: [AEGI_GENERIC_ACCESS_ENGINE_V1.md](../../specs/AEGI_GENERIC_ACCESS_ENGINE_V1.md)
- 피해 범위 계산 명세: [AEGI_BLAST_RADIUS_V1.md](../../specs/AEGI_BLAST_RADIUS_V1.md)

## 2. Cross-SaaS 연결 확인 규칙: 21개 쌍, 260개 방법

두 SaaS의 실제 연동을 확인하려면 어느 API를 보고 어떤 값이 같으면 연결로 판정할지 정해져 있어야 한다. `framework/connection-rules/`에 특정 기업 데이터가 없는 **범용 연결 검증 규칙 260개**가 YAML로 정리되어 있다.

- 대상: Okta, GitHub, Google Workspace, Slack, Atlassian(Jira, Confluence, Bitbucket), Salesforce, 외부 서버(`*-external`)
- 근거 강도(`tier`) 순서: `config_id`, `config_name`, `fingerprint`, `via_person`, `log_id`, `log_time`
- 문서와 시각화:
  - 전체 260개 요약표: [methods.md](../../framework/connection-rules/docs/methods.md)
  - 브라우저로 여는 인터랙티브 연결 지도: [connection-map.html](../../framework/connection-rules/docs/connection-map.html)
  - 규칙 읽는 법: [how-to-read.md](../../framework/connection-rules/docs/how-to-read.md), [process.md](../../framework/connection-rules/docs/process.md)
  - YAML 규칙 파일(21개 쌍): [framework/connection-rules/rules/](../../framework/connection-rules/rules/)

## 3. SaaS 객체별 위협 매핑 (`framework/threat-mapping/`)

각 SaaS의 객체 분류(Identity/Access, Integration/Automation, Policy/Configuration, Resource)별로 발생 가능한 위협, 수집 상태, MITRE ATT&CK, CISA ScubaGear, OWASP NHI 출처를 표준 CSV로 관리한다.
- 형식 규격: [threat-mapping/README.md](../../framework/threat-mapping/README.md)
- 포함 SaaS 10개: `atlassian/`, `gemini/`, `github/`, `gws/`, `microsoft/`, `okta/`, `onepassword/`, `salesforce/`, `slack/`, `snowflake/`

## 4. 컴플라이언스 규격 (`framework/compliance/`)

수집된 Cross-SaaS 그래프와 설정 상태를 국내외 보안 인증 기준에 매핑해 자동 판정 근거와 개선 권고를 제공한다.
- 대상 표준: ISMS-P, PIPA(개인정보보호법), ISO/IEC 27001
- 대상 판정 규격: [compliance/scope/README.md](../../framework/compliance/scope/README.md)
- 가이드와 권고 문구: [compliance/guidance/README.md](../../framework/compliance/guidance/README.md)
