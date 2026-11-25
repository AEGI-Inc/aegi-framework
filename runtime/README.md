# AEGI 로컬 설치판 (`aegi-solution`)

회사 PC 한 대에 AEGI를 설치해 쓰는 판이다. 클라우드나 DB 서버 없이 그 PC 안에서 모두 돈다.
- 6개 SaaS 수집: Okta, Google Workspace, GitHub, Slack, Salesforce, Atlassian(Jira·Confluence)
- 정규화와 위협 판정
- 대시보드
- AI 질문

화면과 판정은 운영 대시보드(dash.aegi.site)와 같은 코드다. 커밋은 `vendor/VERSIONS.json`에 있다.

수집한 데이터와 자격증명은 그 PC의 `data/`와 `.env`에만 남는다. 밖으로 나가는 요청은 셋뿐이다.
- 각 SaaS의 읽기 전용 API
- Splunk를 연결한 경우 그 Splunk의 검색 REST
- AI 키를 넣은 경우 그 AI 회사 API

## 필요한 것

- **Node.js 22.13 이상**
- **Python 3**(표준 라이브러리만): 컴플라이언스의 「관리자 인증 보호」 검사에 쓴다. 없으면 그 검사만 실패로 기록된다.
- 저장소를 clone해 쓰는 경우에만 **Git**과 처음 한 번 패키지를 받을 **인터넷**이 필요하다. 배포 zip은 바로 실행된다.

## 설치와 실행

### 1. 받기

```bash
git clone https://github.com/AEGI-Inc/aegi-solution.git
cd aegi-solution
```

배포 zip(`aegi-solution-<버전>.zip`)을 받았으면 풀기만 한다.

### 2. 실행

- Windows: `start.cmd`
- macOS, Linux: `./start.sh`

- clone한 폴더는 처음 한 번 실행용 패키지를 설치한다(`npm install --omit=dev`).
- `.env`가 없으면 `.env.example`을 복사해 만든다.
- 브라우저에 `http://127.0.0.1:5199`가 열린다. 처음에는 데이터가 없어 빈 화면이다.

### 3. 자격증명 넣기

두 방법 중 하나를 고른다.
- **화면에서**: **Adapters** 메뉴에서 SaaS를 고르고 연결한다. OAuth 탭에서 자체 OAuth 앱을 연결하거나, 직접 입력 탭에서 API 키·토큰(GitHub은 「새 GitHub App 생성 (Manifest)」 포함)을 저장한다.
- **파일로**: `.env`에 SaaS별 값을 채운다. 항목은 `.env.example`에 있다. 비어 있는 SaaS는 수집하지 않는다.

SaaS별로 필요한 권한과 발급 방법은 다음 문서에 있다.
- [docs/saas-collection-guide.md](docs/saas-collection-guide.md)
- [docs/saas-adapter-scopes.md](docs/saas-adapter-scopes.md)
- [docs/saas-adapter-guide.html](docs/saas-adapter-guide.html): 브라우저로 연다.

### 4. 수집

- **화면에서**: Adapters의 「이 SaaS 수집 실행」을 누른다.
- **터미널에서**: `collect.cmd`(macOS, Linux는 `./collect.sh`)를 실행한다.

수집, 정규화, 판정, 게시가 이어서 돌고 그래프, Threat, Compliance가 채워진다. 수집은 읽기 전용 API만 부른다.

먼저 화면을 둘러보려면 빈 그래프의 「샘플로 둘러보기」를 누른다. 합성 샘플 회사(`aegi.site`)가 올라온다.

### 5. 감사 로그와 AI (선택)

- **Splunk**: 감사 로그를 쓰는 Timeline, Event Board, AI 로그 검색이 켜진다. Adapters의 「Splunk 연결」 카드나 아래 「Splunk 연결」을 따른다.
- **AI 키**: Anthropic, Gemini, OpenAI 중 하나를 넣으면 「AEGI AI에게 질문」이 켜진다. Adapters의 「AI 연결」 카드나 `.env`에 넣는다.

