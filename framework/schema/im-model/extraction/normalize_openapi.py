# -*- coding: utf-8 -*-
"""② OpenAPI 3 자료 -> 공통 형식. provider 설정은 lexicons/<provider>.yaml 의 sources 에 있다.

    python normalize_openapi.py jira
    python normalize_openapi.py confluence

형식 변환만 한다. 경로, 파라미터(경로, 쿼리, 본문), 요청과 응답 스키마, 동작별 OAuth scope, scope 카탈로그,
웹훅 이벤트 이름을 옮긴다. description 은 옮기기만 하고 규칙에 쓰지 않는다.
"""
import hashlib
import html
import io
import json
import os
import re
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
NEMO = os.path.normpath(os.path.join(HERE, "..", ".."))
METHODS = ("get", "post", "put", "patch", "delete")


def json_content(content):
    """본문 형식 중 JSON 인 것. application/json 이 먼저, 없으면 +json 접미사 형식(application/scim+json)"""
    content = content or {}
    if "application/json" in content:
        return content["application/json"]
    for ct in sorted(content):
        if ct.split(";")[0].endswith("+json"):
            return content[ct]
    return None


def example_values(value, base="$", out=None):
    """예시 응답 JSON -> {자리: [값]}. 자리 표기는 tree 와 같다 ($.a, $[*], $.a[*].b). 문자열과 정수 값만"""
    out = {} if out is None else out
    if isinstance(value, dict):
        for k, v in value.items():
            example_values(v, base + "." + k, out)
    elif isinstance(value, list):
        for v in value:
            example_values(v, base + "[*]", out)
    elif isinstance(value, (str, int)) and not isinstance(value, bool):
        out.setdefault(base, [])
        if str(value)[:80] not in out[base]:
            out[base].append(str(value)[:80])
    return out


def add_examples(rows, vals):
    """tree 가 만든 자리 행에 예시 응답의 값을 붙인다 (samples, 많아야 20개).
    스키마 속성 예시(examples)와 따로 둔다. 예시 응답은 여러 대상의 값이 한 자리에 섞일 수 있어 근거가 더 약하다"""
    for r in rows:
        v = vals.get(r["path"])
        if v and r["type"] not in ("object", "array"):
            r["samples"] = v[:20]


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def write(out, name, rows):
    os.makedirs(out, exist_ok=True)
    rows = sorted(rows, key=lambda r: json.dumps(r, sort_keys=True, ensure_ascii=False))
    with io.open(os.path.join(out, name), "w", encoding="utf-8", newline="\n") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True, ensure_ascii=False) + "\n")
    return len(rows)


