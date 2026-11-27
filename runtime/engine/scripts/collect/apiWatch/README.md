# api-watch: SaaS API 스펙·변경 감시

## 기준선 만들기 및 갱신 규칙

- 기준선(`baseline/<source_id>.json`)은 **Profile·`api-list.jsonl` 을 고친 PR 안에서만** 갱신한다. 감시 실행 중에는 기준선을 자동으로 덮어쓰지 않는다.
- 생성: `npm run api-watch -- baseline --source <id> --file <스펙 파일 또는 폴더 경로> [--out <file>]`

## 명령

- `check`: 최신 스펙(repo/spec_url/doc_page), 변경 공지(changelog), API 지원 버전(live)을 기준선·상태와 비교해 보고서를 만든다.
  - `npm run api-watch -- check [--source <id>...] [--force] [--no-changelog] [--no-live] [--open-issues] [--fail-on-break]`
- `after-collect`: 수집 뒤 `latest/` 가 비어 있거나 7일이 지났으면 `refresh-latest` 를 먼저 돌리고 `collect:diff` 로 직전 run 과 비교한다 (`--open-issues` 시 provider 별 `수집 run 깨짐` 이슈 등록).
  - `npm run api-watch -- after-collect --current <run_id> [--norm-current <dir>] [--norm-previous <dir>] [--open-issues]`
- `refresh-latest`: 바뀜 여부와 상관없이 최신 스펙을 받아 `collected/api-watch/latest/` 표면을 갱신한다.
  - `npm run api-watch -- refresh-latest [--source <id>...]`
- `versions`: `sources.yaml` 의 `pinned`, `sunset`, `live` 항목과 코드 위치, 최신 사용 가능 값을 표로 출력한다.
  - `npm run api-watch -- versions`
- `fixtures`: 지정한 run 의 원본 페이지에서 approved/legacy operation 당 `--per-op` 개 레코드를 비식별 처리해 `scripts/collect/apiWatch/fixtures/` 에 저장한다.
  - `npm run api-watch -- fixtures --run <run_id> [--root collected] [--out scripts/collect/apiWatch/fixtures] [--per-op 2]`

## 고정 예시

- `fixtures` 명령은 비식별 처리한 예시를 저장한 뒤 가짜 raw run 으로 실제 정규화를 한 번 돌려 `fixtures/expected.json` 에 operation·Profile 별 객체 수와 값 있는 필드를 기록한다.
- API 가 바뀌어 예시를 새로 만들면 `expected.json` 도 같이 바뀌고, 그 diff 가 Profile 영향이다. 기대 결과 갱신은 Profile·`api-list` 를 고친 PR 안에서 한다.
- `collect:shadow`: 설정 사본에 `--set` 값을 덮어써 한 provider 만 수집 → 정규화 → 직전 run 과 `collect:diff` 비교한다.
  - `npm run collect:shadow -- --provider <name> --set <config.key>=<값> --label <이름> [--previous-run <run_id>] [--root <dir>]`
- `run-scheduled.sh`: 주기 실행(cron/launchd) 래퍼로, 최신 `main` 을 fast-forward 로 받은 뒤 `check --open-issues` 를 실행하고 최근 보고서 30개만 남긴다.

## 상태·보고서 파일 위치

- 상태 파일: `collected/api-watch/state.json`
- 최신 표면 캐시: `collected/api-watch/latest/<source_id>.json`
- 감시 보고서: `collected/api-watch/report-<YYYYMMDDTHHMMSSZ>.json`
- 수집 후 비교 보고서: `collected/api-watch/run-diff-<run_id>.json`
- 그림자 수집 결과: `collected/shadow/<label>/` (`collector.config.json`, `norm/`, `diff.json`)

## 심각도 뜻

- `break`: operation 삭제, 메서드/경로 변경, 필수 파라미터 추가/전환, 응답 필드 삭제/타입 변경, 고정 버전 지원 종료·만료
- `soon`: operation·응답 필드 deprecated, 문서 알림(deprecated/sunset 등), 고정 버전이 최신보다 6개 이상 뒤처짐, sunset 183일 이내
- `added`: 선택 파라미터 또는 응답 필드 추가
- `info`: 스펙 `version`/`revision` 변경, 오류 코드 추가, 새 API 버전 출시, 변경 공지 일반 항목
