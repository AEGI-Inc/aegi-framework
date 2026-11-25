# aegi-solution 압축파일과 aegi-framework의 차이

`aegi-solution-0.1.0.zip`은 **SaaS 6개를 수집하는 이전 판**이다. 이 저장소(aegi-framework)의 `runtime/`은 그 뒤에 나온 **SaaS 9개 판**이고, 방법론·규격 문서까지 함께 들어 있다. 두 가지를 모두 받았다면 이 저장소를 기준으로 본다.

## 압축파일에 들어 있는 것

| 항목 | 내용 |
| --- | --- |
| 파일 | `aegi-solution-0.1.0.zip` (풀면 `aegi-solution-0.1.0/` 폴더) |
| 만든 때 | 2026-11-25 |
| SHA-256 | `05f9cc424fa7abba1d0412814339d13177733ac36ae0d7c9e6ac03944ce72469` |
| 원본 | aegi-solution 커밋 `eff8a6f` |
| 수집 SaaS (6개) | Okta, Google Workspace, GitHub, Slack, Salesforce, Atlassian(Jira·Confluence) |
| 넣지 않은 SaaS | Microsoft 365, Google Cloud(Gemini Enterprise), 1Password, Snowflake, AWS |
| 실행 | Node.js 22.13 이상만 있으면 바로 실행된다(`start.cmd`, `start.sh`). 패키지 설치가 필요 없다 |
| 들어 있는 문서 | 압축파일 안 `README.md`(설치·실행·Splunk 연결)와 `docs/`(SaaS별 연동·권한 안내) |

## aegi-framework와 같은 것

- 엔진, 대시보드, IM 모델(V3.2) 코드는 같은 커밋이다. `runtime/vendor/VERSIONS.json`과 압축파일의 `vendor/VERSIONS.json`이 같다.
- 정규화, 위협 판정, 컴플라이언스 판정, Splunk 연결, AI 질문은 같게 동작한다.
- 메뉴 구성은 같다(Overview, Cross-SaaS Graph, Explorer, Threat, Event Board, Compliance, Adapters, Manual).

## 다른 것

| 항목 | aegi-solution 압축파일 | aegi-framework |
| --- | --- | --- |
| 수집 SaaS | 6개 | 9개 (6개 + Microsoft 365, Google Cloud(Gemini Enterprise), 1Password) |
| Adapters 화면의 SaaS 목록 | 6개 | 9개 |
| `.env.example` | 6개 SaaS 항목 | 9개 SaaS 항목 |
| 실행 준비 | 풀고 바로 실행 | clone 뒤 첫 실행에서 패키지 설치(`npm install --omit=dev`) |
| 재수집·정기 실행 안내 | 없음 | [런타임 안내의 「다시 수집하기」](../../runtime/README.md#5-다시-수집하기) |
| 방법론·규격 | 없음 | `docs/`, `framework/`(온톨로지, 연결 규칙, 위협 매핑, 컴플라이언스), `specs/` |
| 내부 개발용 자료 | 일부 남아 있음 | 지움 |

## 어느 쪽을 쓰나

- 새로 도입하면 aegi-framework의 `runtime/`을 쓴다. 설치와 실행은 [런타임 안내](../../runtime/README.md)를 따른다.
- 압축파일을 이미 설치해 6개 SaaS만 쓰고 있다면 그대로 써도 된다. 9개 SaaS가 필요하면 aegi-framework로 옮긴다.
- 압축파일의 `data/`를 aegi-framework `runtime/data/`로 옮겨 쓰는 경우는 시험하지 않았다. 옮길 때는 `.env`만 가져오고 수집을 새로 실행한다.
