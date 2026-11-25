# -*- coding: utf-8 -*-
"""② Okta 자료 -> 공통 형식. 설정은 lexicons/okta.yaml 의 sources (2026-10-14).

    python normalize_okta.py

1. Management OpenAPI (YAML, normalize_openapi.py 와 같은 변환. securitySchemes 의 OAuth scope 도 여기서 나온다)
2. System Log 이벤트 유형 JSON (okta-developer-docs 저장소, developer.okta.com 이벤트 유형 페이지의 원본)
   - 이벤트 유형마다 감사 action (catalog=audit). category 는 이름의 첫 조각(user.lifecycle.create -> user).
     문서의 category(제품 영역, core-identity ...)는 product 로 둔다. 대상 스키마(targets)와 변경 상세(changeDetails) 이름을 남긴다
   - fields: debugData 와 대상 스키마의 속성 이름. 감사 필드 자리 (side=audit, op_id=audit:<필드>)
   - 태그 event-hook-eligible 인 유형은 이벤트 훅으로 받을 수 있어 이벤트(catalog=event_api)로도 둔다
3. 관리자 권한 안내의 권한 이름(okta.users.read ...), 표준 역할 안내의 역할 유형(SUPER_ADMIN ...) -> 권한 어휘

형식 변환만 한다. description 은 읽지 않는다.
"""
import io
import json
import os
import re
import sys

import yaml

import normalize_openapi as no

HERE, NEMO = no.HERE, no.NEMO


def load(out, name):
    p = os.path.join(out, name)
    return [json.loads(l) for l in io.open(p, encoding="utf-8")] if os.path.exists(p) else []


def main():
    provider = "okta"
    cfg = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", provider + ".yaml"), encoding="utf-8"))["sources"]
    out = os.path.join(HERE, "out", provider, "ir")
    os.makedirs(out, exist_ok=True)
    no.main(provider)
    ops = {o["op_id"]: o for o in load(out, "operations.jsonl")}
    fields, holes = load(out, "fields.jsonl"), load(out, "holes.jsonl")
    vocab = {v["name"]: v for v in load(out, "grant_vocab.jsonl")}
    events = load(out, "events.jsonl")
    manifest = json.load(io.open(os.path.join(out, "manifest.json"), encoding="utf-8"))["sources"]

    # 2. System Log 이벤트 유형
    for src in cfg.get("system_log", []):
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=no.sha(path), extraction="machine")
        d = json.load(io.open(path, encoding="utf-8"))
        ver = d["versions"][0]
        schemas = ver.get("schemas", {})
        afields = {}
        for e in sorted(ver["eventTypes"], key=lambda x: x["id"]):
            sch = e.get("schema") or {}
            names = set()
            for sname in ([sch.get("debugData")] if sch.get("debugData") else []) + list(sch.get("targets") or []):
                for k, v in (schemas.get(sname, {}).get("properties") or {}).items():
                    names.add(k)
                    afields.setdefault(k, v.get("type"))
            events.append(dict(event_id="okta.audit.action." + e["id"], catalog="audit", name=e["id"],
                               category=e["id"].split(".")[0], product=e.get("category"),
                               targets=list(sch.get("targets") or []), change_details=list(sch.get("changeDetails") or []),
                               fields=sorted(names), beta=bool(e.get("beta")),
                               src={"source": src["id"], "at": e["id"]}))
            if "event-hook-eligible" in (e.get("tags") or []):
                events.append(dict(event_id="okta.event." + e["id"], catalog="event_api", name=e["id"], scopes=[],
                                   src={"source": src["id"], "at": "event-hook-eligible"}))
        for k, t in sorted(afields.items()):
            fields.append(dict(op_id="audit:" + k, side="audit", path="$." + k,
                               type={"String": "string", "Boolean": "boolean", "Integer": "integer", "List": "array"}.get(t, "string"),
                               src={"source": src["id"]}))

    # 3. 권한 어휘
    for src in cfg.get("permission_docs", []):
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=no.sha(path), extraction="parser@1")
        text = io.open(path, encoding="utf-8").read()
        for name in sorted(set(re.findall(src["pattern"], text))):
            if name in src.get("exclude", []):
                continue
            key = "%s:%s" % (src["kind"], name)
            vocab.setdefault(key, dict(grant_id="okta.%s.%s" % (src["kind"], name), kind=src["kind"], name=name, op_ids=[],
                                       src={"source": src["id"]}))

    counts = dict(operations=no.write(out, "operations.jsonl", ops.values()), fields=no.write(out, "fields.jsonl", fields),
                  id_defs=no.write(out, "id_defs.jsonl", []), events=no.write(out, "events.jsonl", events),
                  grant_vocab=no.write(out, "grant_vocab.jsonl", vocab.values()), holes=no.write(out, "holes.jsonl", holes))
    with io.open(os.path.join(out, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sources=manifest, counts=counts), f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(counts))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
