# -*- coding: utf-8 -*-
"""Microsoft 365 (Microsoft Graph v1.0) -> IR2.

    python norm_m365.py

1. OpenAPI (m365_graph_v1_openapi): lexicons/m365.yaml 의 수집 범위(include/exclude)로 걸러 동작·모양·예시 생성.
   x-ms-deprecation -> deprecated (+ removalDate).
2. CSDL (m365_graph_v1_csdl): EntityType 키(BaseType 사슬)와 EntitySet/Singleton 여부(global/local),
   Org.OData.Core.V1.AlternateKeys -> key_decl (stated). NavigationProperty -> shape.ext.navigation.
3. 바인딩 (binding): x-ms-docs-key-type 및 대체 키 경로 조각((appId='{appId}') 꼴) -> binding (stated).
4. 권한 (m365_graph_v1_docs): api/*.md 의 ## HTTP request 와 ## Permissions(본문 표 또는 INCLUDE 표) -> grant.
5. 감사 카탈로그 (catalog, shape, hole): Management Activity 스키마, Copilot 스키마, Purview 감사 활동 HTML, Entra 감사 활동 md.
"""
import collections
from html.parser import HTMLParser
import io
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

import core
import openapi2
import tenant_log

P = "m365"
SID_OPENAPI = "m365_graph_v1_openapi"
SID_CSDL = "m365_graph_v1_csdl"
SID_DOCS = "m365_graph_v1_docs"
SID_MGMT = "m365_mgmt_activity_schema"
SID_COPILOT = "m365_copilot_audit_schema"
SID_PURVIEW = "m365_purview_audit_activities"
SID_ENTRA = "m365_entra_audit_activities"
SID_TENANT = "m365_tenant_20261120"

EDM_NS = "http://docs.oasis-open.org/odata/ns/edm"
EDM_SCALARS = {
    "Edm.String": ("string", None),
    "Edm.Boolean": ("boolean", None),
    "Edm.Int16": ("integer", None),
    "Edm.Int32": ("integer", None),
    "Edm.Int64": ("integer", None),
    "Edm.Byte": ("integer", None),
    "Edm.SByte": ("integer", None),
    "Edm.Double": ("number", None),
    "Edm.Single": ("number", None),
    "Edm.Decimal": ("number", None),
    "Edm.Date": ("string", "date"),
    "Edm.DateTime": ("string", "date-time"),
    "Edm.DateTimeOffset": ("string", "date-time"),
    "Edm.TimeOfDay": ("string", "time"),
    "Edm.Duration": ("string", "duration"),
    "Edm.Guid": ("string", "uuid"),
    "Edm.Binary": ("string", "byte"),
    "Edm.Stream": ("string", "binary"),
}


# ---------------------------------------------------------------------- 1. 범위
def make_scope_fn(lex, stats=None):
    """lexicons/m365.yaml 의 scope 설정으로 경로 포함 여부를 판정하는 함수를 만든다."""
    sc = (lex or {}).get("scope") or {}
    include_first = set(sc.get("include_first_segments") or [])
    exclude_prefixes = {x["segment"] for x in sc.get("exclude_prefixes") or []}
    exclude_segments = {x["segment"] for x in sc.get("exclude_segments") or []}
    has_sites_lists = any(x.get("pattern") == "sites/{}/lists" for x in sc.get("exclude_subpaths") or [])
    if stats is None:
        stats = collections.Counter()

    def include(raw_path):
        segs = [s for s in raw_path.strip("/").split("/") if s]
        if not segs:
            stats["empty_path"] += 1
            return False
        first = segs[0].split("(")[0]
        if first in exclude_prefixes:
            stats["exclude_prefix:/" + first] += 1
            return False
        if first not in include_first:
            stats["not_in_include"] += 1
            return False
        if has_sites_lists:
            for i in range(len(segs) - 2):
                if segs[i].split("(")[0] == "sites" and segs[i + 2].split("(")[0] == "lists":
                    stats["exclude_subpath:sites/{}/lists"] += 1
                    return False
        for s in segs:
            seg = s.split("(")[0]
            if seg in exclude_segments:
                stats["exclude_segment:/" + seg] += 1
                return False
        stats["included"] += 1
        return True

    return include


def graph_life(o, state):
    dep = o.get("x-ms-deprecation")
    if dep:
        rem = dep.get("removalDate") if isinstance(dep, dict) else None
        return "deprecated", rem
    return state, None


# ---------------------------------------------------------------------- 2. CSDL
def _tag(el):
    return el.tag.split("}", 1)[-1]


