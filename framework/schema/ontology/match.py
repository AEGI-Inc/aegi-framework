# -*- coding: utf-8 -*-
"""조건식 — relation_semantics.yaml 의 match · skip_if · select · uncertain_if 를 기계가 읽는다.

조건의 `when` 은 사람이 읽는 문장이고, 같은 뜻을 `match` 에 정해진 모양으로 적는다. 이 모듈은 그 모양을
검사하고(errors) 데이터에 대 본다(holds). 검사(validation/check_semantics.py S8)와 계산기가 같은 것을 쓴다.

식
  {all: [식, ...]}               전부 맞아야
  {any: [식, ...]}               하나라도
  {not: 식}
  {exists_relation: {type, source, target, role, target_interface, property}}
                                 이런 관계 행이 데이터에 있다. source · target · role · property 값의 $자리 는 그 자리 객체의 키.
                                 role 은 그 행의 역할 객체(references.role)가 이 자리와 같다 (관계 행에 role 이 있어야 한다)
                                 target_interface 는 그 행의 도착 객체 interface 에 이 값이 있다 (Ctx 에 objects 가 있어야 한다)
  {자리: {검사: 값, ...}}        그 자리 객체에 검사가 전부 맞는다 (자리가 없으면 거짓)

자리 (어디서 쓰는지에 따라 있는 것만)
  source · target                관계의 양 끝 객체
  relation                       관계 행 (provider · properties)
  role                           관계의 역할 객체 (references.role 이 가리키는 것)
  via_assignment                 relation.properties.via_assignment 가 가리키는 객체
  self                           참조를 가진 객체 (references 블록)
  object                         사전 규칙이 걸린 객체 (rules 블록)
  item                           사전 규칙이 도는 목록의 원소 (rules.items)
  link                           신원 연결 (rules.automation_links)
  a · b                          SaaS 를 넘는 연결의 양쪽 객체 (crosswalk.yaml)
  그 밖의 이름                   crosswalk.yaml 키 종류의 places 가 끝 찾기로 구한 자리. 여럿이면 그중 하나라도 맞으면 참

검사
  provider: slack                provider 가 이 값
  object_type: conversation      object_type 이 이 값 (대소문자 무시)
  interface: Automation          interface 에 이 값이 있다
  property: {이름: 값}           properties.이름 이 이 값
  judged_or_property: {이름: 값} properties 에 없으면 judged, 거기도 없으면 Profile 상수(profile 칸)에서 찾는다.
                                 Profile 상수는 object_type 만으로 정해지는 판정값이다(Object_Schema_v4.1 「judged{}」 —
                                 GitHub webhook 의 direction: out 처럼 행이 아니라 Profile 에 한 번 적는다)
  meta: {이름: 값}               fixture_meta.이름 이 이 값
  in_table: <providers.yaml 표>  (provider, object_type) 이 표의 한 행과 같다. 맞은 행을 기억한다
  table_property: 값             in_table 로 맞은 행의 property 칸이 가리키는 속성의 값
  refs_missing: <참조 이름>       references 에 그 칸이 없다

값
  그대로 쓰면 같은지, 목록이면 그중 하나인지, present 는 있음, missing 은 없음, {not: 값} 은 그 반대
"""

PLACES = ("source", "target", "relation", "role", "via_assignment", "self", "object", "item", "link", "a", "b")
CHECKS = ("provider", "object_type", "interface", "in_table", "property", "judged_or_property", "meta",
          "table_property", "refs_missing")
TOP = ("all", "any", "not", "exists_relation")
EXISTS_KEYS = ("type", "source", "target", "role", "target_interface", "property")


# ---------------------------------------------------------------- 모양 검사

