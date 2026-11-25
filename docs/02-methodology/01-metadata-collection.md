# 01. 벤더 명세와 테넌트 정보 수집

AEGI의 정보 수집은 두 층이다. 첫째는 모델을 만들기 위한 **벤더 공식 명세 수집**(Build-time), 둘째는 기업 테넌트의 실제 설정, 권한, 연동 상태를 읽는 **읽기 전용 API 수집**(Run-time)이다.

## 1. Build-time: 벤더 공식 명세 수집

오브젝트 목록은 사람이 감으로 쓰지 않는다. 벤더가 공식 제공하는 기계 판독 가능 명세와 문서를 원재료로 삼는다.

| SaaS | 수집하는 벤더 공식 자료 | 정규화 스크립트 (`framework/schema/im-model/extraction/`) |
| --- | --- | --- |
| **Okta** | OpenAPI YAML, System Log 이벤트 유형 | `normalize_okta.py`, `ir2/norm_okta.py` |
| **Google Workspace** | Google Discovery 문서, Reports 활동 부록 | `normalize_gws.py`, `ir2/norm_gws.py` |
| **GitHub** | OpenAPI 경로, 웹훅 명세, 감사 이벤트 목록, App 권한 문서 | `normalize_github.py`, `ir2/norm_github.py` |
| **Slack** | Web API 공식 문서 스냅샷, Legacy OpenAPI, Event/Audit 명세 | `normalize_slack.py`, `slack_docs.py`, `ir2/norm_slack.py` |
| **Atlassian** | Jira / Confluence / Organization OpenAPI, 감사 활동, Scope, 권한 문서 | `normalize_atlassian.py`, `atlassian_docs.py`, `ir2/norm_atlassian.py` |
| **Salesforce** | Object Reference, REST/Tooling API, Event/CDC 문서 | `normalize_salesforce.py`, `ir2/norm_salesforce.py` |
| **Microsoft 365** | Microsoft Graph OpenAPI / 메타데이터 (확장 연구 포함) | `ir2/norm_m365.py` |

설계 근거와 원자료 출처 기록은 아래 문서에 있다.
- [오브젝트 모델 재설계](../../framework/schema/im-model/design/오브젝트%20모델%20재설계.md)
- [오브젝트 후보 추출 설계](../../framework/schema/im-model/design/오브젝트%20후보%20추출%20설계.md)
- [벤더 자료 출처 목록](../../framework/schema/im-model/extraction/sources_2026-10-13.md)

## 2. Run-time: 읽기 전용 테넌트 API 수집

실제 기업 환경에서는 승인된 **읽기 전용 API**만 호출해 현재 설정과 권한 상태를 스냅샷으로 수집한다.

### 수집 원칙
1. **읽기 전용 보장**: `GET` 또는 읽기 전용 `POST`(예: GraphQL 조회, 검색 쿼리)만 허용한다. 테넌트 상태를 바꾸는 쓰기 API는 호출하지 않는다.
2. **원본 봉투(Raw Envelope) 보존**: 모든 API 응답에는 `run`, `provider`, `call`, 요청 문맥, 수집 시각, SHA-256 해시를 함께 기록한다.
3. **완결성(Coverage) 기록**: 각 호출의 결과를 `full`, `partial`, `failed`, `skipped`로 기록해 `coverage.json`으로 넘긴다. HTTP 오류 응답은 객체로 변환하지 않는다. 권한 부족으로 못 읽은 영역은 "접근 없음"이 아니라 "미확인"으로 유지한다.
4. **비밀값 비보존**: 응답에 토큰이나 시크릿 성격의 최상위 필드가 있더라도 식별자나 정규화 결과에 남기지 않는다.
5. **Run 격리**: 정규화는 지정된 단일 완료 run(`finished_at` 확인)만 읽고, 다른 run의 결과를 암묵적으로 섞지 않는다.

### 실행과 상세 명세
- 전수 수집 계약: [TOTAL_COLLECTOR.md](../../specs/TOTAL_COLLECTOR.md)
- 수집 자격증명 요구사항: [COLLECTOR_V3_CREDENTIAL_REQUIREMENTS.md](../../specs/COLLECTOR_V3_CREDENTIAL_REQUIREMENTS.md)
- SaaS별 최소 읽기 권한 및 발급 방법: [saas-collection-guide.md](../../runtime/docs/saas-collection-guide.md), [saas-adapter-scopes.md](../../runtime/docs/saas-adapter-scopes.md)
