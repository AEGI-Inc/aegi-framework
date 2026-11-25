# -*- coding: utf-8 -*-
"""② GitHub 자료 -> 공통 형식. 설정은 lexicons/github.yaml 의 sources.

    python normalize_github.py

1. OpenAPI 경로 (normalize_openapi.py 와 같은 변환)
2. OpenAPI 3.1 webhooks 절 -> 이벤트와 payload 필드 (side=payload, op_id=event:<웹훅 키>)
3. 감사 이벤트 목록 -> 감사 action (catalog=audit, category, fields) 과 감사 필드 자리 (side=audit, op_id=audit:<필드 이름>)
4. GitHub App 권한 문서 표 -> 권한 어휘 (grant: <수준>:<권한 이름>:<read|write|admin>) 과 동작별 scopes
5. GraphQL SDL -> 타입 표 graphql_types.jsonl (타입, 구현 인터페이스, 필드와 가리키는 타입, union 과 인터페이스의 구현 타입)

형식 변환만 한다. description 은 규칙에 쓰지 않는다.
"""
import collections
import io
import json
import os
import re
import sys

import yaml

import graphql_sdl
import normalize_openapi as no

HERE, NEMO = no.HERE, no.NEMO


def load(out, name):
    p = os.path.join(out, name)
    return [json.loads(l) for l in io.open(p, encoding="utf-8")] if os.path.exists(p) else []


def main():
    provider = "github"
    plex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", provider + ".yaml"), encoding="utf-8"))
    cfg = plex["sources"]
    out = os.path.join(HERE, "out", provider, "ir")
    no.main(provider)                                 # 1. 경로
    ops = {o["op_id"]: o for o in load(out, "operations.jsonl")}
    fields = load(out, "fields.jsonl")
    holes = load(out, "holes.jsonl")
    events, vocab = [], {}
    manifest = json.load(io.open(os.path.join(out, "manifest.json"), encoding="utf-8"))["sources"]

    # 2. 웹훅
    for src in cfg["openapi"]:
        sp = no.Spec(os.path.join(NEMO, src["path"]), src["id"])
        for key, item in sorted(sp.s.get("webhooks", {}).items()):
            o = item.get("post", {})
            sch = (((o.get("requestBody") or {}).get("content") or {}).get("application/json") or {}).get("schema")
            op_id = "event:" + key
            events.append(dict(event_id="github.event." + key, catalog="event_api", name=key,
                               category=(o.get("x-github") or {}).get("subcategory"), src={"source": src["id"], "at": "webhooks." + key}))
            if sch:
                sp.tree(sch, "$", "payload", op_id, fields)

    # 3. 감사 이벤트. 같은 action 이 엔터프라이즈, 조직, 사용자 범위에 겹쳐 나온다. action 단위로 합친다
    for src in cfg["audit"]:
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=no.sha(path), extraction="prior_machine_2026-09-03")
        acts = collections.OrderedDict()
        for l in io.open(path, encoding="utf-8"):
            a = json.loads(l)
            x = acts.setdefault(a["action"], dict(category=a["category"], fields=set(), scopes=set()))
            x["fields"].update(a.get("fields") or [])
            x["scopes"].add(a.get("scope"))
        nf = collections.Counter(f for x in acts.values() for f in x["fields"])
        for name, x in sorted(acts.items()):
            events.append(dict(event_id="github.audit.action." + name, catalog="audit", name=name, category=x["category"],
                               fields=sorted(x["fields"]), audit_scopes=sorted(s for s in x["scopes"] if s),
                               src={"source": src["id"]}))
        # 감사 필드 자리: 필드 이름 하나가 자리 하나다 (action 마다 같은 이름이면 같은 필드)
        for fname, n in sorted(nf.items()):
            fields.append(dict(op_id="audit:" + fname, side="audit", path="$." + fname, type="unknown",
                               audit_actions=n, src={"source": src["id"]}))

    # 4. GitHub App 권한
    for src in cfg["permissions"]:
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=no.sha(path), extraction="parser@1")
        by_key = {(o["http_method"], o["path"]): o for o in ops.values()}
        cur = None
        for line in io.open(path, encoding="utf-8"):
            m = re.match(r'^## (Enterprise|Organization|Repository|Account) permissions for "(.+)"', line)
            if m:
                cur = (m.group(1).lower(), m.group(2))
                continue
            m = re.match(r"^\| `(GET|POST|PUT|PATCH|DELETE) ([^`]+)` \| (\w+) \|", line)
            if m and cur:
                g = "%s:%s:%s" % (cur[0], cur[1], m.group(3))
                v = vocab.setdefault(g, dict(grant_id="github.perm." + g, kind="app_permission", name=g, op_ids=[],
                                             src={"source": src["id"], "at": cur[1]}))
                o = by_key.get((m.group(1), m.group(2)))
                if o:
                    v["op_ids"].append(o["op_id"])
                    o["scopes"] = sorted(set(o["scopes"]) | {g})
    for v in vocab.values():
        v["op_ids"] = sorted(set(v["op_ids"]))

    # 5. GraphQL SDL
    gql = []
    for src in cfg.get("graphql", []):
        path = os.path.join(NEMO, src["path"])
        manifest[src["id"]] = dict(path=src["path"], sha256=no.sha(path), extraction="graphql_sdl@1")
        for r in graphql_sdl.parse(io.open(path, encoding="utf-8").read()):
            r["src"] = {"source": src["id"]}
            gql.append(r)

    counts = dict(graphql_types=no.write(out, "graphql_types.jsonl", gql),
                  operations=no.write(out, "operations.jsonl", ops.values()), fields=no.write(out, "fields.jsonl", fields),
                  id_defs=no.write(out, "id_defs.jsonl", []), events=no.write(out, "events.jsonl", events),
                  grant_vocab=no.write(out, "grant_vocab.jsonl", vocab.values()), holes=no.write(out, "holes.jsonl", holes))
    with io.open(os.path.join(out, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sources=manifest, counts=counts), f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(counts))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
