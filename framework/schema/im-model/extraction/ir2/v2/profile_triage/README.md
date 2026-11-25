# 세 모델 오브젝트 대조와 판단표 3차

기존 오브젝트 목록(대시보드 v1, v2 시절), Cartography 노드, IM 오브젝트 모델 v1을 API로 맞춘 대조와, 그중 IM 수집 Profile이 없는 기존 「포함」 223개의 분류(판단표 3차)를 다시 만드는 도구다. 결정은 `../relation_decisions_v2.json`의 V2-P1 ~ V2-P7에 있다.

```bash
python map3way_build.py    # out2/profile_triage/data.json
python map3way_page.py     # out2/profile_triage/map3way.html (세 모델 대조 페이지)
python triage_items.py     # out2/profile_triage/items.json (Profile 없는 223개)
python triage_decide.py    # out2/profile_triage/decisions.json (항목별 분류와 근거)
python triage_page.py      # out2/profile_triage/triage.html, decisions.json 에 표 코드(A01 등)
```

입력은 모두 로컬 산출물이다: `out2/object_audit.json`(기존 목록과 원문 공간 연결, `object_audit.py`), `out2/carto_audit.json`(`carto_audit.py`), `out2/v1/object_types.json`, `out2/<provider>/ir/`, `docs/spec/model-v1/runtime-catalog.json`, `scripts/collect/providers/*.ts`, 대시보드 `src/data/aegi_inc_environment_v2`, `aegi_inc_measured_v2`의 `catalog_ref`(타입 존재만 쓴다). 출력은 `out2` 아래라 git에 들어가지 않는다.

맞추는 규칙은 `map3way_build.py` 머리말에 있다. 이름이 아니라 API와 ID 공간으로 잇고, 공간이 갈린 경우만 이름으로 합친 뒤 행 비고에 적는다. 기존 목록의 근거 API 칸에 있던 시험 환경 응답 예시는 첫 줄만 남기고 뺀다.

게시본(비공개): 세 모델 대조 https://claude.ai/artifact/XUUNPH1ZL2hpDksLKvxSaL, 판단표 3차 https://claude.ai/artifact/EcgCZfkbwtTtLdfGWGxXot
