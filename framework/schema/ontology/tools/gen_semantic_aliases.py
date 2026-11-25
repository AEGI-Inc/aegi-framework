# -*- coding: utf-8 -*-
"""별칭 표(기록 층 관계 17종 → 의미 층 사실 9종)를 효과 표에서 만든다.

    python schema/ontology/tools/gen_semantic_aliases.py           # semantic_mapping.yaml 의 생성 부분을 다시 쓴다
    python schema/ontology/tools/gen_semantic_aliases.py --check   # 다시 만든 것이 파일과 같은지만 본다(다르면 1)

relation_semantics.yaml 의 relations.<관계>.effects · conditions 를 그대로 옮긴다. 바꾸는 것은 이름뿐이다.
  간선 종류 → 사실: M member_of, U contained_in, G grants, A acts_as (authenticates_with 의 A 는 holds), T triggers, F flows_to
  holds 는 보유자 → 자격증명이다. 효과 표는 자격증명 → 보유자 A 라서 끝을 뒤집고 impersonate: true(쥐면 그 신원으로 동작)를 단다
  rank 숫자 → 능력 묶음(capabilities.yaml capability_bundles): 0 none, 1 use, 3 edit, 5 manage. role · membership 은 그대로
  갈래 이름은 앞의 「<관계>.」 를 뗀다. 조건 갈래에서 default 갈래의 칸을 모두 덮는 칸 목록은 'all' 로 줄인다
when · decided 같은 사람이 읽는 칸은 옮기지 않는다(엔진 생성기 scripts/ontology/generate.ts 의 RELATION_EFFECTS 와 같은 범위).

semantic_mapping.yaml 은 손으로 쓰는 앞부분과 이 도구가 쓰는 뒷부분(MARKER 줄부터 끝까지)으로 나뉜다.
"""
import json
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ONTO = os.path.dirname(HERE)
SEMANTICS = os.path.join(ONTO, "relation_semantics.yaml")
MAPPING = os.path.join(ONTO, "semantic_mapping.yaml")
MARKER = "# ---- 생성 부분: 별칭 표"

FACT_OF_EDGE = {"M": "member_of", "U": "contained_in", "G": "grants", "A": "acts_as", "T": "triggers", "F": "flows_to"}
BUNDLE_OF_RANK = {0: "none", 1: "use", 3: "edit", 5: "manage"}


def convert(rt, e):
    fact = "holds" if rt == "authenticates_with" and e["kind"] == "A" else FACT_OF_EDGE[e["kind"]]
    o = {"p": fact}
    if fact == "holds":
        o["from"], o["to"], o["impersonate"] = e["to"], e["from"], True
    else:
        o["from"], o["to"] = e["from"], e["to"]
    if "rank" in e:
        r = e["rank"]
        if isinstance(r, bool) or (isinstance(r, int) and r not in BUNDLE_OF_RANK):
            raise SystemExit(f"{rt}: 묶음으로 못 옮기는 rank {r!r}")
        o["caps"] = BUNDLE_OF_RANK[r] if isinstance(r, int) else r
    if e.get("mode"):
        o["mode"] = e["mode"]
    if e.get("uncertain"):
        o["uncertain"] = list(e["uncertain"])
    return o


def group(cases):
    """같은 사실 목록을 내는 칸을 한 줄로 묶는다(처음 나온 차례)."""
    out = []
    for pair, emits in cases:
        sig = json.dumps(emits, ensure_ascii=False, sort_keys=True)
        for g in out:
            if g["sig"] == sig:
                g["pairs"].append(pair)
                break
        else:
            out.append({"sig": sig, "pairs": [pair], "emit": emits})
    return out


def build(semantics):
    relations = {}
    for rt, r in semantics["relations"].items():
        routes = []
        default_pairs = [p for b in (r.get("effects") or []) for p in b["pairs"]]
        everything = set(default_pairs)

        def short(pairs):
            return "all" if everything and len(pairs) == len(everything) and set(pairs) == everything else pairs

        for c in r.get("conditions") or []:
            route = {"name": c["name"].replace(f"{rt}.", "", 1)}
            if c.get("match"):
                route["match"] = c["match"]
            if c.get("override"):
                route["override"] = c["override"]
            grouped = group([(x["pair"], [convert(rt, e) for e in x["emits"]]) for x in c["cases"]])
            route["cases"] = [{"pairs": short(g["pairs"]), "emit": g["emit"]} for g in grouped]
            routes.append(route)
        if r.get("effects"):
            routes.append({"name": "default", "cases": [{"pairs": list(b["pairs"]), "emit": [convert(rt, e) for e in b["emits"]]} for b in r["effects"]]})
        relations[rt] = routes
    return relations


def flow(v):
    """한 줄 흐름 꼴(JSON 은 YAML 흐름 꼴이기도 하다)."""
    return json.dumps(v, ensure_ascii=False)


def render(relations):
    out = [
        MARKER + " (tools/gen_semantic_aliases.py 가 relation_semantics.yaml 에서 만든다. 손으로 고치지 않는다)",
        "# 관계 종류마다 갈래 목록. 갈래 고르기(위에서부터 먼저 맞는 갈래 하나, 없으면 default)와 match 식·끝 이름은 효과 표와 같다",
        "aliases:",
    ]
    for rt, routes in relations.items():
        if not routes:
            out.append(f"  {rt}: []")
            continue
        out.append(f"  {rt}:")
        for r in routes:
            out.append(f"  - name: {r['name']}")
            if "match" in r:
                out.append(f"    match: {flow(r['match'])}")
            if "override" in r:
                out.append(f"    override: {r['override']}")
            out.append("    cases:")
            for c in r["cases"]:
                out.append(f"    - pairs: {flow(c['pairs'])}")
                out.append("      emit:" + ("" if c["emit"] else " []"))
                for e in c["emit"]:
                    out.append(f"      - {flow(e)}")
    return "\n".join(out) + "\n"


def generated_text():
    with open(SEMANTICS, encoding="utf-8") as f:
        return render(build(yaml.safe_load(f)))


def split(text):
    at = text.find(MARKER)
    if at < 0:
        raise SystemExit(f"semantic_mapping.yaml 에 생성 부분 표시 줄이 없다: {MARKER}")
    return text[:at], text[at:]


def main(argv):
    with open(MAPPING, encoding="utf-8") as f:
        text = f.read()
    head, tail = split(text)
    want = generated_text()
    if "--check" in argv:
        if tail != want:
            print("별칭 표가 효과 표와 다르다 — python schema/ontology/tools/gen_semantic_aliases.py 로 다시 만든다")
            return 1
        print("별칭 표 = 효과 표 (차이 0)")
        return 0
    with open(MAPPING, "w", encoding="utf-8", newline="\n") as f:
        f.write(head + want)
    print(f"생성: aliases ({sum(len(v) for v in build(yaml.safe_load(open(SEMANTICS, encoding='utf-8'))).values())} 갈래)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
