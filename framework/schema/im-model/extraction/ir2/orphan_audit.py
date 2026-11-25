# -*- coding: utf-8 -*-
"""고아 정보가 기존 자료(확정 목록 748건)나 Cartography 노드에 대응하는지 조사한다 (2026-10-18).

    python orphan_audit.py          # out2/orphan_audit.json

고아 묶음(레코드 모양)마다 그 정보를 돌려주는 동작을 모으고, 근거 API 가 같은 동작에 맞는 후보(최종 판정 무관)와
Cartography 노드를 찾는다. 잇는 방법은 object_audit.Matcher 와 같다 (이름 비교가 아니라 API).
"""
import collections
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from object_audit import Matcher, candidates, PROV   # noqa: E402
from carto_audit import NODES                        # noqa: E402

CARTO_P = {"slack": "slack", "github": "github", "okta": "okta", "gws": "gws", "jira": "jira"}


def audit():
    cands = candidates()
    out = {}
    for p in ["slack", "github", "okta", "gws", "jira", "confluence", "atlassian"]:
        mt = Matcher(p)
        im = json.load(io.open(os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))
        roots = collections.defaultdict(lambda: {"items": 0, "ops": set(), "fields": []})
        for it in im["items"]:
            if it["det"].startswith("orphan:"):
                r = roots[it["det"][7:]]
                r["items"] += 1
                r["ops"] |= set(it.get("read_by") or [])
                if len(r["fields"]) < 6:
                    r["fields"].append(it["rel"])
        by_op = collections.defaultdict(list)
        saas = {v: k for k, v in PROV.items()}.get(p)
        for c in cands:
            if c["saas"] != saas:
                continue
            for oid in mt.ops_for(c["api"]):
                by_op[oid].append(c)
        carto_op = collections.defaultdict(list)
        for label, idf, apis, ev, derived in NODES.get(CARTO_P.get(p, ""), []):
            for a in apis:
                if a.startswith("sObject "):
                    continue
                for oid in mt.ops_for(a):
                    carto_op[oid].append(label)
        rows = []
        for sid, r in sorted(roots.items(), key=lambda x: -x[1]["items"]):
            hit = {}
            for oid in r["ops"]:
                for c in by_op.get(oid, []):
                    hit[c["id"]] = c
            carto = sorted({l for oid in r["ops"] for l in carto_op.get(oid, [])})
            rows.append({"root": sid, "items": r["items"], "fields": r["fields"],
                         "ops": sorted(mt.m.ops[o]["name"] for o in r["ops"] if o in mt.m.ops)[:5],
                         "xlsx": [{"id": c["id"], "name": c["name"], "verdict": c["verdict"], "interface": c["interface"],
                                   "reason": c["reason"][:160]} for c in sorted(hit.values(), key=lambda c: c["id"])][:6],
                         "carto": carto})
        out[p] = rows
    with io.open(os.path.join(HERE, "out2", "orphan_audit.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for p, rows in audit().items():
        n = len(rows)
        hx = [r for r in rows if r["xlsx"]]
        hc = [r for r in rows if r["carto"]]
        vc = collections.Counter(c["verdict"] for r in hx for c in r["xlsx"])
        print("== %s 고아 묶음 %d (항목 %d), 기존 자료 맞음 %d (항목 %d) %s, Cartography 맞음 %d" % (
            p, n, sum(r["items"] for r in rows), len(hx), sum(r["items"] for r in hx), dict(vc), len(hc)))
