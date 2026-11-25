# -*- coding: utf-8 -*-
"""SaaS 를 넘는 연결 — crosswalk.yaml 의 키 종류(kinds)와 칸 표시(fields)대로 잇는다.

    from ontology import join
    out = join.run(ontology.load("crosswalk"), objects, relations, records={})

objects    {키: 객체}. match.py 의 모양에 identifiers 를 더한 것 — {k, p, t, i, props, ids, judged, profile, meta, refs}
relations  [{rt, s, d, props}]. 끝 찾기(places)와 exists_relation 이 쓴다. 여기서 만든 관계도 뒤 종류의 식에 보인다
records    {출처: [기록 행]}. co_occurs 종류가 쓴다. 없는 출처는 「못 이은 이유」에 적는다
resolvers  relation_semantics.yaml 의 resolvers (places 가 이름으로 부를 때)
materials  {키: 객체}. Object 가 아닌 Link 재료(오브젝트 모델 v1 의 link_only). link_material 칸 표시만 여기서도 찾는다

반환 {relations, links, unjoined, shadowed}
  relations  [{rt, s, d, props, kind}]. props 에 basis 와 relation_marks
  links      [{a, b, level, kind, records}]
  unjoined   [{kind, why, holder, value}]. why 는
               empty      가리키는 칸(pointer)을 가질 객체인데 비어 있다
               no_target  가리키는 값인데 그 값을 가진 상대가 없다 (target_missing: report 일 때)
               no_record  기록 출처를 못 읽었다
               no_material  Link 재료 칸 표시인데 그 객체가 묶음에도 materials 에도 없다
               ambiguous  unique_match 필드가 여러 상대 끝점에 맞아 특정하지 못함
               where      값은 맞는데 조건(skip_if · where)에 걸렸다
  shadowed   [{kind, a, b}]. 같은 허브 계정 · 같은 provider 를 앞 종류가 이미 이어서 안 쓴 것 (link_one_per_provider)
"""
import collections
import re
import urllib.parse

from ontology import match

TRANSFORMS = ("strip_suffix", "require_suffix", "map", "email_domain", "path_segment_after", "url_host", "email_address")


# Link 단계의 세기 — 앞일수록 세다 (identity.yaml link_levels 에서 different 를 뺀 순서). level_cap 이 쓴다
STRENGTH = ("disclosed_relation", "resolved", "possibly_same", "possibly_related")


def _scalar(v):
    return v.get("value") if isinstance(v, dict) and "value" in v else v


def get(obj, path):
    """Nested paths with explicit [] traversal. Literal dotted keys retain precedence."""
    where, _, name = path.partition(".")
    box = obj.get("props") if where == "properties" else obj.get("ids") if where == "identifiers" else None
    if box is None:
        raise ValueError("모르는 칸 %s" % path)
    def walk(container, rest):
        if not isinstance(container, dict):
            return None
        if rest in container:
            return _scalar(container[rest])
        head, _, tail = rest.partition('.')
        if head.endswith('[]'):
            value = _scalar(container.get(head[:-2]))
            if not isinstance(value, list):
                return None
            if not tail:
                return value
            result = []
            for row in value:
                if isinstance(row, dict):
                    item = walk(row, tail)
                    result.extend(item if isinstance(item, list) else [item])
            return result
        return walk(container.get(head), tail) if tail else None
    return walk(box, name)


def get_record(row, path):
    v = row
    for part in path.split("."):
        v = v.get(part) if isinstance(v, dict) else None
    return v


EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
# 가린 값(마스킹)에 흔한 글자와 자리표시 값의 앞부분. 이런 값은 같아도 같은 사람이라는 근거가 아니다(crosswalk.yaml email_match)
EMAIL_MASK = ("*", "\u2022", "\u2026", "\u2588")
EMAIL_PLACEHOLDER = frozenset(("unknown", "none", "null", "nil", "undefined", "n/a", "na", "redacted", "hidden", "masked", "private",
                               "noemail", "no-email", "placeholder", "dummy", "changeme"))


