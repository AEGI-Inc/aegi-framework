# -*- coding: utf-8 -*-
"""관계 17종 진단표 — 명세 · 엔진 · 데이터가 관계를 어떻게 보는지 한 줄씩 나란히 놓는다.

    python ontology/tools/diagnose_relations.py                       # 대시보드 합성 데이터 없이
    python ontology/tools/diagnose_relations.py --dashboard ../aegi-dashboard
    python ontology/tools/diagnose_relations.py --dashboard ../aegi-dashboard --out reports/Relation_Diagnosis_v1.md

**측정만 한다. 값을 고치지 않는다.** Relation 재설계(관계마다 무엇을 만드는지 선언하기) 전에
어디가 어긋나 있는지를 숫자로 보는 표다.

입력 — 전부 읽기만 한다.

  명세        ontology/relation_types.yaml 의 relation_types · grades (Relation_Schema_v3 에서 옮긴 것)
  엔진        같은 파일의 engine_probe (대시보드 엔진에 시험 입력을 넣어 본 결과. 규칙이 아니다)
  Profile     docs/*_Profiles_v3.md 가 선언한 관계 (validation/check_twohop.py 의 declared_edges)
  Slack 실측  fixtures/slack/relations.json (회귀 기준선 190행) + objects.json 의 interface
  합성        aegi-dashboard src/data/aegi_inc_environment_v2 (--dashboard 를 줄 때만)
"""
import argparse
import collections
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "validation"))
import ontology  # noqa: E402
import lib  # noqa: E402
from check_twohop import declared_edges  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# 엔진 간선 종류의 뜻. 사전(effects.yaml)에는 기호만 있어서 엔진이 간선에 붙이는 label 에서 읽었다.
KIND_MEANING = {
    "M": "소속",
    "U": "상위 범위",
    "G": "권한 (능력 순위가 붙는다)",
    "T": "실행을 시킨다",
    "A": "~로서 동작한다 (대행)",
    "F": "데이터가 흐른다",
}

# 등급 대조 기준. **이 표가 쓴 기준이지 결정이 아니다.**
# 사전 effects.yaml 은 M · U · G 를 원래 권한(native), 나머지를 연동 간선으로 나눈다.
# 원래 권한 중 권한 · 소속(G · M)은 「접근」, 상위 범위(U)는 「구조」, 연동 간선(T · A · F)은 「신뢰」로 본다.
KIND_GRADE = {"G": "접근", "M": "접근", "U": "구조", "T": "신뢰", "A": "신뢰", "F": "신뢰"}


def git_head(path):
    try:
        return subprocess.check_output(["git", "-C", path, "rev-parse", "--short", "HEAD"],
                                       stderr=subprocess.DEVNULL).decode().strip()
    except Exception:  # noqa: BLE001
        return "?"


def fits(pairs, sif, tif):
    """relate.py 와 같은 판정 — 출발 interface 하나, 도착 interface 하나가 template 의 한 칸에 맞으면 통과."""
    return any(a in sif and b in tif for a, b in pairs)


# ---------------------------------------------------------------- 엔진

def engine_of(probe):
    """관계 하나의 engine_probe 를 요약한다."""
    base, extra, reverse, emits_from = [], [], False, set()
    for blk in probe.get("edges") or []:
        for e in blk["emits"]:
            if e["kind"] not in base:
                base.append(e["kind"])
            emits_from.add(e["from"])
            reverse |= e["from"] == "target"
    variants = []
    for v in probe.get("variants") or []:
        kinds = []
        for c in v["cases"]:
            for e in c["emits"]:
                kinds.append(e["kind"])
                emits_from.add(e["from"])
                reverse |= e["from"] == "target"
                if e["kind"] not in base and e["kind"] not in extra:
                    extra.append(e["kind"])
        variants.append((v["name"], v["when"], kinds))
    order = "MUGTAF"
    return {
        "use": probe["use"],
        "base": sorted(base, key=order.index),
        "extra": sorted(extra, key=order.index),
        "reverse": reverse,
        "from": sorted(emits_from),
        "variants": variants,
        "outside": probe.get("outside_template") or {},
        "filters_in": probe.get("filters_in") or [],
    }


