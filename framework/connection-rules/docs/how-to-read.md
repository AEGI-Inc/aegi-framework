# GroundTruth 읽는 법

이 폴더는 「우리 시험 환경에서 SaaS 끼리 어떻게 이어져 있고, 그것을 무엇으로 확인하는가」를 세 층으로 적는다.

1. **인벤토리**: 지금 환경에서 SaaS1 과 SaaS2 가 A 방식으로 이어져 있다. → [`connection-inventory.md`](connection-inventory.md)
2. **규칙**: 일반적으로 A 방식이면 이 값과 저 값이 같아야 한다. → [`../connection-rules/<쌍>.yaml`](../connection-rules/)
3. **정답지**: 이 환경에서 그 값들이 실제로 무엇이었고 같았는가. → [`../test-environment/v3/<쌍>.yaml`](../test-environment/v3/) 의 `checks`

## 어디에 무엇이 있나

```
groundtruth/
├── connection-rules/<쌍>.yaml        규칙. 방법마다 identify(어디서 읽나), points_to(무엇이 같아야 하나)
│   └── legend.yaml                   모든 칸의 뜻
├── test-environment/v3/<쌍>.yaml      정답지. 이 환경에서 잰 연결(instances)과 checks
│   └── chains.yaml                   여러 SaaS 를 건너는 경로
├── docs/
│   ├── how-to-read.md                이 문서
│   ├── connection-inventory.md/.csv  인벤토리 (생성물)
│   └── connection-viewer.html        쌍을 고르고 연동을 누르면 checks 가 뜨는 보기 페이지 (내려받아 브라우저로 연다)
└── environments/                     회차별 환경 명세 (테넌트, 계정)
```

`test-environment/<쌍>.yaml`(v3 밖)은 2026-10-05 g2 환경의 예전 결과다.

## 예: Okta 이벤트 훅 하나를 따라가기

**1. 인벤토리** 에서 `okta-external` 표의 `v3-okta-event-hook` 행을 본다. 방법은 `event_hook`, 판정은 연결됨, 정답지 확인은 「같음 4」다.

**2. 규칙** `connection-rules/okta-external.yaml` 에서 `id: event_hook` 을 찾는다.

```yaml
identify:
  api: okta GET /api/v1/eventHooks
points_to:
  - tier: config_name     # 항목 1
    a: okta event hook 주소 호스트
    b: 받는 서버
  - tier: log_id          # 항목 2
    a: 받는 서버 요청 기록의 source (…/api/v1/eventHooks/{id}), data.events[].uuid
    b: okta event hook id, okta System Log 이벤트 uuid
```

**3. 정답지** `test-environment/v3/okta-external.yaml` 에서 `id: v3-okta-event-hook` 의 `checks` 를 본다. `point` 가 규칙 항목 번호다.

```yaml
checks:
- point: 2
  a: {api: 없음, field: Workflows 실행 입력 source, value: …/api/v1/eventHooks/who1901w0adip5RYs698, raw: cm.md CM-04 ⑥}
  b: {api: okta GET /api/v1/eventHooks, field: "[].id", value: who1901w0adip5RYs698, raw: …/okta/eventHooks.json}
  result: 같음
- point: null             # 규칙에 없는 근거 (규칙에 넣을 후보)
  a: {api: okta GET /api/v1/logs, field: debugContext.debugData.targetEventHookIds, value: who1901w0adip5RYs698}
  b: {api: okta GET /api/v1/eventHooks, field: "[].id", value: who1901w0adip5RYs698}
  result: 같음
```

이렇게 「어느 API 응답의 어느 필드에 어떤 값이 있어서 둘이 같았는가」가 항목마다 남는다.

## checks 칸

- `point`: 규칙 `points_to` 의 몇 번째 항목인가(1부터). 연결에 방법이 둘이면 첫 방법의 번호다. `null` 은 규칙에 없지만 이 환경에서 찾은 근거로, 규칙에 넣을 후보다.
- `a`, `b`: 규칙의 a·b 와 같은 쪽. `api` 는 부르는 API(또는 감사 이벤트). API 가 없고 화면·실행 기록으로 봤으면 `없음` 이다. `field` 는 응답 안 필드 경로, `value` 는 이 환경의 실제 값, `raw` 는 그 값을 확인한 원본 파일이다.
- `result`
  - **같음**: 양쪽 값이 맞았다
  - **다름**: 값이 어긋났다. `note` 에 까닭이 있다 (예: Jira 쪽에 1회차 워크스페이스만 연결됨)
  - **못 읽음**: 한쪽을 API 로 읽을 수 없다. 비밀 값이거나, 조회 API 가 없어 화면으로만 볼 수 있다
  - **원본 없음**: 읽을 수는 있지만 모은 원본에 그 값이 없다. 다음 수집 때 채운다
  - **해당 없음**: 이 연결에는 맞지 않는 항목이다 (예: 만들지 않은 방향)

`raw` 의 `aegi-adapter-engine …`, `dev/…` 경로는 GroundTruth 작업 PC 의 로컬 원본이라 저장소에는 없다.

## 함께 적은 것

- `identify`: 이 연결을 설정값만 보고 아는지(1단계), 설정과 로그를 함께 봐야 아는지(2단계), 로그가 있어야 아는지(3단계), 로그로도 안 되고 실행 기록·글 본문이 있어야 아는지(4단계).
- `history`: 기간에 따라 값이 달랐던 연결의 값과 기간. 테넌트 단위 기간은 파일 맨 위 `data_sources.tenant_history` 에 있다.
- `chains.yaml`: 쌍 연결을 이은 경로. 단계마다 누구 권한으로 돌았는지, 단계 사이에 넘어간 값을 적었다.

## 지금 상태 (2026-10-29)

- checks 는 현재 환경 연결 70건에 있다. 218개 중 같음 123, 원본 없음 60, 못 읽음 21, 해당 없음 9, 다름 5 다.
- 이전 회차 연결 71건에는 checks 가 없다.
- checks 를 채우다 찾은 근거 9개를 규칙 points_to 끝에 더했고, 규칙 항목 12곳의 칸을 실제 응답에 맞게 고쳤다. 이 항목들은 `note` 에 「시험 환경 응답에서 확인」이라고 적혀 있다.
- 회차가 바뀌며 값이 바뀐 것(예: 같은 Atlassian 토큰의 계정 이메일이 aegi.site 에서 aegi.men 으로)은 checks 가 아니라 `history` 에 기간과 함께 적는다.
