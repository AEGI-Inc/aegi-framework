# -*- coding: utf-8 -*-
"""기존 확정 목록과 후보를 대조한다. 대조표(validation/<provider>_*.yaml)는 사람이 쓴 것이고,
이 스크립트는 그 표의 key 가 실제 후보 출력에 있는지와 집계만 확인한다.

    python compare.py slack
"""
import collections
import io
import json
import os
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))


def main(provider):
    rows = [json.loads(l) for l in io.open(os.path.join(HERE, "out", provider, "candidates.jsonl"), encoding="utf-8")]
    keys = {json.dumps(r["key"]) for r in rows}
    table = yaml.safe_load(io.open(os.path.join(HERE, "validation", provider + "_57.yaml"), encoding="utf-8"))
    bad = []
    for t in table:
        for k in [t.get("key")] + (t.get("also") or []):
            if k and json.dumps(k) not in keys:
                bad.append((t["id"], k))
    c = collections.Counter(t["status"] for t in table)
    print("대조 %d건  hit %d  weak %d  miss %d" % (len(table), c["hit"], c["weak"], c["miss"]))
    for t in table:
        if t["status"] != "hit":
            print("  %-5s %-40s %s" % (t["status"], t["term"], t.get("why", "")))
    if bad:
        print("후보 출력에 없는 key:")
        for b in bad:
            print("  ", b)
        return 1
    print("대조표의 key 는 모두 후보 출력에 있다")
    return 0




def judge_compare(provider):
    """판정 결과(judgments.jsonl)의 Interface 를 기존 목록의 Interface 와 대조한다."""
    base = os.path.join(HERE, "out", provider)
    jpath = os.path.join(base, "judgments.jsonl")
    if not os.path.exists(jpath):
        return
    rows = {json.loads(l)["candidate_id"]: json.loads(l) for l in io.open(jpath, encoding="utf-8")}
    cands = [json.loads(l) for l in io.open(os.path.join(base, "candidates.jsonl"), encoding="utf-8")]
    by_key = {json.dumps(c["key"]): c["candidate_id"] for c in cands}
    objs = {o["id"]: o for o in json.load(io.open(os.path.join(HERE, "..", "..", "aegi-knowledge", "schema", "data", "objects.json"),
                                                   encoding="utf-8"))}
    table = yaml.safe_load(io.open(os.path.join(HERE, "validation", provider + "_57.yaml"), encoding="utf-8"))
    stat = collections.Counter()
    print("\nInterface 대조 (기존 목록 vs 판정)")
    for t in table:
        want = {x.strip() for x in objs[t["id"]]["interface"].split(";")}
        if t["status"] == "miss" or not t.get("key"):
            stat["후보 없음"] += 1
            continue
        got = set(rows[by_key[json.dumps(t["key"])]]["interfaces"]) if json.dumps(t["key"]) in by_key else set()
        if want <= got:
            s = "일치"
        elif want & got:
            s = "일부"
        elif got:
            s = "다름"
        else:
            s = "미판정"
        stat[s] += 1
        if s != "일치":
            r = rows.get(by_key.get(json.dumps(t["key"])), {})
            print("  %-4s %-42s 기존 %-22s 판정 %-22s %s" % (s, t["term"], "/".join(sorted(want)), "/".join(sorted(got)) or "-",
                                                      ",".join(d["code"] for d in r.get("decisions", []))))
    print("  ", dict(stat))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) > 2 and sys.argv[2] == "--judge":
        judge_compare(sys.argv[1])
        sys.exit(0)
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "slack"))
