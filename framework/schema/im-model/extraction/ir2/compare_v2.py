# -*- coding: utf-8 -*-
"""옛 IR(out/<provider>/ir)과 새 IR(out2/<provider>/ir) 대조. 새 IR 이 옛 IR 의 정보를 잃지 않았는지 본다.

    python compare_v2.py              # 8개 전부
    python compare_v2.py github okta

보는 것:
- 개체 수 (옛 파일별, 새 종류별)
- 동작: 옛 동작이 새 동작에 있는가 (이름, 또는 메서드와 경로 틀 {} 로 맞춘다)
- 응답 자리: 맞춘 동작마다 옛 응답 자리 경로($.a[*].b)가 새 응답 모양을 펼친 경로에 있는가 (union 은 대안 전부를 펼친다)
- 요청 자리, 인자 이름
- 키: 옛 응답 레코드 자리(사전 키 필드가 아래에 있는 객체)의 새 모양에 key_decl 이 있는가
- 참조: 옛 ref_def, ref_targets, GraphQL 객체형 필드 수와 새 ref_decl
- 예시: 옛 자리 예시 값(example, examples, samples)이 새 instance 값에 있는가
- 카탈로그, 권한 어휘, 구멍
결과: out2/<provider>/compare_v2.json, out2/compare_v2.md
"""
import collections
import io
import json
import os
import re
import sys

import core

PROVIDERS = ("github", "okta", "slack", "salesforce", "gws", "jira", "confluence", "atlassian")
OLD = os.path.join(core.CE, "out")


def load_old(p, name):
    f = os.path.join(OLD, p, "ir", name)
    return [json.loads(l) for l in io.open(f, encoding="utf-8")] if os.path.exists(f) else []


def tmpl(path):
    return "/" + re.sub(r"\{[^}]+\}", "{}", path.strip("/"))


def snake(display):
    t = re.sub(r"[’'`]", "", (display or "").lower())
    t = re.sub(r"\(.*?\)", " ", t)
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


class New:
    def __init__(self, p):
        self.ir = core.load_ir(p)
        self.sh = {s["id"]: s for s in self.ir["shape"]}
        self.keyed = {k["shape"] for k in self.ir["key_decl"]}

    def expand(self, sid, base="$", out=None, seen=(), depth=0):
        """모양 -> {자리 경로: 그 자리의 모양 id 집합}"""
        out = {} if out is None else out
        s = self.sh.get(sid)
        if not s or depth > 40:
            return out
        if s.get("name") and sid in seen:
            out.setdefault(base, set()).add(sid)
            return out
        seen = seen + (sid,)
        out.setdefault(base, set()).add(sid)
        if s["kind"] == "union":
            for a in s.get("alts") or []:
                self.expand(a, base, out, seen, depth + 1)
            for p in s.get("props") or []:
                self.prop(p, base, out, seen, depth)
        elif s["kind"] == "array":
            it = s.get("items") or {}
            if it.get("shape"):
                self.expand(it["shape"], base + "[*]", out, seen, depth + 1)
            else:
                out.setdefault(base + "[*]", set())
        elif s["kind"] == "object":
            for p in s.get("props") or []:
                self.prop(p, base, out, seen, depth)
        return out

    def prop(self, p, base, out, seen, depth):
        path = base + "." + p["name"]
        if p.get("shape"):
            self.expand(p["shape"], path, out, seen, depth + 1)
        else:
            out.setdefault(path, set())


def values(v, out):
    if isinstance(v, dict):
        for x in v.values():
            values(x, out)
    elif isinstance(v, list):
        for x in v:
            values(x, out)
    elif v is not None:
        out.add(str(v)[:80])