def parse_csdl(xml_text):
    """CSDL XML 을 읽어 EntityType(BaseType, Key, AlternateKeys, NavigationProperty) 과 EntityContainer 타입을 돌려준다."""
    root = ET.fromstring(xml_text)
    schemas = [el for el in root.iter() if _tag(el) == "Schema"]
    alias_map = {}
    for sc in schemas:
        ns = sc.attrib.get("Namespace")
        al = sc.attrib.get("Alias")
        if ns and al and al.lower() != "self":
            alias_map[al] = ns

    def resolve_type(tstr, cur_ns):
        if not tstr:
            return False, None
        is_coll = tstr.startswith("Collection(") and tstr.endswith(")")
        inner = tstr[len("Collection("):-1] if is_coll else tstr
        if inner.startswith("Edm."):
            return is_coll, inner
        if "." in inner:
            pre, rest = inner.split(".", 1)
            if pre.lower() == "self" and cur_ns:
                return is_coll, cur_ns + "." + rest
            if pre in alias_map:
                return is_coll, alias_map[pre] + "." + rest
            return is_coll, inner
        return is_coll, (cur_ns + "." + inner if cur_ns else inner)

    def extract_alt_keys(ann_el):
        out = []
        for rec in ann_el.iter():
            if _tag(rec) == "Record" and rec.attrib.get("Type") == "Org.OData.Core.V1.AlternateKey":
                props = []
                for sub in rec.iter():
                    if _tag(sub) == "Record" and sub.attrib.get("Type") == "Org.OData.Core.V1.PropertyRef":
                        for pv in sub:
                            if _tag(pv) == "PropertyValue" and pv.attrib.get("Property") == "Name":
                                pp = pv.attrib.get("PropertyPath") or pv.attrib.get("String")
                                if pp:
                                    props.append(pp)
                if props:
                    out.append(props)
        return out

    entity_types = {}
    container_types = set()
    singletons = []

    for sc in schemas:
        cur_ns = sc.attrib.get("Namespace") or ""
        for child in sc:
            tg = _tag(child)
            if tg == "EntityType":
                name = child.attrib["Name"]
                full_name = f"{cur_ns}.{name}" if cur_ns else name
                _, base = resolve_type(child.attrib.get("BaseType"), cur_ns)
                own_keys = []
                nav_props = []
                alt_keys = []
                for sub in child:
                    stg = _tag(sub)
                    if stg == "Key":
                        for pr in sub:
                            if _tag(pr) == "PropertyRef" and pr.attrib.get("Name"):
                                own_keys.append(pr.attrib["Name"])
                    elif stg == "NavigationProperty":
                        is_coll, target = resolve_type(sub.attrib.get("Type"), cur_ns)
                        nav_props.append({
                            "name": sub.attrib["Name"],
                            "target": target,
                            "collection": is_coll,
                            "contains_target": sub.attrib.get("ContainsTarget", "").lower() == "true",
                        })
                    elif stg == "Annotation" and sub.attrib.get("Term") == "Org.OData.Core.V1.AlternateKeys":
                        alt_keys.extend(extract_alt_keys(sub))
                nav_props.sort(key=lambda x: x["name"])
                entity_types[full_name] = {
                    "ns": cur_ns,
                    "name": name,
                    "base": base,
                    "own_keys": own_keys,
                    "alt_keys": alt_keys,
                    "nav_props": nav_props,
                }
            elif tg == "EntityContainer":
                for sub in child:
                    stg = _tag(sub)
                    if stg == "EntitySet":
                        _, t = resolve_type(sub.attrib.get("EntityType"), cur_ns)
                        if t:
                            container_types.add(t)
                    elif stg == "Singleton":
                        _, t = resolve_type(sub.attrib.get("Type"), cur_ns)
                        if t:
                            container_types.add(t)
                            if sub.attrib.get("Name"):
                                singletons.append((sub.attrib["Name"], t))
            elif tg == "Annotations":
                tgt = child.attrib.get("Target")
                if tgt and "/" not in tgt:
                    _, resolved_tgt = resolve_type(tgt, cur_ns)
                    for sub in child:
                        if _tag(sub) == "Annotation" and sub.attrib.get("Term") == "Org.OData.Core.V1.AlternateKeys":
                            if resolved_tgt in entity_types:
                                entity_types[resolved_tgt]["alt_keys"].extend(extract_alt_keys(sub))

    def find_keys(full_name):
        cur, seen = full_name, set()
        while cur and cur not in seen:
            seen.add(cur)
            et = entity_types.get(cur)
            if not et:
                break
            if et["own_keys"]:
                return list(et["own_keys"])
            cur = et["base"]
        return []

    def is_global(full_name):
        cur, seen = full_name, set()
        while cur and cur not in seen:
            seen.add(cur)
            if cur in container_types:
                return True
            et = entity_types.get(cur)
            if not et:
                break
            cur = et["base"]
        return False

    def base_chain(full_name):
        chain, cur, seen = [], full_name, set()
        while cur and cur not in seen:
            seen.add(cur)
            chain.append(cur)
            et = entity_types.get(cur)
            if not et:
                break
            cur = et["base"]
        return chain

    def all_nav_props(full_name):
        by_name = {}
        for t in reversed(base_chain(full_name)):
            et = entity_types.get(t)
            if et:
                for np in et["nav_props"]:
                    by_name[np["name"]] = np
        return [by_name[k] for k in sorted(by_name)]

    # Singleton-scoped collection BFS:
    # Singleton -> 0+ single-valued ContainsTarget nav -> 1 Collection ContainsTarget nav
    coll_target_paths = {}
    visited_single = set()
    queue = collections.deque((sg_t, [f"Singleton {sg_n}"]) for sg_n, sg_t in sorted(singletons))
    while queue:
        cur_t, path = queue.popleft()
        for nav in all_nav_props(cur_t):
            if not nav["contains_target"]:
                continue
            if nav["collection"]:
                coll_target_paths.setdefault(nav["target"], path + [nav["name"]])
            else:
                if nav["target"] not in visited_single:
                    visited_single.add(nav["target"])
                    queue.append((nav["target"], path + [nav["name"]]))

    def singleton_path_of(full_name):
        for t in base_chain(full_name):
            if t in coll_target_paths:
                return " -> ".join(coll_target_paths[t])
        return None

    return {
        "entity_types": entity_types,
        "container_types": container_types,
        "find_keys": find_keys,
        "is_global": is_global,
        "singleton_path_of": singleton_path_of,
    }


