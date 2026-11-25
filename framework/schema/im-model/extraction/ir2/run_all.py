# -*- coding: utf-8 -*-
"""IR2 전체 실행: 출처 등록부 -> 8개 provider 정규화 -> 검증 -> 옛 IR 대조. 받기(collect/fetch.py)는 따로 돌린다.

    python run_all.py              # 한 번
    python run_all.py --twice      # 두 번 돌려 out2 의 모든 파일 sha256 이 같은지 본다 (결정론 확인)
"""
import hashlib
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS = [
    ["collect/build_registry.py"],
    ["norm_github.py"], ["norm_okta.py"], ["norm_slack.py"], ["norm_salesforce.py"], ["norm_gws.py"],
    ["norm_atlassian.py", "jira", "confluence", "atlassian"],
    ["validate.py", "all"],
    ["compare_v2.py"],
]


def run_once():
    for st in STEPS:
        r = subprocess.run([sys.executable] + st, cwd=HERE, capture_output=True, text=True, encoding="utf-8",
                           env=dict(os.environ, PYTHONIOENCODING="utf-8"))
        sys.stdout.write(r.stdout)
        if r.returncode:
            sys.stdout.write(r.stderr)
            raise SystemExit("실패: %s" % " ".join(st))


def digest():
    out = {}
    base = os.path.join(HERE, "out2")
    for root, _, files in os.walk(base):
        for fn in sorted(files):
            if fn == "desktop.ini":
                continue
            p = os.path.join(root, fn)
            out[os.path.relpath(p, base).replace("\\", "/")] = hashlib.sha256(open(p, "rb").read()).hexdigest()
    reg = os.path.join(HERE, "collect", "registry.json")
    out["collect/registry.json"] = hashlib.sha256(open(reg, "rb").read()).hexdigest()
    return out


def main():
    run_once()
    if "--twice" in sys.argv:
        a = digest()
        run_once()
        b = digest()
        diff = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
        res = {"files": len(b), "different": diff}
        with io.open(os.path.join(HERE, "out2", "determinism.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(res, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        print("결정론: 파일 %d, 다른 파일 %d %s" % (len(b), len(diff), diff[:5]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
