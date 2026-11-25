# -*- coding: utf-8 -*-
"""Atlassian -> IR2. provider 셋: jira, confluence, atlassian(조직 층). 범위는 IR 설계.md 1절.

    python norm_atlassian.py              # 셋 다
    python norm_atlassian.py jira

1. OpenAPI: Jira 플랫폼 v3, Jira Service Management, Jira Software (2026-10-15 받음), Confluence v1 과 v2, 조직 관리 API 4종.
   경로 접두사 벗기기(strip_prefixes)는 사전의 변환 설정을 쓴다. 인자 이름은 원문 그대로 둔다(옛 param_rename 은 쓰지 않는다).
   Jira x-changes 의 removed 가 받은 날짜보다 앞이면 뺀다, 뒤면 deprecated + sunset
2. 웹훅 문서의 이벤트 이름 -> 이벤트 카탈로그 (Jira 이슈 이벤트 payload 예시는 instance 와 예시 모양)
3. 조직 감사 활동 목록, Jira 감사 범주 표 -> 감사 카탈로그. 기계 키가 없어 key=null, display=표시 이름 (3.8)
4. OAuth scope 문서, 권한 문서 -> 권한 어휘 (Jira 기본 권한 키, 전역 권한, Confluence 공간 권한과 역할)
5. Confluence v1 과 v2 중복 표시: 같은 HTTP 메서드와 같은 granular scope 집합(x:y:confluence)을 가진 동작이 두 판에 다 있으면
   ext.dup_v1_v2 에 상대 동작을 적는다. scope 이름은 한 명명 체계 안의 정확한 식별자다
"""
import collections
import io
import json
import re
import sys

import core
import example_shape
import openapi2

sys.path.insert(0, core.CE)
import atlassian_docs as ad      # noqa: E402
import slack_docs                # noqa: E402

KIND_MAP = {"project_permission": "privilege", "global_permission": "privilege", "space_permission": "privilege",
            "space_role": "role"}
EXTRA_OPENAPI = {"jira": [{"id": "jsm_openapi"}, {"id": "jira_software_openapi"}]}


def jira_life(snapshot):
    def f(o, state):
        for c in o.get("x-changes") or []:
            if c.get("type") == "removed" and c.get("effective"):
                if c["effective"] <= snapshot:
                    return "removed", c["effective"]
                return "deprecated", c["effective"]
        return state, None
    return f


def reg_id(src):
    """사전 sources 항목 -> 출처 등록부 id (같은 파일). 사전 id 와 등록부 id 가 다를 수 있다"""
    r = core.registry()
    if src["id"] in r and r[src["id"]]["file"] == src.get("path", r[src["id"]]["file"]):
        return src["id"]
    return next(k for k, e in sorted(r.items()) if e["file"] == src["path"] and e.get("used"))


def page(sid):
    return io.open(core.nemo(core.registry()[sid]["file"]), encoding="utf-8").read()


def snake(display):
    t = re.sub(r"[’'`]", "", display.lower())
    t = re.sub(r"\(.*?\)", " ", t)
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


