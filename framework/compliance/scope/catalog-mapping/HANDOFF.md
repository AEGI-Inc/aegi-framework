# 카탈로그 종류 ↔ 컴플라이언스 항목 매핑 인계 (2026-11-09)

> 11-11 인계(멘토 회의 뒤 방향 전환, ISO 범위 확정)는 [HANDOFF-2026-11-11.md](HANDOFF-2026-11-11.md)에 있다. 그 뒤 결정(11-15~11-17)은 이 문서 「남은 일」에 이어 적었으므로 최신 내용은 이 문서다. 처음 부분은 11-09 매핑 작업의 기록이다.

다른 서버에서 이어서 작업할 때 이 문서부터 읽는다. 이 폴더가 작업 정본이다(로컬 `bob/aegi/archive/compliance-scope-20261108/` 는 옛 작업 공간).

## 요약

- 방향(11-09 사용자 결정): 실제 객체(인스턴스)마다 판정하던 방식을 「카탈로그 객체 종류 ↔ 항목」 매핑으로 바꾼다. 새 테넌트에서 다시 판정하지 않기 위해서다.
- 지금 결과: `items-clean/item-type-scope.jsonl` 24,959쌍(167항목 × 1,298종). confirmed 16,797(Jev p ≥ 0.6), ambiguous 8,162(0.4~0.6).
- 만든 순서
  1. 항목 다시 판정(S1R): ISO·ISMS-P·PIPA 를 원문으로 다시 봐서 SaaS 에 적용되는 167개만 남김
  2. 태그 사전 31개: 167개 항목을 모두 표현하는 최소 집합. 태그 하나의 어휘를 항목과 종류 양쪽에 붙인다
  3. 항목 → 태그(Claude), 종류 → 태그(Jev, 카탈로그 profile 1,976종 + 관측 종류)
  4. 태그가 겹치는 (항목, 종류) 34,829쌍을 후보로, 쌍마다 Jev 판정 → 0.4 미만 버림
- 사람 판정(11-08 묶음 판정, 167항목 범위 안 246묶음)과 비교: 사람 「해당」 167묶음 중 135개(81%)가 최종에 남는다. 남긴 것 중 사람도 해당이라 한 비율 70%. 이 묶음들은 원래 애매해서 사람에게 간 것이라 Jev 도 잘 못 가른다.

## 결정 사항 (사용자, 11-09)

- 용어: 「허용 태그/종류 태그」라 하지 않고 그냥 「태그」. 붙는 곳만 다르다.
- API 로 수집할 수 없는 정보(제공자 내부 구현, 데이터 출처 같은 회사 사실)만으로 정해지는 항목은 뺀다. 그래서 PIPA 안전성 확보조치 기준 제7조①, 「한국으로 이전된 개인정보 처리 보완규정」(EU 적정성)을 뺐다.
- 종류 태그는 카탈로그 전체를 Jev 로 붙인다.
- SaaS 별 손 규칙(하드코딩)은 쓰지 않는다. 같은 종류 안에서 갈리는 것(gws Policy 설정 이름, 역할의 관리자 여부)은 Jev 판정을 표로 기록해 쓴다(아래 남은 일 2).
- (항목, 종류) 쌍은 모두 Jev 로 검토해 확정한다. ambiguous 는 나중 과제로 남긴다.
- 자산 목록·분류 항목(ISMS-P 1.2.1-01~03, 1.2.2-02·03, ISO 5.9·5.12·5.34)의 `data_resource` 는 종류(테이블) 단위 대상(`@type=data_resource`). ISMS-P 안내서가 데이터 자산을 DB·테이블 단위로 목록화하라고 한다. 1.2.1 에서 account 는 뺐다.

## 파일

