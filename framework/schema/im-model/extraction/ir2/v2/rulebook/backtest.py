# -*- coding: utf-8 -*-
"""규칙집 되짚기: 지난 결정이 규칙 하나로 설명되는지 센다 (-> out2/rulebook/backtest.json)

두 가지를 잰다.
- 설명률: 기록된 결정과 그 이유를 규칙에 대응시킨다. 대응이 안 되는 결정은 그 사안만의 판단이다.
  이유 글로 대응시키므로 「규칙이 그 결정과 모순되지 않는다」는 확인이지 예측은 아니다.
- 자동 예측: 사람 답 없이 원문만으로 정해지는 규칙(S1 원문 없음, S2 제품 계열 경로)을 판단표 3차 223개에 돌려
  실제 결정과 맞는지 본다.
"""
import collections
import io
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
IR2 = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(IR2, "out2", "rulebook")
os.makedirs(OUT, exist_ok=True)
load = lambda p: json.load(io.open(p, encoding="utf-8"))
RULES = load(os.path.join(HERE, "rules.json"))
RULE_IDS = {r["id"] for r in RULES["rules"]}

rows = []  # (출처, 결정 id, 라벨, 결정, 규칙 또는 None)


def add(source, did, label, choice, rule):
    assert rule is None or rule == "process" or rule in RULE_IDS, rule
    rows.append({"source": source, "id": did, "label": label, "choice": choice, "rule": rule})


# ---- v1 1단계 (69)
STEP1 = {"G": "L4", "H": "I2", "A": "O4", "R": "R10"}
# 판단이 아니라 다음 단계로 넘긴 절차 결정 (공간 인정, 3단계로 넘김, 지금 지도 유지). 분모에서 뺀다
PROCESS_GROUPS = {"B", "C", "E", "F"}
IFACE_RULE = {"Tenant": "I8", "Principal": "I9", "Policy": "I10", "Automation": "I11", "Resource": "I12", "Integration": "I4", "Assignment": "I1", "Credential": "I2", "Endpoint": "I3"}
SAME = re.compile(r"위와 같|같은 판정|와 같은 (기준|대상|묶음)|맞춘다|결정으로|결정했|결정대로|다른 응답 보기|와 같다")


def interface_rule(d):
    basis = str(d.get("basis") or "")
    if SAME.search(basis):
        return "M1"
    ifs = (d.get("effect") or {}).get("interfaces")
    if ifs:
        return IFACE_RULE.get(ifs[0])
    return next((r for k, r in O_BASIS if k in basis), "O4" if "속성으로" in basis else None)
for d in load(os.path.join(IR2, "decisions_step1.json"))["decisions"]:
    g, ch = d["group"], d["choice"]
    if g in PROCESS_GROUPS:
        add("v1 1단계 (절차)", d["id"], d["object"], ch, "process")
        continue
    rule = "S8" if g == "D" and "수집 과제" in ch else "O4" if g == "D" else STEP1.get(g)
    add("v1 1단계", d["id"], d["object"], ch, rule)

# ---- v1 4단계 (610)
O_BASIS = [("위와 같다", "M1"), ("하나에 하나뿐인", "O6"), ("참조이고", "R11"), ("v1 밖", "S8"), ("속성으로 둔다", "O4"), ("조직에 하나뿐인", "O6"), ("메타데이터나 목록 값", "O1"), ("파생된 보기", "O2"), ("실행 기록이나 진행 상태", "O3"), ("로그인 세션", "O3"),
           ("설정 값", "O4"), ("속성 값", "O4"), ("벤더 전역 정의", "O5"), ("전역 보안 권고", "O5"), ("이메일 보기", "O2"), ("도메인 별칭", "O4"), ("방식 요약", "O2"), ("수집 과제", "S8")]
