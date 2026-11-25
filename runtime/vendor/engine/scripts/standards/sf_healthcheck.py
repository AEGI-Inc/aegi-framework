"""Salesforce Health Check 기본 기준선 44개 항목을 기준 하나 단위 형식으로 옮긴다. 판정은 Salesforce 가 했고(RiskType), AEGI 는 옮기기만 한다.
입력은 추가 설정 수집 run 의 SFS-01(Tooling API SecurityHealthCheckRisks). Health Check 는 항목별 조직 값만 주고 개별 객체(인증서·원격 사이트·사용자)는 주지 않아 대상은 조직 노드 하나다.
사용: run_all.py 가 부른다(README.md)
"""
import std_paths as P
import json, os, sys, collections

RAW, UNIQ, DS, OUT = P.EXTRA, P.UNIQ, P.DS, P.out("sf_healthcheck")
STD = "Salesforce Health Check 기본 기준선 (SecurityHealthCheckRisks StandardValue)"
fid = {s["id"]: f["finding_id"] for f in json.load(open(UNIQ, encoding="utf-8")) for s in f["sources"] if s["source"].startswith("Salesforce Health")}
objs = json.load(open(os.path.join(DS, "objects.json"), encoding="utf-8"))
org = next(o["fixture_key"] for o in objs if o["canonical"]["provider"] == "salesforce" and o["canonical"]["object_type"] == "Organization")

recs = json.load(open(os.path.join(RAW, "salesforce", "SFS-01-0002.json"), encoding="utf-8"))["payload"]["records"]
items = []
for r in recs:
    st = "pass" if r["RiskType"] == "MEETS_STANDARD" else "fail"
    items.append({"item_id": r["DurableId"], "title": r["Setting"], "finding_id": fid.get(r["DurableId"]), "status": st, "threshold": r["StandardValue"],
                  "rule": {"source": "SFS-01 Tooling API SecurityHealthCheckRisks", "field": f"{r['SettingGroup']}.{r['Setting']}", "condition": "RiskType == MEETS_STANDARD",
                           "combine": "판정은 Salesforce 가 함. AEGI 는 결과를 옮김"},
                  "targets": [{"key": org, "in_graph": True, "name": "Organization", "value": r["OrgValue"], "status": st}],
                  "note": f"Salesforce 위험 등급 {r['RiskType']}"})
out = {"standard": STD, "tier": 2, "provider": "salesforce", "raw_run": os.path.basename(RAW.rstrip("\\/")), "items": items}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(items), "items", dict(collections.Counter(i["status"] for i in items)), collections.Counter(r["RiskType"] for r in recs), "finding 미연결:", [i["item_id"] for i in items if not i["finding_id"]])
