# -*- coding: utf-8 -*-
"""map3 결과 -> 정보 지도 화면 (2026-10-16).

    python map3_view.py            # out2/<p>/map/info_map.html 과 첫 쪽 out2/index.html
"""
import html
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROVIDERS = [("slack", "Slack"), ("github", "GitHub"), ("okta", "Okta"), ("gws", "Google Workspace"), ("salesforce", "Salesforce"),
             ("jira", "Jira"), ("confluence", "Confluence"), ("atlassian", "Atlassian 조직 층")]
DETK = {"space": "공간", "local": "부모 안", "relation": "relation", "catalog": "이벤트", "envelope": "봉투", "orphan": "고아"}


def page(p, title):
    d = os.path.join(HERE, "out2", p, "map")
    m = json.load(io.open(os.path.join(d, "info_map.json"), encoding="utf-8"))
    metrics = json.load(io.open(os.path.join(d, "metrics.json"), encoding="utf-8"))
    jev = []
    jp = os.path.join(d, "jev_duplicates2.json")
    if os.path.exists(jp):
        jev = [{"pair": x["pair"], "combined": x["combined"]} for x in json.load(io.open(jp, encoding="utf-8"))]
    data = {"metrics": metrics, "spaces": m["spaces"], "refs": m["refs"], "duplicate_candidates": m.get("duplicate_candidates", []),
            "id_roles": m["id_roles"], "jev": jev,
            "items": [{k: it[k] for k in ("det", "rel", "kind", "target", "n_read_by")} | {"slots": it["slots"][:2]} for it in m["items"]]}
    tpl = io.open(os.path.join(HERE, "map3_view.html"), encoding="utf-8").read()
    out = tpl.replace("/*TITLE*/", title).replace("/*DATA*/null", json.dumps(data, ensure_ascii=False, sort_keys=True).replace("</", "<\\/"))
    with io.open(os.path.join(d, "info_map.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(out)
    return metrics


def main():
    cards = []
    for p, title in PROVIDERS:
        if not os.path.exists(os.path.join(HERE, "out2", p, "map", "info_map.json")):
            continue
        m = page(p, title)
        st = [("ID 공간", m["spaces"]), ("오브젝트 후보", m.get("object_candidates", 0)), ("정보 항목", m["items"])] + [(DETK.get(k, k), v) for k, v in sorted(m["items_by_determinant"].items())] + \
             [("참조 간선", m["refs"]), ("중복 후보", m.get("duplicate_candidates", 0))]
        cards.append('<section class="card"><h2><a href="%s/map/info_map.html">%s</a></h2><div class="stats">%s</div></section>'
                     % (p, html.escape(title), "".join("<div><span>%s</span><b>%s</b></div>" % (html.escape(k), f"{v:,}") for k, v in st)))
    idx = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SaaS 정보 지도</title><style>
:root { --bg: #fff; --text: #111; --line: #d0d0d0; --accent: #0b5cad; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 "Pretendard", "Malgun Gothic", system-ui, sans-serif; }
header { padding: 16px 20px 12px; border-bottom: 1px solid var(--line); } h1 { margin: 0; font-size: 18px; }
main { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; padding: 16px 20px; }
.card { border: 1px solid var(--line); padding: 12px 14px; } .card h2 { margin: 0 0 8px; font-size: 16px; } a { color: var(--accent); }
.stats { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid var(--line); }
.stats div { display: flex; justify-content: space-between; padding: 4px 8px 4px 0; border-bottom: 1px solid var(--line); }
.stats b { font-variant-numeric: tabular-nums; }
</style></head><body><header><h1>SaaS 정보 지도 (사전 없는 규칙)</h1></header><main>%s</main></body></html>""" % "".join(cards)
    with io.open(os.path.join(HERE, "out2", "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(idx)
    print(os.path.join(HERE, "out2", "index.html"))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