### 막히면

```bash
node --import tsx bin/aegi.ts doctor      # clone한 폴더
node dist/aegi.mjs doctor                 # 배포 zip
```

doctor는 Node, Python, `.env`, AI 키, SaaS별 자격증명 준비 상태, 현재 데이터, Splunk 연결을 점검한다.

## 화면

| 메뉴 | 내용 |
| --- | --- |
| Overview | 위협 수, 마지막 수집, SaaS별 수집 상태, 우선 위협 |
| Cross-SaaS Graph | SaaS를 잇는 사람, 그룹, 앱, 자격증명 관계 그래프 |
| Explorer | SaaS 간 연결 경로와 자산 검색 |
| Threat | 위협 목록과 상세. 차단 지점, Access Gap, 피해 범위, 예외, 「이 위협 다시 확인」 |
| Event Board | 감사 로그 조사(Splunk 필요) |
| Compliance | ISMS-P, PIPA, ISO 27001 항목 판정과 근거, 예외 |
| Adapters | SaaS 연결, 수집 실행, 호출 현황, Splunk·AI 연결 |
| Manual | 메뉴 안내 |

## 명령

clone한 폴더는 `node --import tsx bin/aegi.ts <명령>`(또는 `npm run aegi -- <명령>`)으로 실행한다. 배포 zip은 `node dist/aegi.mjs <명령>`으로 실행한다.

| 명령 | 하는 일 |
| --- | --- |
| `start [--port 5199] [--no-open]` | 대시보드를 연다. 게시된 데이터가 없으면 빈 데이터셋을 올린다 |
| `collect [--only github,okta] [--serve]` | `.env`의 SaaS를 읽기 전용으로 수집 → 정규화 → 판정 → 게시 |
| `import --raw <수집 폴더> [--run <id>]` | 다른 PC에서 수집한 원본(`runs/`, `raw/`)을 가져와 같은 과정을 거친다 |
| `doctor` | 설치와 연결 상태 점검 |
| `splunk` | Splunk 인증, 인증서, 출처별 최근 7일 이벤트 수만 점검 |
| `sample` | 합성 샘플을 올린다 |
| `reset --yes` | `data/`를 지운다(`.env`는 남긴다) |

**파일 위치**
- `.env`는 설치 폴더 최상위에 있다. `AEGI_ENV_FILE`로 다른 파일을 지정할 수 있다.
- 데이터는 설치 폴더의 `data/`에 있다. `AEGI_DATA_DIR`로 다른 폴더를 지정할 수 있다.
  - `aegi.sqlite`: 그래프 스냅샷, 판정, 예외·조치, 로그 캐시
  - `collected/`: 수집 원본
  - `datasets/`: 정규화 결과

**접속과 보안**
- 서버는 기본으로 `127.0.0.1:5199`에서만 열리고 로그인이 없다.
- 다른 PC에서 열려면 `.env`에 `AEGI_HOST=0.0.0.0`과 `AEGI_PASSWORD`를 둔다. 비밀번호가 없으면 열지 않는다. 예전 이름 `AEGI_DEMO_PASSWORD`도 읽는다.
- 배포본에는 외부 앱의 비밀키(Client Secret, GitHub App 개인키)를 포함하지 않는다.
- 각 SaaS는 **OAuth 연결**(자체 등록 OAuth 앱의 Client ID·Secret 입력, Salesforce는 PKCE 무비밀 패키지 지원)과 **API Key·토큰 직접 입력**(GitHub은 사내 전용 App Manifest 1-클릭 생성 포함)을 모두 지원한다.
- 직접 등록한 OAuth 앱의 Redirect URI에는 `http://127.0.0.1:5199/__aegi/oauth/callback`을 등록한다(Salesforce는 `http://localhost:5199/__aegi/oauth/callback`, Slack은 `https://127.0.0.1:5199/__aegi/oauth/callback`).

## Splunk 연결