def errors(expr, places=PLACES, tables=None, path="match"):
    """식의 모양이 틀린 곳 목록. places 는 이 자리에서 쓸 수 있는 자리, tables 는 providers.yaml 표 이름."""
    out = []
    if not isinstance(expr, dict) or not expr:
        return ["%s: 식은 비지 않은 맵이어야 한다" % path]
    for key, val in expr.items():
        here = "%s.%s" % (path, key)
        if key in ("all", "any"):
            if not isinstance(val, list) or not val:
                out.append("%s: 식 목록이어야 한다" % here)
                continue
            for i, e in enumerate(val):
                out += errors(e, places, tables, "%s[%d]" % (here, i))
        elif key == "not":
            out += errors(val, places, tables, here)
        elif key == "exists_relation":
            if not isinstance(val, dict) or "type" not in val:
                out.append("%s: type 이 있어야 한다" % here)
                continue
            bad = [k for k in val if k not in EXISTS_KEYS]
            if bad:
                out.append("%s: 모르는 칸 %s" % (here, bad))
            for k in ("source", "target", "role"):
                v = val.get(k)
                if v is not None and not (isinstance(v, str) and v.startswith("$") and v[1:] in places):
                    out.append("%s.%s: $자리 여야 한다 (%s)" % (here, k, ", ".join(places)))
            if "target_interface" in val and not (isinstance(val["target_interface"], str) and val["target_interface"]):
                out.append("%s.target_interface: interface 이름 하나여야 한다" % here)
        elif key in places:
            if not isinstance(val, dict) or not val:
                out.append("%s: 검사 맵이어야 한다" % here)
                continue
            for c, w in val.items():
                if c not in CHECKS:
                    out.append("%s: 모르는 검사 %s (%s)" % (here, c, ", ".join(CHECKS)))
                elif c in ("property", "judged_or_property", "meta") and not isinstance(w, dict):
                    out.append("%s.%s: {이름: 값} 이어야 한다" % (here, c))
                elif c == "in_table" and tables is not None and w not in tables:
                    out.append("%s.in_table: providers.yaml 에 표 %s 가 없다" % (here, w))
            if "table_property" in val and "in_table" not in val:
                out.append("%s: table_property 는 같은 자리에 in_table 이 있어야 한다" % here)
        else:
            out.append("%s: 모르는 칸 (자리 %s 또는 %s)" % (here, ", ".join(places), ", ".join(TOP)))
    return out


# ---------------------------------------------------------------- 대 보기

def lower(s):
    return (s or "").lower() if isinstance(s, str) else s


def value_ok(actual, want):
    if isinstance(want, dict) and set(want) == {"not"}:
        return not value_ok(actual, want["not"])
    if isinstance(want, list):
        return any(value_ok(actual, w) for w in want)
    if want == "present":
        return actual is not None
    if want == "missing":
        return actual is None
    return actual == want


class Ctx(object):
    """대 볼 때 필요한 것.

    places     {자리: 객체 또는 객체 목록}. 객체는 {k, p, t, i, props, judged, profile, meta, refs} 모양 (없는 칸은 비어 있다고 본다).
               profile 은 그 객체 Profile 의 상수 {이름: 값}
               목록이면 그중 하나라도 맞으면 참이다 (끝 찾기 take: all)
    relations  관계 행 목록 [{rt, s, d, role, props}] — exists_relation 이 쓴다(role 은 역할 객체 키, 없어도 된다)
    tables     providers.yaml (in_table 이 쓴다)
    objects    {키: 객체} — exists_relation.target_interface 가 도착 객체를 찾는다. 없으면 그 검사는 늘 거짓이다
    """

    def __init__(self, places, relations=(), tables=None, objects=None):
        self.places = places
        self.relations = relations
        self.tables = tables or {}
        self.objects = objects or {}
        self.row = None  # in_table 로 맞은 표 행

    def place(self, name):
        return self.places.get(name)


def _scalar(v):
    return v.get("value") if isinstance(v, dict) and "value" in v else v