def apply_csdl(ir, csdl, sid=SID_CSDL, openapi_sid=SID_OPENAPI):
    stats = collections.Counter()
    promoted_examples = []
    for full_name in sorted(csdl["entity_types"]):
        et = csdl["entity_types"][full_name]
        shape_id = f"sh:{openapi_sid}:{full_name}"
        kprops = csdl["find_keys"](full_name)
        has_shape = ir.has("shape", shape_id)
        if not has_shape:
            if kprops:
                stats["key_skipped_no_shape"] += 1
            if et["alt_keys"]:
                stats["alt_key_skipped_no_shape"] += len(et["alt_keys"])
            continue
        if et["nav_props"]:
            ir.get("shape", shape_id)["ext"]["navigation"] = et["nav_props"]
            stats["nav_attached"] += 1
        glob = csdl["is_global"](full_name)
        spath = None if glob else csdl["singleton_path_of"](full_name)
        if glob:
            form, grade, ext = "global", "stated", {}
        elif spath:
            form, grade = "global", "transform"
            ext = {"csdl_form_local": True, "singleton_path": spath}
        else:
            form, grade, ext = "local", "stated", {}
        loc = f"Schema[{et['ns']}].EntityType[{et['name']}]"
        if kprops:
            if spath:
                ev = f"CSDL Singleton-scoped collection 규칙: {spath}"
                stats["key_singleton_promoted"] += 1
                if len(promoted_examples) < 20:
                    promoted_examples.append(f"{full_name}: {spath}")
            else:
                ev = "CSDL Key(BaseType 사슬) + EntitySet/Singleton 여부(%s)" % ("있음" if glob else "없음")
                stats["key_" + form] += 1
            row = dict(
                id=f"kd:{sid}:{full_name}",
                shape=shape_id,
                props=kprops,
                form=form,
                evidence=ev,
                src=ir.src(sid, loc),
                grade=grade,
                life=ir.life(),
            )
            if ext:
                row["ext"] = dict(ext)
            ir.add("key_decl", row)
        for ak_props in et["alt_keys"]:
            if spath:
                ev = f"CSDL AlternateKeys + Singleton-scoped collection 규칙: {spath}"
            else:
                ev = "CSDL Org.OData.Core.V1.AlternateKeys + EntitySet/Singleton 여부(%s)" % ("있음" if glob else "없음")
            row = dict(
                id=f"kd:{sid}:{full_name}:alt:{'+'.join(ak_props)}",
                shape=shape_id,
                props=ak_props,
                form=form,
                evidence=ev,
                src=ir.src(sid, loc + ".AlternateKeys"),
                grade=grade,
                life=ir.life(),
            )
            if ext:
                row["ext"] = dict(ext)
            ir.add("key_decl", row)
            stats["key_alt"] += 1
    out = dict(stats)
    if promoted_examples:
        out["singleton_promoted_examples"] = promoted_examples
    return out


# ---------------------------------------------------------------------- 3. 바인딩
def _resolve_graph_type(kt):
    if "." in kt:
        if kt.startswith("graph."):
            return "microsoft.graph." + kt[len("graph."):]
        return kt
    return "microsoft.graph." + kt