class Spec:
    def __init__(self, path, sid):
        text = io.open(path, encoding="utf-8").read()
        if text.lstrip().startswith("{"):
            self.s = json.loads(text)
        else:                                         # YAML 명세 (Okta)
            self.s = yaml.load(text, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))
        self.sid = sid
        self.schemas = self.s.get("components", {}).get("schemas", {})

    def resolve(self, obj):
        seen = 0
        while isinstance(obj, dict) and "$ref" in obj and seen < 20:
            parts = obj["$ref"].split("/")
            # #/components/<종류>/<이름>. 스키마 말고 parameters, responses, requestBodies 참조도 있다 (GitHub)
            if len(parts) == 4 and parts[1] == "components":
                obj = self.s.get("components", {}).get(parts[2], {}).get(parts[3], {})
            else:
                obj = self.schemas.get(parts[-1], {})
            seen += 1
        return obj

    def tree(self, schema, base, side, op_id, out, depth=0, seen=(), sname=None):
        """sname: 이 자리에 들어온 $ref 스키마 이름. 같은 스키마를 쓰는 레코드끼리 같은 공간으로 잇는 근거(다리 B1)"""
        if not isinstance(schema, dict) or depth > 8:
            return
        if "$ref" in schema:
            name = schema["$ref"].split("/")[-1]
            if name in seen:
                out.append(dict(op_id=op_id, side=side, path=base, type="object", schema=name, recursive=True,
                                src={"source": self.sid}))
                return
            return self.tree(self.schemas.get(name, {}), base, side, op_id, out, depth + 1, seen + (name,), name)
        for key in ("allOf", "anyOf", "oneOf"):
            for a in schema.get(key, []):
                self.tree(a, base, side, op_id, out, depth + 1, seen, sname)
        t = schema.get("type")
        if t == "array":
            out.append(dict(op_id=op_id, side=side, path=base, type="array", src={"source": self.sid}))
            self.tree(schema.get("items", {}), base + "[*]", side, op_id, out, depth + 1, seen)
            return
        props = schema.get("properties")
        if t == "object" or props:
            hole = None
            if not props and not any(schema.get(k) for k in ("allOf", "anyOf", "oneOf")):
                hole = "open_map" if schema.get("additionalProperties") else "object_no_props"
            row = dict(op_id=op_id, side=side, path=base, type="object", hole=hole, src={"source": self.sid})
            if sname:
                row["schema"] = sname
            out.append(row)
            for k, v in (props or {}).items():
                vv = self.resolve(v) if isinstance(v, dict) else {}
                self.tree(v, base + "." + k, side, op_id, out, depth + 1, seen)
                if isinstance(vv, dict) and (vv.get("writeOnly") or v.get("writeOnly")):
                    out.append(dict(op_id=op_id, side=side, path=base + "." + k, type=vv.get("type", "string"),
                                    write_only=True, src={"source": self.sid}))
            return
        row = dict(op_id=op_id, side=side, path=base, type=t or "unknown", src={"source": self.sid})
        if schema.get("format"):
            row["format"] = schema["format"]
        if schema.get("example") is not None and isinstance(schema.get("example"), (str, int)):
            row["example"] = str(schema["example"])[:80]
        exs = [str(x)[:80] for x in schema.get("examples") or [] if isinstance(x, (str, int))]   # OpenAPI 3.1 examples 배열
        if exs:
            row["examples"] = exs[:20]
        if schema.get("enum"):
            row["enum"] = [str(x) for x in schema["enum"]][:30]
        if schema.get("writeOnly"):
            row["write_only"] = True
        out.append(row)


