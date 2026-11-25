# 보안 및 데이터 보호 원칙

AEGI Framework는 기업 보안팀이 민감한 SaaS 권한·계정 정보를 외부에 유출하지 않고 안전하게 분석할 수 있도록 아래 원칙을 강제한다.

---

## 1. 읽기 전용(Read-Only) 수집 원칙

- 모든 SaaS 어댑터는 **읽기 전용 API**만 호출한다. 테넌트 설정, 계정, 권한, 웹훅을 생성·수정·삭제하지 않는다.
- SaaS별 최소 필요 권한(Scope)은 [saas-adapter-scopes.md](../../runtime/docs/saas-adapter-scopes.md)에 공개되어 있어 도입 전 보안 심의에 바로 활용할 수 있다.
- Splunk 연동 시에도 검색 전용 경로(`/services/search/jobs` 및 상태·결과·취소)만 허용하며 HEC 전송이나 쓰기 요청을 보내지 않는다.

---

## 2. 데이터 경계와 외부 통신 최소화

`runtime/` 실행 시 수집된 원본 데이터, 정규화 그래프, 판정 결과, 자격증명은 모두 도입 기업의 로컬/사내 디렉터리(`runtime/data/`, `runtime/.env`)에만 저장된다. 외부로 나가는 네트워크 요청은 다음 세 가지뿐이며, 별도 텔레메트리나 외부 전송은 없다.

1. 도입 기업이 설정한 각 SaaS의 읽기 전용 API
2. (선택) 도입 기업이 연결한 사내 Splunk 검색 REST API
3. (선택) 도입 기업이 API 키를 직접 입력한 AI 제공자 API

---

## 3. 자격증명 및 비밀값 보호

- 배포 저장소에는 어떤 OAuth Client Secret, API 토큰, 개인키(PEM), 테넌트 ID도 포함하지 않는다.
- 수집·정규화 과정에서 API 응답에 포함된 비밀 성격의 최상위 필드는 식별자나 그래프 출력에서 제거한다.
- 대시보드 서버는 기본으로 `127.0.0.1:5199`에만 바인딩된다. 외부 접속(`AEGI_HOST=0.0.0.0`)을 열려면 반드시 `AEGI_PASSWORD`를 설정해야 한다.

---

## 4. 배포 전 자동 안전성 검사

이 저장소는 외부 기업에 제공하기 전 내부 환경 정보나 민감 패턴이 섞이지 않도록 `scripts/check-public-safety.mjs`를 제공한다.

```bash
npm run check:safety
```

검사 항목:
- 내부 운영/시험 전용 디렉터리(`registry`, `environments`, `env-automation`, `adapter-auto-setup`, `test-environment`, `golden-datasets`) 미포함 여부
- 개발자 로컬 PC 절대경로(사용자 홈 디렉터리 경로) 미포함 여부
- 실제 토큰·키 패턴(GitHub PAT, Slack Token, AWS Key, Anthropic Key, PEM Private Key) 미포함 여부