def grade_check(spec_grade, eng):
    """(판정, 설명) — 명세 등급과 엔진 간선을 KIND_GRADE 로 대조한다."""
    if eng["use"] == "unread":
        return "안 읽음", "엔진이 이 관계를 읽지 않는다"
    if eng["use"] == "filter":
        return "거르기만", "간선을 만들지 않고 %s 를 지운다" % ", ".join(eng["filters_in"])
    base = {KIND_GRADE[k] for k in eng["base"]}
    extra = {KIND_GRADE[k] for k in eng["extra"]} - base
    if base == {spec_grade} and not extra:
        return "같음", ""
    other = sorted((base | extra) - {spec_grade})
    if spec_grade in base:
        why = ["기본 간선에 " + "·".join(k for k in eng["base"] if KIND_GRADE[k] != spec_grade)] \
            if base != {spec_grade} else []
        if extra:
            why.append("조건부로 " + "·".join(k for k in eng["extra"] if KIND_GRADE[k] != spec_grade))
        return "일부 다름", "%s (→ %s)" % (", ".join(why), "·".join(other))
    return "다름", "엔진 간선 %s 은 %s" % ("·".join(eng["base"]), "·".join(sorted(base)))


# ---------------------------------------------------------------- 데이터

def profile_counts():
    """({relation_type: Counter(provider)}, {relation_type: 끝점 타입 미정 수}) — Profile 이 선언한 관계 자리 수.

    declared_edges 는 끝점 타입이 실행 때 정해지는 참조(`object_type: "@resolve"`)를 뺀다.
    선언은 있으니 따로 센다.
    """
    profiles = lib.load_profiles()
    out = collections.defaultdict(collections.Counter)
    for e in declared_edges(profiles):
        out[e["rt"]][e["src"].split(".")[0]] += 1
    open_end = collections.Counter()
    for p in profiles:
        for r in (p.get("references") or {}).values():
            if isinstance(r, dict) and r.get("relation_type") not in (None, "no_relation") \
                    and str(r.get("object_type", "")).startswith("@"):
                open_end[r["relation_type"]] += 1
    return out, open_end


def slack_rows(T):
    """{relation_type: {"n", "bad", "unknown", "pairs": Counter}} — 회귀 기준선 190행."""
    objs = json.load(io.open(os.path.join(ROOT, "fixtures/slack/objects.json"), encoding="utf-8"))
    rels = json.load(io.open(os.path.join(ROOT, "fixtures/slack/relations.json"), encoding="utf-8"))
    ifs = {}
    for o in objs:
        ifs.setdefault(o["object_type"], o.get("interfaces") or [])
    return rows_by_type(rels, T, lambda side: ifs.get(side["object_type"]),
                        lambda r: (r["relation_type"], r["references"]))


def synthetic_rows(dash, T):
    base = os.path.join(dash, "src/data/aegi_inc_environment_v2")
    objs = json.load(io.open(os.path.join(base, "objects.json"), encoding="utf-8"))
    rels = json.load(io.open(os.path.join(base, "relations.json"), encoding="utf-8"))
    ifs = {}
    for o in objs:
        c = o["canonical"]
        ifs.setdefault((c["provider"], c["object_type"]), c.get("interfaces") or [])
    return rows_by_type(rels, T, lambda side: ifs.get((side.get("provider"), side["object_type"])),
                        lambda r: (r["canonical"]["relation_type"], r["canonical"]["references"]))


def rows_by_type(rels, T, iface_of, unpack):
    out = collections.defaultdict(lambda: {"n": 0, "bad": [], "unknown": 0, "pairs": collections.Counter()})
    for r in rels:
        rt, refs = unpack(r)
        d = out[rt]
        d["n"] += 1
        sif, tif = iface_of(refs["source"]), iface_of(refs["target"])
        if sif is None or tif is None:
            d["unknown"] += 1
            continue
        d["pairs"]["%s>%s" % ("|".join(sif), "|".join(tif))] += 1
        if rt in T and not fits(T[rt], sif, tif):
            d["bad"].append("%s(%s) -> %s(%s)" % (refs["source"]["object_type"], ",".join(sif),
                                                 refs["target"]["object_type"], ",".join(tif)))
    return out