def main(provider):
    plex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", provider + ".yaml"), encoding="utf-8"))
    cfg = plex["sources"]
    out = os.path.join(HERE, "out", provider, "ir")
    ops, fields, events, vocab, holes, manifest = {}, [], [], {}, [], {}
    for src in cfg["openapi"]:
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=sha(path), extraction="machine")
        sp = Spec(path, src["id"])
        # scope 카탈로그: securitySchemes 의 OAuth2 scope 전부
        for sch in sp.s.get("components", {}).get("securitySchemes", {}).values():
            for flow in (sch.get("flows") or {}).values():
                for name in (flow.get("scopes") or {}):
                    vocab.setdefault(name, dict(grant_id="%s.scope.%s" % (provider, name), kind="oauth_scope",
                                                name=name, op_ids=[], src={"source": src["id"], "at": "securitySchemes"}))
        for raw_path, item in sp.s["paths"].items():
            p = raw_path
            for pre in src.get("strip_prefixes", []):
                if p.startswith(pre):
                    p = p[len(pre):] or "/"
                    break
            # 같은 파라미터 이름이 경로마다 다른 대상을 가리키면 사전에서 이름을 바꾼다 (2026-10-14)
            # (Atlassian 조직 API 의 userId 는 계정 ID, /scim/ 아래 userId 는 SCIM 사용자 ID)
            ren = {r["from"]: r["to"] for r in src.get("param_rename", []) if p.startswith(r["prefix"])}
            for a, b in ren.items():
                p = p.replace("{%s}" % a, "{%s}" % b)
            shared = item.get("parameters", [])
            for m in METHODS:
                if m not in item:
                    continue
                o = item[m]
                op_id = "%s.%s" % (provider, o.get("operationId") or (m + p))
                params = []
                for prm in shared + o.get("parameters", []):
                    prm = sp.resolve(prm)
                    if not prm.get("name") or prm.get("in") == "header":
                        continue
                    ps = sp.resolve(prm.get("schema", {}))
                    params.append(dict(name=ren.get(prm["name"], prm["name"]) if prm.get("in") == "path" else prm["name"],
                                       **{"in": prm.get("in")}, required=bool(prm.get("required")),
                                       type=ps.get("type"), enum=bool(ps.get("enum")),
                                       example=str(prm.get("example") or ps.get("example"))[:80]
                                       if (prm.get("example") or ps.get("example")) is not None else None))
                body = (o.get("requestBody") or {})
                body = sp.resolve(body)
                bschema = (json_content(body.get("content")) or {}).get("schema")
                if bschema:
                    bs = sp.resolve(bschema)
                    req = set(bs.get("required", []))
                    for k, v in (bs.get("properties") or {}).items():
                        vv = sp.resolve(v)
                        params.append(dict(name=k, **{"in": "body"}, required=k in req, type=vv.get("type"),
                                           example=str(vv.get("example"))[:80] if isinstance(vv.get("example"), (str, int)) else None))
                    sp.tree(bschema, "$", "request", op_id, fields)
                scopes = sorted({s for x in o.get("x-atlassian-oauth2-scopes", []) if x.get("state", "Current") in ("Current", "Beta")
                                 for s in x.get("scopes", [])})
                for sec in o.get("security", []):
                    for k, v in sec.items():
                        if k.lower().startswith("oauth"):
                            scopes = sorted(set(scopes) | set(v))
                has_resp = False
                for code in ("200", "201"):
                    r = sp.resolve((o.get("responses") or {}).get(code) or {})
                    media = json_content(r.get("content")) or {}
                    sch = media.get("schema")
                    if sch:
                        start = len(fields)
                        sp.tree(sch, "$", "response", op_id, fields)
                        # 예시 응답의 값 (GitHub components/examples). 값의 모양이 공간 근거가 된다 (node_id 해독, 2부 V2)
                        vals = {}
                        for ex in ([media["example"]] if "example" in media else []) +                                 [sp.resolve(e).get("value") for e in (media.get("examples") or {}).values()]:
                            if ex is not None:
                                example_values(ex, "$", vals)
                        add_examples(fields[start:], vals)
                        has_resp = True
                        break
                ops[op_id] = dict(op_id=op_id, provider=provider, surface="rest", method=o.get("operationId") or m + p,
                                  path=p, http_method=m.upper(), params=sorted(params, key=lambda x: (x["in"] or "", x["name"])),
                                  scopes=scopes, deprecated=bool(o.get("deprecated")), has_response=has_resp,
                                  src={"source": src["id"], "at": "%s %s" % (m.upper(), raw_path)})
                for s in scopes:
                    vocab.setdefault(s, dict(grant_id="%s.scope.%s" % (provider, s), kind="oauth_scope", name=s, op_ids=[],
                                             src={"source": src["id"], "at": "operation scopes"}))["op_ids"].append(op_id)
    for f in fields:
        if f.get("hole"):
            holes.append(dict(op_id=f["op_id"], path=f["path"], hole=f["hole"], src=f["src"]))
    # 웹훅 이벤트 이름 (문서의 <code> 토큰)
    for ev in cfg.get("events", []):
        path = os.path.join(NEMO, ev["path"])
        manifest[ev["id"]] = dict(path=ev["path"], sha256=sha(path), extraction="parser@1")
        t = io.open(path, encoding="utf-8").read()
        names = {html.unescape(c) for c in re.findall(r"<code[^>]*>([^<]{3,60})</code>", t)}
        names = {n for n in names if re.match(r"^[a-z_:]+$", n) and "_" in n}
        for n in sorted(names):
            if any(n.startswith(x) for x in ev.get("exclude_prefixes", [])) or n in ev.get("exclude", []):
                continue
            events.append(dict(event_id="%s.event.%s" % (provider, n), catalog="event_api", name=n, scopes=[],
                               src={"source": ev["id"]}))
    for v in vocab.values():
        v["op_ids"] = sorted(set(v["op_ids"]))
    counts = dict(operations=write(out, "operations.jsonl", ops.values()), fields=write(out, "fields.jsonl", fields),
                  id_defs=write(out, "id_defs.jsonl", []), events=write(out, "events.jsonl", events),
                  grant_vocab=write(out, "grant_vocab.jsonl", vocab.values()), holes=write(out, "holes.jsonl", holes))
    with io.open(os.path.join(out, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sources=manifest, counts=counts), f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(counts))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1])