Splunk 를 어떻게 설치했는지, 로그를 어느 index 로 받는지는 회사마다 다르다. 설치판은 그 부분을 만들지 않고 연결만 한다. 필요한 것은 둘이다.

**1. 연결 정보** (`.env`)

| 키 | 값 |
| --- | --- |
| `SPLUNK_URL` | 검색 REST 주소. 관리 포트(보통 `https://<host>:8089`) |
| `SPLUNK_TOKEN` | Splunk 인증 토큰(Settings → Tokens). 감사 로그 index 를 읽는 검색 전용 계정으로 만든다 |
| `SPLUNK_CA_FILE` 또는 `SPLUNK_TLS_SHA256` | 인증서 확인. 공인 인증서면 둘 다 비운다. 사내 CA 면 CA 파일, 자체 서명이면 서버 인증서 SHA-256 지문 |
| `SPLUNK_SOURCES_FILE` | 출처 설정 파일(기본 `.env` 옆 `splunk.sources.json`) |

**2. 출처 설정** (`splunk.sources.json`): 어느 index·sourcetype 이 어느 SaaS 감사 로그인지 적는다. 형식은 운영 Connector 설정(엔진 `scripts/stream/splunk/query/config.example.json`)의 `sources` 와 같고, 그 파일을 그대로 줘도 읽는다.

| 칸 | 뜻 |
| --- | --- |
| `ref` | 출처 이름(AI 가 고르는 이름) |
| `provider` | `okta`, `github`, `slack`, `gws`, `salesforce`, `atlassian` 중 하나. 이 값으로 원문을 해석한다 |
| `index`, `sourcetype` | 회사 Splunk 의 값 |
| `isolation` | 이 index 가 이 tenant 전용이면 `{"dedicated": true}`. 여러 tenant 가 섞여 있으면 `{"field": "<JSON 경로>", "value": "<tenant id>"}` |
| `fields` | AI 가 쓰는 필드 이름 → 원문 JSON 경로 |

- 원문(`_raw`)은 각 SaaS 감사 로그 API 의 JSON 그대로여야 한다. 다른 모양이면 Timeline 해석이 실패한다(`mapping_errors`).
- 설치판은 Splunk 에 검색만 한다. 엔진 `SearchTransport` 가 허용하는 경로는 `/services/search/jobs` 와 그 상태·결과·취소뿐이고, 설치판은 HEC 전송을 쓰지 않는다.
- 조회 결과는 `data/aegi.sqlite` 의 로그 캐시에 `AEGI_LOG_CACHE_HOURS`(기본 24) 시간 둔다. 그래프를 새로 게시하면 비운다.
- `aegi splunk` 는 검색 하나(`| tstats count … by index sourcetype`, 최근 7일)로 인증, 인증서, 출처별 건수와 마지막 시각을 보여 준다. tenant 필드로 거르는 출처는 index 전체 수다.
- Splunk 연결과 AI 키는 Adapters 의 「Splunk 연결」, 「AI 연결」 카드에서도 저장한다(`.env` 에 쓴다, 화면에는 저장 여부만). Splunk 값은 서버 재시작 없이 반영된다.
- `SPLUNK_URL` 이 없으면 Timeline 과 AI 로그 검색만 꺼지고(`splunk_not_configured`) 나머지 화면은 그대로 돈다.

## 운영 구조와의 대응

