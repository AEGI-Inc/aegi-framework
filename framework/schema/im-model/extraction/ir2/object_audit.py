# -*- coding: utf-8 -*-
"""ID 공간 = 오브젝트로 볼 때 누락과 불필요를 조사한다 (2026-10-16).

    python object_audit.py          # out2/object_audit.json, out2/object_audit.md

비교 기준: aegi-schema/data/AEGI_Object_List_Final_2026-09-20.xlsx 의 Final_Reconciliation (후보 748건, 최종 판정과 근거 API).
후보와 공간은 이름이 아니라 근거 API 경로로 잇는다: 근거 API 의 메서드와 경로를 IR 동작의 경로 틀에 맞추고(글자 조각 같음, {} 는 {}),
그 동작이 고르는 위치나 돌려주는 모양의 공간을 본다. Slack 은 메서드 이름(같은 명명 체계의 식별자)으로 맞춘다.
이 스크립트는 판정이 아니라 조사용이다.
"""
import collections
import io
import json
import os
import re
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
NEMO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
XLSX = os.path.join(NEMO, "aegi-knowledge", "schema", "data", "AEGI_Object_List_Final_2026-09-20.xlsx")
PROV = {"GitHub": "github", "Okta": "okta", "Slack": "slack", "Google Workspace": "gws"}

sys.path.insert(0, HERE)
from map3 import Map3, pos_of, segs   # noqa: E402


def candidates():
    ws = openpyxl.load_workbook(XLSX, read_only=True)["Final_Reconciliation"]
    rows = list(ws.iter_rows(values_only=True))
    hdr = rows[3]
    out = []
    for r in rows[4:]:
        if not r or not r[0]:
            continue
        d = dict(zip(hdr, r))
        out.append({"saas": d["SaaS"], "id": d["ID"], "name": d["최종 Object 명칭"], "verdict": d["최종 판정"],
                    "interface": d["최종 Interface"], "reason": (d["최종 판단 근거"] or "")[:300], "api": d["근거 API"] or ""})
    return out


REST = re.compile(r"\[?\b((?:GET|POST|PUT|PATCH|DELETE)(?:/(?:GET|POST|PUT|PATCH|DELETE))*)\]?\s+`?(/?[A-Za-z0-9_{}\-./:*]+)")
GQL = re.compile(r"GraphQL\s+`?([A-Z][A-Za-z0-9]+)|`([A-Z][A-Za-z0-9]+)`")
SLACK = re.compile(r"`?\b([a-z][a-zA-Z]+(?:\.[a-zA-Z0-9]+){1,4})\b`?")   # 2026-10-18: oauth.v2.access 처럼 숫자 조각


class Matcher:
    def __init__(self, p):
        self.p = p
        m = Map3(p)
        m.build_edges()
        m.spaces()
        m.ids()                                            # 다른 출처 모양 맞춤까지
        self.m = m
        self.tmpls = []
        for oid, o in m.ops.items():
            if o.get("path"):
                self.tmpls.append((segs(o["path"]["template"]), o["method"], oid))
        self.by_name = collections.defaultdict(list)
        for oid, o in m.ops.items():
            self.by_name[o["name"]].append(oid)
        # 지도 결과의 relation, 부모 안 레코드 결정자 (공간이 아니어도 오브젝트에 해당한다, 루프 19)
        self.op_dets = collections.defaultdict(set)
        mp = os.path.join(HERE, "out2", p, "map", "info_map.json")
        im = json.load(io.open(mp, encoding="utf-8"))
        # 참조로만 있는 공간(ref_only, catalog_key): 응답 레코드의 필드가 그 공간을 가리키면 닿은 것으로 본다 (2026-10-18)
        side = {k for k, v in im["spaces"].items() if v["form"] in ("ref_only", "catalog_key")}
        self.ref_side = collections.defaultdict(set)
        for sh_, pr_, r_ in im["id_roles"]:
            if isinstance(r_.get("target"), str) and r_["target"] in side:
                self.ref_side[sh_].add(r_["target"])
        # 복합키 자격증명 오브젝트(R2a): 그 자리를 돌려주는 동작에 닿으면 그 오브젝트에 닿은 것으로 본다 (2026-10-18)
        for k_, v_ in im["spaces"].items():
            if v_["form"] == "composite_key":
                for oid in v_.get("operations") or []:
                    self.op_dets[oid].add("composite:" + k_)
        for it in im["items"]:
            if it["det"].startswith(("relation:", "local:")):
                for oid in it["read_by"]:
                    self.op_dets[oid].add(it["det"])

    def ops_for(self, api):
        found = []
        for meths, path in REST.findall(api):
            g = [s for s in path.split("?")[0].strip("/").split("/") if s and s not in ("...", "*")]
            best, bl = [], (False, 0)
            for t, tm, oid in self.tmpls:
                if tm not in meths.split("/") or not t:
                    continue
                k = min(len(t), len(g))                    # 끝에서부터 짧은 쪽 길이만큼 (어느 쪽에 접두사가 붙어도)
                tt, gg = t[len(t) - k:], g[len(g) - k:]
                if all((a.startswith("{") and b.startswith("{")) or a == b for a, b in zip(tt, gg)):
                    lit = sum(1 for a in tt if not a.startswith("{"))
                    if lit == 0:
                        continue                   # 글자 조각 없는 틀({} 하나)은 아무 경로 끝에나 맞는다
                    lit = (len(t) == len(g), lit)  # 길이까지 같은 틀을 먼저 (2026-10-18, /users/{u} 가 .../users/{u} 에 붙지 않게)
                    if lit > bl:
                        best, bl = [oid], lit
                    elif lit == bl:
                        best.append(oid)
            found += best
        if self.p in ("slack", "gws"):           # 메서드 이름 또는 Discovery 메서드 id (같은 출처의 식별자)
            for name in SLACK.findall(api):
                found += self.by_name.get(name, [])
        return sorted(set(found))

    def graphql_spaces(self, api):
        """GraphQL 타입 이름(SDL 의 같은 이름 타입 모양)이 속한 공간. GitHub 의 GraphQL 전용 후보용"""
        out = set()
        if "GraphQL" not in api:
            return out
        for t in {x or y for x, y in GQL.findall(api)}:
            for sid, sh in self.m.shapes.items():
                if sh.get("name") == t and sh["src"]["source"].startswith("gh_graphql") and self.m.shape_space.get(sid):
                    out.add(self.m.shape_space[sid])
        return out

    def spaces_for(self, oid):
        m, o = self.m, self.m.ops[oid]
        out = set()
        if o.get("path") and o["path"]["positions"]:
            t = o["path"]["template"]
            if segs(t)[-1].startswith("{"):
                sp = m.pos_space.get(pos_of(t, len(segs(t)) - 1))
                if sp:
                    out.add(("position", sp))
        out |= {("relation", d) for d in self.op_dets.get(oid, ())}
        if out:
            return out                             # 위치로 닿으면 그것만 (목록을 돌려주는 동작이 원소 공간으로 잡히지 않게)
        r = m.resp(o)
        if r:
            for x in m.obj(r):
                out |= {("ref_only", t) for t in self.ref_side.get(x, ())}
            for x in m.obj(r) + m.element(r):
                if m.shape_space.get(x):
                    out.add(("response", m.shape_space[x]))
                elif x in m.shapes:                # 래퍼 응답 안 한 단계 박힌 레코드 (Slack bots.info 의 bot)
                    for pr in m.shapes[x].get("props") or []:
                        for y in m.obj(pr.get("shape") or ""):
                            if m.shape_space.get(y):
                                out.add(("embedded", m.shape_space[y]))
        return out