def email_address(v):
    """이메일 칸 값 → 비교할 주소. 앞뒤 공백을 빼고, 이메일 모양이 아니거나 가렸거나 자리표시 값이면 빈 값(일치로 보지 않는다)"""
    v = v.strip()
    if not EMAIL_SHAPE.match(v) or any(c in v for c in EMAIL_MASK) or "redacted" in v.lower():
        return ""
    return "" if v.split("@")[0].lower() in EMAIL_PLACEHOLDER else v


def shared_local(value, local_parts):
    """주소 앞부분(+ 뒤를 뺀)이 공용 메일함 이름이면 True"""
    return value.split("@")[0].split("+")[0].lower() in local_parts


def normalize(value, transform, same):
    if value is None or value == "":
        return None
    v = str(value)
    for t in transform or []:
        if isinstance(t, dict) and "strip_suffix" in t:
            v = v[:-len(t["strip_suffix"])] if v.lower().endswith(t["strip_suffix"].lower()) else v
        elif isinstance(t, dict) and "map" in t:
            # 표에 있는 값만 그 짝 이름으로, 없으면 빈 값
            v = str(t["map"].get(v, ""))
        elif isinstance(t, dict) and "require_suffix" in t:
            # 끝이 그 글자면 떼고, 아니면 빈 값 (그 칸이 이 종류의 값이 아니다)
            v = v[:-len(t["require_suffix"])] if v.lower().endswith(t["require_suffix"].lower()) else ""
        elif t == "email_domain":
            v = v.split("@")[1] if "@" in v else ""
        elif t == "email_address":
            v = email_address(v)
        elif t == "url_host":
            # 절대 주소의 호스트 이름(소문자, 포트 뺌). 스킴이 없는 값은 빈 값
            try:
                v = urllib.parse.urlsplit(v).hostname or ""
            except ValueError:
                v = ""
        elif isinstance(t, dict) and "path_segment_after" in t:
            parts = v.split("/")
            i = parts.index(t["path_segment_after"]) if t["path_segment_after"] in parts else len(parts)
            v = parts[i + 1] if i + 1 < len(parts) else ""
        else:
            raise ValueError("모르는 transform %r" % (t,))
    if same == "casefold":
        v = v.strip().lower()
    return v or None


def fits(obj, to):
    if not to:
        return True
    want = to["object_type"] if isinstance(to["object_type"], list) else [to["object_type"]]
    return obj.get("p") == to["provider"] and obj.get("t") in want


def ends(obj, end, objects):
    if not end:
        return [obj["k"]]
    name = end.split(".", 1)[1]
    return [k for k in (obj.get("refs") or {}).get(name) or [] if k in objects]


def entries(fields, kind, side, same, objects, relations, skip_if=None, materials=None):
    """(값, 끝, 값을 가진 객체, 칸 표시) 목록과, 값이 비거나 재료가 없는 것."""
    out, misses = [], []
    for f in fields:
        if f["kind"] != kind or f["side"] != side:
            continue
        holders = [o for o in objects.values() if o.get("p") == f["provider"] and o.get("t") == f["object_type"]]
        if f.get("link_material"):
            holders += [o for o in (materials or {}).values()
                        if o.get("p") == f["provider"] and o.get("t") == f["object_type"] and o["k"] not in objects]
            if not holders:
                misses.append({"kind": kind, "why": "no_material", "holder": None, "value": "%s %s" % (f["provider"], f["object_type"])})
                continue
        for o in holders:
            # skip_if 는 "어느 쪽이든" 이라, 값을 가진 객체 하나를 양쪽에 두고 대 봐서 걸리면 아예 안 본다 (껍데기 등)
            if skip_if and match.holds(skip_if, match.Ctx({"a": o, "b": o}, relations)):
                continue
            if f.get("where"):
                parent = [objects[k] for k in (o.get("refs") or {}).get("parent") or [] if k in objects]
                if not match.holds(f["where"], match.Ctx({"self": o, "parent": parent}, relations)):
                    continue
            raw = get(o, f["path"])
            vals = [normalize(v, f.get("transform"), same) for v in (raw if isinstance(raw, list) else [raw])]
            vals = [v for v in vals if v]
            if not vals:
                # 가리키는 칸(pointer)이 빈 것만 적는다. 상대를 가리키지 않는 칸이 빈 것은 이을 거리가 없는 것이다
                if f.get("pointer"):
                    misses.append({"kind": kind, "why": "empty", "holder": o["k"], "value": None})
                continue
            for v in vals:
                for e in ends(o, f.get("end"), objects):
                    out.append({"value": v, "end": e, "holder": o["k"], "field": f})
    return out, misses


