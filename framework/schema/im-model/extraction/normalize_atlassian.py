# -*- coding: utf-8 -*-
"""② Atlassian 자료 -> 공통 형식. 설정은 lexicons/<provider>.yaml 의 sources. provider 는 jira, confluence, atlassian(조직).

    python normalize_atlassian.py jira

1. OpenAPI 경로와 웹훅 이름 (normalize_openapi.py 와 같은 변환)
2. 조직 감사 활동 목록(Audit log activities database) 중 이 provider 범주의 활동 -> 감사 action (catalog=audit)
   활동은 표시 이름(「Added Jira global permission」)뿐이다. action 이름은 소문자 밑줄로 바꾼다. 범주(h2)를 category 로 둔다
3. Jira 감사 범주 표(Category, Events): 이벤트 칸을 쉼표로 나눈 표시 이름 -> 감사 action
4. OAuth scope 문서 표의 첫 칸 -> 권한 어휘 (kind=oauth_scope). 명세에 이미 있는 scope 는 출처만 더한다
5. 권한 문서 -> 권한 어휘
   - Jira 기본 권한 키(Built-in permissions, 대문자 키) kind=project_permission
   - 제목 목록(Jira 전역 권한 h3) kind=global_permission
   - 표 칸(Confluence 공간 권한 새 이름, 역할 이름, 전역 권한 머리 행)
6. Jira 웹훅 문서의 payload 예시 -> 이슈 이벤트 payload 자리

형식 변환만 한다. 표의 설명 칸과 본문 문장은 읽지 않는다.
"""
import io
import json
import os
import re
import sys

import yaml

import atlassian_docs as ad
import normalize_openapi as no

HERE, NEMO = no.HERE, no.NEMO


def snake(display):
    """표시 이름 -> action 이름. 「Added Jira global permission」 -> added_jira_global_permission"""
    t = re.sub(r"[’'`]", "", display.lower())
    t = re.sub(r"\(.*?\)", " ", t)
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


def load(out, name):
    p = os.path.join(out, name)
    return [json.loads(l) for l in io.open(p, encoding="utf-8")] if os.path.exists(p) else []


def page(rel):
    return io.open(os.path.join(NEMO, rel), encoding="utf-8").read()