def compare(p):
    res = {"provider": p}
    old_ops = load_old(p, "operations.jsonl")
    old_fields = load_old(p, "fields.jsonl")
    old_events = load_old(p, "events.jsonl")
    old_vocab = load_old(p, "grant_vocab.jsonl")
    old_holes = load_old(p, "holes.jsonl")
    old_defs = load_old(p, "id_defs.jsonl")
    old_gql = load_old(p, "graphql_types.jsonl")
    n = New(p)
    res["counts_old"] = {"operations": len(old_ops), "fields": len(old_fields), "events": len(old_events),
                         "grant_vocab": len(old_vocab), "holes": len(old_holes), "id_defs": len(old_defs),
                         "graphql_types": len(old_gql)}
    res["counts_new"] = {k: len(v) for k, v in n.ir.items()}

    # 동작 맞추기
    by_name = collections.defaultdict(list)
    by_path = collections.defaultdict(list)
    for o in n.ir["operation"]:
        by_name[o["name"]].append(o)
        if o.get("path"):
            by_path[(o["method"] or "", tmpl(o["path"]["template"]))].append(o)
            raw = (o.get("ext") or {}).get("raw_path")
            if raw:
                by_path[(o["method"] or "", tmpl(raw))].append(o)
    match, unmatched = {}, []
    for o in old_ops:
        cands = by_name.get(o["method"]) or by_name.get(o["op_id"].split(".", 1)[1] if "." in o["op_id"] else "") or \
            by_path.get(((o.get("http_method") or "").upper(), tmpl(o.get("path") or ""))) or []
        if o.get("surface") == "rpc" and not cands:
            cands = by_name.get(o["method"]) or []
        if cands:
            match[o["op_id"]] = sorted(cands, key=lambda x: (x["src"]["rank"], x["id"]))
        else:
            unmatched.append(o["op_id"])
    res["operations"] = {"old": len(old_ops), "matched": len(match), "unmatched": len(unmatched),
                         "unmatched_sample": sorted(unmatched)[:15], "new": len(n.ir["operation"])}

    # 응답, 요청 자리
    old_slots = collections.defaultdict(lambda: collections.defaultdict(set))
    old_samples = set()
    for f in old_fields:
        old_slots[(f["op_id"], f["side"])][f["path"]].add(str(f.get("type")))
        for k in ("example",):
            if f.get(k):
                old_samples.add(str(f[k])[:80])
        for k in ("examples", "samples"):
            for x in f.get(k) or []:
                old_samples.add(str(x)[:80])
    side_stats = {}
    lost = collections.Counter()
    lost_by_op = collections.Counter()
    norm_found = collections.Counter()
    lost_sample = []
    key_total = key_ok = 0
    lex = core.lexicon(p)
    keys = lex.get("record_key_fields", ["id"])
    for side in ("response", "request"):
        tot = found = 0
        for oid, ops in sorted(match.items()):
            slots = old_slots.get((oid, side))
            if not slots:
                continue
            exp = {}
            for o in ops:
                if side == "response":
                    shapes = [x["shape"] for x in o["responses"] if x["shape"] and (x["status"] is None or str(x["status"]).startswith("2"))]
                else:
                    shapes = [o["request"]] if o.get("request") else []
                for s in shapes:
                    for k, v in n.expand(s).items():
                        exp.setdefault(k, set()).update(v)
            flat = {k.replace("[*]", "") for k in exp}
            for path in slots:
                tot += 1
                if path not in exp and path.replace("[*]", "") in flat:
                    norm_found[side] += 1          # 배열 표기만 다르다 (옛 IR 은 대안 목록 items[] 를 [*] 없이 펼쳤다)
                    found += 1
                    continue
                if path in exp:
                    found += 1
                    if side == "response" and any(path + "." + k in slots for k in keys) and "object" in slots[path]:
                        key_total += 1
                        if exp[path] & n.keyed:
                            key_ok += 1
                else:
                    lost[side] += 1
                    lost_by_op[(oid, side)] += 1
                    if len(lost_sample) < 15:
                        lost_sample.append({"op": oid, "side": side, "path": path})
        side_stats[side] = {"old_slots": tot, "found_in_new": found, "found_only_ignoring_array_marks": norm_found[side]}
    res["slots"] = side_stats
    res["slots_lost_sample"] = lost_sample
    res["slots_lost_by_op"] = [{"op": k[0], "side": k[1], "lost": v} for k, v in lost_by_op.most_common(15)]
    res["keys"] = {"old_record_slots_with_key_field": key_total, "new_shape_has_key_decl": key_ok,
                   "new_key_decl": len(n.ir["key_decl"]),
                   "by_grade": dict(collections.Counter(k["grade"] for k in n.ir["key_decl"]))}

    # 인자
    tot = found = 0
    for o in old_ops:
        ops = match.get(o["op_id"])
        if not ops:
            continue
        names = set()
        for x in ops:
            names |= {q["name"] for q in x["params"]}
            if x.get("request") and n.sh.get(x["request"]):
                names |= {q["name"] for q in n.sh[x["request"]].get("props") or []}
        for q in o.get("params") or []:
            tot += 1
            found += q["name"] in names
    res["params"] = {"old": tot, "found_in_new": found}

    # 참조
    old_ref = sum(1 for f in old_fields if f.get("ref_def") or f.get("ref_targets"))
    gtypes = {t["name"]: t for t in old_gql}
    old_gref = sum(1 for t in old_gql if t["kind"] in ("object", "interface") and t["name"] not in ("Query", "Mutation")
                   for f in t.get("fields") or [] if (gtypes.get(f.get("type")) or {}).get("kind") in ("object", "interface", "union"))
    res["refs"] = {"old_ref_def_or_targets": old_ref, "old_graphql_object_fields": old_gref,
                   "new_ref_decl": len(n.ir["ref_decl"]), "new_poly": sum(1 for r in n.ir["ref_decl"] if r["poly"])}
    res["id_formats"] = {"old_id_defs": len(old_defs), "new_id_format": len(n.ir["id_format"])}

    # 예시
    new_vals = set()
    for i in n.ir["instance"]:
        values(i["value"], new_vals)
    res["examples"] = {"old_distinct_values": len(old_samples), "found_in_new_instances": len(old_samples & new_vals),
                       "new_instances": len(n.ir["instance"]),
                       "new_by_grade": dict(collections.Counter(i["grade"] for i in n.ir["instance"]))}
    miss = sorted(old_samples - new_vals)
    res["examples"]["missing_sample"] = miss[:10]

    # 카탈로그
    new_keys = set()
    for c in n.ir["catalog"]:
        for k in (c.get("key"), (c.get("ext") or {}).get("action")):
            if k:
                new_keys.add(k)
        if c.get("display"):
            new_keys.add(snake(c["display"]))
            new_keys.add(c["display"])
            new_keys.add(snake(re.sub(r" Event Type$", "", c["display"])))     # 옛 Salesforce ELF 이름 (제목에서 만든 이름)
            if c["display"] == "ChangeEventHeader Fields":
                new_keys.add("change_event")                                   # 옛 Salesforce 이름 (변환기가 지은 이름)
    for c in n.ir["catalog"]:
        if c.get("key") and (c.get("ext") or {}).get("action"):
            new_keys.add("%s.%s" % (c["key"], c["ext"]["action"]))
    oe = collections.Counter()
    oe_found = collections.Counter()
    oe_miss = []
    for e in old_events:
        cat = e["catalog"]
        oe[cat] += 1
        nm = e["name"]
        ok = nm in new_keys or nm.lower() in {k.lower() for k in new_keys if isinstance(k, str)} if cat != "audit_entity" else True
        if ok:
            oe_found[cat] += 1
        elif len(oe_miss) < 10:
            oe_miss.append("%s:%s" % (cat, nm))
    res["catalog"] = {"old_by_catalog": dict(oe), "old_found": dict(oe_found), "missing_sample": oe_miss,
                      "new_by_catalog": dict(collections.Counter(c["catalog"] for c in n.ir["catalog"])),
                      "new_without_key": sum(1 for c in n.ir["catalog"] if not c.get("key")),
                      "new_with_targets": sum(1 for c in n.ir["catalog"] if c.get("targets"))}

    # 권한 어휘
    gn = {g["name"] for g in n.ir["grant"]}
    gops_new = sum(len(g["operations"]) for g in n.ir["grant"])
    res["grants"] = {"old": len(old_vocab), "found_in_new": sum(1 for v in old_vocab if v["name"] in gn),
                     "missing_sample": sorted(v["name"] for v in old_vocab if v["name"] not in gn)[:10],
                     "old_op_links": sum(len(v.get("op_ids") or []) for v in old_vocab), "new_op_links": gops_new,
                     "new": len(n.ir["grant"])}
    res["holes"] = {"old": dict(collections.Counter(h["hole"] for h in old_holes)),
                    "new": dict(collections.Counter(h["hole"] for h in n.ir["hole"]))}
    with io.open(os.path.join(core.OUT2, p, "compare_v2.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    return res


def pct(a, b):
    return "%d/%d" % (a, b) if b else "-"


def main(args):
    ps = args or list(PROVIDERS)
    rows = []
    for p in ps:
        if not os.path.exists(os.path.join(core.OUT2, p, "ir")):
            continue
        r = compare(p)
        rows.append(r)
        print("%-11s 동작 %s 응답자리 %s 요청자리 %s 인자 %s 키 %s 예시값 %s 카탈로그 %s 권한 %s" % (
            p, pct(r["operations"]["matched"], r["operations"]["old"]),
            pct(r["slots"].get("response", {}).get("found_in_new", 0), r["slots"].get("response", {}).get("old_slots", 0)),
            pct(r["slots"].get("request", {}).get("found_in_new", 0), r["slots"].get("request", {}).get("old_slots", 0)),
            pct(r["params"]["found_in_new"], r["params"]["old"]),
            pct(r["keys"]["new_shape_has_key_decl"], r["keys"]["old_record_slots_with_key_field"]),
            pct(r["examples"]["found_in_new_instances"], r["examples"]["old_distinct_values"]),
            pct(sum(r["catalog"]["old_found"].values()), sum(r["catalog"]["old_by_catalog"].values())),
            pct(r["grants"]["found_in_new"], r["grants"]["old"])))
    if not args:
        lines = ["# 옛 IR 대조 (compare_v2.py)", "",
                 "| provider | 동작 | 응답 자리 | 요청 자리 | 인자 | 레코드 키 | 예시 값 | 카탈로그 | 권한 어휘 |",
                 "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for r in rows:
            lines.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
                r["provider"], pct(r["operations"]["matched"], r["operations"]["old"]),
                pct(r["slots"].get("response", {}).get("found_in_new", 0), r["slots"].get("response", {}).get("old_slots", 0)),
                pct(r["slots"].get("request", {}).get("found_in_new", 0), r["slots"].get("request", {}).get("old_slots", 0)),
                pct(r["params"]["found_in_new"], r["params"]["old"]),
                pct(r["keys"]["new_shape_has_key_decl"], r["keys"]["old_record_slots_with_key_field"]),
                pct(r["examples"]["found_in_new_instances"], r["examples"]["old_distinct_values"]),
                pct(sum(r["catalog"]["old_found"].values()), sum(r["catalog"]["old_by_catalog"].values())),
                pct(r["grants"]["found_in_new"], r["grants"]["old"])))
        with io.open(os.path.join(core.OUT2, "compare_v2.md"), "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