for d in load(os.path.join(IR2, "relation_decisions_step4.json"))["decisions"]:
    cat, ch, basis = d["category"], d["choice"], str(d.get("basis") or "")
    rule = None
    if cat == "undecided_interface":
        if ch == "Object에서 뺀다":
            rule = next((r for k, r in O_BASIS if k in basis), None)
        elif ch == "보류한다":
            rule = "M2"
        elif ch == "권고 interface로 정한다":
            rule = interface_rule(d)
    elif cat == "semantic_mapping_not_declared":
        rule = {"권고 relation으로 매핑한다": "R10", "보류한다 (v1 밖 또는 근거 부족)": "S8", "relation이 아니다 (속성, 조건, Link로 보존)": "R6", "Effective Access 계산으로 넘긴다": "R7"}.get(ch)
        if ch.startswith("relation이 아니다") and ("Link" in basis or "같은 사람" in basis):
            rule = "R9"
        if ch.startswith("relation이 아니다") and "조건" in basis:
            rule = "R4"
    elif cat == "existing_reference_disagreement":
        if SAME.search(basis) or "결정에서" in basis:
            rule = "M1"
        elif "같은 사람" in basis or "Link" in basis:
            rule = "O7"
        elif "비밀값이 없어" in basis or "Credential" in basis:
            rule = "I2"
        elif "Endpoint" in basis or "경계를 넘" in basis or "통로" in basis or "조건으로 쓰는 주소" in basis:
            rule = "I3"
        elif "Integration" in basis or "설치 소프트웨어" in basis or "등록 층" in basis:
            rule = "I4"
        elif "Automation" in basis and "Policy" in basis:
            rule = "I5"
        elif "반례" in basis or "부여 대상" in basis:
            rule = "I6"
        elif "배정" in basis:
            rule = "I1"
        elif "벤더 전역" in basis:
            rule = "O5"
        elif "Object에서 뺀다" in basis or "무관해" in basis:
            rule = "O1"
        if rule is None and ch != "보류한다":
            rule = interface_rule(d)
        if ch == "보류한다":
            rule = "M2"
    elif cat == "assignment_permission_semantics":
        rule = "I1" if "배정" in ch else "I4" if "다른 interface" in ch else "I1"
    elif cat == "template_or_endpoint_review":
        rule = "R4" if "조건 참조" in ch else "R3" if "스킴 경유" in ch else "R1" if "역할=" in ch else "R5" if "contained_in" in ch else None
    elif cat == "profile_semantic_mapping_not_declared":
        rule = "R1" if "역할 슬롯" in basis or "역할 칸" in basis else "R6" if "no_relation" in ch else "R8" if "제안" in ch else "R10" if "권고대로" in ch else "M1" if "합친다" in ch else None
    elif cat == "profile_reviewed_vocabulary_gap":
        rule = "R8"
    elif cat == "profile_endpoint_interface_unresolved":
        rule = "I3" if "Endpoint" in ch else "I2" if "Credential" in ch else "R5" if "contained_in" in ch else None
    elif cat == "profile_needs_scope_or_parent_evidence":
        rule = "R5"
    add("v1 4단계", d["code"], d["label"], ch, rule)

# ---- v2 판단표 3차 (223)
TRIAGE = {"G": "S1", "E": "S2", "D": "S3", "F": "S4", "C": "S5", "A": "S6", "B": None}
triage = load(os.path.join(IR2, "out2", "profile_triage", "decisions.json"))["items"]
for x in triage:
    rule = TRIAGE[x["bucket"]]
    if x["bucket"] == "B":
        rule = "S6" if re.search(r"토큰이 있을 때|탐지를 할 때|테넌트에서\)|쓰는 테넌트", x["rec"]) else "S7"
    if x["bucket"] == "F" and x.get("family") == "noreread":
        rule = "O8"
    add("v2 판단표 3차", x["id"], x["name"], x["bucket"], rule)