def run(provider):
    ir = core.IR(provider)
    lex = core.lexicon(provider)
    cfg = lex["sources"]
    convs = {}
    for src in list(cfg.get("openapi", [])) + EXTRA_OPENAPI.get(provider, []):
        sid = src["id"]
        snap = core.registry()[sid]["snapshot"]
        c = openapi2.OpenAPIConv(ir, sid, strip_prefixes=src.get("strip_prefixes", []), lifecycle=jira_life(snap))
        c.run()
        convs[sid] = c
        if src.get("param_rename"):
            ir.issue("param_name_collision", {"source": sid}, "normalize", "binding",
                     "같은 인자 이름이 경로마다 다른 대상을 가리킨다 (옛 IR 은 이름을 바꿨다). 새 IR 은 이름을 그대로 두고 규칙 단계에 맡긴다",
                     {"renames": src["param_rename"]})
    # 2. 웹훅 이벤트 이름
    for ev in cfg.get("events", []):
        ev = dict(ev, id=reg_id(ev))
        t = page(ev["id"])
        names = {re.sub(r"&amp;", "&", c) for c in re.findall(r"<code[^>]*>([^<]{3,60})</code>", t)}
        names = {n for n in names if re.match(r"^[a-z_:]+$", n) and "_" in n}
        for n in sorted(names):
            if any(n.startswith(x) for x in ev.get("exclude_prefixes", [])) or n in ev.get("exclude", []):
                continue
            ir.add("catalog", dict(id="cat:event:%s" % n, catalog="event", key=n, display=None, category=None, payload=None,
                                   targets=[], src=ir.src(ev["id"], "<code> %s" % n), grade="stated", life=ir.life()))
    for src in cfg.get("webhook_payload", []):
        src = dict(src, id=reg_id(src))
        s = ad.unescape(page(src["id"]))
        ex = None
        for m in re.finditer(r"<pre[^>]*>(.*?)</pre>", s, re.S):
            t = ad.html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))
            if t.strip().startswith("{") and '"issue"' in t:
                ex = slack_docs.loose_json(t)
                if isinstance(ex, dict):
                    break
        if isinstance(ex, dict):
            pid = example_shape.build(ir, [ex], "sh:%s:issue_event_payload" % src["id"], ir.src(src["id"], "payload example"))
            for ev in src["events"]:
                cid = "cat:event:%s" % ev
                if ir.has("catalog", cid):
                    ir.get("catalog", cid)["payload"] = pid
                    ir.add("instance", dict(id="in:catalog=%s#0" % cid, of={"catalog": cid}, value=ex,
                                            src=ir.src(src["id"], "payload example"), grade="example", life=ir.life()))
    # 3. 감사
    seen = set()

    def audit(display, category, sid, loc):
        k = (display, category)
        if not display or k in seen:
            return
        seen.add(k)
        row = dict(id="cat:audit:%s:%s:%s" % (sid, category, display), catalog="audit", key=None, display=display,
                   category=category, payload=None, targets=[], src=ir.src(sid, loc), grade="stated", life=ir.life())
        ir.add("catalog", row)
    for src in cfg.get("audit_db", []):
        src = dict(src, id=reg_id(src))
        cats, prefixes = set(src.get("categories", [])), tuple(src.get("name_prefixes", []))
        for cat, act, _ in dict.fromkeys((c, a, tuple(h)) for c, a, h in ad.first_column(page(src["id"]), "Activity")):
            if cat in cats or (prefixes and act.startswith(prefixes)):
                audit(act, cat, src["id"], cat)
    for src in cfg.get("audit_table", []):
        src = dict(src, id=reg_id(src))
        for sec in ad.sections(page(src["id"])):
            for t in sec["tables"]:
                head = next((r["cells"] for r in t if r["th"]), [])
                if head[:2] != ["Category", "Events"]:
                    continue
                for r in t:
                    if r["th"] or len(r["cells"]) < 2:
                        continue
                    for ev in r["cells"][1].split(","):
                        audit(ev.strip(), r["cells"][0], src["id"], r["cells"][0])
    # 4. 권한 어휘
    for src in cfg.get("scope_docs", []):
        src = dict(src, id=reg_id(src))
        for sec_title, name, head in dict.fromkeys((s, n, tuple(h)) for s, n, h in ad.first_column(page(src["id"]), "Scope name")):
            if not re.match(r"^[a-z]+:[a-z0-9:._-]+$", name):
                continue
            gid = "gr:oauth_scope:%s" % name
            if not ir.has("grant", gid):
                ir.add("grant", dict(id=gid, kind="oauth_scope", name=name, operations=[], src=ir.src(src["id"], "scope table"),
                                     grade="stated", life=ir.life()))
            g = ir.get("grant", gid)
            g["ext"]["scope_family"] = "granular" if head[1:2] == ("Title",) else "classic"
            g["ext"]["in_scope_doc"] = True
    for src in cfg.get("permission_docs", []):
        how, kind = src["how"], src["kind"]
        src = dict(src, id=reg_id(src))
        names = []
        s = page(src["id"])
        if how == "upper_keys":
            u = ad.unescape(s)
            i = u.find('id="%s"' % src["anchor"])
            j = u.find("<h4", i + 10)
            seg = ad.text(u[i:j])
            seg = seg[: seg.find(src.get("stop", "\0"))] if src.get("stop") in seg else seg
            group = None
            for tok in re.findall(r"[A-Z][A-Z_]{3,}|[A-Z][a-z]+(?: [a-z]+)* permissions", seg):
                if tok.endswith(" permissions"):
                    group = tok
                else:
                    names.append((tok, group))
        elif how == "headings":
            on = False
            for sec in ad.sections(s):
                if sec["level"] in ("h1", "h2"):
                    on = sec["title"] == src["section"]
                elif on and sec["level"] == src.get("level", "h3"):
                    names.append((sec["title"], src["section"]))
        elif how == "table_column":
            for sec in ad.sections(s):
                for t in sec["tables"]:
                    head = next((r["cells"] for r in t if r["th"]), [])
                    if head[:1] != [src["header"]]:
                        continue
                    for r in t:
                        if not r["th"] and len(r["cells"]) > src["col"]:
                            names.append((r["cells"][src["col"]], sec["title"]))
        elif how == "row_prefix":
            for sec in ad.sections(s):
                for t in sec["tables"]:
                    for r in t:
                        if len(r["cells"]) > src["col"] and r["cells"][0].startswith(src["prefix"]):
                            names.append((r["cells"][src["col"]], r["cells"][0]))
        elif how == "table_header":
            for sec in ad.sections(s):
                if sec["title"] == src["section"]:
                    for t in sec["tables"]:
                        head = next((r["cells"] for r in t if r["th"]), [])
                        names += [(h, sec["title"]) for h in head]
        elif how == "first_word":
            for sec in ad.sections(s):
                if sec["title"] == src["section"]:
                    for t in sec["tables"]:
                        for r in t:
                            names += [(c.split(" ", 1)[0], sec["title"]) for c in r["cells"] if c]
        names = [(n, g) for n, g in names if n and n not in src.get("exclude", [])]
        gk = KIND_MAP.get(kind, "privilege")
        for name, group in dict.fromkeys(names):
            gid = "gr:%s:%s:%s" % (gk, kind, name)
            if ir.has("grant", gid):
                continue
            g = dict(id=gid, kind=gk, name=name, operations=[], src=ir.src(src["id"], "%s %s" % (how, group)), grade="stated", life=ir.life())
            g["ext"] = {"atlassian_kind": kind, "group": group}
            ir.add("grant", g)
    # 5. Confluence v1, v2 중복 표시
    if provider == "confluence":
        groups = collections.defaultdict(lambda: collections.defaultdict(list))
        for o in ir.rows["operation"].values():
            scopes = sorted(g.split(":", 2)[2] for g in o["grants"] if g.count(":") >= 4)
            if scopes:
                groups[(o["method"], tuple(scopes))][o["src"]["source"]].append(o["id"])
        n = 0
        for key, by in groups.items():
            if "confluence_openapi_v1" in by and "confluence_openapi_v2" in by:
                for a, b in (("confluence_openapi_v1", "confluence_openapi_v2"), ("confluence_openapi_v2", "confluence_openapi_v1")):
                    for oid in by[a]:
                        ir.get("operation", oid)["ext"]["dup_v1_v2"] = {
                            "counterparts": sorted(by[b]), "basis": "같은 HTTP 메서드와 같은 granular scope 집합 %s" % list(key[1])}
                        n += 1
        ir.issue("v1_v2_duplicate", {"provider": "confluence"}, "normalize", "operation",
                 "Confluence v1 과 v2 가 같은 대상을 다른 동작으로 다룬다 (표시만 한다. 판단은 규칙 단계)", {"marked_operations": n})
    return ir.write()


def main(args):
    for p in args or ["jira", "confluence", "atlassian"]:
        print(p, json.dumps(run(p), ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1:])