def apply_bindings(ir, spec, csdl, scope_fn=None, openapi_sid=SID_OPENAPI):
    stats = collections.Counter()
    by_method_path = {}
    for o in ir.rows["operation"].values():
        if o["src"]["source"] == openapi_sid:
            by_method_path[(o["method"], o["ext"]["raw_path"])] = o

    # 대체 키 속성 -> 가능한 EntityType 목록 (x-ms-docs-key-type 이 없는 대체 키 경로용)
    alt_prop_types = collections.defaultdict(list)
    for fn in sorted(csdl["entity_types"]):
        for ak in csdl["entity_types"][fn]["alt_keys"]:
            for p in ak:
                alt_prop_types[p].append(fn)

    paths = spec.get("paths") or {}
    for raw_path in sorted(paths):
        if scope_fn and not scope_fn(raw_path):
            continue
        item = paths[raw_path]
        if not isinstance(item, dict):
            continue
        alt_param_map = {prop: param for prop, param in re.findall(r"(\w+)\s*=\s*'\{([^}]+)\}'", raw_path)}
        shared = item.get("parameters") or []
        for m in openapi2.METHODS:
            op_dict = item.get(m)
            if not isinstance(op_dict, dict):
                continue
            op = by_method_path.get((m.upper(), raw_path))
            if not op:
                continue
            merged = {}
            for prm in list(shared) + list(op_dict.get("parameters") or []):
                if isinstance(prm, dict) and prm.get("name"):
                    merged[(prm.get("in"), prm["name"])] = prm
            for (pin, pname), prm in sorted(merged.items()):
                if pin != "path":
                    continue
                kt = prm.get("x-ms-docs-key-type")
                if kt:
                    full_type = _resolve_graph_type(kt)
                    target_shape = f"sh:{openapi_sid}:{full_type}"
                    if not ir.has("shape", target_shape):
                        stats["skipped_no_shape"] += 1
                        continue
                    if pname in alt_param_map:
                        prop = alt_param_map[pname]
                    else:
                        kprops = csdl["find_keys"](full_type)
                        if not kprops:
                            stats["skipped_no_key"] += 1
                            continue
                        prop = kprops[0]
                    bid = f"bd:{openapi_sid}:{op['name']}:{pname}"
                    if not ir.has("binding", bid):
                        ir.add("binding", dict(
                            id=bid,
                            operation=op["id"],
                            param=pname,
                            to={"shape": target_shape, "prop": prop},
                            src=ir.src(openapi_sid, f"paths.{raw_path}.{m}.parameters.{pname}"),
                            grade="stated",
                            life=ir.life(),
                        ))
                        stats["created_key_type"] += 1
                elif pname in alt_param_map:
                    alt_prop = alt_param_map[pname]
                    cands = alt_prop_types.get(alt_prop, [])
                    full_type = None
                    # 1) 2xx 응답 모양에서 찾기
                    for resp in op.get("responses") or []:
                        if resp.get("shape") and str(resp.get("status") or "").startswith("2"):
                            rname = resp["shape"].split(":", 2)[-1]
                            if rname in cands:
                                full_type = rname
                                break
                    # 2) tags 의 <prefix>.<type> 에서 찾기
                    if not full_type:
                        for tag in op_dict.get("tags") or []:
                            tpart = tag.split(".")[-1]
                            cand = f"microsoft.graph.{tpart}"
                            if cand in cands:
                                full_type = cand
                                break
                    # 3) 유일 후보
                    if not full_type and len(cands) == 1:
                        full_type = cands[0]
                    if not full_type:
                        stats["skipped_no_shape"] += 1
                        continue
                    target_shape = f"sh:{openapi_sid}:{full_type}"
                    if not ir.has("shape", target_shape):
                        stats["skipped_no_shape"] += 1
                        continue
                    bid = f"bd:{openapi_sid}:{op['name']}:{pname}"
                    if not ir.has("binding", bid):
                        ir.add("binding", dict(
                            id=bid,
                            operation=op["id"],
                            param=pname,
                            to={"shape": target_shape, "prop": alt_prop},
                            src=ir.src(openapi_sid, f"paths.{raw_path}.{m}.parameters.{pname}"),
                            grade="stated",
                            life=ir.life(),
                        ))
                        stats["created_alt_key"] += 1
    return dict(stats)


# ---------------------------------------------------------------------- 4. 권한 문서
def _norm_path_pattern(path):
    p = path.split("?", 1)[0].strip()
    p = re.sub(r"\{[^}]+\}", "{}", p)
    return p.strip("/")


def _clean_perm_tokens(cell):
    cell = cell.strip()
    low = cell.lower()
    if not cell or low.startswith("not supported") or low.startswith("not available") or low in ("none", "n/a", "-"):
        return []
    cell = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", cell)
    out = []
    for raw in cell.split(","):
        tok = raw.strip().strip("`*_ ")
        if not tok:
            continue
        tlow = tok.lower()
        if tlow.startswith("not supported") or tlow.startswith("not available") or tlow in ("none", "n/a", "-"):
            continue
        if re.match(r"^[A-Za-z0-9._-]+$", tok):
            out.append(tok)
    return out


def parse_permission_tables(md_text):
    """마크다운 권한 표를 읽어 (kind, [perm_name, ...]) 목록을 돌려준다."""
    out = []
    lines = md_text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|", lines[i + 1].strip()):
            hdr = [c.strip().lower() for c in line.strip("|").split("|")]
            if hdr and "permission type" in hdr[0]:
                i += 2
                while i < len(lines) and lines[i].strip().startswith("|"):
                    cols = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                    if cols:
                        ptype = cols[0].lower()
                        if "delegated" in ptype and "work or school" in ptype:
                            kind = "oauth_scope"
                        elif ptype == "application" or ptype.startswith("application "):
                            kind = "app_permission"
                        else:
                            kind = None
                        if kind:
                            perms = []
                            for col in cols[1:]:
                                for tok in _clean_perm_tokens(col):
                                    if tok not in perms:
                                        perms.append(tok)
                            if perms:
                                out.append((kind, perms))
                    i += 1
                continue
        i += 1
    return out


def parse_http_requests(md_text):
    """## HTTP request 절의 코드 블록에서 (METHOD, path) 목록을 추출한다."""
    m = re.search(r"(?m)^##\s+HTTP request\s*$(.*?)(?=^##\s|\Z)", md_text, re.S)
    if not m:
        return []
    sec = m.group(1)
    reqs = []
    in_code = False
    for line in sec.splitlines():
        s = line.strip()
        if s.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            s_no_http = re.sub(r"\s+HTTP/\S+$", "", s)
            rm = re.match(r"^(GET|POST|PUT|PATCH|DELETE)\s+(/.*)$", s_no_http)
            if rm:
                reqs.append((rm.group(1), rm.group(2).strip()))
    return reqs


