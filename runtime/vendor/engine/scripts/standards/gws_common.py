"""GWS 기준별 판정 스크립트가 같이 쓰는 부분: 수집 원본 읽기, 적용 정책 고르기, 결과 항목 만들기.
같은 설정의 정책이 여럿이면 sortOrder 가 가장 큰 값이 적용된다(Policy API 개념 문서 Reduction 절). 라이선스 할당은 수집 원본에 없어 전원이 가졌다고 가정한다.
"""
import json, glob, os, collections, urllib.parse


class Run:
    def __init__(self, raw, uniq, ds, std_prefix, titles):
        self.gw = os.path.join(raw, "gws")
        self.titles = titles
        self.fid = {s["id"]: f["finding_id"] for f in json.load(open(uniq, encoding="utf-8")) for s in f["sources"] if s["source"].startswith(std_prefix)}
        self.keys = {o["fixture_key"] for o in json.load(open(os.path.join(ds, "objects.json"), encoding="utf-8"))}
        root = next(ou["parentOrgUnitId"].replace("id:", "") for p in self.payloads("GW-20") for ou in p.get("organizationUnits", []) if ou.get("parentOrgUnitPath") == "/")
        self.pol = collections.defaultdict(list)
        for p in self.payloads("GW-24"):
            for x in p.get("policies", []):
                q = x.get("policyQuery") or {}
                if q.get("group") or q.get("orgUnit") != f"orgUnits/{root}": continue
                self.pol[x["setting"]["type"].replace("settings/", "")].append({"name": x["name"], "sort": float(q.get("sortOrder") or 0), "value": x["setting"].get("value") or {}})
        self.users = [u for p in self.payloads("GW-03") for u in (p.get("users", []) if isinstance(p, dict) else p)]
        self.items = {}

    def payloads(self, call):
        for f in sorted(glob.glob(os.path.join(self.gw, f"{call}-*.json"))):
            yield json.load(open(f, encoding="utf-8"))["payload"] or {}

    def tkey(self, k): return {"key": k, "in_graph": k in self.keys}
    def pkey(self, name): return self.tkey("im:gws:Policy:" + urllib.parse.quote(name, safe=""))
    def ukey(self, u): return self.tkey(f"im:gws:User:{u['id']}")
    def eff(self, stype):
        vs = self.pol.get(stype)
        return max(vs, key=lambda t: t["sort"]) if vs else None

    def emit(self, iid, status, rule, threshold="", targets=(), note=""):
        """status: pass | fail | unknown(값은 있으나 해석 불가) | not_collected(수집 없음) | org_policy(조직이 정한 값 필요) | manual(사람 검토)"""
        self.items[iid] = {"item_id": iid, "title": self.titles.get(iid, ""), "finding_id": self.fid.get(iid), "status": status,
                           "threshold": threshold, "rule": rule, "targets": list(targets), "note": note}

    def setting(self, iid, stype, field, test, want, note=""):
        """적용 정책 하나의 값으로 판정. test 가 None 을 돌려주면 해석 불가"""
        rule = {"source": f"GW-24 {stype}", "field": field, "condition": want, "combine": "같은 설정의 정책 중 sortOrder 가 가장 큰 값"}
        e = self.eff(stype)
        if not e: self.emit(iid, "not_collected", rule, want, note=f"{stype} 가 GW-24 에 없음"); return
        r = test(e["value"])
        st = "unknown" if r is None else ("pass" if r else "fail")
        shown = {k: e["value"].get(k) for k in field.split(",")} if "," in field else e["value"].get(field)
        self.emit(iid, st, rule, want, [{**self.pkey(e["name"]), "name": stype, "value": shown, "status": st}], note)

    def absent(self, iid, what, note=""):
        self.emit(iid, "not_collected", {"source": "없음", "field": what, "condition": "", "combine": ""}, note=note or f"{what} 설정이 GW-24 163종에 없다")

    def enforced_2sv(self, iid, who, rule_cond, note):
        """활성 사용자(who 로 거름)의 isEnforcedIn2Sv. 강제 안 된 사용자가 있으면 위반, 다 강제면 나머지 조건을 못 봐 해석 불가"""
        ts = [{**self.ukey(u), "name": u["primaryEmail"], "value": u.get("isEnforcedIn2Sv"), "status": "pass" if u.get("isEnforcedIn2Sv") else "fail"}
              for u in self.users if not u.get("suspended") and who(u)]
        self.emit(iid, "fail" if any(t["status"] == "fail" for t in ts) else "unknown",
                  {"source": "GW-03 users", "field": "isEnforcedIn2Sv", "condition": rule_cond, "combine": "대상 사용자마다 본다. 2SV 가 강제되지 않은 사용자가 있으면 위반"}, rule_cond, ts, note)

    def write(self, out, std, tier, raw):
        res = {"standard": std, "tier": tier, "provider": "gws", "raw_run": os.path.basename(raw.rstrip("\\/")), "items": [self.items[k] for k in self.titles if k in self.items]}
        json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(len(self.items), "items", dict(collections.Counter(i["status"] for i in self.items.values())), "누락:", sorted(set(self.titles) - set(self.items)))
        for i in res["items"]:
            if i["status"] in ("pass", "fail", "unknown"):
                print(f"{i['item_id']:24} {i['status']:8} " + "; ".join(f"{t['name']}={json.dumps(t['value'], ensure_ascii=False)}" for t in i["targets"])[:100])
        print("그래프에 없는 대상 키:", len({t["key"] for i in self.items.values() for t in i["targets"] if not t["in_graph"]}))


dur = lambda s: int(str(s).rstrip("s") or 0)
