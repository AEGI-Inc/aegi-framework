# 기준별 설정 판정 (scripts/standards)

공개 보안 기준 하나를 단위로, 그 기준의 항목 전부를 수집 원본으로 판정한다. 결과 `standard_results.json` 은 대시보드(aegi-dashboard-new `src/config-findings/standardResultsStore.ts`)가 D1 판정 이력의 최신 판정으로 읽어 컴플라이언스 화면 등에서 쓴다.

## 실행

```bash
python scripts/standards/run_all.py --raw collected/raw/<run> --dataset <데이터셋 폴더> [--settings-raw <설정 수집 run>] [--out <출력 폴더>]
```

- `--raw`: 수집 원본 run 폴더. `collected/runs/<run>.json` 이 같은 수집 폴더에 있어야 한다(`AEGI_STD_RUN_RECORD` 로 바꿀 수 있다). `build_standard_results.py` 가 이 실행 기록(`--settings-raw` 가 있으면 그 run 기록도)을 읽어, 대상 0개라 pass 인 항목이 기대는 호출(`rule.source` 의 호출 ID)이 full 이 아니면(partial·failed·skipped·기록 없음) `not_collected` 로 바꾼다. 기준별 판정 파일(`<기준>.json`)은 그대로다.
- `--dataset`: 정규화 데이터셋 폴더. `objects.json` 의 `fixture_key` 로 걸린 대상이 그래프에 있는지(`in_graph`)만 본다.
- `--settings-raw`: GHS-01~03(GitHub Actions 권한·기본 브랜치 적용 규칙), SFS-01(Salesforce Health Check) 를 담은 run. 없으면 `--raw` 에서 찾고, 파일이 없으면 그 항목은 `not_collected` 다.
- `--out`: 기본 `scripts/standards/out/`(git 제외). 기준마다 `<기준>.json` 과 묶은 `standard_results.json` 을 쓴다. 결과에는 테넌트 값(이름·ID)이 들어간다.

수집 run에 어떤 SaaS의 원본이 하나도 없으면 그 SaaS 판정기는 실행하지 않고 `not_applicable: true`, 빈 `items` 결과를 쓴다. 이 결과는 묶음의 `standards`에 넣지 않는다. 원본이 있는데 판정기가 실패하면 `standard_results.json`은 성공한 기준만으로 만들고 `failed_detectors`에 판정기 이름을 남긴 뒤 `run_all.py`는 0 이외 코드로 끝난다. 따라서 해당 없음과 판정 실패는 서로 바꾸어 보이지 않는다.

Python 3 표준 라이브러리만 쓴다(3.12 에서 확인).

## 수집과 게시

GHS-01~03(GitHub Actions 권한, 기본 브랜치 규칙)과 SFS-01(Salesforce Health Check)은 수집기에 있는 호출이다. GHS-03 은 저장소 목록이 필요해 GH-05 와 같은 run 에서 돌린다.

```bash
npm run collect:local -- --kv --only github,salesforce --calls GH-05,GHS-01,GHS-02,GHS-03,SFS-01 --no-api-list
```

판정이 끝난 `standard_results.json`은 그래프와 독립된 D1 `standard_runs` 이력에 보관하고 `standard_head`가 현재 결과를 가리킨다. 그래프 게시와 과거 스냅샷 정리는 이 이력을 변경하지 않는다. 운영은 사람이 요청한 경우 게시한다. `--source-snapshot`은 판정 당시 그래프 ID이며, 생략하면 출처 미상(null)으로 남긴다. 과거 결과를 다시 현재로 지정하려면 같은 파일과 같은 출처로 게시한다.

```bash
npm run standards:publish -- --env production --file scripts/standards/out/standard_results.json --source-snapshot <판정에 사용한 그래프 ID>
```


## 기준

공식 기준은 `source_tier` 1(표준기관·정부), 2(SaaS 벤더 공식)만 둔다. 아래 AEGI 자체 점검은 3 이다.

