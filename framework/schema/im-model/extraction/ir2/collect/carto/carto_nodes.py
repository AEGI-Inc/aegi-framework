# -*- coding: utf-8 -*-
"""Cartography 모델 파일을 AST 로 읽어 노드와 간선 선언을 뽑는다 (실행하지 않음)."""
import ast, json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "carto", "cartography", "models")
MODS = ["slack", "github", "okta", "googleworkspace", "gsuite", "jira", "salesforce"]


def lit(n):
    try:
        return ast.literal_eval(n)
    except Exception:
        if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "PropertyRef":
            a = [lit(x) for x in n.args]
            return "ref:" + str(a[0]) + ("(set)" if any(k.arg == "set_in_kwargs" for k in n.keywords) else "")
        if isinstance(n, ast.Call) and getattr(n.func, "id", "") == "make_target_node_matcher":
            return {k: lit(v) for k, v in zip([lit(x) for x in n.args[0].keys], n.args[0].values)}
        if isinstance(n, ast.Call):
            return getattr(n.func, "id", getattr(n.func, "attr", "?")) + "()"
        if isinstance(n, ast.Attribute):
            return n.attr
        return None


def fields(cls):
    out = {}
    for st in cls.body:
        if isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Name) and st.value is not None:
            out[st.target.id] = st.value
    return out


def scan(mod):
    classes = {}
    for fn in sorted(os.listdir(os.path.join(ROOT, mod))):
        if not fn.endswith(".py"):
            continue
        t = ast.parse(open(os.path.join(ROOT, mod, fn), encoding="utf-8").read())
        for c in t.body:
            if isinstance(c, ast.ClassDef):
                classes[c.name] = (fn, [getattr(b, "id", "") for b in c.bases], fields(c))
    nodes, rels = [], {}
    for name, (fn, bases, f) in classes.items():
        if "CartographyRelSchema" in bases:
            props_cls = f.get("properties")
            rels[name] = {"class": name, "file": fn, "source": lit(f.get("source_node_label")) if f.get("source_node_label") is not None else None,
                          "label": lit(f.get("rel_label")), "target": lit(f.get("target_node_label")),
                          "dir": lit(f.get("direction")), "matcher": lit(f.get("target_node_matcher"))}
    for name, (fn, bases, f) in classes.items():
        if "CartographyNodeSchema" not in bases:
            continue
        pc = lit(f.get("properties"))
        pcls = classes.get(pc.rstrip("()") if isinstance(pc, str) else "", (None, None, {}))[2]
        props = {k: lit(v) for k, v in pcls.items()}
        def relname(v):
            r = lit(v)
            return r.rstrip("()") if isinstance(r, str) else None
        sub = relname(f.get("sub_resource_relationship")) if f.get("sub_resource_relationship") is not None else None
        other = []
        o = f.get("other_relationships")
        if isinstance(o, ast.Call):
            lst = o.args[0] if o.args else next((k.value for k in o.keywords if k.arg == "rels"), None)
            if isinstance(lst, ast.List):
                other = [relname(x) for x in lst.elts]
        el = f.get("extra_node_labels")
        extra = []
        if isinstance(el, ast.Call) and el.args and isinstance(el.args[0], ast.List):
            extra = [lit(x) for x in el.args[0].elts]
        nodes.append({"module": mod, "file": fn, "class": name, "label": lit(f.get("label")), "extra_labels": extra,
                      "id": props.get("id"), "props": sorted(props), "sub_resource": rels.get(sub) if sub else None,
                      "rels": [rels.get(x, {"label": x}) for x in other]})
    used = {r.get("class") for n in nodes for r in n["rels"] + ([n["sub_resource"]] if n["sub_resource"] else [])}
    loose = [r for k, r in rels.items() if k not in used]        # 노드에 안 붙은 간선 (matchlink 등)
    return nodes, loose


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    allnodes, allloose = [], []
    for m in MODS:
        n_, l_ = scan(m)
        allnodes += n_
        allloose += [dict(r, module=m) for r in l_]
    json.dump(allloose, open(os.path.join(os.path.dirname(ROOT), "..", "..", "carto_loose_rels.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(allnodes, open(os.path.join(os.path.dirname(ROOT), "..", "..", "carto_nodes.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    for n in allnodes:
        sr = n["sub_resource"]
        print("%-16s %-34s id=%-22s sub=%s  rels=%s" % (n["module"], n["label"], n["id"], sr and (sr["target"], sr["label"]),
              [(r.get("label"), r.get("target")) for r in n["rels"]]))
