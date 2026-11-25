# 화면 설명 문구 (display-text)

대시보드에 보이는 설명 문구의 **정본**이다. 배포 환경이나 연결 SaaS 가 바뀌어도 코드를 고치지 않도록, 문구를 틀(어느 tenant 에서나 같은 말)과 값(tenant 의 실제 이름)으로 나눈다. 틀은 여기 두고, 값은 게시 때 수집한 객체로 채운다.

| 폴더 | 내용 | 누가 쓰나 |
| --- | --- | --- |
| `types/<provider>.yaml` | SaaS 이름과 역할(`profile`), 객체 종류의 뜻(`types`, 키는 object_type 소문자) | 사람. AI 초안은 검토 뒤 옮긴다 |
| `prompts/*.md` | AI 초안 프롬프트(`type`, `provider`)와 윤문 프롬프트(`polish`) | 사람 |
| `formats/*.json` | AI 출력 형식(JSON 스키마). 초안과 윤문이 같은 형식을 쓴다 | 사람 |

## 문구를 정하는 순서

1. 여기의 검토된 문구(`reviewed`)
2. AI 생성 캐시(`generated`). `.cache/display-text.json`, git 밖
3. 둘 다 없으면 화면이 기계적 대체 문구(객체 종류 이름과 인터페이스)를 쓴다

`npm run publish` 가 이 순서로 합친 `display_text` 문서를 스냅샷(`snap_documents`)에 싣는다. 대시보드는 읽기만 한다.

## AI 생성

```bash
npm run display-text -- --dataset collected/<데이터셋>                 # 무엇이 비었는지만 본다(네트워크 없음)
npm run display-text -- --dataset collected/<데이터셋> --generate      # 빈 것만 AI 로 만들어 캐시에 넣는다
npm run display-text -- --dataset collected/<데이터셋> --review-out <폴더>   # 생성분을 검토용 YAML 로 뽑는다
npm run display-text -- --dataset <폴더> --write                       # 합친 문서를 <폴더>/display_text.json 으로 쓴다(대시보드 로컬 개발, CI 데이터셋)
```

- 한 항목은 두 번 부른다: 초안 프롬프트(`prompts/<종류>.md`)로 만들고, 윤문 프롬프트(`prompts/polish.md`)로 다듬는다. 두 번 모두 `formats/<종류>.json` 형식을 강제한다. 다듬은 결과가 검사(`scripts/displayText/validate.ts`)를 통과해야 캐시에 들어간다.
- AI 입력에는 SaaS 이름, 객체 종류, 필드와 관계 이름만 넣는다. 계정 이름, 이메일, tenant 키, 객체 속성값은 보내지 않는다.
- 캐시 키는 입력과 프롬프트 판의 해시다. 프롬프트 판은 초안 프롬프트, 윤문 프롬프트, 출력 형식 파일의 해시라 셋 중 하나를 고치면 다시 만든다. 모델만 바꾸면 다시 만들지 않는다.
- 키와 모델: `AEGI_DISPLAY_TEXT_API_KEY`, `AEGI_DISPLAY_TEXT_MODEL`, `AEGI_DISPLAY_TEXT_PROVIDER`(`anthropic`, `gemini`, `openai`), `AEGI_DISPLAY_TEXT_BASE_URL`. 비어 있으면 같은 이름의 `AEGI_ASSISTANT_*` 를 쓴다. `.env.local` 에서 읽는다. 크레덴셜 정의는 aegi-knowledge `environments/registry/credentials.yaml` 의 `AI-DISPLAY-TEXT`, 작업은 `jobs.yaml` 의 `display-text-generate` 다.
- 한 번에 부르는 항목 수는 `--limit`(기본 200)으로 제한한다.
- 캐시 파일은 `AEGI_DISPLAY_TEXT_CACHE` 로 옮길 수 있다(데모 배포판처럼 코드 폴더에 쓸 수 없을 때).

## 검토

`--review-out` 이 쓴 YAML 을 읽고 고친 뒤 `types/` 의 같은 파일에 옮겨 PR 한다. 옮긴 항목은 `reviewed` 가 되어 더는 AI 를 부르지 않는다.
