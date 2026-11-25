# 오브젝트 모델 규칙집 (초안)

지난 판단표 결정(v1 1단계, 4단계, v2 판단표 1~4차)을 다시 쓸 수 있는 규칙으로 옮긴 것이다. 새 SaaS 후보는 단계 순서대로 규칙의 질문에 답하고, 규칙이 정하지 못하거나 두 규칙이 부딪치는 것만 판단표에 올린다. 사람이 정한 결과는 새 규칙이나 규칙의 예외로 `rules.json`에 더한다.

```bash
python backtest.py       # out2/rulebook/backtest.json (지난 결정이 규칙으로 설명되는지, 자동 규칙 예측)
python rulebook_page.py  # out2/rulebook/rulebook.html
```

입력: `../../decisions_step1.json`, `../../relation_decisions_step4.json`, `../relation_decisions_v2.json`, `../../out2/profile_triage/decisions.json`(판단표 3차, `profile_triage/` 도구로 다시 만든다). 출력은 `out2` 아래라 git에 들어가지 않는다.

설명률은 결정에 기록된 이유를 규칙에 대응시킨 값이다. 규칙이 지난 결정과 어긋나지 않는다는 확인이지 새 후보를 맞힌다는 증명은 아니다. 사람 답 없이 정해지는 것은 `auto: true` 규칙(코드가 검사)과 S2 제품 계열 표뿐이다.

게시본(비공개): https://claude.ai/artifact/WieGMW7it7TqzvmXrVvJVG

## 판단표 G4 (2026-10-21)

실측 g4 의 SaaS별 객체 수 차이를 따진 7건을 모두 권고안으로 정했다. I1(Assignment 단위, 권한 체계 내용 행), R7(세션 기반 권한)을 보강하고 I13(앱 계정), R12(특수 주체), M3(플랫폼 기본 객체 표시)를 더했다. 되짚기에서 7건 모두 규칙으로 설명된다(판단 904건 중 904건). 결정 기록은 aegi-knowledge `docs/decisions/OBJECT_MODEL_G4_2026-10-21.md`.
