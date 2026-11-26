# Cross-SaaS 연결 확인 규칙 읽는 법

이 폴더(`framework/connection-rules/`)는 **서로 다른 두 SaaS(또는 외부 서버)가 실제로 연동되어 있는지 어떤 API와 필드로 확인하는가**를 특정 기업 데이터 없이 범용 규칙(YAML)으로 정리한다.

## 폴더 구성

```text
framework/connection-rules/
├── rules/
│   ├── <saasA>-<saasB>.yaml   # SaaS 쌍별 연결 확인 규칙 (총 21개 쌍, 260개 방법)
│   └── legend.yaml            # 규칙 YAML의 모든 필드(tier, identify, activity 등) 정의
└── docs/
    ├── how-to-read.md         # 이 문서 (규칙 읽는 법)
    ├── methods.md             # 260개 연결 방법 전체 요약표
    ├── connection-map.html    # 브라우저로 여는 인터랙티브 연결 지도
    └── process.md             # 초기 규칙 작성 과정 기록 (2026-10)
```

> 특정 기업·시험 환경의 실측 인스턴스, 테넌트 계정, 원본 수집 파일은 외부 공개 안전성을 위해 이 저장소에 포함하지 않는다.

## 규칙 하나 읽는 법 (예: Okta 이벤트 훅)

[`../rules/okta-external.yaml`](../rules/okta-external.yaml)에서 `id: event_hook` 항목을 보면 다음과 같은 구조를 따른다.

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

각 필드의 의미는 다음과 같다(전체 정의는 [`../rules/legend.yaml`](../rules/legend.yaml) 참고).

| 필드 | 의미 |
| --- | --- |
| `id` | 해당 SaaS 쌍 안에서 연결 방법을 구분하는 식별자 |
| `identify` | 이 연동이 존재하는지 확인할 때 호출하는 API(또는 감사 로그·관리 화면)와 조건 |
| `points_to` | 양쪽 SaaS(`a`, `b`)에서 **어떤 값이 일치하면 같은 연결로 판정하는가**의 목록. 근거가 센 순서부터 약한 순서까지 모두 적는다 |
| `tier` | 근거 강도 등급: `config_id`(설정 ID 직접 일치) > `config_name`(이름·호스트 일치) > `fingerprint`(키·인증서 지문) > `via_person`(동일인 경유) > `log_id`(로그 ID 일치) > `log_time`(시각 근접) |
| `activity` | 연동이 실제로 동작했을 때 남는 감사 로그 이벤트와 확인 필드 |
| `sources` | 근거가 된 벤더 공식 문서 주소 |

## 근거 강도(`tier`)를 여러 개 적는 이유

기업마다 부여할 수 있는 API 읽기 권한과 SaaS 요금제가 다르다. 설정 API에서 상대 ID(`config_id`)를 바로 읽을 수 있는 환경이 가장 확실하지만, 설정 조회 권한이 없는 환경에서는 감사 로그(`log_id`, `log_time`)나 이름(`config_name`)으로 연결을 추정해야 한다. 따라서 센 근거가 있더라도 약한 근거를 생략하지 않고 함께 기록한다.

## 관련 문서

- 전체 260개 연결 방법 요약표: [methods.md](methods.md)
- 인터랙티브 연결 지도(브라우저로 열기): [connection-map.html](connection-map.html)
- 초기 규칙 작성 과정 기록: [process.md](process.md)
