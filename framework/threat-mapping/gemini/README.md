# Gemini Enterprise 객체별 위협 매핑

- 버전: v0, 2026-11-24 초안, 2026-11-25 검토 반영
- 상태: 초안, PR 검토 반영
- 폴더와 provider id: `gemini`, 약어 `GEM`
- 범위: GCP Discovery Engine, Agent Registry, IAM 기반 Gemini Enterprise 객체 30종(수집 중 29종, API 밖 1종)과 객체별 위협 27건
- 주요 출처: OWASP NHI Top 10 (2025), OWASP LLM Top 10, OWASP Citizen Development Top 10, OWASP CI/CD Top 10, MITRE ATT&CK, Push Security, BloodHound/GitHound, 공개 보안 연구와 사고 보고서
- 남은 일:
  1. `Agent` 정의 본문(`workflowAgentDefinition` 등)의 연결 참조 수집 여부 확인
  2. `scenarios.csv` 39건을 테넌트에서 실행해 `status`와 `evidence`를 채우기

## scenarios.csv

다른 SaaS에서 출발해 마지막 위협이 Gemini Enterprise 객체에서 일어나는 Cross-SaaS 시나리오 후보 39건이다. 열은 [threat-mapping/README.md](../README.md#scenarioscsv)의 양식을 따른다. `threats.csv`의 위협을 끝점(`end_threat_ids`)으로 두고, 경로에 드는 다른 SaaS 폴더의 위협 ID는 `notes`에 적었다. 성립 여부를 가리지 않고 나올 수 있는 경로를 모은 목록이라 모두 실행 전 후보다. 자기 권한 안에서만 도는 `SC-GEM-14`는 위협으로 보지 않아 뺐다. Gemini에서 출발해 다른 SaaS에서 끝나는 후보 53건은 [scenarios-backlog/](../scenarios-backlog/README.md)에 `GEMS-…`로 있다.