def apply_docs_permissions(ir, docs_dir, sid=SID_DOCS, openapi_sid=SID_OPENAPI):
    by_sig = collections.defaultdict(list)
    by_method_len = collections.defaultdict(list)
    for o in ir.rows["operation"].values():
        if o["src"]["source"] == openapi_sid and o.get("path"):
            pat = _norm_path_pattern(o["path"]["template"])
            by_sig[(o["method"], pat)].append(o["id"])
            segs = [s for s in pat.split("/") if s]
            by_method_len[(o["method"], len(segs))].append((segs, o["id"]))

    api_dir = os.path.join(docs_dir, "api")
    stats = collections.Counter()
    unmatched_examples = []

    for fn in sorted(os.listdir(api_dir)):
        if not fn.endswith(".md"):
            continue
        stats["docs_read"] += 1
        p = os.path.join(api_dir, fn)
        with io.open(p, encoding="utf-8", errors="replace") as f:
            txt = f.read()

        reqs = parse_http_requests(txt)
        matched_ops = []
        literal_fill_ops = set()
        for method, raw_doc_path in reqs:
            np = _norm_path_pattern(raw_doc_path)
            if np == "me" or np.startswith("me/") or np.startswith("me("):
                stats["skipped_me"] += 1
                continue
            hits = by_sig.get((method, np))
            if hits:
                matched_ops.extend(hits)
            else:
                doc_segs = [s for s in np.split("/") if s]
                cands = []
                for op_segs, oid in by_method_len.get((method, len(doc_segs)), []):
                    if all(ds == os_ or (os_ == "{}" and ds != "{}") for ds, os_ in zip(doc_segs, op_segs)):
                        cands.append(oid)
                if len(cands) == 1:
                    matched_ops.append(cands[0])
                    literal_fill_ops.add(cands[0])
                    stats["ops_matched_literal_fill"] += 1
                else:
                    if len(cands) > 1:
                        stats["unmatched_ambiguous"] += 1
                    stats["unmatched_lines"] += 1
                    if len(unmatched_examples) < 10:
                        unmatched_examples.append(f"{fn}: {method} {raw_doc_path}")
                    ir.issue(
                        "doc_operation_unmatched",
                        {"source": sid, "file": fn},
                        "normalize",
                        "operation",
                        "문서의 HTTP request 경로가 범위 내 OpenAPI 동작과 맞지 않는다",
                        {"method": method, "path": raw_doc_path, "ambiguous_candidates": len(cands)},
                    )
        matched_ops = sorted(set(matched_ops))
        if matched_ops:
            stats["ops_matched"] += len(matched_ops)

        pm = re.search(r"(?m)^##\s+Permissions\s*$(.*?)(?=^##\s|\Z)", txt, re.S)
        if not pm:
            continue
        psec = pm.group(1)
        perm_rows = parse_permission_tables(psec)
        for inc_m in re.finditer(r"\[!INCLUDE\s+\[[^\]]*\]\(([^)]+)\)\]", psec):
            rel_inc = inc_m.group(1).strip()
            inc_path = os.path.normpath(os.path.join(api_dir, rel_inc))
            if os.path.isfile(inc_path):
                with io.open(inc_path, encoding="utf-8", errors="replace") as f:
                    inc_txt = f.read()
                perm_rows.extend(parse_permission_tables(inc_txt))

        if not matched_ops or not perm_rows:
            continue

        lf_matched = sorted(oid for oid in matched_ops if oid in literal_fill_ops)
        for kind, perms in perm_rows:
            least = perms[0]
            for pname in perms:
                gid = f"gr:{kind}:{pname}"
                row = dict(
                    id=gid,
                    kind=kind,
                    name=pname,
                    operations=list(matched_ops),
                    src=ir.src(sid, f"api/{fn}"),
                    grade="stated",
                    life=ir.life(),
                )
                g = ir.add("grant", row, merge=True)
                if pname == least:
                    lp = g["ext"].get("least_privileged_for") or []
                    g["ext"]["least_privileged_for"] = sorted(set(lp) | set(matched_ops))
                if lf_matched:
                    g["ext"]["match"] = "literal_fill"
                    prev_lf = g["ext"].get("literal_fill_ops") or []
                    g["ext"]["literal_fill_ops"] = sorted(set(prev_lf) | set(lf_matched))
                for oid in matched_ops:
                    op = ir.get("operation", oid)
                    if gid not in op["grants"]:
                        op["grants"] = sorted(op["grants"] + [gid])
            stats["perm_tables_applied"] += 1

    return dict(stats), unmatched_examples


# ---------------------------------------------------------------------- 5. 감사 카탈로그
def _edm_scalar(raw_type):
    t = re.sub(r"[`*\s]", "", raw_type or "")
    if t in EDM_SCALARS:
        sc, fmt = EDM_SCALARS[t]
        d = {"scalar": sc}
        if fmt:
            d["format"] = fmt
        return d
    return {"scalar": raw_type.strip() or "any"}