def main(provider):
    plex = yaml.safe_load(io.open(os.path.join(HERE, "lexicons", provider + ".yaml"), encoding="utf-8"))
    cfg = plex["sources"]
    out = os.path.join(HERE, "out", provider, "ir")
    if cfg.get("openapi"):
        no.main(provider)                                 # 1. 경로, 웹훅 이름
    ops = {o["op_id"]: o for o in load(out, "operations.jsonl")}
    fields = load(out, "fields.jsonl")
    holes = load(out, "holes.jsonl")
    events = load(out, "events.jsonl")
    vocab = {v["name"]: v for v in load(out, "grant_vocab.jsonl")}
    mpath = os.path.join(out, "manifest.json")
    manifest = json.load(io.open(mpath, encoding="utf-8"))["sources"] if os.path.exists(mpath) else {}

    def note(src):
        manifest[src["id"]] = dict(path=src["path"], sha256=no.sha(os.path.join(NEMO, src["path"])), extraction=ad.PARSER)

    seen_actions = {e["name"] for e in events if e["catalog"] == "audit"}

    def add_action(display, category, src_id, at):
        name = snake(display)
        if not name or name in seen_actions:
            return
        seen_actions.add(name)
        events.append(dict(event_id="%s.audit.action.%s" % (provider, name), catalog="audit", name=name,
                           display=display, category=snake(category), fields=[], src={"source": src_id, "at": at}))

    # 2. 조직 감사 활동 목록
    for src in cfg.get("audit_db", []):
        note(src)
        cats, prefixes = set(src.get("categories", [])), tuple(src.get("name_prefixes", []))
        rows = list(dict.fromkeys((c, a) for c, a, _ in ad.first_column(page(src["path"]), "Activity")))
        for cat, act in rows:
            if cat in cats or (prefixes and act.startswith(prefixes)):
                add_action(act, cat, src["id"], cat)

    # 3. Jira 감사 범주 표
    for src in cfg.get("audit_table", []):
        note(src)
        seen = set()
        for sec in ad.sections(page(src["path"])):
            for t in sec["tables"]:
                head = next((r["cells"] for r in t if r["th"]), [])
                if head[:2] != ["Category", "Events"]:
                    continue
                for r in t:
                    if r["th"] or len(r["cells"]) < 2 or (r["cells"][0], r["cells"][1]) in seen:
                        continue
                    seen.add((r["cells"][0], r["cells"][1]))
                    for ev in r["cells"][1].split(","):
                        ev = ev.strip()
                        if ev:
                            add_action(ev, r["cells"][0], src["id"], r["cells"][0])

    # 4. OAuth scope 문서
    for src in cfg.get("scope_docs", []):
        note(src)
        for sec_title, name, head in dict.fromkeys(
                (s, n, tuple(h)) for s, n, h in ad.first_column(page(src["path"]), "Scope name")):
            if not re.match(r"^[a-z]+:[a-z0-9:._-]+$", name):
                continue
            v = vocab.setdefault(name, dict(grant_id="%s.scope.%s" % (provider, name), kind="oauth_scope", name=name,
                                            op_ids=[], src={"source": src["id"], "at": "scope table"}))
            v.setdefault("doc_sources", [])
            if src["id"] not in v["doc_sources"]:
                v["doc_sources"].append(src["id"])
            v["scope_family"] = "granular" if head[1:2] == ("Title",) else "classic"

    # 5. 권한 문서
    for src in cfg.get("permission_docs", []):
        note(src)
        how, kind = src["how"], src["kind"]
        names = []
        if how == "upper_keys":                          # 대문자 키 목록 (Jira Built-in permissions)
            s = ad.unescape(page(src["path"]))
            i = s.find('id="%s"' % src["anchor"])
            j = s.find("<h4", i + 10)
            seg = ad.text(s[i:j])
            seg = seg[: seg.find(src.get("stop", "\0"))] if src.get("stop") in seg else seg
            group = None
            for tok in re.findall(r"[A-Z][A-Z_]{3,}|[A-Z][a-z]+(?: [a-z]+)* permissions", seg):
                if tok.endswith(" permissions"):
                    group = tok
                else:
                    names.append((tok, group))
        elif how == "headings":                          # 한 절 아래 제목 목록 (Jira 전역 권한 h3)
            secs = ad.sections(page(src["path"]))
            on = False
            for sec in secs:
                if sec["level"] in ("h1", "h2"):
                    on = sec["title"] == src["section"]
                elif on and sec["level"] == src.get("level", "h3"):
                    names.append((sec["title"], src["section"]))
        elif how == "table_column":                      # 표 머리 첫 칸이 header 인 표의 col 번째 칸
            for sec in ad.sections(page(src["path"])):
                for t in sec["tables"]:
                    head = next((r["cells"] for r in t if r["th"]), [])
                    if head[:1] != [src["header"]]:
                        continue
                    for r in t:
                        if not r["th"] and len(r["cells"]) > src["col"]:
                            names.append((r["cells"][src["col"]], sec["title"]))
        elif how == "row_prefix":                        # 첫 칸이 prefix 로 시작하는 행의 col 번째 칸 (머리 행이 없는 표)
            for sec in ad.sections(page(src["path"])):
                for t in sec["tables"]:
                    for r in t:
                        if len(r["cells"]) > src["col"] and r["cells"][0].startswith(src["prefix"]):
                            names.append((r["cells"][src["col"]], r["cells"][0]))
        elif how == "table_header":                      # 머리 행 칸 전부가 이름 (Confluence 전역 권한)
            for sec in ad.sections(page(src["path"])):
                if sec["title"] != src["section"]:
                    continue
                for t in sec["tables"]:
                    head = next((r["cells"] for r in t if r["th"]), [])
                    names += [(h, sec["title"]) for h in head]
        elif how == "first_word":                        # 칸 첫 단어가 이름 (Confluence 역할 칸: 「Admin Manages ...」)
            for sec in ad.sections(page(src["path"])):
                if sec["title"] != src["section"]:
                    continue
                for t in sec["tables"]:
                    for r in t:
                        names += [(c.split(" ", 1)[0], sec["title"]) for c in r["cells"] if c]
        names = [(n, g) for n, g in names if n not in src.get("exclude", [])]
        for name, group in dict.fromkeys(names):
            key = "%s:%s" % (kind, name)
            vocab.setdefault(key, dict(grant_id="%s.%s.%s" % (provider, kind, snake(name) or name), kind=kind, name=name,
                                       group=group, op_ids=[], src={"source": src["id"], "at": group}))

    # 6. 웹훅 payload 예시 (Jira 이슈 이벤트)
    for src in cfg.get("webhook_payload", []):
        note(src)
        s = ad.unescape(page(src["path"]))
        ex = None
        for m in re.finditer(r"<pre[^>]*>(.*?)</pre>", s, re.S):
            t = ad.html.unescape(re.sub(r"<[^>]+>", "", m.group(1)))
            if t.strip().startswith("{") and '"issue"' in t:
                import slack_docs
                ex = slack_docs.loose_json(t)               # 문서 예시라 끝 쉼표가 있다
                if isinstance(ex, dict):
                    break
        if ex:
            import normalize_slack as ns
            for ev in src["events"]:
                ns.example_merge([ex], "$", "payload", "event:" + ev, {"source": src["id"]}, fields)

    for v in vocab.values():
        v["op_ids"] = sorted(set(v["op_ids"]))
    counts = dict(operations=no.write(out, "operations.jsonl", ops.values()), fields=no.write(out, "fields.jsonl", fields),
                  id_defs=no.write(out, "id_defs.jsonl", []), events=no.write(out, "events.jsonl", events),
                  grant_vocab=no.write(out, "grant_vocab.jsonl", vocab.values()), holes=no.write(out, "holes.jsonl", holes))
    with io.open(mpath, "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(sources=manifest, counts=counts), f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps(counts))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1])