| 경로 | 내용 |
|---|---|
| `docs/compliance-items-saas-20261109.md` | SaaS 적용 항목 167개 목록(기준별, 판정 사유) |
| `docs/compliance-tags-20261109.md` | 태그 사전 31개, 항목별 태그, 옛 41개에서 바뀐 것 |
| `items-clean/{iso27001,isms-p,pipa}.items.jsonl` | S1R 판정 전체(제외 포함, 사유). ISO 는 우리말 요약만 있고 원문은 없다 |
| `items-clean/saas-items.jsonl` | 남긴 167개 |
| `items-clean/tags.json`, `item-tags.v2.tsv` | 태그 사전, 항목 → 태그. `build_tags.cjs` 가 만든다(태그 쌍마다 한 항목 이상에서 갈리는지 검사) |
| `items-clean/item-statements-en.tsv` | Jev 질문에 쓰는 항목별 영어 문장 |
| `items-clean/observed-types.jsonl` | 운영 스냅샷(20261104T172000Z-705786fd-6a5194)에서 관측된 객체 종류 196개(종류와 인터페이스, 개수만) |
| `items-clean/type-decisions.draft.jsonl` | 11-08 인스턴스 판정을 (항목, 종류) 묶음으로 모은 것. 비교 정답으로 쓴다 |
| `items-clean/item-type-map.jsonl` | 태그 겹침 후보 34,829쌍(`join_check.cjs`) |
| `items-clean/item-type-scope.jsonl` | **최종 매핑**(`type-tags/build_scope.cjs`). 칸: item_key, type_key, status, p, via(이어 준 태그), unit(object/type) |
| `type-tags/types-v2.jsonl` | 카탈로그 profile 1,976종의 Jev 설명(state) |
| `type-tags/type-tag-scores.jsonl`, `-v2.jsonl`, `mid-v3-scores.jsonl` | 종류 × 태그 Jev 점수(1차, 2차, 3차) |
| `type-tags/type-tags.jsonl` | **종류 → 태그 확정본**(`build_type_tags.cjs`). 태그마다 출처(rule, rule-name, rule-fix, jev-v2, jev-v2mid+v1, umbrella) |
| `type-tags/pair-scores.jsonl` | (항목, 종류) 쌍 Jev 점수 |
| `items-clean/prev/` | 옛 규칙 `kind-tags.json`(`type-tags/*.cjs`가 읽음). 같은 바이트 사본이던 11-08 S1 결과 `*.scope.jsonl`과 `item-tags.tsv`는 지웠다. 현행은 `../*.scope.jsonl`, `../rules/item-tags.tsv` |
| `checks/threat-categories.jsonl` | **위협 종류 → 항목**(11-11, Claude 판정). 엔진 위협 finding 의 category 7종(data_exposure, bypass, escalation, shared_credential, mail_exfil, delegation, attribute)마다 위반 사례가 되는 항목과 사유. 접근 격차는 bypass 위협으로 나온다. 11-17 삭제: 위협 판정 V2 위협에는 category 가 없어 대시보드 「관련 위협」이 늘 비었고, 대시보드가 이 연결을 지웠다. 마지막 내용은 4042c56 |
| `items-clean/iso-scope-1111.jsonl` | ISO 27001 통제별 확정 결정(11-11, 포함 19, 제외 22)과 사유. item-tiers 의 ISO 행에 반영됨 |
| `items-clean/scope-review-1111.jsonl` | ISMS-P 2번, PIPA 안전성 확보조치 기준의 항목별 확정 결정(11-11, Claude 판정)과 사유 |
| `items-clean/scope-review-1115.jsonl` | 미점검 (항목, 종류) 쌍 검토(11-15, Claude 판정: drop 85, narrow 2)와 사유 |
| `items-clean/apply_review_1115.py` | `scope-review-1115.jsonl` 을 `item-type-scope.jsonl` 에 반영하는 스크립트 |
| `items-clean/scope-final.jsonl`, `docs/compliance-scope-final-20261111.md` | **모든 항목의 제외 단계와 사유**(문서 단위, SaaS 적용, 멘토 범위, 본뜻 판정, 범위 안). `items-clean/apply_scope_1111.py` 가 item-tiers 반영과 함께 만든다 |
| `items-clean/item-tiers.jsonl` | **항목 등급**(11-11, Claude 판정). 칸: item_key, tier(auto 자동 판정, evidence 근거 제공, exclude 제외), reason, checks(연결 점검 수), prev_decision. 기준: 우리 데이터로 위반, 충족을 말할 수 있으면 auto, 대상 객체 목록이 의미 있으면 evidence, 동의, 법적 근거, 계약, 가명처리, 시험 데이터, 분리 보관, 제공자 내부 구현처럼 SaaS 데이터로 보여 줄 것이 없으면 exclude. 167개 중 auto 81, evidence 29, exclude 57 |
| `value-tags/values.jsonl` | 값으로 태그가 갈리는 (종류, 필드)의 값 목록과 하위 키 경로(값 내용 없음). `jev_value_tags.mjs values` 가 만든다 |
| `value-tags/value-tag-scores.jsonl`, `value-tags.jsonl` | 값 × 태그 Jev 점수, **값 → 태그 표**(칸: type_key, field, value, tags, extra, p) |