def _parse_md_tables(text):
    """마크다운 텍스트에서 (headers, rows) 목록을 추출한다."""
    tables = []
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|", lines[i + 1].strip()):
            hdr = [c.strip() for c in line.strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cols = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                rows.append(cols)
                i += 1
            tables.append((hdr, rows))
            continue
        i += 1
    return tables


def parse_mgmt_activity_schema(ir, text, sid=SID_MGMT):
    stats = collections.Counter()
    lines = text.splitlines()
    sec_title = ""
    title = ""
    enum_ctx = None  # (enum_name, stated_type)
    tidx = 0
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith("## "):
            sec_title = line[3:].strip()
            title = sec_title
            enum_ctx = None
            i += 1
            continue
        em = re.match(r"^(?:#+\s*|\*\*)Enum:\s*([^-*\n]+?)(?:\s*-\s*Type[:\s]+([A-Za-z0-9.]+))?\s*(?:\*\*|:|\*\*:)?\s*$", line)
        if em:
            ename = em.group(1).strip()
            etype = (em.group(2) or "Edm.Int32").strip()
            enum_ctx = (ename, etype)
            title = ename
            i += 1
            continue
        hm = re.match(r"^#{3,5}\s+(.+)", line)
        if hm:
            htxt = hm.group(1).strip()
            if enum_ctx and htxt == enum_ctx[0]:
                pass
            else:
                title = htxt
                enum_ctx = None
            i += 1
            continue
        if line.startswith("|") and i + 1 < len(lines) and re.match(r"^\|[\s:|-]+\|", lines[i + 1].strip()):
            hdr = [c.strip() for c in line.strip("|").split("|")]
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cols = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                rows.append(cols)
                i += 1
            tidx += 1
            if sec_title == "Office 365 Management API schemas":
                continue
            hlow = [h.lower() for h in hdr]
            if "member name" in hlow and "value" in hlow:
                v_i, m_i = hlow.index("value"), hlow.index("member name")
                ename, etype = enum_ctx if enum_ctx else (title, "Edm.Int32")
                if ename == "AuditLogRecordType":
                    for r in rows:
                        if m_i >= len(r):
                            continue
                        key = re.sub(r"[`*]", "", r[m_i]).strip()
                        if not key:
                            continue
                        cid = f"cat:log_type:{sid}:{key}"
                        if ir.has("catalog", cid):
                            continue
                        val = r[v_i].strip() if v_i < len(r) else None
                        row = dict(
                            id=cid,
                            catalog="log_type",
                            key=key,
                            display=None,
                            category="AuditLogRecordType",
                            payload=None,
                            targets=[],
                            src=ir.src(sid, f"Enum: AuditLogRecordType#row={key}"),
                            grade="stated",
                            life=ir.life(),
                        )
                        if val is not None:
                            row["ext"] = {"value": val}
                        ir.add("catalog", row)
                        stats["log_type"] += 1
                else:
                    members, values = [], {}
                    for r in rows:
                        if m_i >= len(r):
                            continue
                        mname = re.sub(r"[`*]", "", r[m_i]).strip()
                        if not mname:
                            continue
                        val = r[v_i].strip() if v_i < len(r) else None
                        if mname not in members:
                            members.append(mname)
                        if val is not None:
                            values[mname] = val
                    if members:
                        sh_id = f"sh:{sid}:enum:{ename}"
                        if ir.has("shape", sh_id):
                            sh_id = f"sh:{sid}:enum:{sec_title}:{ename}"
                        if ir.has("shape", sh_id):
                            sh_id = f"{sh_id}#{tidx}"
                        sc_desc = _edm_scalar(etype)
                        row = dict(
                            id=sh_id,
                            name=ename,
                            origin="named",
                            kind="scalar",
                            scalar={"scalar": sc_desc["scalar"], "enum": members},
                            src=ir.src(sid, f"Enum: {ename}"),
                            grade="stated",
                            life=ir.life(),
                        )
                        row["ext"] = {"values": values}
                        ir.add("shape", row)
                        stats["enum_shapes"] += 1
            elif any(k in hlow for k in ("parameter", "parameters", "property")) and "type" in hlow:
                p_i = next(idx for idx, h in enumerate(hlow) if h in ("parameter", "parameters", "property"))
                t_i = hlow.index("type")
                req_i = hlow.index("mandatory?") if "mandatory?" in hlow else None
                props = []
                for r in rows:
                    if p_i >= len(r):
                        continue
                    pname = re.sub(r"[`*]", "", r[p_i]).strip()
                    if not pname:
                        continue
                    ptype = r[t_i].strip() if t_i < len(r) else ""
                    prop = {"name": pname}
                    prop.update(_edm_scalar(ptype))
                    prop["required"] = (r[req_i].strip().lower() == "yes") if (req_i is not None and req_i < len(r)) else False
                    props.append(prop)
                if props:
                    sname = title if not ir.has("shape", f"sh:{sid}:{title}") else f"{sec_title}:{title}"
                    sh_id = f"sh:{sid}:{sname}"
                    if ir.has("shape", sh_id):
                        sh_id = f"{sh_id}#{tidx}"
                    ir.add("shape", dict(
                        id=sh_id,
                        name=sname,
                        origin="named",
                        kind="object",
                        props=props,
                        src=ir.src(sid, title),
                        grade="stated",
                        life=ir.life(),
                    ))
                    stats["shapes"] += 1
            else:
                ir.add("hole", dict(
                    id=f"hole:pdf_table_unparsed:{sid}:{title}#{tidx}",
                    at={"source": sid, "section": title},
                    hole="pdf_table_unparsed",
                    reason="스키마 매개변수 표 또는 열거 표 형식이 아니다: %s" % ",".join(hdr),
                    src=ir.src(sid, title),
                    grade="stated",
                    life=ir.life(),
                ))
                stats["holes"] += 1
            continue
        i += 1
    return dict(stats)


def parse_copilot_schema(ir, text, sid=SID_COPILOT):
    stats = collections.Counter()
    for m in re.finditer(r"```xml\s*(.*?)```", text, re.S):
        xml_str = m.group(1).strip()
        if "edmx:" in xml_str and "xmlns:edmx=" not in xml_str:
            xml_str = xml_str.replace("<edmx:DataServices>", '<edmx:DataServices xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">', 1)
        try:
            root = ET.fromstring(xml_str)
        except ET.ParseError:
            continue
        for el in root.iter():
            tg = _tag(el)
            if tg in ("EntityType", "ComplexType") and el.attrib.get("Name"):
                name = el.attrib["Name"]
                props = []
                for p in el:
                    if _tag(p) == "Property" and p.attrib.get("Name"):
                        prop = {"name": p.attrib["Name"]}
                        prop.update(_edm_scalar(p.attrib.get("Type", "")))
                        prop["required"] = False
                        props.append(prop)
                ir.add("shape", dict(
                    id=f"sh:{sid}:{name}",
                    name=name,
                    origin="named",
                    kind="object",
                    props=props,
                    src=ir.src(sid, f"Schema.{name}"),
                    grade="stated",
                    life=ir.life(),
                ))
                stats["shapes"] += 1
    return dict(stats)


class _PurviewHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.h2 = None
        self.in_h2 = False
        self.h2_buf = []
        self.in_table = False
        self.in_row = False
        self.in_cell = False
        self.is_header_cell = False
        self.cell_buf = []
        self.cur_row = []
        self.cur_row_is_hdr = False
        self.cur_headers = []
        self.cur_rows = []
        self.tables = []

    def handle_starttag(self, tag, attrs):
        if tag == "h2":
            self.in_h2 = True
            self.h2_buf = []
        elif tag == "table":
            self.in_table = True
            self.cur_headers = []
            self.cur_rows = []
        elif self.in_table and tag == "tr":
            self.in_row = True
            self.cur_row = []
            self.cur_row_is_hdr = False
        elif self.in_row and tag in ("th", "td"):
            self.in_cell = True
            self.is_header_cell = (tag == "th")
            if tag == "th":
                self.cur_row_is_hdr = True
            self.cell_buf = []

    def handle_endtag(self, tag):
        if tag == "h2" and self.in_h2:
            self.in_h2 = False
            self.h2 = " ".join("".join(self.h2_buf).split())
        elif tag in ("th", "td") and self.in_cell:
            self.in_cell = False
            self.cur_row.append(" ".join("".join(self.cell_buf).split()))
        elif tag == "tr" and self.in_row:
            self.in_row = False
            if self.cur_row:
                if self.cur_row_is_hdr and not self.cur_headers:
                    self.cur_headers = self.cur_row
                else:
                    self.cur_rows.append(self.cur_row)
        elif tag == "table" and self.in_table:
            self.in_table = False
            self.tables.append((self.h2 or "", self.cur_headers, self.cur_rows))

    def handle_data(self, data):
        if self.in_h2:
            self.h2_buf.append(data)
        if self.in_cell:
            self.cell_buf.append(data)


def parse_purview_html(ir, html_text, sid=SID_PURVIEW):
    p = _PurviewHTMLParser()
    p.feed(html_text)
    stats = collections.Counter()
    for tidx, (h2, hdr, rows) in enumerate(p.tables):
        hlow = [h.lower() for h in hdr]
        if "operation" not in hlow:
            ir.add("hole", dict(
                id=f"hole:pdf_table_unparsed:{sid}:{tidx}",
                at={"source": sid, "section": h2 or f"table#{tidx}"},
                hole="pdf_table_unparsed",
                reason="Operation 열이 없는 표: %s" % ",".join(hdr),
                src=ir.src(sid, h2 or f"table#{tidx}"),
                grade="stated",
                life=ir.life(),
            ))
            stats["holes"] += 1
            continue
        op_i = hlow.index("operation")
        disp_i = hlow.index("friendly name") if "friendly name" in hlow else (hlow.index("events") if "events" in hlow else None)
        for r in rows:
            if op_i >= len(r):
                continue
            key = r[op_i].strip()
            if not key:
                continue
            disp = r[disp_i].strip() if (disp_i is not None and disp_i < len(r)) else None
            cat_slug = re.sub(r"[^a-zA-Z0-9]+", "_", h2).strip("_") or "general"
            cid = f"cat:audit:{sid}:{cat_slug}:{key}"
            if ir.has("catalog", cid):
                continue
            ir.add("catalog", dict(
                id=cid,
                catalog="audit",
                key=key,
                display=disp,
                category=h2 or None,
                payload=None,
                targets=[],
                src=ir.src(sid, f"{h2}#Operation={key}"),
                grade="stated",
                life=ir.life(),
            ))
            stats["catalog"] += 1
    return dict(stats)


def parse_entra_audit_md(ir, text, sid=SID_ENTRA):
    stats = collections.Counter()
    blocks = re.split(r"(?m)^(?=## )", text)
    for blk in blocks:
        hm = re.match(r"^##\s+(.+)", blk)
        sec = hm.group(1).strip() if hm else ""
        for tidx, (hdr, rows) in enumerate(_parse_md_tables(blk)):
            hlow = [h.lower() for h in hdr]
            if "activity" not in hlow:
                ir.add("hole", dict(
                    id=f"hole:pdf_table_unparsed:{sid}:{sec}#{tidx}",
                    at={"source": sid, "section": sec or f"table#{tidx}"},
                    hole="pdf_table_unparsed",
                    reason="Activity 열이 없는 표: %s" % ",".join(hdr),
                    src=ir.src(sid, sec or f"table#{tidx}"),
                    grade="stated",
                    life=ir.life(),
                ))
                stats["holes"] += 1
                continue
            act_i = hlow.index("activity")
            cat_i = next((i for i, h in enumerate(hlow) if h in ("audit category", "category", "service")), None)
            for r in rows:
                if act_i >= len(r):
                    continue
                key = re.sub(r"[`*]", "", r[act_i]).strip()
                if not key:
                    continue
                cat = re.sub(r"[`*]", "", r[cat_i]).strip() if (cat_i is not None and cat_i < len(r)) else (sec or None)
                slug = re.sub(r"[^a-zA-Z0-9]+", "_", f"{cat}_{key}").strip("_")
                cid = f"cat:audit:{sid}:{slug}"
                if ir.has("catalog", cid):
                    also = ir.get("catalog", cid)["ext"].setdefault("also_in", [])
                    if sec and sec not in also:
                        also.append(sec)
                    continue
                ir.add("catalog", dict(
                    id=cid,
                    catalog="audit",
                    key=key,
                    display=None,
                    category=cat,
                    payload=None,
                    targets=[],
                    src=ir.src(sid, f"{sec}#Activity={key}"),
                    grade="stated",
                    life=ir.life(),
                ))
                stats["catalog"] += 1
    return dict(stats)


# ---------------------------------------------------------------------- main
def _fix_yaml_bool_param_names(spec):
    """YAML 1.1 로더(PyYAML)가 따옴표 없는 파라미터 이름 'on' 을 bool True 로 읽는 것을 원문 문자열로 복원한다."""
    for item in (spec.get("paths") or {}).values():
        if not isinstance(item, dict):
            continue
        for prm in item.get("parameters") or []:
            if isinstance(prm, dict) and isinstance(prm.get("name"), bool):
                prm["name"] = "on" if prm["name"] else "off"
        for m in openapi2.METHODS:
            op = item.get(m)
            if isinstance(op, dict):
                for prm in op.get("parameters") or []:
                    if isinstance(prm, dict) and isinstance(prm.get("name"), bool):
                        prm["name"] = "on" if prm["name"] else "off"


def ingest_tenant_if_present(ir, reg, sid=SID_TENANT):
    e = reg.get(sid)
    if not e or e.get("missing"):
        return 0
    tdir = core.nemo(e.get("dir") or e["file"])
    if not os.path.isfile(os.path.join(tdir, "_log.tsv")):
        return 0
    return tenant_log.ingest(ir, sid, "/v1.0")


def main():
    sys.setrecursionlimit(10000)
    ir = core.IR(P)
    reg = core.registry()
    lex = core.lexicon(P)

    scope_stats = collections.Counter()
    scope_fn = make_scope_fn(lex, scope_stats)

    spec = core.load_spec(core.nemo(reg[SID_OPENAPI]["file"]))
    _fix_yaml_bool_param_names(spec)
    conv = openapi2.OpenAPIConv(ir, SID_OPENAPI, spec=spec, lifecycle=graph_life)
    conv.run(include=scope_fn)

    with io.open(core.nemo(reg[SID_CSDL]["file"]), encoding="utf-8") as f:
        csdl_text = f.read()
    csdl = parse_csdl(csdl_text)
    csdl_stats = apply_csdl(ir, csdl, SID_CSDL, SID_OPENAPI)
    bind_stats = apply_bindings(ir, conv.s, csdl, make_scope_fn(lex), SID_OPENAPI)

    docs_dir = core.nemo(reg[SID_DOCS].get("dir") or reg[SID_DOCS]["file"])
    perm_stats, perm_unmatched = apply_docs_permissions(ir, docs_dir, SID_DOCS, SID_OPENAPI)

    with io.open(core.nemo(reg[SID_MGMT]["file"]), encoding="utf-8") as f:
        mgmt_stats = parse_mgmt_activity_schema(ir, f.read(), SID_MGMT)
    with io.open(core.nemo(reg[SID_COPILOT]["file"]), encoding="utf-8") as f:
        copilot_stats = parse_copilot_schema(ir, f.read(), SID_COPILOT)
    with io.open(core.nemo(reg[SID_PURVIEW]["file"]), encoding="utf-8") as f:
        purview_stats = parse_purview_html(ir, f.read(), SID_PURVIEW)
    with io.open(core.nemo(reg[SID_ENTRA]["file"]), encoding="utf-8") as f:
        entra_stats = parse_entra_audit_md(ir, f.read(), SID_ENTRA)

    tenant_count = ingest_tenant_if_present(ir, reg)

    counts = ir.write()
    summary = {
        "counts": counts,
        "scope": dict(scope_stats),
        "csdl": csdl_stats,
        "bindings": bind_stats,
        "permissions": perm_stats,
        "permission_unmatched_examples": perm_unmatched,
        "tenant_instances": tenant_count,
        "audit": {
            SID_MGMT: mgmt_stats,
            SID_COPILOT: copilot_stats,
            SID_PURVIEW: purview_stats,
            SID_ENTRA: entra_stats,
        },
    }
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