def audit():
    cands = candidates()
    res = {}
    for saas, p in PROV.items():
        mt = Matcher(p)
        rows = []
        for c in cands:
            if c["saas"] != saas:
                continue
            ops = mt.ops_for(c["api"])
            sps = set()
            for oid in ops:
                sps |= {s for _, s in mt.spaces_for(oid)}
            sps |= mt.graphql_spaces(c["api"])
            rows.append(dict(c, ops=ops[:6], n_ops=len(ops), spaces=sorted(sps)))
        inc = [r for r in rows if r["verdict"] == "포함"]
        space_inc = collections.defaultdict(list)
        space_exc = collections.defaultdict(list)
        for r in rows:
            for s in r["spaces"]:
                (space_inc if r["verdict"] == "포함" else space_exc)[s].append(r)
        missing = []
        for r in inc:
            if r["spaces"]:
                continue
            if not r["api"].strip():
                why = "근거 API 없음"
            elif not r["n_ops"]:
                why = "근거 API 가 IR 동작에 없음"
            else:
                rs = [mt.m.resp(mt.m.ops[o]) for o in r["ops"]]
                why = "동작은 있으나 응답 모양이 없음" if not any(rs) else "동작은 있으나 응답 모양이 공간이 아님"
            missing.append(dict(r, why=why))
        merged = {s: v for s, v in space_inc.items() if len(v) > 1}
        spaces = mt.m.space
        flags = {k: v.get("object_candidate", True) for k, v in json.load(io.open(
            os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))["spaces"].items()}
        unnecessary, not_candidate = [], 0
        for root, sp in spaces.items():
            n = sp["name"]
            if n in space_inc:
                continue
            if not flags.get(n, True):
                not_candidate += 1                         # 오브젝트 후보가 아닌 공간 (원문 키만, 닿지 않음)
                continue
            if n in space_exc:
                unnecessary.append({"space": n, "form": sp["form"], "why": "후보 목록이 제외나 보류로 판정",
                                    "candidates": [(x["name"], x["verdict"], x["reason"][:160]) for x in space_exc[n][:3]]})
            else:
                unnecessary.append({"space": n, "form": sp["form"], "why": "후보 목록의 근거 API 와 맞는 후보 없음",
                                    "positions": sp["item_positions"][:2], "shapes": [x.split(":")[-1] for x in sp["shapes"][:4]]})
        res[p] = {"included": len(inc), "covered": sum(1 for r in inc if r["spaces"]), "missing": missing,
                  "merged": {s: [(x["name"], x["interface"]) for x in v] for s, v in merged.items()},
                  "spaces": len(spaces), "spaces_with_included": len(space_inc), "unnecessary": unnecessary,
                  "object_candidates": sum(1 for v in flags.values() if v), "not_candidate": not_candidate,
                  "rows": rows}
    with io.open(os.path.join(HERE, "out2", "object_audit.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, ensure_ascii=False, indent=1, sort_keys=True)
    return res


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    r = audit()
    for p, v in r.items():
        mw = collections.Counter(x["why"] for x in v["missing"])
        uw = collections.Counter((x["why"], x["form"]) for x in v["unnecessary"])
        print("== %s 포함 %d, 공간에 닿음 %d, 누락 %d %s" % (p, v["included"], v["covered"], len(v["missing"]), dict(mw)))
        print("   공간 %d, 포함 후보가 닿은 공간 %d, 한 공간에 포함 후보 여럿 %d" % (v["spaces"], v["spaces_with_included"], len(v["merged"])))
        print("   오브젝트 후보 공간 %d (후보 아님 %d), 불필요 후보 %d %s" % (v["object_candidates"], v["not_candidate"], len(v["unnecessary"]), dict(uw)))