## 다시 돌리는 법

필요한 것: node 20+, engine checkout(`yaml` 패키지와 `scripts/collect/profile-binding/profiles`), Jev 키.

```bash
export AEGI_ENGINE_DIR=/path/to/aegi-adapter-engine   # npm install 이 되어 있어야 yaml 을 읽는다
export TYPESAFE_API_KEY=...                            # 또는 JEV_KEY_FILE=<TYPESAFE_API_KEY= 줄이 있는 파일>
cd compliance/scope/catalog-mapping
node items-clean/build_tags.cjs                # 항목 태그, 사전, docs/compliance-tags 문서
node type-tags/jev_type_tags.mjs plan && node type-tags/jev_type_tags.mjs send && node type-tags/jev_type_tags.mjs scores        # 1차(종류 × 태그)
node type-tags/jev_type_tags_v2.mjs plan && node type-tags/jev_type_tags_v2.mjs send && node type-tags/jev_type_tags_v2.mjs scores  # 2차
node type-tags/build_draft.cjs && node type-tags/build_type_tags.cjs   # 종류 태그 확정본
node items-clean/join_check.cjs                # 후보 쌍과 옛 판정 비교
node type-tags/jev_pairs.mjs plan && node type-tags/jev_pairs.mjs send && node type-tags/jev_pairs.mjs scores
node type-tags/pair_calib.cjs                  # 사람·Jev 판정과 기준선 비교
node type-tags/build_scope.cjs                 # 최종 매핑
```

- Jev 는 빠르다. 6천 요청에 70초 남짓(동시 16). 캐시(`type-tags/cache*.jsonl`)는 저장소에 넣지 않았다. 처음 돌리면 전부 다시 묻는다(1·2차 각 5,931, 쌍 3,497 요청).
- Jev 응답은 같은 질문이면 거의 같지만 완전히 같다는 보장은 없다. 점수가 조금 바뀌면 경계(0.4, 0.6) 근처 쌍이 바뀔 수 있다.
- 지금 결과 파일은 11-09 로컬 실행 결과다. 이 폴더 사본으로 build 계열(Jev 호출 없는 것)을 다시 돌려 같은 숫자가 나오는 것을 확인했다.

## Jev 질문에서 배운 것

- 1차(정의만, 「이 종류가 그것인가」): 정밀 0.82, 재현 0.51(0.7 기준). 두 번째 태그를 놓친다.
- 2차(태그마다 맞는 예·아닌 예, 같은 종류 안에서 갈리는 태그는 「그런 객체가 있을 수 있는가」): 정밀 0.74, 재현 0.73. 더 붙인 것 상당수는 실제로 맞다(공개 저장소의 sharing, isAdmin 사용자의 admin_access).
- 3차(애매한 쌍만 「점검 담당자가 봐야 하나」): 구별 못 함(정답 0.66, 아님 0.63). 버렸다. 애매한 구간은 1차 점수가 구별한다(0.41 대 0.24). 그래서 종류 태그 규칙 = 2차 ≥ 0.7 ∪ (2차 0.4~0.7 이면서 1차 ≥ 0.5).
- 쌍 판정: Jev+사람 판정 대비 0.4 에서 정밀 0.88 재현 0.98(같은 모델 판정이 섞여 있어 후하게 나온다). 사람 판정만 보면 0.5 에서도 「해당 아님」 63개 중 19개만 뺀다.
- Jev 질문 문장이 좁으면 후보를 문구 때문에 뺀다. 항목 태그를 넓히면 `item-statements-en.tsv` 괄호 설명도 같이 넓힌다.

## 남은 일

