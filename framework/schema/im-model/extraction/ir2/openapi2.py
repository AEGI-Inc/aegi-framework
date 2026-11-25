# -*- coding: utf-8 -*-
"""OpenAPI 3.0, 3.1 과 Swagger 2.0 -> IR 개체 (operation, shape, instance, binding, grant, catalog, hole).

규칙 (IR 설계.md 4.1):
- 모양은 1급이다. components 스키마는 이름 있는 모양(named), 그 밖은 첫 출현 위치로 id 를 만든 인라인 모양이다.
- oneOf, anyOf 의 대안은 union 모양으로 남긴다. null 대안은 대안이 아니라 nullable 표시다.
- allOf 는 합쳐 한 모양으로 두고 ext.allOf 에 구성 요소를 남긴다.
- 본문 인자는 request 모양에만 둔다. params 에는 경로, 질의, 머리 인자만 있다.
- 예시는 객체 단위 instance 로 남긴다 (응답 예시, components/examples, 스키마 예시, 속성 예시, 인자 예시).
- description 은 읽지 않는다.
"""
import json
import re

import core

METHODS = ("get", "put", "post", "delete", "patch", "head", "options")
VENDOR_EXT = ("x-github", "x-okta-lifecycle", "x-atlassian-connect-scope", "x-experimental", "x-changes",
              "x-atlassian-data-security-policy", "tags",
              "x-ms-deprecation", "x-ms-navigationProperty", "x-ms-discriminator-value",
              "x-ms-docs-key-type", "x-ms-pageable", "x-ms-docs-operation-type")


def is_null_schema(a):
    return isinstance(a, dict) and (a.get("type") == "null" or a.get("enum") == [None]) and "properties" not in a


def json_media(content):
    """본문 형식 중 JSON 인 것: application/json 먼저, 다음 +json 접미사, 다음 */*"""
    content = content or {}
    if "application/json" in content:
        return "application/json", content["application/json"]
    for ct in sorted(content):
        if ct.split(";")[0].strip().endswith("+json") or ct.split(";")[0].strip().endswith("/json"):
            return ct, content[ct]
    if "*/*" in content:
        return "*/*", content["*/*"]
    return None, None


