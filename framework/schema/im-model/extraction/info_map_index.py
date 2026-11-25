# -*- coding: utf-8 -*-
"""정보 지도 첫 쪽: 대상 SaaS 7개(와 Atlassian 조직 층)의 정보 지도를 한 쪽에 모은다 (2026-10-14).

    python info_map_index.py        # out/<provider>/info_map.json 을 읽어 out/index.html 을 쓴다

각 provider 의 info_map.py 를 먼저 돌려야 한다.
"""
import html
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROVIDERS = [("slack", "Slack"), ("github", "GitHub"), ("okta", "Okta"), ("gws", "Google Workspace"),
             ("salesforce", "Salesforce"), ("jira", "Jira"), ("confluence", "Confluence"), ("atlassian", "Atlassian 조직 층")]


def esc(x):
    return html.escape(str(x))


def card(p, name):
    path = os.path.join(HERE, "out", p, "info_map.json")
    if not os.path.exists(path):
        return ""
    m = json.load(io.open(path, encoding="utf-8"))
    t = m["totals"]
    man = json.load(io.open(os.path.join(HERE, "out", p, "ir", "manifest.json"), encoding="utf-8"))
    ev = [json.loads(l) for l in io.open(os.path.join(HERE, "out", p, "ir", "events.jsonl"), encoding="utf-8")]
    gv = sum(1 for _ in io.open(os.path.join(HERE, "out", p, "ir", "grant_vocab.jsonl"), encoding="utf-8"))
    rb = os.path.join(HERE, "out", p, "space_rebuild.json")
    path_only = len(json.load(io.open(rb, encoding="utf-8"))["path_only"]) if os.path.exists(rb) else None
    spaces = sorted(((d[6:], v["items"]) for d, v in m["determinants"].items() if d.startswith("space:")), key=lambda x: (-x[1], x[0]))
    nsp = len(spaces)
    audit_all = t["audit_actions_matched"] + t["audit_actions_unmatched"]
    n_audit = sum(1 for e in ev if e["catalog"] == "audit")
    n_event = sum(1 for e in ev if e["catalog"] == "event_api")
    op_items = sum(v["items"] for d, v in m["determinants"].items() if d.startswith("op:"))
    top = spaces[:10]
    mx = max([n for _, n in top] or [1])
    bars = "".join('<div class="bar"><span class="k">%s</span><span class="t"><i style="width:%.1f%%"></i></span><span class="n">%s</span></div>'
                   % (esc(s), 100.0 * n / mx, f"{n:,}") for s, n in top)
    stats = [("API 동작", man["counts"].get("operations", 0)), ("감사 action", n_audit), ("이벤트", n_event), ("권한 어휘", gv),
             ("정보 항목", t["items"]), ("ID 공간", nsp), ("공간 못 정한 항목", op_items),
             ("감사 공간 연결", "%s / %s" % (f"{t['audit_actions_matched']:,}", f"{audit_all:,}")),
             ("쓰기 짝", t["write_edges"] + t.get("body_write_edges", 0)), ("경로 단독 공간", "-" if path_only is None else path_only)]
    st = "".join('<div><span>%s</span><b>%s</b></div>' % (esc(k), f"{v:,}" if isinstance(v, int) else esc(v)) for k, v in stats)
    v2 = os.path.exists(os.path.join(HERE, "out", p, "info_map_v2.html"))
    extra = (' <a href="%s/info_map_v2.html" style="margin-left:12px">근거 기반 v2 열기</a>' % p) if v2 else ""
    return ('<section class="card"><h2><a href="%s/info_map.html">%s</a></h2><div class="stats">%s</div>'
            '<h3>정보 항목이 많은 ID 공간</h3>%s<p class="go"><a href="%s/info_map.html">정보 지도 열기</a>%s</p></section>'
            % (p, esc(name), st, bars, p, extra))


def main():
    cards = "".join(card(p, n) for p, n in PROVIDERS)
    page = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SaaS 정보 지도</title>
<style>
:root { --bg: #ffffff; --text: #111111; --line: #d0d0d0; --accent: #0b5cad; --row: #f6f6f6; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 "Pretendard", "Malgun Gothic", system-ui, sans-serif; }
header { padding: 16px 20px 12px; border-bottom: 1px solid var(--line); }
h1 { margin: 0; font-size: 18px; }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; padding: 16px 20px; }
.card { border: 1px solid var(--line); padding: 12px 14px; }
.card h2 { margin: 0 0 8px; font-size: 16px; }
.card h3 { margin: 12px 0 6px; font-size: 13px; }
a { color: var(--accent); }
.stats { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); }
.stats div { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--line); }
.stats div:nth-child(odd) { padding-right: 10px; }
.stats div:nth-child(even) { padding-left: 10px; border-left: 1px solid var(--line); }
.stats b { font-variant-numeric: tabular-nums; }
.bar { display: grid; grid-template-columns: 150px 1fr 56px; align-items: center; gap: 8px; font-size: 13px; padding: 1px 0; }
.bar .k { font-family: Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar .t { height: 10px; background: var(--row); }
.bar .t i { display: block; height: 10px; background: var(--accent); }
.bar .n { text-align: right; font-variant-numeric: tabular-nums; }
.go { margin: 10px 0 0; }
@media (max-width: 420px) { main { padding: 12px 16px; } .bar { grid-template-columns: 110px 1fr 48px; } }
</style>
</head>
<body>
<header><h1>SaaS 정보 지도</h1></header>
<main>%s</main>
</body>
</html>
""" % cards
    p = os.path.join(HERE, "out", "index.html")
    with io.open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(page)
    print(p)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