def _check(obj, check, want, ctx):
    props = obj.get("props") or {}
    if check == "provider":
        return value_ok(obj.get("p"), want)
    if check == "object_type":
        return value_ok(lower(obj.get("t")), [lower(w) for w in want] if isinstance(want, list) else lower(want))
    if check == "interface":
        return any(i in (obj.get("i") or []) for i in (want if isinstance(want, list) else [want]))
    if check == "property":
        return all(value_ok(props.get(n), w) for n, w in want.items())
    if check == "judged_or_property":
        judged, profile = obj.get("judged") or {}, obj.get("profile") or {}
        return all(value_ok(_scalar(props.get(n, judged.get(n, profile.get(n)))), w) for n, w in want.items())
    if check == "meta":
        meta = obj.get("meta") or {}
        return all(value_ok(meta.get(n), w) for n, w in want.items())
    if check == "in_table":
        for row in ctx.tables.get(want) or []:
            if row.get("provider") == obj.get("p") and lower(row.get("objectType")) == lower(obj.get("t")):
                ctx.row = row
                return True
        return False
    if check == "table_property":
        if not ctx.row or "property" not in ctx.row:
            return False
        return value_ok(props.get(ctx.row["property"]), want)
    if check == "refs_missing":
        return not (obj.get("refs") or {}).get(want)
    raise ValueError("모르는 검사 %s" % check)


def holds(expr, ctx):
    """식이 이 자리들에서 맞나."""
    for key, val in expr.items():
        if key == "all":
            ok = all(holds(e, ctx) for e in val)
        elif key == "any":
            ok = any(holds(e, ctx) for e in val)
        elif key == "not":
            ok = not holds(val, ctx)
        elif key == "exists_relation":
            ok = _exists(val, ctx)
        else:
            obj = ctx.place(key)
            if obj is None:
                return False
            # in_table 이 table_property 보다 먼저 돌도록 순서를 고정한다
            objs = obj if isinstance(obj, list) else [obj]
            ok = any(all(_check(o, c, val[c], ctx) for c in CHECKS if c in val) for o in objs)
        if not ok:
            return False
    return True


def _key(ctx, ref):
    if isinstance(ref, str) and ref.startswith("$"):
        obj = ctx.place(ref[1:])
        if isinstance(obj, list):
            return [o.get("k") for o in obj]
        return obj.get("k") if obj else None
    return ref


def _is(value, key):
    return value in key if isinstance(key, list) else value == key


def _exists(spec, ctx):
    src = _key(ctx, spec.get("source")) if "source" in spec else None
    tgt = _key(ctx, spec.get("target")) if "target" in spec else None
    want_props = {n: _key(ctx, w) for n, w in (spec.get("property") or {}).items()}
    for r in ctx.relations:
        if r.get("rt") != spec["type"]:
            continue
        if "source" in spec and not _is(r.get("s"), src):
            continue
        if "target" in spec and not _is(r.get("d"), tgt):
            continue
        if "role" in spec and not _is(r.get("role"), _key(ctx, spec["role"])):
            continue
        if "target_interface" in spec and spec["target_interface"] not in ((ctx.objects.get(r.get("d")) or {}).get("i") or []):
            continue
        props = r.get("props") or {}
        if all(value_ok(props.get(n), w) for n, w in want_props.items()):
            return True
    return False


# ---------------------------------------------------------------- 끝 찾기 (rules 의 tenant · owner · scope)

def resolve(spec, start, objects, relations_from):
    """resolvers 의 한 줄대로 start 객체에서 끝을 찾는다. objects {키: 객체}, relations_from {키: [관계 행]}."""
    want, take, depth = spec.get("want", "any"), spec.get("take", "all"), spec.get("depth", 1)
    found, seen, frontier = [], set(), [start]
    for _ in range(depth):
        nxt = []
        for k in frontier:
            if k in seen or k not in objects:
                continue
            seen.add(k)
            cands = [t for name in spec.get("refs") or [] for t in (objects[k].get("refs") or {}).get(name) or []]
            cands += [r["d"] for r in relations_from.get(k, []) if r.get("rt") in (spec.get("relations") or [])]
            for t in cands:
                if t not in objects:
                    continue
                if want == "any" or want in (objects[t].get("i") or []):
                    if take == "first":
                        return [t]
                    if t not in found:
                        found.append(t)
                else:
                    nxt.append(t)
        frontier = nxt
    return found
