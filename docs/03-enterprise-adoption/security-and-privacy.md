# 보안 및 데이터 보호 원칙

AEGI Framework는 기업 보안팀이 민감한 SaaS 권한과 계정 정보를 외부로 내보내지 않고 분석하도록 아래 원칙을 강제한다.

## 1. 읽기 전용 수집

- 모든 SaaS 어댑터는 **읽기 전용 API**만 호출한다. 테넌트 설정, 계정, 권한, 웹훅을 생성, 수정, 삭제하지 않는다.
- SaaS별 최소 필요 권한(Scope)은 [saas-adapter-scopes.md](../../runtime/docs/saas-adapter-scopes.md)에 공개되어 있다. 도입 전 보안 심의 자료로 쓴다.
- Splunk도 검색 전용 경로인 `/services/search/jobs`와 그 상태, 결과, 취소 경로만 허용한다. HEC 전송이나 쓰기 요청은 보내지 않는다.

## 2. 데이터 경계와 외부 통신 최소화

`runtime/` 실행 시 수집된 원본 데이터, 정규화 그래프, 판정 결과, 자격증명은 모두 도입 기업의 로컬이나 사내 디렉터리(`runtime/data/`, `runtime/.env`)에만 저장된다. 외부로 나가는 네트워크 요청은 아래 네 가지뿐이다. 별도 텔레메트리는 없다.

1. 도입 기업이 설정한 각 SaaS의 읽기 API. 수집기는 조회 호출만 보낸다.
2. 도입 기업이 연결한 사내 Splunk 검색 REST API(선택)
3. 도입 기업이 API 키를 직접 입력한 AI 제공자 API(선택)
   - 보내는 것: 사용자의 질문과, AI가 답하려고 부른 조회 도구의 결과. 도구는 그래프 객체, 관계, 계정, 동일인 연결, 자격증명 피해 범위, 설정 점검, 컴플라이언스 항목을 돌려주고, Splunk를 연결했다면 감사 로그 검색 결과도 돌려준다. 곧 계정 이름, 이메일, 권한, 로그 이벤트 같은 수집 데이터 일부가 그 AI 제공자에게 간다(`runtime/dashboard/server/assistant/provider.ts`, `runtime/dashboard/src/assistant/chatProtocol.ts`).
   - 자격증명(`.env`의 키와 토큰)은 보내지 않는다. AI 키를 넣지 않으면 이 요청은 없다.
4. 대시보드를 연 브라우저가 화면 글꼴(Pretendard)을 `cdn.jsdelivr.net`에서 받는다(`runtime/web/index.html`). 수집 데이터는 담기지 않는다. 이 주소가 막힌 망에서는 글꼴이 CSS의 대체 글꼴(`Malgun Gothic` 등 OS 기본 글꼴)로 바뀐다.

## 3. 자격증명과 비밀값 보호

- 배포 저장소에는 어떤 OAuth Client Secret, API 토큰, 개인키(PEM), 테넌트 ID도 포함하지 않는다.
- 수집과 정규화 과정에서 API 응답에 포함된 비밀 성격의 최상위 필드는 식별자나 그래프 출력에서 제거한다.
- 대시보드 서버는 기본으로 `127.0.0.1:5199`에만 바인딩된다. 외부 접속(`AEGI_HOST=0.0.0.0`)을 열려면 반드시 `AEGI_PASSWORD`를 설정해야 한다.

## 4. 배포 전 자동 안전성 검사

이 저장소는 외부 기업에 제공하기 전 내부 환경 정보나 민감 패턴이 섞이지 않도록 `scripts/check-public-safety.mjs`를 제공한다.

```bash
npm run check:safety
```

검사 항목:
- 내부 운영/시험 전용 디렉터리(`registry`, `environments`, `env-automation`, `adapter-auto-setup`, `test-environment`, `golden-datasets`) 미포함 여부
- 개발자 로컬 PC 절대경로(사용자 홈 디렉터리 경로) 미포함 여부
- 실제 토큰·키 패턴(GitHub PAT, Slack Token, AWS Key, Anthropic Key, Google API/OAuth Key, 1Password 토큰, PEM Private Key) 미포함 여부
- 내부 시험 도메인·계정, 팀 운영 주소, 개인 이메일, Google Drive/Docs 공유 링크 미포함 여부