def domain_groups(alias, objects, relations):
    """도메인 -> 별칭 묶음 대표 (crosswalk.yaml email_match.domain_alias). domains 칸 값을 그 객체의 end(조직, 고객) 단위로 모으고,
    같은 end 의 도메인끼리, 겹치는 도메인으로 이어지는 묶음끼리 합친다. 값은 소문자로 비교한다"""
    parent = {}

    def find(d):
        while parent.setdefault(d, d) != d:
            parent[d] = parent[parent[d]]
            d = parent[d]
        return d

    by_end = collections.defaultdict(set)
    for f in alias.get("domains") or []:
        for o in objects.values():
            if o.get("p") != f["provider"] or o.get("t") != f["object_type"]:
                continue
            if f.get("where") and not match.holds(f["where"], match.Ctx({"self": o, "parent": []}, relations)):
                continue
            raw = get(o, f["path"])
            for v in (raw if isinstance(raw, list) else [raw]):
                if isinstance(v, str) and v.strip():
                    for e in ends(o, f.get("end"), objects):
                        by_end[e].add(v.strip().lower())
    for doms in by_end.values():
        doms = sorted(doms)
        for d in doms:
            parent[find(d)] = find(doms[0])
    return {d: find(d) for d in list(parent)}


def place_spec(spec, resolvers):
    """places 한 줄 → (출발 a · b, 끝 찾기 한 줄). resolver: <이름> 이면 relation_semantics.yaml resolvers 에서 가져온다."""
    start = spec.get("from")
    found = resolvers.get(spec["resolver"]) if "resolver" in spec else {k: v for k, v in spec.items() if k != "from"}
    return start, found


def _places(kind, a, b, objects, rel_from, resolvers):
    places = {"a": objects.get(a), "b": objects.get(b)}
    for n, spec in (kind.get("places") or {}).items():
        start, found = place_spec(spec, resolvers)
        places[n] = [objects[k] for k in match.resolve(found, a if start == "a" else b, objects, rel_from)]
    return places


