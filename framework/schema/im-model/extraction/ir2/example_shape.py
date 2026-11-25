# -*- coding: utf-8 -*-
"""예시 값(문서 예시, 테넌트 응답)에서 모양을 만든다 (origin example_derived).

같은 자리에 나온 값 여럿을 합친다: 객체는 모든 값의 키를, 배열은 모든 원소를 본다. 키 순서는 처음 나온 순서.
타입이 둘 이상이면 처음 본 타입을 쓰고 ext.types_seen 에 남긴다. 필수 여부는 예시로 정하지 않는다(required=False).
"""
TYPES = {bool: "boolean", int: "integer", float: "number", str: "string"}


def scalar_of(values):
    ts = []
    for v in values:
        t = TYPES.get(type(v), "null")
        if t not in ts:
            ts.append(t)
    non = [t for t in ts if t != "null"]
    d = {"scalar": non[0] if non else "null"}
    if len(non) > 1:
        d["types_seen"] = non
    return d


def build(ir, values, sid, src, grade="example", name=None):
    """values: 같은 자리의 JSON 값 목록. 모양 id 를 돌려준다 (스칼라면 스칼라 모양)"""
    dicts = [v for v in values if isinstance(v, dict)]
    lists = [v for v in values if isinstance(v, list)]
    head = {"src": src, "grade": grade, "life": {"state": "active"}}
    if ir.has("shape", sid):
        return sid
    if dicts:
        keys = []
        for d in dicts:
            keys += [k for k in d if k not in keys]
        props = []
        for k in keys:
            sub = [d[k] for d in dicts if k in d]
            p = {"name": k, "required": False}
            p.update(desc(ir, sub, "%s.%s" % (sid, k), src, grade))
            props.append(p)
        ir.add("shape", dict(id=sid, name=name, origin="example_derived", kind="object", props=props, **head))
    elif lists:
        items = [x for l in lists for x in l]
        it = desc(ir, items, sid + "[*]", src, grade) if items else {"scalar": "unknown"}
        ir.add("shape", dict(id=sid, name=name, origin="example_derived", kind="array", items=it, **head))
    else:
        ir.add("shape", dict(id=sid, name=name, origin="example_derived", kind="scalar", scalar=scalar_of(values), **head))
    return sid


def desc(ir, values, sid, src, grade):
    if any(isinstance(v, (dict, list)) for v in values):
        return {"shape": build(ir, values, sid, src, grade)}
    d = scalar_of(values)
    return {k: v for k, v in d.items() if k == "scalar"} if "types_seen" not in d else d
