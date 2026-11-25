# candidate-extraction

「오브젝트 후보 추출 설계.md」의 구현. 벤더 자료에서 Object 후보를 결정론으로 뽑는다. Object 판정은 하지 않는다.

```bash
pip install pyyaml openpyxl
python ../../slack_api_list/docs_snapshot_2026-10-12/fetch.py   # 공식 문서 스냅샷 (이미 받았으면 건너뜀)
python normalize_slack.py     # ② Slack 자료 -> out/slack/ir/*.jsonl
python extract.py slack       # ③~⑥ -> out/slack/candidates.jsonl, queue.jsonl, run.json
python compare.py slack       # 기존 57건 대조표(validation/slack_57.yaml) 확인
python judge.py slack         # Object 판정 v0 -> out/slack/judgments.jsonl (features 만 읽음)
python compare.py slack --judge   # 판정 Interface 를 기존 57건과 대조
```

다른 provider:

```bash
python normalize_atlassian.py jira      # confluence, atlassian(조직 층)도 같다. OpenAPI + 감사 활동 + scope + 권한 문서
python normalize_github.py
python normalize_salesforce.py          # Object Reference + 이벤트, CDC, Mobile SDK, REST 안내서 PDF
python extract.py jira && python judge.py jira
python info_map.py jira                 # 정보 지도
```

4개 SaaS 결과 요약은 `out/summary_4saas.md`.

| 파일 | 무엇 |
|---|---|
| `normalize_<provider>.py` | 형식 변환만. provider마다 하나 |
| `slack_docs.py` | docs.slack.dev 서버 렌더링 HTML 파서 (parser@1) |
| `extract.py` | 후보 규칙. provider와 무관 |
| `normalize_okta.py`, `normalize_gws.py` | Okta(OpenAPI YAML, System Log 이벤트 유형), Google Workspace(Discovery 문서, Reports 활동 부록) -> `out/<provider>/ir/` |
| `info_map_index.py` | 정보 지도 첫 쪽 `out/index.html` |
| `normalize_atlassian.py`, `atlassian_docs.py` | Atlassian 자료(Jira, Confluence, 조직) -> `out/<provider>/ir/`. 문서 HTML 은 제목과 표 첫 칸만 읽는다 |
| `normalize_github.py` | GitHub 자료(OpenAPI 경로와 웹훅, 감사 이벤트 목록, App 권한 문서) -> `out/github/ir/` |
| `info_map.py`, `info_map_view.html` | 정보 지도 v0(「정보 지도 설계.md」). `python info_map.py <provider>` (slack, github, jira, confluence, atlassian, salesforce) -> `out/<provider>/info_map.json`, `info_map.html` |
| `lexicons/common.yaml`, `lexicons/<provider>.yaml` | 사람이 정하는 판단 전부. 줄마다 이유를 적는다 |
| `validation/` | 사람이 쓴 대조표 |
| `out/<provider>/report.md` | 실행 결과 |

규칙: 추출기는 `description`을 읽지 않는다. 같은 입력과 같은 사전이면 출력이 바이트 단위로 같다. 판단이 안 서는 것은 `queue.jsonl`로 가고, 대기열은 사전이나 자료를 고쳐서만 닫는다.
