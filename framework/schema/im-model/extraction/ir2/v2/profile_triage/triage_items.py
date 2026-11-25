# -*- coding: utf-8 -*-
"""판단표 3차 1/3: 대상 뽑기. 기존 「포함」 중 IM 수집 Profile 이 없는 항목 (-> out2/profile_triage/items.json)"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "out2", "profile_triage")
d = json.load(io.open(os.path.join(OUT, "data.json"), encoding="utf-8"))
inc = lambda o: o["verdict"] in ("포함", "데이터셋 전용")
rk = {"profile": 3, "research": 2, "none": 1}
best = {}
for r in d["rows"]:
    st = "profile" if r["profile"] else ("research" if r["im_types"] else "none")
    for o in r["old"]:
        if not inc(o):
            continue
        k = (r["provider"], o["id"])
        cand = {"p": r["provider"], "id": o["id"], "name": o["name"], "if": o["interface"], "st": st, "api": o["api"][:160],
                "why": o.get("why", ""), "space": [t["space"] for t in r["im_types"]][:2],
                "rif": sorted({i for t in r["im_types"] for i in t["interfaces"]}),
                "carto": [c["node"] for c in r["carto"]], "ds": o["dataset"]}
        if k not in best or rk[st] > rk[best[k]["st"]]:
            best[k] = cand
items = sorted((v for v in best.values() if v["st"] != "profile"), key=lambda x: (x["p"], x["st"], x["if"], x["name"]))
json.dump(items, io.open(os.path.join(OUT, "items.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(len(items))