1. **ambiguous 8,162쌍**: 나중 과제(사용자 11-09). 사용자 검토 대상으로 둘지, 넓게 포함할지 정한다.
   - **11-11 1차 검토**(Claude): 운영 11-04 + AWS 데이터에 객체가 있고(값 표로 좁힌 뒤) 제외 등급이 아닌 항목의 ambiguous 301쌍을 봤다. 종류가 항목이 요구하는 설정이나 대상 자체이면 confirm(110), 느슨한 연관이면 drop(191). 기록 `items-clean/ambiguous-review-1111.jsonl`, 반영 `items-clean/apply_review_1111.py`(confirm 은 status confirmed 와 review 칸, drop 은 매핑에서 뺌). 반영 뒤 confirmed 16,907, ambiguous 7,861. 남은 ambiguous 는 지금 데이터에 객체가 없는 종류다.
   - **11-15 미점검 대상 좁히기**(Claude): 항목 뜻과 맞지 않는 (항목, 종류) 쌍을 검토해 drop 85, narrow 2 를 정했다. 기록 `items-clean/scope-review-1115.jsonl`, 반영 `items-clean/apply_review_1115.py`(반영 뒤 24,683쌍). 같은 날 연결 359개(item-findings), GWS 설정 값 태그 4개(value-tags 의 monitoring 제거), 설정 규칙 S10~S57(relation-rules, 번호 970~1017, S17, S38, S42 는 비움)을 더했다.
   - **11-16 ISO 5.12, 5.13 제외**(사용자 결정): 정보 분류와 정보 표시는 분류 체계, 라벨 절차가 본뜻이라 조직 문서로 확인한다. `iso-scope-1111.jsonl` 과 `item-tiers.jsonl` 에 exclude 와 사유를 적고 `apply_scope_1111.py` 로 `scope-final.jsonl` 을 다시 만들었다. `relation-rules.yaml` 사람 확인 항목(958)에서도 뺐다. Drive 라벨과 Salesforce 필드 분류를 수집하면 다시 본다.
   - **11-16 gws-243 연결 제외**(사용자 결정): CISA SCuBA GWS.COMMONCONTROLS.15.2(보조 데이터 저장소 미국)는 미국 기관 기준이고 수집 값(처리 지역을 저장 지역으로 제한)과 같은 설정인지도 확인되지 않아 ISO 5.23, ISMS-P 2.10.2-02 에서 뺐다.
   - **11-17 okta-032, okta-034 연결 제외**(사용자 결정): DISA Okta STIG OKTA-APP-001670(Smart Card 인증자), OKTA-APP-001920(Smart Card IdP)는 미국 국방부 PKI(PIV/CAC) 요건이라 일반 기업 통제의 본뜻이 아니므로 ISO 8.5, ISMS-P 2.5.3-01 에서 뺐다.
   - **11-17 자동 판정 없는 다섯 항목 제외**(사용자 결정, dashboard #441 에서 화면 스냅샷만 바꾼 것을 원본에 맞춤): ISO 8.10, 8.15, ISMS-P 2.5.6-01, PIPA 안전성 확보조치 기준 제5조 제3항, 제8조 제3항. 자동 판정 점검 없이 사람 확인 항목과 미수집 점검만 있다. ISO 는 iso-scope-1111.jsonl, ISMS-P, PIPA 는 scope-review-1111.jsonl 에 적고 apply_scope_1111.py 로 다시 만들었다.
2. **객체 단위로 좁히기**: 종류 매핑은 「이 종류의 객체 중 해당이 있을 수 있음」까지다. 게시할 때 어느 객체가 대상인지는 아래 표로 정한다(손 규칙 금지).
   - 값 → 태그 표: 제공자가 정한 유한한 값(gws 설정 이름 `settings/security.password` 등, okta 정책 유형, Salesforce 표준 권한, 공유 대상 유형 anyone/domain). 수집 데이터와 제공자 문서에서 값을 모아 Jev 로 한 번 판정해 기록한다.
   - 객체 → 태그 캐시: 회사가 만든 사용자 정의 역할처럼 테넌트마다 다른 것. 게시 때 해당 (종류, 태그) 객체만 Jev 에 묻고 캐시한다.
   - 먼저 「있을 수 있음」 태그가 붙은 종류에서 어떤 필드가 갈리는 값인지 찾는다. 이것도 Jev 로 정할 수 있는지 시험해 본다.
   - **11-10 값 → 태그 표 1차**(`value-tags/`): gws Policy `setting_type`(163값), okta Policy·PolicyRule `type`(각 6), atlassian Policy `attributes.type`(7), 모두 182값. 값마다 태그 31개를 Jev 에 묻고(546요청 8초) p ≥ 0.6 인 태그 중 그 종류 태그에 있는 것만 `tags`, 없는 것은 `extra`(종류 태그 보완 후보). 값 설명에는 하위 키 경로(값 제외, 3단계)를 넣는다. 한 단계만 넣었을 때 okta SIGN_ON 의 session_policy 를 놓쳤다.
     - 적용 규칙: 표가 있는 종류의 객체는 그 값의 `tags` 가 쌍의 `via` 와 겹칠 때만 대상. 표에 없는 값은 좁히지 않고 검토로 둔다. 태그가 없는 값(서비스 켜기·끄기 대부분 등 71값)은 어느 항목에도 안 걸린다.
     - 운영 11-04 스냅샷에 대 보면 confirmed·object 쌍의 (항목, 객체) 수가 67,286 → 38,368. gws Policy 는 2.5.4 비밀번호 318 → 7, PIPA 시행령 제8조 318 → 41. tenant_policy 로 이어진 9항목(ISO 8.9 구성 관리 등)은 설정 대부분(약 243)이 그대로 남는다(설정 전체가 대상인 항목이라 맞다).
     - 아는 빈틈: vault.service_status 에 retention_backup 이 빠짐(p 0.57). atlassian Policy 는 종류 태그에 data_region·monitoring·device 가 없어 값 표의 extra 로만 남는다(종류 태그 보완 후보).
     - 다시 돌리기: `AEGI_DATASET_DIR=<objects.json 폴더> node value-tags/jev_value_tags.mjs values`(값은 합쳐 쌓인다) → `plan` → `send` → `scores` → `build`.
     - 11-11 적용: 대시보드 점검 대상(dashboard dash-prod #374)과 engine 게시 `compliance_scope.object_count`(engine #376)가 이 표를 읽는다. 표에 없는 값은 좁히지 않는다(대시보드는 「값 표에 없음」으로 검토에 둔다). 운영 11-04 + AWS 데이터에서 게시 객체 수 67,633 → 38,715, 맞는 객체 없는 19쌍은 싣지 않는다.
3. **engine 게시(S6)에 붙이기**(11-10 engine #374 로 종류 매핑 적재 완료, 아래는 당시 기록): 지금 engine `scripts/compliance-scope` 는 옛 방식(규칙 + 인스턴스 Jev + bundle-overrides)이다. 새 매핑을 읽어 스냅샷 객체에 적용하도록 바꾼다. 구조 변경이라 `architecture/*.yaml` PR 이 같이 필요하다. `unit: type` 쌍은 객체마다가 아니라 「종류 + 객체 수」로 싣는다. 운영 D1 첫 게시(0006 마이그레이션)는 아직 안 했고 사용자 승인이 필요하다.
4. **사람 「해당」 인데 후보 밖 18건**: 대부분 11-08 판정이 넓었던 것으로 본다(예: 암호화 항목 → TrustedOrigin). `join_check.cjs` 의 `join-check-fn.txt` 로 다시 볼 수 있다.
5. PIPA 는 11-08 판정과 항목 키가 달라(조 → 항) 비교하지 않았다.
6. 관측되지 않은 종류의 Jev 종류 태그는 사람이 다 보지 않았다. 관측 종류(196)만 옛 규칙과 대조해 고쳤다(`build_type_tags.cjs` 의 FIX, REJECT).

## 주의

- ISO 27001 원문(사용자 라이선스 PDF)과 그 파싱 결과는 저장소에 넣지 않는다. 로컬 `archive/compliance-scope-20261108/inputs-private/` 에만 있다. 항목 파일에는 우리말 요약만 있다.
- 실측 대상 설명(`work/targets.jsonl`), Jev 캐시, Jev 키는 넣지 않았다. `items-clean/type_decisions.cjs` 는 실측 데이터(work/)가 있어야 다시 돌아간다. 결과(`type-decisions.draft.jsonl`)는 넣었다.
- Gemini 요약은 원문과 6건 어긋났었다(고침). 항목 요약을 바꾸면 원문과 대조한다.