# ---------------------------------------------------------------- 출력

def cell_data(d):
    if not d or not d["n"]:
        return "0"
    s = str(d["n"])
    notes = []
    if d["bad"]:
        notes.append("밖 %d" % len(d["bad"]))
    if d["unknown"]:
        notes.append("모름 %d" % d["unknown"])
    return s + (" (%s)" % ", ".join(notes) if notes else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dashboard", help="aegi-dashboard 저장소 경로 (합성 데이터 열)")
    ap.add_argument("--out", help="마크다운을 쓸 파일. 없으면 표준 출력")
    a = ap.parse_args()

    rt_rows = ontology.load("relation_types")["relation_types"]
    grade_of = {t: g["name"] for g in ontology.load("relation_types")["grades"] for t in g["relation_types"]}
    default_of = {g["name"]: g["default"] for g in ontology.load("relation_types")["grades"]}
    probe = ontology.load("relation_types")["engine_probe"]["relations"]
    T = ontology.template_pairs()

    eng = {r["name"]: engine_of(probe[r["name"]]) for r in rt_rows}
    prof, prof_open = profile_counts()
    slack = slack_rows(T)
    synth = synthetic_rows(a.dashboard, T) if a.dashboard else None

    L = []
    w = L.append
    w("# Relation 진단표 v1")
    w("")
    w("> `python ontology/tools/diagnose_relations.py%s` 로 만든다. 손으로 고치지 않는다."
      % (" --dashboard <aegi-dashboard>" if a.dashboard else ""))
    w(">")
    w("> 입력: aegi-knowledge `%s`%s. **측정만 했다 — 사전 값은 하나도 안 바꿨다.**"
      % (git_head(ROOT), (" · aegi-dashboard `%s` (합성 데이터)" % git_head(a.dashboard)) if a.dashboard else ""))
    w("")
    w("관계 17종을 명세 · 엔진 · 데이터가 각각 어떻게 보는지 한 줄씩 나란히 놓았다. "
      "Relation 재설계(관계마다 무엇을 만드는지 사전에 선언하기)의 출발점이다.")
    w("")

    # --- 읽는 법
    w("## 읽는 법")
    w("")
    w("| 열 | 무엇 | 출처 |")
    w("| --- | --- | --- |")
    w("| 등급 | 명세가 정한 표현 등급 | `ontology/relation_types.yaml` `grades` (Relation_Schema_v3) |")
    w("| 엔진 간선 | 대시보드 엔진이 만드는 간선 종류. 괄호는 조건이 붙을 때만 | `engine_probe` — 엔진에 시험 입력을 넣어 본 결과다. 규칙이 아니다 (%s) |"
      % ontology.load("relation_types")["sources"]["engine_probe"])
    w("| 등급 대조 | 엔진 간선을 아래 기준으로 등급에 옮겨 명세 등급과 비교 | 이 표의 기준. **결정이 아니다** |")
    w("| 뒤집힘 | 엔진 간선이 관계의 도착(target)에서 출발(source)로 나간다 | `engine_probe` 의 `from: target` |")
    w("| template 밖 | template 이 안 받는 interface 칸 중 엔진이 그래도 간선을 낸 칸 | `engine_probe.outside_template` |")
    w("| Profile | 명세 Profile %d종(Slack · Okta · Pilot)이 이 관계를 선언한 자리 수. `끝점 미정` 은 끝점 타입이 실행 때 정해지는 참조 | `validation/check_twohop.py` `declared_edges` |"
      % len(lib.load_profiles()))
    w("| Slack 실측 | 회귀 기준선 190행 중 이 관계. `밖 n` 은 template 위반, `모름 n` 은 끝점 interface 를 모름 | `fixtures/slack/` |")
    w("| 합성 | 대시보드 합성 데이터셋 150행 중 이 관계 | aegi-dashboard `src/data/aegi_inc_environment_v2` |")
    w("")
    w("엔진 간선 종류 — 사전에는 기호만 있어서 엔진이 간선에 붙이는 label 에서 뜻을 읽었다.")
    w("")
    w("| 기호 | 뜻 | 사전 분류 | 이 표의 등급 대조 |")
    w("| --- | --- | --- | --- |")
    native = set(ontology.load("effects")["native_kinds"])
    for k in "MUGTAF":
        w("| %s | %s | %s | %s |" % (k, KIND_MEANING[k], "원래 권한" if k in native else "연동", KIND_GRADE[k]))
    w("")
    w("등급 대조 기준: 사전 `effects.yaml` 이 M · U · G 를 원래 권한, T · A · F 를 연동 간선으로 나눈다. "
      "원래 권한 중 권한 · 소속(G · M)은 「접근」, 상위 범위(U)는 「구조」, 연동 간선은 「신뢰」로 옮겼다. "
      "이 기준이 틀렸다고 보면 표의 「등급 대조」 열만 달라진다. 엔진 간선 열은 그대로다.")
    w("")

    # --- 한눈에
    w("## 한눈에")
    w("")
    head = ["#", "relation_type", "등급", "엔진 간선", "등급 대조", "뒤집힘", "template 밖", "Profile", "Slack 실측"]
    if synth is not None:
        head.append("합성")
    w("| " + " | ".join(head) + " |")
    w("|" + " --- |" * len(head))
    tally = collections.Counter()
    for r in rt_rows:
        n = r["name"]
        e = eng[n]
        verdict, _ = grade_check(grade_of[n], e)
        tally[verdict] += 1
        kinds = "·".join(e["base"]) + (" (+%s)" % "·".join(e["extra"]) if e["extra"] else "")
        if e["use"] == "unread":
            kinds = "—"
        elif e["use"] == "filter":
            kinds = "거르기"
        out = e["outside"]
        outside = "%d / %d" % (out.get("with_edges", 0), out.get("cells", 0)) if out.get("cells") else "— (any → any)"
        p = prof.get(n)
        prof_cell = str(sum(p.values())) if p else "0"
        if prof_open.get(n):
            prof_cell += " (+%d 끝점 미정)" % prof_open[n]
        row = [str(r["number"]), "`%s`" % n, grade_of[n], kinds, verdict, "예" if e["reverse"] else "",
               outside, prof_cell, cell_data(slack.get(n))]
        if synth is not None:
            row.append(cell_data(synth.get(n)))
        w("| " + " | ".join(row) + " |")
    w("")
    w("등급 대조: " + " · ".join("%s %d" % (k, tally[k]) for k in ("같음", "일부 다름", "다름", "안 읽음", "거르기만")))
    w("")

    # --- 어긋남 묶음
    w("## 어긋남")
    w("")
    w("### 1. 엔진이 읽지 않는 관계")
    w("")
    unread = [r["name"] for r in rt_rows if eng[r["name"]]["use"] == "unread"]
    seen = [n for n in unread if prof.get(n) or (slack.get(n) or {}).get("n") or (synth and (synth.get(n) or {}).get("n"))]
    w("%d종 — %s. 명세에는 있는데 엔진 결론에 안 들어간다. 그중 데이터에 실제로 나오는 것은 %s 이다."
      % (len(unread), ", ".join("`%s`" % x for x in unread), ", ".join("`%s`" % x for x in seen) if seen else "없다"))
    w("")
    w("| relation_type | 등급 | Profile | Slack 실측 | %s |" % ("합성" if synth is not None else "—"))
    w("| --- | --- | --- | --- | --- |")
    for n in unread:
        p = prof.get(n)
        w("| `%s` | %s | %s | %s | %s |" % (n, grade_of[n], sum(p.values()) if p else 0, cell_data(slack.get(n)),
                                          cell_data(synth.get(n)) if synth is not None else "—"))
    w("")
    w("팀 결정 #4(읽는다 / 정보 관계 / 보류)가 이 줄들을 정한다.")
    w("")

    w("### 2. 명세 등급과 엔진 간선이 다른 관계")
    w("")
    w("| relation_type | 명세 등급 (기본 표시) | 엔진 간선 | 판정 | 무엇이 다른가 |")
    w("| --- | --- | --- | --- | --- |")
    for r in rt_rows:
        n = r["name"]
        verdict, why = grade_check(grade_of[n], eng[n])
        if verdict in ("일부 다름", "다름"):
            e = eng[n]
            kinds = "·".join(e["base"]) + (" (+%s)" % "·".join(e["extra"]) if e["extra"] else "")
            w("| `%s` | %s (%s) | %s | %s | %s |" % (n, grade_of[n], default_of[grade_of[n]], kinds, verdict, why))
    w("")
    w("「구조」는 기본으로 접힌다. 구조 등급인데 엔진이 권한 · 소속 · 대행 간선을 만드는 관계는 **화면에서 접으면 결론의 근거가 안 보인다.**")
    w("")

    w("### 3. 방향이 뒤집혀 나오는 관계")
    w("")
    w("관계는 출발 → 도착인데 엔진 간선은 도착 → 출발로 나간다. 관계 정의에 효과를 선언할 때 방향을 같이 적어야 하는 자리다.")
    w("")
    w("| relation_type | 어느 칸에서 | 엔진 간선 |")
    w("| --- | --- | --- |")
    for r in rt_rows:
        n = r["name"]
        for blk in probe[n].get("edges") or []:
            rev = [e for e in blk["emits"] if e["from"] == "target"]
            if rev:
                pairs = blk["pairs"]
                where = ", ".join(pairs[:3]) + (" 외 %d칸" % (len(pairs) - 3) if len(pairs) > 3 else "")
                w("| `%s` | %s | %s |" % (n, where, ", ".join("%s (도착 → 출발)" % e["kind"] for e in rev)))
        for name, when, _ in eng[n]["variants"]:
            v = next(x for x in probe[n]["variants"] if x["name"] == name)
            rev = [(c["pair"], e) for c in v["cases"] for e in c["emits"] if e["from"] == "target"]
            if rev and not any(e["from"] == "target" for blk in probe[n].get("edges") or [] for e in blk["emits"]):
                w("| `%s` | %s (조건: %s) | %s |" % (n, rev[0][0], when, ", ".join("%s (도착 → 출발)" % e["kind"] for _, e in rev)))
    w("")
    others = sorted({f for n in eng for f in eng[n]["from"]} - {"source", "target"})
    if others:
        w("출발도 도착도 아닌 곳에서 나가는 간선도 있다: %s. 예를 들어 `everyone` 은 `shared_with` 의 `anyone` 공유에서 나온다." %
          ", ".join("`%s`" % x for x in others))
        w("")

    w("### 4. template 밖에서도 간선을 내는 관계")
    w("")
    tot_c = sum(eng[n]["outside"].get("cells", 0) for n in eng)
    tot_e = sum(eng[n]["outside"].get("with_edges", 0) for n in eng)
    w("엔진은 template 을 따지지 않는다. template 밖 **%s칸 중 %s칸**에서 간선을 냈다." % (format(tot_c, ","), format(tot_e, ",")))
    w("")
    w("| relation_type | template 칸 | 밖 칸 | 밖에서 간선 |")
    w("| --- | --- | --- | --- |")
    for r in rt_rows:
        n = r["name"]
        o = eng[n]["outside"]
        if o.get("with_edges"):
            w("| `%s` | %d | %d | %d |" % (n, len(T[n]), o["cells"], o["with_edges"]))
    w("")
    w("실데이터에서는 아래와 같다 — 엔진이 이 칸을 받는 게 지금 데이터에 실제로 영향을 주는지.")
    w("")
    w("| 데이터 | 행 | template 위반 | 끝점 interface 모름 |")
    w("| --- | --- | --- | --- |")
    for label, data in (("Slack 실측 (회귀 기준선)", slack), ("대시보드 합성", synth)):
        if data is None:
            continue
        n_all = sum(d["n"] for d in data.values())
        bad = [(rt, b) for rt, d in data.items() for b in d["bad"]]
        unk = sum(d["unknown"] for d in data.values())
        w("| %s | %d | %d | %d |" % (label, n_all, len(bad), unk))
    w("")
    for label, data in (("Slack 실측", slack), ("합성", synth)):
        if data is None:
            continue
        bad = [(rt, b) for rt, d in sorted(data.items()) for b in d["bad"]]
        if bad:
            w("%s template 위반:" % label)
            w("")
            for rt, b in collections.Counter(bad).most_common():
                w("- `%s` %s — %d행" % (rt[0], rt[1], b))
            w("")

    w("### 5. interface 쌍이 아닌 것으로 갈리는 갈래")
    w("")
    w("엔진은 interface 쌍만으로 간선을 정하지 않는다. 아래 조건이 붙으면 결과가 달라진다. "
      "관계 정의에 효과를 선언할 때 이 조건을 어디에 적을지(관계 행 / provider 파일 / 역할 표)를 정해야 한다.")
    w("")
    w("| relation_type | 갈래 | 조건 | 그때 간선 |")
    w("| --- | --- | --- | --- |")
    for r in rt_rows:
        n = r["name"]
        for name, when, kinds in eng[n]["variants"]:
            uniq = [k for i, k in enumerate(kinds) if k not in kinds[:i]]
            w("| `%s` | `%s` | %s | %s |" % (n, name.split(".", 1)[1], when, "·".join(uniq) if uniq else "없음 (간선이 사라진다)"))
    w("")
    w("시험 입력에서 정해진 것도 있다 (`engine_probe.depends_on_inputs`):")
    w("")
    for d in ontology.load("relation_types")["engine_probe"]["depends_on_inputs"]:
        w("- %s" % d)
    w("")

    w("### 6. 근거 데이터가 없는 관계")
    w("")
    w("Profile 선언, Slack 실측, 합성 데이터 어디에도 한 번도 안 나온 관계. 명세 「Slack 아닌 근거」 열의 벤더 예시만 있다.")
    w("")
    none = []
    for r in rt_rows:
        n = r["name"]
        if not prof.get(n) and not prof_open.get(n) and not (slack.get(n) or {}).get("n") and not (synth and (synth.get(n) or {}).get("n")):
            none.append(r)
    if none:
        w("| relation_type | 등급 | 엔진 | 명세 근거 |")
        w("| --- | --- | --- | --- |")
        for r in none:
            e = eng[r["name"]]
            w("| `%s` | %s | %s | %s |" % (r["name"], grade_of[r["name"]], e["use"] if e["use"] != "edges" else "·".join(e["base"]),
                                         r["evidence"]))
    else:
        w("없다.")
    w("")

    # --- 관계별
    w("## 관계별")
    w("")
    for r in rt_rows:
        n = r["name"]
        e = eng[n]
        w("### %d. `%s`" % (r["number"], n))
        w("")
        w("- **명세:** `%s` · %s 층 · %s 등급 · %d항" % (r["form"], "부여" if r["layer"] == "grant" else "구조", grade_of[n], r["arity"]))
        verdict, why = grade_check(grade_of[n], e)
        if e["use"] == "edges":
            w("- **엔진:** %s%s" % ("·".join(e["base"]), (" · 조건부 " + "·".join(e["extra"])) if e["extra"] else ""))
            for blk in probe[n].get("edges") or []:
                ems = ", ".join("%s %s→%s%s" % (x["kind"], x["from"], x["to"],
                                                 (" rank %s" % x["rank"]) if "rank" in x else "")
                                for x in blk["emits"])
                pairs = blk["pairs"]
                where = ", ".join(pairs) if len(pairs) <= 4 else "%s 외 %d칸" % (", ".join(pairs[:3]), len(pairs) - 3)
                w("  - %s → %s" % (where, ems))
        else:
            w("- **엔진:** %s" % ("읽지 않는다" if e["use"] == "unread" else "간선 없이 거른다 (%s)" % ", ".join(e["filters_in"])))
        w("- **등급 대조:** %s%s" % (verdict, (" — " + why) if why else ""))
        p = prof.get(n)
        decl = ", ".join("%s %d" % kv for kv in sorted(p.items())) if p else "없음"
        if prof_open.get(n):
            decl += " · 끝점 타입 미정 %d (`object_type: \"@resolve\"`)" % prof_open[n]
        w("- **Profile 선언:** %s" % decl)
        for label, data in (("Slack 실측", slack), ("합성", synth)):
            if data is None:
                continue
            d = data.get(n)
            if d and d["n"]:
                w("- **%s:** %d행 — %s" % (label, d["n"], ", ".join("%s %d" % kv for kv in d["pairs"].most_common())))
        w("")

    text = "\n".join(L) + "\n"
    if a.out:
        with io.open(a.out, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print("썼다: %s" % a.out)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
