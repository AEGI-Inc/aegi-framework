# 연결 규칙 읽는 법

이 폴더는 「SaaS 두 개가 이어져 있다는 것을 무엇으로 확인하는가」를 규칙으로 적는다. 특정 회사의 값은 넣지 않는다.

## 어디에 무엇이 있나

```
connection-rules/
├── rules/<쌍>.yaml        규칙. 방법마다 identify(어디서 읽나), points_to(무엇이 같아야 하나)
│   └── legend.yaml        칸과 근거 등급의 뜻
└── docs/
    ├── how-to-read.md     이 문서
    ├── process.md         규칙을 어떻게 만들었나
    ├── methods.md         방법 전체를 한 표로 줄인 것
    └── connection-map.html  쌍을 고르고 방법을 누르면 같아야 하는 값이 뜨는 보기 페이지 (내려받아 브라우저로 연다)
```

SaaS 쌍마다 파일 하나(`okta-github.yaml` 등)이고, SaaS 가 밖의 서버와 이어지는 방법은 `<SaaS>-external.yaml` 에 있다.

## 규칙 하나 읽기: Okta 이벤트 훅

`rules/okta-external.yaml` 에서 `id: event_hook` 을 찾는다.

```yaml
- id: event_hook
  type: event_delivery
  what: "Okta 가 지정 주소로 이벤트를 HTTPS 로 보냄"
  identify: {api: "okta GET /api/v1/eventHooks (okta.eventHooks.read)", when: "훅이 있음"}
  points_to:
  - {tier: config_name, a: "okta event hook 주소 호스트", b: "받는 서버", check: "a 와 b 가 같다", if_unreadable: "Okta 관리 콘솔 Workflow > Event Hooks"}
  - {tier: log_id, a: "받는 서버 요청 기록의 source (…/api/v1/eventHooks/{id}), data.events[].uuid", b: "okta event hook id, okta System Log 이벤트 uuid", check: "a 와 b 가 같다"}
```

- `identify`: 어떤 API 의 어떤 객체가 어떤 조건이면 이 방법인가.
- `points_to`: a 와 b 가 같아야 이어진 것이다. 항목마다 근거의 세기(`tier`)가 붙는다.
- `if_unreadable`: a 나 b 를 API 로 읽을 수 없을 때 확인하는 방법.
- `activity`: 이 연동이 동작하면 남는 감사 로그.
- `sources`: 근거 문서.

## 근거의 세기 (tier)

위가 강하다. 위가 맞아도 아래 근거를 빼지 않는다.

- `config_id`: 한쪽 설정에 상대 ID 가 적혀 있다
- `config_name`: 한쪽 설정에 상대 이름이나 도메인이 적혀 있다
- `fingerprint`: 비밀 값의 해시가 양쪽에서 같다
- `via_person`: 같은 사람의 계정을 거쳐서만 이어진다
- `log_id`: 로그의 ID 가 상대 객체와 같다
- `log_time`: 시각과 대상만 맞는다

## 연결의 종류 (type)

- `identity`: SSO, 프로비저닝, 가져오기, 그룹 동기화
- `app_grant`: 앱 설치, OAuth 승인
- `stored_credential`: 상대 SaaS 의 비밀(토큰, 웹훅 주소, 키)을 보관
- `event_delivery`: 웹훅, 이벤트 전달
- `external_relay`: SaaS 밖의 서버를 거침
- `same_person`: 같은 사람의 계정
- `content_ref`: 내용 속 주소, 링크

## 함께 적은 것

- `note`: 방법이나 항목에 붙는 설명.
- 값을 읽는 방법이 문서에 없으면 「문서에 없다」고 적고, 단정하지 않는다.