# ---- v2 대장 결정 (판단표 1, 2차와 개별 결정)
V2 = {"E11": "R8", "C1": "I3", "V2-D01": "process", "V2-D02": "R4", "V2-D03": "R8", "V2-D04": "R8", "V2-D05": "L3", "V2-D06": "R3",
      "V2-R1": "I1", "V2-R2": "O4", "V2-R3": "O4", "V2-R4": "S9", "V2-R5": "S9", "V2-R6": "O6", "V2-R7": "O3", "V2-R8": "S2",
      "V2-S1": "L1", "V2-S2": "L1", "V2-S3": "L5", "V2-S4": "L2", "V2-S5": "L2", "V2-S6": "L5", "V2-S7": "L3", "V2-S8": "L1", "V2-S9": "process",
      "V2-M1": "R7", "V2-M2": "R7", "V2-M3": "R6", "V2-T1": "I8", "V2-D07": "process"}
for d in load(os.path.join(IR2, "v2", "relation_decisions_v2.json"))["decisions"]:
    code = d.get("code") or d.get("id")
    if code in V2:
        add("v2 대장", code, str(d.get("choice"))[:60], d.get("kind"), V2[code])

# ---- 판단표 G4 (2026-10-21, 7). 결정 기록: aegi-knowledge docs/decisions/OBJECT_MODEL_G4_2026-10-21.md
G4 = [
    ("G4-Q01", "Assignment 단위", "I1"),
    ("G4-Q02", "권한 체계 내용 행", "I1"),
    ("G4-Q03", "특수 주체", "R12"),
    ("G4-Q04", "플랫폼 기본 객체 표시", "M3"),
    ("G4-Q05", "할당 없는 기본 객체", "M3"),
    ("G4-Q06", "세션 기반 권한 세트", "R7"),
    ("G4-Q07", "앱 계정", "I13"),
]
for did, label, rule in G4:
    add("판단표 G4", did, label, "A", rule)

# ---- 자동 예측: S1, S2 를 판단표 3차에 돌린다
fams = RULES["product_families"]
pred = collections.Counter()
mismatch = []
for x in triage:
    text = (x["api"] or "") + " " + x["name"]
    # S 단계 순서: S2(제품 계열)를 먼저, S1(원문 없음)은 S2 ~ S5 다음. S3 ~ S5 는 사람 답이 필요하다
    p = "E" if any(f["provider"] == x["p"] and any(pat.lower() in text.lower() for pat in f["api_patterns"]) for f in fams) else "G?" if "연구 원문에 없음" in (x["why"] or "") else None
    if p == "G?":
        pred["원문 없음: S3 ~ S5 사람 답 뒤 G 후보"] += 1
        continue
    if p is None:
        pred["규칙 없음(사람 답 필요)"] += 1
        continue
    ok = p == x["bucket"]
    pred[f"{p} 예측 {'맞음' if ok else '틀림'}"] += 1
    if not ok:
        mismatch.append({"id": x["id"], "name": x["name"], "predicted": p, "decided": x["bucket"]})

by_source = collections.defaultdict(collections.Counter)
by_rule = collections.Counter()
judged = [r for r in rows if r["rule"] != "process"]
for r in rows:
    by_source[r["source"]]["절차" if r["rule"] == "process" else "설명됨" if r["rule"] else "규칙 없음"] += 1
    if r["rule"] and r["rule"] != "process":
        by_rule[r["rule"]] += 1
residue = [r for r in rows if not r["rule"]]
summary = {
    "decisions": len(rows),
    "process": len(rows) - len(judged),
    "judgments": len(judged),
    "explained": sum(1 for r in judged if r["rule"]),
    "by_source": {k: dict(v) for k, v in by_source.items()},
    "by_rule": dict(sorted(by_rule.items(), key=lambda kv: (kv[0][0], int(kv[0][1:])))),
    "unused_rules": sorted(RULE_IDS - set(by_rule)),
    "auto_prediction_triage": dict(pred),
    "auto_prediction_mismatch": mismatch,
    "residue_groups": collections.Counter((r["source"], str(r["choice"])[:40]) for r in residue).most_common(),
}
json.dump({"summary": summary, "rows": rows}, io.open(os.path.join(OUT, "backtest.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=list)
print(json.dumps({k: v for k, v in summary.items() if k != "residue_groups"}, ensure_ascii=False, indent=1))
print("residue", summary["residue_groups"][:25])