| 파일 | 기준 |
|---|---|
| `okta_stig.py` | DISA Okta IDaaS STIG V1R2 |
| `okta_healthinsight.py` | Okta HealthInsight |
| `cis_gws.py` | CIS Google Workspace Foundations Benchmark 1.4.0 |
| `scuba_gws.py` | CISA SCuBA Google Workspace Baseline 0.6 |
| `gws_checklist_medium_large.py`, `gws_checklist_small.py`, `gws_checklists_both.py`, `gws_security_health.py` | Google Workspace 보안 체크리스트·보안 상태 페이지 |
| `cis_github.py` | CIS GitHub Benchmark 1.2.0 |
| `github_docs_data_leaks.py` | GitHub Docs 데이터 유출 방지 모범 사례 |
| `sf_healthcheck.py` | Salesforce Health Check 기본 기준선 |
| `gsa_cio_it_11_62.py` | GSA CIO-IT Security-11-62 Rev 3 (Salesforce) |
| `slack_help.py` | Slack Help 보안 팁 |
| `atlassian_support.py` | Atlassian Support 조직 보안 |

GWS 기준은 `gws_common.py` 를 같이 쓴다(적용 정책 고르기, 결과 항목 만들기).

### AEGI 자체 점검 (source_tier 3)

공개 기준에 데이터로 판정하는 항목이 없는 계정 수명주기와 기기 상태를 같은 형식으로 판정한다. 공식 기준이 아니라 `source_tier` 3 으로 두고, finding id 는 `<SaaS>-9xx` 를 쓴다. 공통 코드는 `aegi_common.py`.

| 파일 | 점검 |
|---|---|
| `aegi_gws.py` | 90일 넘게 로그인하지 않은 활성 사용자(gws-901), Okta 에서 정지된 사용자의 활성 Google 계정(gws-902), 암호화되지 않은 기기(gws-903), 화면 잠금 비밀번호 없는 기기(gws-904), 관리 승인되지 않은 기기(gws-905) |
| `aegi_okta.py` | 90일 넘게 로그인하지 않은 활성 사용자(okta-901), Google Workspace 에서 정지된 사용자의 활성 Okta 계정(okta-902) |
| `aegi_salesforce.py` | 90일 넘게 로그인하지 않은 사람 사용자(salesforce-901), IdP 에서 정지된 사용자의 활성 Salesforce 계정(salesforce-902) |
| `aegi_slack.py` | IdP 에서 정지된 사용자의 활성 Slack 계정(slack-901). Slack 원본에는 마지막 로그인 시각이 없다 |

- 기간 기준은 90일이고 `AEGI_STD_INACTIVE_DAYS` 로 바꾼다. 기준 시각은 원본 수집 시각이라 같은 원본이면 결과가 같다. 로그인한 적 없는 계정은 만든 시각으로 본다.
- 동일인은 같은 이메일(소문자)로 잇는다. Atlassian 사용자 원본(JI-02)에는 이메일이 없어 보지 않는다.
- 기기는 GWS Cloud Identity 원본(`RG-GW-cloudidentity.devices.*`)을 읽는다. 기기에 관리 에이전트가 없으면 상태 값이 비어 판정 불가(unknown)다. 원본이 없으면 미수집이다(도메인 위임 scope `cloud-identity.devices` 필요).
- 시험: `python3 -m unittest scripts/standards/aegi_checks_test.py`(합성 원본).

### AEGI 관계 점검 (source_tier 3)

정규화 데이터셋과 범용 접근 엔진 간선(EdgeIndex)을 읽어 컴플라이언스 관계 점검 패턴 R1~R7 및 사람 확인 항목을 SaaS별로 판정한다. 패턴 정의 위치는 aegi-knowledge의 `compliance/scope/catalog-mapping/checks/relation-rules.yaml`이고 finding id는 `<SaaS>-951`~`958`이다.

