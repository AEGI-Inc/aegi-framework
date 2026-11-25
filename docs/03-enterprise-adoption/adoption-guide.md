# 기업 도입 가이드 (Enterprise Adoption Guide)

AEGI Framework는 기업의 보안 성숙도와 인프라 여건에 따라 **1단계(로컬 PoC) → 2단계(실제 테넌트 파일럿) → 3단계(사내 확장 및 SIEM 통합)** 순으로 점진 도입할 수 있다.

---

## 사전 요구사항

- **Node.js 22.13 이상**
- **Python 3** (표준 라이브러리만 사용: 컴플라이언스 "관리자 인증 보호" 검사 및 IM 도출 도구 실행용)
- **Git** (저장소를 clone해 사용하는 경우)

---

## Phase 1. 로컬 PoC (30분 내 검증)

외부 클라우드나 별도 DB 없이 담당자 PC 한 대에서 AEGI 런타임을 띄워 샘플 데이터로 그래프·위협·컴플라이언스 화면을 확인한다.

1. **프레임워크 무결성 확인**
   ```bash
   npm run verify
   ```
2. **런타임 실행**
   - Windows: `runtime\start.cmd`
   - macOS / Linux: `./runtime/start.sh`
   - 처음 실행 시 필요한 패키지를 설치하고 브라우저에 `http://127.0.0.1:5199`가 열린다.
3. **샘플 데이터 확인**
   - 대시보드 빈 화면의 「샘플로 둘러보기」를 누르거나 `npm --prefix runtime run aegi -- sample` 실행
   - **Overview → Cross-SaaS Graph → Explorer → Threat → Compliance** 순으로 판정 결과와 차단 지점(`cut`), Access Gap, Blast Radius 확인

---

## Phase 2. 실제 SaaS 테넌트 파일럿 (읽기 전용 연동)

지원 SaaS 중 자사가 사용하는 SaaS만 선택해 읽기 전용으로 수집한다.
- **수집·정규화·판정 지원 (9개)**: Okta, Google Workspace, GitHub, Slack, Salesforce, Atlassian(Jira·Confluence), Microsoft 365(Entra ID), Google Cloud / Gemini Enterprise, 1Password

1. **최소 읽기 권한 확인 및 발급**
   - [SaaS 수집 가이드](../../runtime/docs/saas-collection-guide.md)
   - [SaaS 어댑터 권한 범위 표](../../runtime/docs/saas-adapter-scopes.md)
   - [인터랙티브 연동 가이드(HTML)](../../runtime/docs/saas-adapter-guide.html)
2. **자격증명 등록**
   - 대시보드 **Adapters** 메뉴에서 OAuth 또는 API 토큰 직접 입력, 또는 `runtime/.env`에 입력 (비어 있는 SaaS는 수집 제외)
   - 환경 점검: `npm run runtime:doctor`
3. **수집 → 정규화 → 판정 실행**
   - 화면: **Adapters → 이 SaaS 수집 실행**
   - CLI: `runtime\collect.cmd` (macOS/Linux: `./runtime/collect.sh`) 또는 특정 SaaS만 지정:
     ```bash
     npm --prefix runtime run aegi -- collect --only okta,github
     ```
4. **(선택) 감사 로그(Splunk) 및 AI 조사 연동**
   - 사내 Splunk 검색 REST API(`SPLUNK_URL`, `SPLUNK_TOKEN`, `splunk.sources.json`)를 연결하면 Timeline, Event Board, AI 로그 검색이 활성화된다.
   - AI 키(Anthropic / Gemini / OpenAI 중 선택)를 설정하면 대시보드 내 AI 질의가 활성화된다.
   - 상세 설정은 [런타임 안내](../../runtime/README.md)의 「Splunk 연결」 절을 따른다.

---

## Phase 3. 사내 공용 운영 및 프레임워크 확장

### 1. 사내 공용 서버 운영 (On-Premise / Private VPC)
- `runtime/.env`에 `AEGI_HOST=0.0.0.0`과 `AEGI_PASSWORD=<강한 비밀번호>`를 설정한다. (비밀번호 없이는 외부 바인딩을 거부한다.)
- 수집 원본은 `runtime/data/collected/`, 정규화 결과와 스냅샷은 `runtime/data/`의 `datasets/`와 `aegi.sqlite`에 저장된다(`AEGI_DATA_DIR`로 경로 변경 가능).

### 2. 정기 재수집
- 런타임은 수집을 자동으로 반복하지 않는다. SaaS 변경을 반영하려면 수집을 다시 실행하거나, OS 예약 작업(Windows 작업 스케줄러, cron)으로 `collect`를 정기 실행한다.
- 다시 수집할 때마다 전체를 읽고(증분 수집 없음) 새 스냅샷을 게시한다. 예외와 조치 진행 상태는 그대로 남는다.
- 예약 명령, 겹침 주의, 데이터 보존은 [런타임 안내의 「다시 수집하기」](../../runtime/README.md#5-다시-수집하기)를 따른다.

### 3. 사내 보안 체계·SIEM/SOAR 통합
- **온톨로지 활용**: `framework/schema/ontology/*.yaml`을 사내 자산 관리(CMDB)나 SIEM 정규화 어휘로 직접 참조한다.
- **연결 규칙 활용**: `framework/connection-rules/rules/*.yaml`의 260개 연결 검증 방법을 사내 보안 점검 체크리스트나 탐지 규칙으로 이식한다.
- **위협 매핑·컴플라이언스 활용**: `framework/threat-mapping/`과 `framework/compliance/`를 사내 리스크 평가 및 ISMS-P/ISO 27001 증적 기준선으로 사용한다.

### 4. 자사 SaaS 신규 추가
- 지원 SaaS 외에 Workday나 사내 자체 SaaS를 통합하려면 [새 SaaS 추가 플레이북](adding-new-saas.md)을 따른다.
