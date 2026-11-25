# -*- coding: utf-8 -*-
"""세 모델 오브젝트 대조 2/2: 페이지 (python map3way_page.py -> out2/profile_triage/map3way.html)"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "out2", "profile_triage")
d = json.load(io.open(os.path.join(OUT, "data.json"), encoding="utf-8"))
s = json.dumps(d, ensure_ascii=False, separators=(",", ":")).replace("·", ", ").replace("</", "<" + chr(92) + "/")
t = io.open(os.path.join(HERE, "map3way_template.html"), encoding="utf-8").read().replace("__DATA__", s)
io.open(os.path.join(OUT, "map3way.html"), "w", encoding="utf-8").write(t)
print(len(t))