```bash
node --import tsx scripts/standards/relation_checks.ts --dataset <데이터셋 폴더> --knowledge <catalog-mapping 폴더> --out <출력 폴더> --raw-run <이름>
```

`run_all.py`에 `--knowledge`가 있으면 파이썬 판정기 뒤에 실행되어 `aegi_relations_<provider>.json` 6개를 만들고 `standard_results.json`에 합친다.

대상이 0개라 pass(「대상 없음」)가 되는 항목은 데이터셋 `coverage.json` 으로 정말 없는지 본다(`emptyTargetsReason`). 설정 규칙은 대상 종류를 받는 수집 호출이 모두 full 일 때만 pass 로 두고, 호출이 full 이 아니거나 표에 없는 종류면 `not_collected` 다. 종류 → 호출 표는 `scripts/collect/profile-binding/` 에서 읽는다(`loadProfileTypeCalls`): `bindings.jsonl` 의 `collected_*` 줄의 `call`, 그 줄 `file` 의 overlay 와 `new-*` overlay 의 object 규칙 원본 호출. jira·confluence 는 atlassian 으로 접고 존재 확인 호출(`*-90`)은 뺀다. 대상 종류를 하나로 정하지 않는 R1~R7 은 그 SaaS 의 호출이 모두 full 일 때만 pass 다. 볼 종류가 정해지지 않은 958 은 그대로 둔다.

관계로 판정되지 않는 설정 객체(정책, 인증 수단, 허용 목록, 브랜치 설정)는 같은 규칙 파일의 `setting_rules`(S1~S9, finding `<SaaS>-961`~`969`, item_id `AEGI-SET-*`)로 객체 속성 값을 판정해 각 SaaS 결과의 `items` 끝에 더한다.

## 판정 결과

항목마다 `status` 는 `pass`, `fail`, `unknown`(값은 있으나 기준 조건으로 해석 못 함), `not_collected`(필요한 호출·값이 수집에 없음), `org_policy`(조직이 정한 값이 있어야 판정됨), `manual`(값으로 위반이 정해지지 않음) 중 하나다. `rule` 에 읽은 호출·필드·조건·합친 방법을, `targets` 에 걸린 대상 객체 키와 값을, `note` 에 해석 근거를 적는다.

판정은 정규화 객체가 아니라 수집 원본(`collected/raw/<run>/<provider>/<CALL>-*.json`)을 읽는다. 일부 `note` 는 2026-10-27 run(`20261027T050939Z-4ecf`)에서 본 값을 적은 것이라 다른 run 에서는 맞지 않을 수 있다.


## 컴플라이언스 항목 판정

SaaS 설정 점검(`standard_results.json` 의 `findings`)과 `catalog-mapping` 폴더의 연결을 대조해 컴플라이언스 기준별 항목(ISMS-P, ISO 27001, PIPA)의 판정을 계산한다.

- 입력: `standard_results.json`, knowledge `catalog-mapping`(items-clean/item-tiers.jsonl, items-clean/saas-items.jsonl, checks/item-findings.jsonl). item-tiers 에서 tier 가 `auto`, `evidence` 인 항목만 대상이다.
- 판정 규칙: 각 항목에 연결된 finding 의 `items[]`(기준 항목) 중 `not_collected`(미수집)를 제외한 판정 건수를 센다. 판정이 모두 `not_collected` 인 finding 은 항목의 `findings`, `fail_findings` 에 넣지 않는다.
  1. 판정 건이 0 이면 `no_check`
  2. fail 이 1건 이상이면 `fail`
  3. 모든 건이 pass 면 `pass`
  4. pass 가 1건 이상이면 `partial`
  5. unknown 이 0건이고 manual 또는 org_policy 가 1건 이상이면 `manual`
  6. 그 밖에는 `unknown`