def run(cw, objects, relations, records=None, resolvers=None, materials=None):
    records = records or {}
    resolvers = resolvers or {}
    fields = cw.get("fields") or []
    marks = cw.get("relation_marks") or {}
    email_match = cw.get("email_match") or {}
    shared = email_match.get("shared_mailbox") or {}
    shared_locals = frozenset(str(x).lower() for x in shared.get("local_parts") or [])
    alias = email_match.get("domain_alias") or {}
    alias_kinds = frozenset(alias.get("kinds") or [])
    is_email = lambda e: "email_address" in (e["field"].get("transform") or [])
    rels = list(relations)
    rel_from = collections.defaultdict(list)
    for r in rels:
        rel_from[r["s"]].append(r)
    out_rel, out_link, unjoined, shadowed = [], [], [], []
    linked = {}  # (허브 계정, 상대 provider) -> 먼저 이은 키 종류
    group = domain_groups(alias, objects, rels) if alias_kinds else {}

    for name, kind in (cw.get("kinds") or {}).items():
        same = kind["same"]
        A, miss_a = entries(fields, name, "a", same, objects, rels, cw.get("skip_if"), materials)
        B, miss_b = entries(fields, name, "b", same, objects, rels, cw.get("skip_if"), materials)
        pairs = []  # (a 끝, b 끝, a 항목, b 항목)
        aliased = set()  # 도메인 별칭으로 맞은 (a 항목, b 항목)
        if same == "co_occurs":
            unjoined += [m for m in miss_a + miss_b if m["why"] == "no_material"]
            for f in fields:
                if f["kind"] != name or f["side"] != "record":
                    continue
                if f["source"] not in records:
                    unjoined.append({"kind": name, "why": "no_record", "holder": None, "value": f["source"]})
                    continue
                for row in records[f["source"]]:
                    va, vb = normalize(get_record(row, f["a"]), None, "exact"), normalize(get_record(row, f["b"]), None, "exact")
                    pairs += [(x["end"], y["end"], x, y) for x in A if x["value"] == va for y in B if y["value"] == vb]
        else:
            unjoined += miss_a + miss_b
            b_by = collections.defaultdict(list)
            for y in B:
                b_by[y["value"]].append(y)
            hit_b = set()
            for x in A:
                found = [y for y in b_by.get(x["value"], [])
                         if fits(objects[y["end"]], x["field"].get("to")) and fits(objects[x["end"]], y["field"].get("to"))]
                for y in found:
                    hit_b.add(id(y))
                    pairs.append((x["end"], y["end"], x, y))
                if not found and x["field"].get("pointer") and kind["target_missing"] == "report":
                    unjoined.append({"kind": name, "why": "no_target", "holder": x["holder"], "value": x["value"]})
            for y in B:
                if id(y) not in hit_b and y["field"].get("pointer") and kind["target_missing"] == "report":
                    unjoined.append({"kind": name, "why": "no_target", "holder": y["holder"], "value": y["value"]})
            # 도메인 별칭(email_match.domain_alias): 이메일 칸끼리 앞부분이 같고 도메인이 다르지만 같은 별칭 묶음이면 잇는다
            if name in alias_kinds and group:
                def alias_key(e):
                    local, _, dom = e["value"].rpartition("@")
                    return (local, group[dom]) if is_email(e) and local and dom in group else None
                b_alias = collections.defaultdict(list)
                for y in B:
                    if alias_key(y):
                        b_alias[alias_key(y)].append(y)
                for x in A:
                    for y in b_alias.get(alias_key(x), []) if alias_key(x) else []:
                        if y["value"] != x["value"] and fits(objects[y["end"]], x["field"].get("to")) and fits(objects[x["end"]], y["field"].get("to")):
                            pairs.append((x["end"], y["end"], x, y))
                            aliased.add((id(x), id(y)))

        # Optional endpoint uniqueness; duplicate fields do not count twice.
        opposites = collections.defaultdict(set)
        for a, b, x, y in pairs:
            for entry, opposite in ((x, b), (y, a)):
                if entry['field'].get('unique_match'):
                    opposites[(entry['holder'], entry['value'])].add(opposite)
        ambiguous = set()
        seen = set()
        m = kind["makes"]
        same_provider = collections.defaultdict(set)  # (provider, 값) -> 그 값을 가진 계정. 한 SaaS 안 여러 계정이면 공용으로 본다
        for e in A + B:
            if is_email(e):
                same_provider[(objects[e["end"]]["p"], e["value"])].add(e["end"])
        # 같은 두 끝을 여러 칸이 이으면 단계를 낮추지 않는 칸(level_cap 없음)을 먼저 쓴다 — 주 이메일이 별칭보다 먼저다
        pairs.sort(key=lambda p: bool(p[2]["field"].get("level_cap") or p[3]["field"].get("level_cap")))
        for a, b, x, y in pairs:
            unclear = next((e for e in (x, y) if e['field'].get('unique_match') and len(opposites[(e['holder'], e['value'])]) > 1), None)
            if unclear:
                key = (unclear['holder'], unclear['value'])
                if key not in ambiguous:
                    unjoined.append({'kind': name, 'why': 'ambiguous', 'holder': unclear['holder'], 'value': unclear['value']})
                    ambiguous.add(key)
                continue
            if (a, b) in seen or a == b:
                continue
            seen.add((a, b))
            places = _places(kind, a, b, objects, rel_from, resolvers)
            ctx = match.Ctx(places, rels)
            if (cw.get("skip_if") and match.holds(cw["skip_if"], ctx)) or (kind.get("where") and not match.holds(kind["where"], ctx)):
                unjoined.append({"kind": name, "why": "where", "holder": x["holder"], "value": x["value"]})
                continue
            if "relation" in m:
                s, d = (a, b) if m["from"] == "a" else (b, a)
                props = {"basis": kind["evidence"], "tier": kind["tier"]}  # 근거 세기(범례 tier) — 만든 관계에 그대로 남긴다
                if objects[s]["p"] != objects[d]["p"]:
                    props.update(marks)
                row = {"rt": m["relation"], "s": s, "d": d, "props": props, "kind": name}
                out_rel.append(row)
                rels.append(row)
                rel_from[s].append(row)
                continue
            key = (a, objects[b]["p"])
            if cw.get("link_one_per_provider") and linked.get(key, name) != name:
                shadowed.append({"kind": name, "a": a, "b": b})
                continue
            linked[key] = name
            level = next((st["level"] for st in m["link"] if "when" not in st or match.holds(st["when"], ctx)), None)
            cap = x["field"].get("level_cap") or y["field"].get("level_cap")
            lift = x["field"].get("cap_unless_same") or y["field"].get("cap_unless_same")
            if cap and isinstance(lift, dict) and "a" in lift and "b" in lift:
                try:
                    va = normalize(get(objects[a], lift["a"]), None, same)
                    vb = normalize(get(objects[b], lift["b"]), None, same)
                except ValueError:  # 모양이 틀린 칸은 S9 가 잡는다
                    va = vb = None
                if va and va == vb:  # 다른 칸 하나가 더 맞았다 — cap 을 풀어 준다
                    cap = None
            if cap in STRENGTH and level in STRENGTH and STRENGTH.index(level) < STRENGTH.index(cap):  # 모르는 cap 은 S9 가 잡는다
                level = cap
            # 같은 이메일이면 같은 사람(email_match, 2026-11-03): 두 끝 칸이 다 이메일 칸이면 적어도 email_match.level
            email = is_email(x) and is_email(y)
            by_alias = (id(x), id(y)) in aliased  # 같은 주소가 아니라 별칭 도메인 주소다. email_match.level 로 올리지 않는다
            floor = email_match.get("level")
            if email and not by_alias and floor in STRENGTH and level in STRENGTH and STRENGTH.index(level) > STRENGTH.index(floor):
                level = floor
            # 별칭 도메인 주소는 domain_alias.level 까지 올린다(2026-11-14 decided.alias_domain_level). 없으면 그 종류의 makes 단계
            alias_floor = alias.get("level")
            if email and by_alias and alias_floor in STRENGTH and level in STRENGTH and STRENGTH.index(level) > STRENGTH.index(alias_floor):
                level = alias_floor
            suspect = email and (shared_local(x["value"], shared_locals) or (
                shared.get("same_provider") and any(len(same_provider[(objects[k]["p"], v)]) > 1 for k, v in ((a, x["value"]), (b, y["value"])))))
            rec = {}
            for f in (x["field"], y["field"]):
                for rn, path in (f.get("records") or {}).items():
                    holder = objects[y["holder"] if f is y["field"] else x["holder"]]
                    rec[rn] = get(holder, path)
            link = {"a": a, "b": b, "level": level, "kind": name, "tier": kind["tier"], "records": rec, "link_kind": m.get("link_kind"),
                    "capped": bool(cap) and level == cap}
            if suspect:
                link["shared_mailbox_suspected"] = True
            if by_alias:
                link["domain_alias"] = {"a": x["value"].rpartition("@")[2], "b": y["value"].rpartition("@")[2]}
            out_link.append(link)
    return {"relations": out_rel, "links": out_link, "unjoined": unjoined, "shadowed": shadowed}