class OpenAPIConv:
    def __init__(self, ir, sid, spec=None, strip_prefixes=(), lifecycle=None, extra_grants=None, generic_wrappers=(),
                 op_hook=None, op_name=None):
        self.op_hook = op_hook                # 함수 (row, op dict, method, raw_path): 동작 행을 넣기 전에 고친다 (RPC 표면 등)
        self.op_name = op_name                # 함수 (op dict, method, raw_path) -> 동작 이름
        self.ir = ir
        self.sid = sid
        self.entry = core.registry()[sid]
        self.s = spec if spec is not None else core.load_spec(core.nemo(self.entry["file"]))
        self.v2 = "swagger" in self.s
        self.schemas = (self.s.get("definitions") if self.v2 else self.s.get("components", {}).get("schemas")) or {}
        self.named_ids = {"sh:%s:%s" % (self.sid, n) for n in self.schemas}
        self.schema_loc = "definitions." if self.v2 else "components.schemas."
        self.strip_prefixes = tuple(strip_prefixes)
        self.lifecycle = lifecycle            # 함수 (op dict) -> (state, sunset) ; state 가 removed 면 뺀다
        self.extra_grants = extra_grants      # 함수 (op dict) -> [(kind, name)]
        self.generic_wrappers = set(generic_wrappers)
        self.done = set()
        self.ops = {}                         # 동작 이름 -> op id
        self.n_examples = 0

    # ------------------------------------------------------------------ 머리
    def head(self, locator, grade="stated", life=None):
        return {"src": self.ir.src(self.sid, locator), "grade": grade, "life": life or {"state": "active"}}

    def resolve(self, obj, depth=0):
        while isinstance(obj, dict) and "$ref" in obj and depth < 30:
            parts = obj["$ref"].lstrip("#/").split("/")
            cur = self.s
            for p in parts:
                cur = cur.get(p.replace("~1", "/").replace("~0", "~"), {}) if isinstance(cur, dict) else {}
            obj = cur
            depth += 1
        return obj

    @staticmethod
    def ref_name(ref):
        return ref.split("/")[-1].replace("~1", "/").replace("~0", "~")

    def is_schema_ref(self, ref):
        return ref.startswith("#/components/schemas/") or ref.startswith("#/definitions/")

    # ------------------------------------------------------------------ 모양
    def named(self, name):
        sid = "sh:%s:%s" % (self.sid, name)
        if sid in self.done:
            return sid
        self.done.add(sid)
        sch = self.schemas.get(name)
        loc = self.schema_loc + name
        if sch is None:
            self.ir.add("shape", dict(id=sid, name=name, origin="named", kind="object", props=[], **self.head(loc)))
            self.hole({"shape": sid}, "unresolved_ref", "참조한 스키마가 명세에 없다", loc)
            return sid
        self.build(sch, sid, name, "named", loc)
        return sid

    def strip_null(self, schema):
        if not isinstance(schema, dict):
            return {}, False
        nullable = schema.get("nullable") is True or schema.get("x-nullable") is True
        t = schema.get("type")
        if isinstance(t, list) and "null" in t:
            nullable = True
            rest = [x for x in t if x != "null"]
            schema = dict(schema, type=rest[0] if len(rest) == 1 else rest)
        for key in ("anyOf", "oneOf"):
            alts = schema.get(key)
            if not isinstance(alts, list):
                continue
            non = [a for a in alts if not is_null_schema(a)]
            if len(non) < len(alts):
                nullable = True
                if len(non) == 1 and not any(k in schema for k in ("properties", "allOf", "items")):
                    base = {k: v for k, v in schema.items() if k != key}
                    one = non[0]
                    if "$ref" in one:
                        schema = dict(base, **{"$ref": one["$ref"]})
                    else:
                        schema = dict(base, **one)
                else:
                    schema = dict(schema, **{key: non})
        return schema, nullable

    def is_scalar(self, schema):
        if not isinstance(schema, dict) or "$ref" in schema:
            return False
        if any(k in schema for k in ("properties", "allOf", "items", "additionalProperties", "discriminator")):
            return False
        for key in ("oneOf", "anyOf"):
            if isinstance(schema.get(key), list) and schema[key]:
                return False
        t = schema.get("type")
        if isinstance(t, list):
            return all(x not in ("object", "array") for x in t)
        return t not in ("object", "array")

    @staticmethod
    def scalar_desc(schema):
        t = schema.get("type")
        if isinstance(t, list):
            t = "|".join(t)
        d = {"scalar": t or "any"}
        if schema.get("format"):
            d["format"] = schema["format"]
        if schema.get("enum") is not None:
            d["enum"] = [x for x in schema["enum"] if x is not None] if isinstance(schema["enum"], list) else schema["enum"]
        if schema.get("pattern"):
            d["pattern"] = schema["pattern"]
        return d

    def _inline_id(self, sid):
        return sid + "#inline" if sid in self.named_ids else sid

    def ref_of(self, schema, inline_id, loc):
        """값 자리 하나의 서술: {'shape': id} 또는 {'scalar': ..}"""
        schema, _ = self.strip_null(schema)
        if "$ref" in schema and self.is_schema_ref(schema["$ref"]):
            return {"shape": self.named(self.ref_name(schema["$ref"]))}
        if "$ref" in schema:
            schema = self.resolve(schema)
        al = schema.get("allOf")
        if isinstance(al, list) and len(al) == 1 and isinstance(al[0], dict) and "$ref" in al[0] and                 self.is_schema_ref(al[0]["$ref"]) and not any(k in schema for k in ("properties", "oneOf", "anyOf", "items")):
            return {"shape": self.named(self.ref_name(al[0]["$ref"]))}      # allOf 하나로 $ref 에 설명만 붙인 꼴
        if self.is_scalar(schema):
            return self.scalar_desc(schema)
        inline_id = self._inline_id(inline_id)
        if inline_id.count(".") + inline_id.count("[*]") + inline_id.count("|") > 40:
            self.ir.add("shape", dict(id=inline_id, name=None, origin="inline", kind="object", props=[], **self.head(loc)))
            self.hole({"shape": inline_id}, "recursive_cut", "인라인 모양이 40단 넘게 이어져 자른다 (자기 참조 allOf)", loc)
            return {"shape": inline_id}
        self.build(schema, inline_id, None, "inline", loc)
        return {"shape": inline_id}

    def as_shape(self, desc, sid, loc):
        """서술이 스칼라면 스칼라 모양을 만들어 id 를 돌려준다 (request, response, 대안 자리는 모양 id 만 받는다)"""
        if "shape" in desc:
            return desc["shape"]
        sid = self._inline_id(sid)
        if sid not in self.done:
            self.done.add(sid)
            self.ir.add("shape", dict(id=sid, name=None, origin="inline", kind="scalar", scalar=desc, **self.head(loc)))
        return sid

    def merge_allof(self, schema, seen=()):
        props, required, parts, extra = {}, set(), [], {}
        for i, part in enumerate(schema.get("allOf") or []):
            if not isinstance(part, dict):
                continue
            if "$ref" in part:
                name = self.ref_name(part["$ref"])
                parts.append(self.named(name))
                if name in seen:
                    continue
                sub = self.resolve(part)
                seen2 = seen + (name,)
            else:
                parts.append("inline#%d" % i)
                sub, seen2 = part, seen
            if isinstance(sub, dict) and sub.get("allOf"):
                sub, _ = self.merge_allof(sub, seen2)
            sub, _ = self.strip_null(sub) if isinstance(sub, dict) else ({}, False)
            for k, v in (sub.get("properties") or {}).items():
                # 같은 속성을 두 구성 요소가 말하면 둘 다 성립한다 (allOf). 덮어쓰지 않고 그 속성도 allOf 로 둔다
                props[k] = {"allOf": [props[k], v]} if k in props and props[k] != v else v
            required |= set(sub.get("required") or [])
            for k in ("type", "oneOf", "anyOf", "discriminator", "additionalProperties", "items", "enum", "format"):
                if k in sub and k not in extra:
                    extra[k] = sub[k]
        props.update(schema.get("properties") or {})
        required |= set(schema.get("required") or [])
        merged = {k: v for k, v in schema.items() if k != "allOf"}
        for k, v in extra.items():
            merged.setdefault(k, v)
        if props:
            merged["properties"] = props
            merged.setdefault("type", "object")
        if required:
            merged["required"] = sorted(required)
        return merged, parts

    def build(self, schema, sid, name, origin, loc, grade="stated"):
        self.done.add(sid)
        schema, nullable = self.strip_null(schema if isinstance(schema, dict) else {})
        if "$ref" in schema and self.is_schema_ref(schema["$ref"]):
            # 이름 있는 스키마가 다른 이름 있는 스키마를 그대로 가리킨다: 대안 하나인 union 으로 남긴다
            target = self.named(self.ref_name(schema["$ref"]))
            row = dict(id=sid, name=name, origin=origin, kind="union", alts=[target], **self.head(loc, grade))
            row["ext"] = {"single_ref": True, "nullable": nullable}
            self.ir.add("shape", row)
            return
        ext = {}
        if schema.get("allOf"):
            schema, parts = self.merge_allof(schema)
            ext["allOf"] = parts
        if nullable:
            ext["nullable"] = True
        row = dict(id=sid, name=name, origin=origin, **self.head(loc, grade))
        alts_key = next((k for k in ("oneOf", "anyOf") if isinstance(schema.get(k), list) and schema.get(k)), None)
        if not alts_key and isinstance(schema.get("items"), list) and schema.get("type") != "array":
            alts_key = "items"                          # Slack 구판 명세: type 없이 items 에 대안 목록을 둔다 (objs_user ...)
        props = schema.get("properties")
        t = schema.get("type")
        if alts_key:
            row["kind"] = "union"
            row["alts"] = [self.as_shape(self.ref_of(a, "%s|%d" % (sid, i), "%s.%s[%d]" % (loc, alts_key, i)),
                                         "%s|%d" % (sid, i), "%s.%s[%d]" % (loc, alts_key, i))
                           for i, a in enumerate(schema[alts_key])]
            ext["union_keyword"] = alts_key if alts_key != "items" else "items[] (type 없음)"
            if props:
                row["props"] = self.props(schema, sid, loc)
        elif t == "array" or "items" in schema:
            row["kind"] = "array"
            items = schema.get("items")
            if isinstance(items, list):                 # 튜플 꼴 (Slack 구판 objs_*): 대안 목록으로 남긴다
                iid = sid + "[*]"
                self.done.add(iid)
                alts = [self.as_shape(self.ref_of(a, "%s|%d" % (iid, i), "%s.items[%d]" % (loc, i)), "%s|%d" % (iid, i),
                                      "%s.items[%d]" % (loc, i)) for i, a in enumerate(items)]
                urow = dict(id=iid, name=None, origin="inline", kind="union", alts=alts, **self.head(loc + ".items"))
                urow["ext"] = {"union_keyword": "items[]"}
                self.ir.add("shape", urow)
                row["items"] = {"shape": iid}
            else:
                row["items"] = self.ref_of(items or {}, sid + "[*]", loc + ".items")
                if "shape" not in row["items"] and isinstance(items, dict):     # 스칼라 원소의 예시
                    self.examples_of(items, {"shape": sid, "prop": "[*]"}, loc + ".items")
        elif props or t == "object" or "additionalProperties" in schema or schema.get("discriminator"):
            addl = schema.get("additionalProperties")
            if props:
                row["kind"] = "object"
                row["props"] = self.props(schema, sid, loc)
                if isinstance(addl, dict) and addl:
                    ext["additional"] = self.ref_of(addl, sid + "{*}", loc + ".additionalProperties")
            elif isinstance(addl, dict) and addl:
                row["kind"] = "map"
                row["items"] = self.ref_of(addl, sid + "{*}", loc + ".additionalProperties")
            else:
                row["kind"] = "object"
                row["props"] = []
                if addl is True or addl == {}:
                    self.hole({"shape": sid}, "open_map", "속성 없이 additionalProperties 만 있다", loc)
                else:
                    self.hole({"shape": sid}, "object_no_props", "속성이 없는 객체", loc)
        else:
            row["kind"] = "scalar"
            row["scalar"] = self.scalar_desc(schema)
        disc = schema.get("discriminator")
        if isinstance(disc, dict) and disc.get("propertyName"):
            mp = {}
            for v, r in sorted((disc.get("mapping") or {}).items()):
                if isinstance(r, str) and self.is_schema_ref(r):
                    mp[str(v)] = self.named(self.ref_name(r))
                elif isinstance(r, str):
                    mp[str(v)] = self.named(r)
            row["discriminator"] = {"prop": disc["propertyName"], "map": mp}
        elif isinstance(disc, str):                     # Swagger 2.0
            row["discriminator"] = {"prop": disc, "map": {}}
        if schema.get("deprecated"):
            row["life"] = {"state": "deprecated"}
        row["ext"] = ext
        self.ir.add("shape", row)
        self.examples_of(schema, {"shape": sid}, loc)

    def props(self, schema, sid, loc):
        req = set(schema.get("required") or [])
        out = []
        for pname, psch in (schema.get("properties") or {}).items():
            if not isinstance(psch, dict):
                continue
            ps, pnull = self.strip_null(psch)
            e = {"name": pname}
            e.update(self.ref_of(ps, "%s.%s" % (sid, pname), "%s.properties.%s" % (loc, pname)))
            e["required"] = pname in req
            for k, kk in (("readOnly", "read_only"), ("writeOnly", "write_only")):
                if psch.get(k) or ps.get(k):
                    e[kk] = True
            if pnull:
                e["nullable"] = True
            if psch.get("deprecated") or ps.get("deprecated"):
                e["deprecated"] = True
            if psch.get("x-ms-navigationProperty") is True or ps.get("x-ms-navigationProperty") is True:
                e["navigation"] = True
            out.append(e)
            if "shape" not in e or "$ref" in ps:
                self.examples_of(psch, {"shape": sid, "prop": pname}, "%s.properties.%s" % (loc, pname))
        return out

    def examples_of(self, schema, of, loc):
        vals = []
        if "example" in schema and schema["example"] is not None:
            vals.append(schema["example"])
        if isinstance(schema.get("examples"), list):
            vals += [v for v in schema["examples"] if v is not None]
        elif isinstance(schema.get("examples"), dict) and self.v2:
            vals += list(schema["examples"].values())
        self.instances(of, vals, loc)

    def instances(self, of, vals, loc, names=None, grade="example"):
        base = "in:" + "|".join("%s=%s" % (k, of[k]) for k in sorted(of))
        for i, v in enumerate(vals):
            # 응답, 요청 예시가 JSON 을 담은 문자열이면 풀어서 둔다 (Atlassian 명세는 예시를 문자열로 적는다). 형식 변환일 뿐이다
            if isinstance(v, str) and "status" in of and v.lstrip()[:1] in ("{", "["):
                try:
                    v = json.loads(v)
                    self.ir_json_examples = getattr(self, "ir_json_examples", 0) + 1
                except ValueError:
                    pass
            row = dict(id="%s#%d" % (base, i), of=of, value=v, **self.head(loc, grade))
            if names and names[i]:
                row["ext"] = {"example_name": names[i]}
            self.ir.add("instance", row)
            self.n_examples += 1

    def hole(self, at, kind, reason, loc):
        key = "|".join("%s=%s" % (k, at[k]) for k in sorted(at))
        self.ir.add("hole", dict(id="hole:%s:%s" % (kind, key), at=at, hole=kind, reason=reason, **self.head(loc)))

    def media_examples(self, media, of, loc):
        vals, names = [], []
        if not isinstance(media, dict):
            return
        if "example" in media and media["example"] is not None:
            vals.append(media["example"])
            names.append(None)
        for n, e in sorted((media.get("examples") or {}).items()):
            e = self.resolve(e)
            if isinstance(e, dict) and "value" in e:
                vals.append(e["value"])
                names.append(n)
        self.instances(of, vals, loc, names)

    # ------------------------------------------------------------------ 경로
    def template(self, raw):
        p = raw
        for pre in self.strip_prefixes:
            if p.startswith(pre):
                p = p[len(pre):] or "/"
                break
        return p.strip("/")

    def run(self, include=None):
        sec = (self.s.get("securityDefinitions") if self.v2 else self.s.get("components", {}).get("securitySchemes")) or {}
        oauth_names = set()
        for sname, sch in sorted(sec.items()):
            sch = self.resolve(sch)
            if sch.get("type") == "oauth2":
                oauth_names.add(sname)
                scopes = dict(sch.get("scopes") or {})
                for flow in (sch.get("flows") or {}).values():
                    scopes.update(flow.get("scopes") or {})
                for sc in sorted(scopes):
                    self.grant("oauth_scope", sc, None, "securitySchemes.%s" % sname)
        glob_sec = self.s.get("security") or []
        seen_ids = {}
        for raw_path, item in self.s.get("paths", {}).items():
            for m in METHODS:
                oid_ = ((self.resolve(item) or {}).get(m) or {}).get("operationId")
                if oid_:
                    seen_ids[oid_] = seen_ids.get(oid_, 0) + 1
        self.dup_ids = {k for k, v in seen_ids.items() if v > 1}
        if self.dup_ids:
            self.ir.issue("duplicate_operation_id", {"source": self.sid}, "normalize", "operation",
                          "명세 안에서 operationId 가 겹친다. 동작 이름에 메서드와 경로를 붙여 구별했다", {"ids": sorted(self.dup_ids)})
        for raw_path, item in self.s.get("paths", {}).items():
            item = self.resolve(item)
            if include and not include(raw_path):
                continue
            shared = item.get("parameters", [])
            for m in METHODS:
                if m not in item:
                    continue
                self.operation(raw_path, m, item[m], shared, oauth_names, glob_sec)
        for key in ("webhooks", "x-webhooks"):
            for wk, item in sorted((self.s.get(key) or {}).items()):
                self.webhook(key, wk, self.resolve(item))
        # 동작이 가리키지 않은 이름 있는 스키마도 남긴다 (원문에 있는 모양 전부)
        if not include:
            for name in sorted(self.schemas):
                self.named(name)

    def grant(self, kind, name, op_id, loc):
        gid = "gr:%s:%s" % (kind, name)
        if not self.ir.has("grant", gid):
            self.ir.add("grant", dict(id=gid, kind=kind, name=name, operations=[], **self.head(loc)))
        g = self.ir.get("grant", gid)
        if op_id and op_id not in g["operations"]:
            g["operations"] = sorted(g["operations"] + [op_id])
        return gid

    def operation(self, raw_path, m, o, shared, oauth_names, glob_sec):
        name = self.op_name(o, m, raw_path) if self.op_name else (o.get("operationId") or "%s %s" % (m.upper(), raw_path))
        if not self.op_name and o.get("operationId") in self.dup_ids:
            name = "%s@%s %s" % (o["operationId"], m.upper(), raw_path)    # 명세 안에서 operationId 가 겹친다 (JSM)
        oid = "op:%s:%s" % (self.sid, name)
        loc = "paths.%s.%s" % (raw_path, m)
        state, sunset = ("deprecated" if o.get("deprecated") else "active"), None
        if self.lifecycle:
            state, sunset = self.lifecycle(o, state)
        if state == "removed":
            self.ir.dropped.append({"operation": oid, "locator": loc, "sunset": sunset})
            return
        tmpl = self.template(raw_path)
        params, req_props, req_required = [], {}, []
        merged = {}
        for prm in list(shared) + list(o.get("parameters", [])):
            prm = self.resolve(prm)
            if isinstance(prm, dict) and prm.get("name"):
                merged[(prm.get("in"), prm["name"])] = prm
        for (pin, pname), prm in merged.items():
            if pin == "body":                               # Swagger 2.0 본문
                req_props["__body__"] = prm.get("schema") or {}
                continue
            if pin == "formData":
                req_props[pname] = {k: v for k, v in prm.items() if k in ("type", "format", "enum", "items", "example")}
                if prm.get("required"):
                    req_required.append(pname)
                continue
            if pin == "cookie":
                continue
            psch = prm.get("schema") if not self.v2 else {k: v for k, v in prm.items() if k in ("type", "format", "enum", "items", "pattern")}
            e = {"name": pname, "in": pin, "required": bool(prm.get("required"))}
            e.update(self.ref_of(psch or {}, "sh:%s:op:%s:param:%s:%s" % (self.sid, name, pin, pname), loc + ".parameters." + pname))
            if prm.get("deprecated"):
                e["deprecated"] = True
            params.append(e)
            ex = [prm["example"]] if prm.get("example") is not None else []
            ex += [self.resolve(v).get("value") for v in (prm.get("examples") or {}).values()
                   if isinstance(self.resolve(v), dict) and self.resolve(v).get("value") is not None]
            if ex:
                self.instances({"operation": oid, "param": pname}, ex, loc + ".parameters." + pname)
        request = None
        if self.v2:
            if "__body__" in req_props:
                request = self.as_shape(self.ref_of(req_props["__body__"], "sh:%s:op:%s:req" % (self.sid, name), loc + ".body"),
                                        "sh:%s:op:%s:req" % (self.sid, name), loc + ".body")
            elif req_props:
                rid = "sh:%s:op:%s:req" % (self.sid, name)
                self.build({"type": "object", "properties": req_props, "required": req_required}, rid, None, "inline",
                           loc + ".formData")
                request = rid
        else:
            body = self.resolve(o.get("requestBody") or {})
            media_t, media = json_media(body.get("content"))
            if media_t is None and body.get("content"):
                media_t = sorted(body["content"])[0]
                media = body["content"][media_t]
            if media and media.get("schema"):
                rid = "sh:%s:op:%s:req" % (self.sid, name)
                request = self.as_shape(self.ref_of(media["schema"], rid, loc + ".requestBody"), rid, loc + ".requestBody")
                self.media_examples(media, {"operation": oid, "status": "request"}, loc + ".requestBody")
        responses = []
        for code, r in sorted((o.get("responses") or {}).items(), key=lambda kv: str(kv[0])):
            r = self.resolve(r)
            code = str(code)
            if self.v2:
                media_t, sch = ("application/json", r.get("schema")) if r.get("schema") else (None, None)
                media = {"examples": {k: {"value": v} for k, v in (r.get("examples") or {}).items()}}
            else:
                media_t, media = json_media(r.get("content"))
                if media_t is None and r.get("content"):
                    media_t = sorted(r["content"])[0]
                    media = r["content"][media_t]
                sch = (media or {}).get("schema")
            shape = None
            if sch:
                rid = "sh:%s:op:%s:resp:%s" % (self.sid, name, code)
                shape = self.as_shape(self.ref_of(sch, rid, "%s.responses.%s" % (loc, code)), rid, "%s.responses.%s" % (loc, code))
            responses.append({"status": code, "media": media_t, "shape": shape})
            self.media_examples(media, {"operation": oid, "status": code}, "%s.responses.%s" % (loc, code))
            for lname, link in sorted((r.get("links") or {}).items()):
                link = self.resolve(link)
                tgt = link.get("operationId")
                for pn, expr in sorted((link.get("parameters") or {}).items()):
                    if tgt and isinstance(expr, str) and expr.startswith("$response.body#/") and shape:
                        prop = expr[len("$response.body#/"):].replace("/", ".")
                        self.ir.add("binding", dict(id="bd:%s:%s:%s" % (self.sid, tgt, pn),
                                                    operation="op:%s:%s" % (self.sid, tgt), param=pn,
                                                    to={"shape": shape, "prop": prop},
                                                    **self.head("%s.responses.%s.links.%s" % (loc, code, lname))))
        ok = [x for x in responses if x["status"].startswith("2")]
        first = next((x for x in ok if x["shape"]), None)
        rk, wrap = None, False
        if first:
            srow = self.ir.get("shape", first["shape"])
            rk = srow["kind"] if srow else None
            if srow and srow["kind"] == "object":
                arr = [p for p in srow.get("props", []) if p.get("shape") and (self.ir.get("shape", p["shape"]) or {}).get("kind") == "array"]
                wrap = len(arr) == 1 and (self.ir.get("shape", (self.ir.get("shape", arr[0]["shape"]).get("items") or {}).get("shape") or "") or {}).get("kind") == "object"   # 객체 원소 배열 속성이 하나뿐인 객체 (이름 표를 쓰지 않는다)
        status = (ok[0]["status"] if ok else None)
        kind = core.rest_kind(m, tmpl, rk, status, wrap)
        grants = []
        sec = o.get("security", glob_sec) or []
        for req in sec:
            for sname, scopes in req.items():
                if sname in oauth_names:
                    for sc in scopes:
                        grants.append(self.grant("oauth_scope", sc, oid, loc + ".security"))
        for x in o.get("x-atlassian-oauth2-scopes", []) or []:
            if x.get("state", "Current") in ("Current", "Beta"):
                for sc in x.get("scopes", []):
                    grants.append(self.grant("oauth_scope", sc, oid, loc + ".x-atlassian-oauth2-scopes"))
        for p in o.get("x-okta-iam-permissions", []) or []:
            grants.append(self.grant("privilege", p, oid, loc + ".x-okta-iam-permissions"))
        for p in o.get("x-okta-iam-admin-roles", []) or []:
            grants.append(self.grant("role", p, oid, loc + ".x-okta-iam-admin-roles"))
        if self.extra_grants:
            for gk, gn, gloc in self.extra_grants(o, m, raw_path):
                grants.append(self.grant(gk, gn, oid, gloc))
        ext = {"raw_path": raw_path}
        for k in VENDOR_EXT:
            if k in o:
                ext[k] = o[k]
        if o.get("tags"):
            ext["tags"] = o["tags"]
        row = dict(id=oid, surface="rest", name=name, method=m.upper(), kind=kind, kind_grade="transform",
                   path={"template": tmpl, "positions": core.path_positions(tmpl)},
                   params=sorted(params, key=lambda x: (x["in"] or "", x["name"])), request=request,
                   responses=responses, grants=sorted(set(grants)), **self.head(loc, "stated", core.IR.life(state, sunset)))
        row["ext"] = ext
        if self.op_hook:
            self.op_hook(row, o, m, raw_path)
        self.ir.add("operation", row)
        self.ops[name] = oid
        if not first and not (ok and all(x["media"] is None for x in ok)):
            self.hole({"operation": oid}, "no_response_schema", "2xx 응답에 본문 스키마가 없다", loc + ".responses")

    def webhook(self, key, wk, item):
        o = item.get("post") or {}
        loc = "%s.%s.post" % (key, wk)
        body = self.resolve(o.get("requestBody") or {})
        _, media = json_media(body.get("content"))
        payload = None
        if media and media.get("schema"):
            pid = "sh:%s:webhook:%s" % (self.sid, wk)
            payload = self.as_shape(self.ref_of(media["schema"], pid, loc + ".requestBody"), pid, loc + ".requestBody")
        xg = o.get("x-github") or {}
        cid = "cat:event:%s:%s" % (self.sid, wk)
        state = "deprecated" if o.get("deprecated") else "active"
        row = dict(id=cid, catalog="event", key=wk, display=None, category=xg.get("subcategory") or xg.get("category"),
                   payload=payload, targets=[], **self.head(loc, "stated", {"state": state}))
        row["ext"] = {k: v for k, v in (("x-github", xg), ("operationId", o.get("operationId"))) if v}
        self.ir.add("catalog", row)
        if media:
            self.media_examples(media, {"catalog": cid}, loc + ".requestBody")