- 출력 칸: `standard_results.json` 맨 위 `compliance` 칸(`knowledge_commit`, `rule`, `items` 배열, `fixes` 배열, `no_result_count`). 각 항목에 `key`, `framework`, `id`, `tier`, `status`, `counts`, `fail_findings`, `findings`, `no_result_findings` 가 실린다.
- 연결됐지만 점검 결과 없음: 항목에 연결된 finding 이 `standard_results.json` 의 `findings` 에 아예 없으면(그 판정기가 이 묶음에서 안 돌았거나, 돌았지만 그 기준 항목을 내지 않음) 판정 셈에서 빼고 항목의 `no_result_findings` 에 남긴다. `no_result_count` 는 그 항목 수, 연결 수, finding 수이고, 하나라도 있으면 stderr 에 경고를 찍는다. 판정 값은 바꾸지 않는다. 결과는 있으나 모두 `not_collected` 인 finding 은 여기에 넣지 않는다.
- 조치 순서: `compliance.fixes` 배열에 위반 건이 있는 점검마다 `{ finding, items, fail_targets, score }` 를 score 내림차순(점수 같으면 finding id 순)으로 싣는다. 점수는 연결된 범위 안 항목 수와 위반 대상 수의 곱(len(items) * max(1, fail_targets))이다.

## 설정 점검 조치

컴플라이언스 범위 안 점검 435개에 대한 권장 조치 데이터는 `scripts/standards/defs/remediations_all.json` 에 정의한다.

- 형식: 배열에 `finding_id`, `summary`(조치 요약), `where`(관리 콘솔 경로), `api`(수집 호출), `change`(`setting`, `recommended`), `steps`(단계 목록), `impact`(영향), `verify`(확인 방법), `references`(`source`, `item`, `url`), `review`(검토 상태)를 싣는다.
- 규칙: `recommended` 는 점검 문턱값(threshold)과 일치해야 한다. 공식 문서에서 설정 위치가 명확하지 않거나 사람이 수행하는 절차는 `where` 를 빈 문자열로, `steps` 를 `["공식 문서에서 이 설정 위치 확인 필요"]` 로 두고 `review` 를 `"근거 부족"` 으로 남긴다. 위치와 단계가 명확한 항목은 `review` 를 `"검토 전"` 으로 둔다. 「검토 전」은 공식 문서를 근거로 쓴 AI 초안이고 사람이 아직 확인하지 않았다는 뜻이다. CIS 원문 문장은 옮기지 않고 요약과 항목 번호만 쓴다. 문장에는 가운뎃점을 쓰지 않고 명사형이나 간결한 문장으로 끝맺는다.
- 실행법:
  - 직접: `python scripts/standards/build_compliance_verdicts.py --results <standard_results.json> --knowledge <catalog-mapping 폴더>`
  - 묶음: `run_all.py` 에 `--knowledge <catalog-mapping 폴더>` 를 전달하면 판정 묶음 생성 뒤 자동으로 계산해 파일에 싣는다.
  - 재연결: python scripts/standards/relink_findings.py --results <standard_results.json> (defs 추가 전 생성된 standard_results.json 의 미매핑 finding id 를 새 defs 에 맞추어 재연결)

## defs/

- `standards_items_all.json`: 기준 항목(기준, 등급, 항목 ID, 제목, 묶을 finding 문장, 문턱값, 쓰는 API, 원문 열람 기록)
- `findings_unique_all.json`: 기준 항목을 같은 뜻끼리 묶은 finding 과 그 출처 항목
- `kinds_bottomup.json`: finding 분류(층, 묶음, 종류)
- `prowler_titles.json`: CIS GitHub 1.2.0, CIS GWS 1.4.0, DISA Okta STIG V1R2, CISA SCuBA GWS 0.6 요구사항 설명. Prowler(Apache-2.0) `prowler/compliance/` 의 JSON(커밋 `61d2cc55`)에서 `Requirements[].Id`, `Description` 만 뽑았다.