| 운영 | 설치판 | 방법 |
| --- | --- | --- |
| Cloudflare KV Vault (자격증명) | `.env` 하나 | 엔진 수집기가 원래 `.env` 형식을 읽는다. tenant 식별값도 `.env` 에서 수집 설정으로 만든다 (`src/collectorConfig.ts`) |
| Cloudflare D1 (스냅샷, 예외, 조치, 로그 캐시) | `data/aegi.sqlite` (`node:sqlite`) | D1Like·SqlExecutor 어댑터 (`src/db.ts`). 마이그레이션은 운영과 같은 세 묶음 |
| `npm run publish` (D1 REST) | `src/publish.ts` | 엔진 `computeSnapshot`, `loadSnapshot`, 번들 대조, `setHead` 를 같은 순서로 |
| Pages + Function, 지역 AI Worker | Node HTTP 서버 하나 (`src/server.ts`) | 대시보드 `handleMeasured` 를 그대로 부르고 바인딩만 로컬로 |
| KV 로그인 기록 | 메모리 | 비밀번호가 없으면 서버가 서명한 세션을 붙인다(운영의 공개 접속은 로그 검색을 막기 때문) |
| Splunk Connector (EC2) | 같은 프로세스의 로그 서비스 (`src/logs.ts`, `src/splunk.ts`) | 운영 Connector(`servicesFromEnv`)와 같은 조립: 엔진 `QueryService`·`EventService` → `SearchTransport` → 회사 Splunk 검색 REST |

Timeline, AI `search_logs`/`read_logs` 는 운영과 같은 코드가 같은 Splunk REST 요청을 보낸다.

Compliance: 「관리자 인증 보호」 검사는 수집 데이터로 로컬에서 돌고 Python 3 이 필요하다(`AEGI_PYTHON` 으로 지정 가능, 없으면 검사가 실패로 기록된다).

## 지금 판에 없는 것

- **수집 SaaS**: 이 판은 6개만 수집한다. 운영에서 시험 중인 Microsoft 365, Google Cloud(Gemini), 1Password, Snowflake, AWS 수집은 넣지 않았다.
- **감사 로그 샘플**: 합성 샘플에는 감사 로그가 없다. 로그 화면은 Splunk를 연결해야 채워진다.
- **규모**: 화면이 그래프 전체를 브라우저로 받는다. 수천 명 규모 tenant는 무거울 수 있다.

## 개발자용

```bash
npm install
npm start                                       # bin/aegi.ts start (tsx)
npm test
npm run sync -- --dashboard origin/dash-prod    # 옆 폴더 세 저장소를 vendor/ 로 가져오고 화면을 다시 빌드
npm run release                                 # release/aegi-solution-<버전>/ 와 .zip
```

**vendor**
- `vendor/`는 `scripts/sync.mjs`가 만든 사본이라 손으로 고치지 않는다.
- 고칠 것은 원래 저장소에서 고치고 다시 `sync`한다.
- 원래 저장소:
  - `aegi-adapter-engine`: main
  - `aegi-dashboard-new`: dash-prod
  - `aegi-knowledge`: main

**화면 빌드**
- 화면은 `VITE_AEGI_LOCAL=on`(로컬 설치판)으로 빌드한다.
- 메뉴는 운영과 같게 그린다. 로컬 서버가 있어야 하는 기능만 켠다:
  - Splunk·AI 설정 카드
  - 위협 다시 확인
  - 빈 데이터셋
  - 샘플
  - 수집 실행
- 공개 데모용 `VITE_AEGI_DEMO`, `VITE_AEGI_PUBLIC_DEMO`는 켜지 않는다.

**patches/**
- 원래 저장소에 아직 없는 설치판 수정이다.
- sync가 가져온 뒤 이름 순서로 얹는다. 원래 저장소에 들어가면 해당 패치를 지운다.

**코드 규칙**
- 설치판 전용 코드는 `src/`, `bin/`에만 둔다.
- vendor 코드는 바꾸지 않는다. 인터페이스(D1Like, SqlExecutor, Relay)에 로컬 구현을 끼운다.

**release**
- esbuild로 두 파일을 만든다.
  - `dist/aegi.mjs`: 서버, 정규화, 판정
  - `dist/collect.mjs`: 엔진 수집 CLI
- 같은 경로로 싣는 것은 셋이다.
  - 실행 중에 읽는 데이터 파일
  - 판정 코드 지문(`engineSha256`)이 읽는 원본
  - 고객용 연동 안내 문서(`docs/`)
- 만든 뒤 두 가지를 확인한다.
  - 실은 원본의 코드 지문이 vendor 전체와 같은지
  - `doctor`로 묶음이 뜨는지
