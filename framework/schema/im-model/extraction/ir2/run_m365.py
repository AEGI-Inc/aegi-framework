# -*- coding: utf-8 -*-
"""M365 IR2 실행: 출처 등록부 -> norm_m365.py -> validate.py m365.

    python run_m365.py              # 한 번
    python run_m365.py --twice      # 두 번 돌려 out2/m365 와 registry.json 의 sha256 비교 -> out2/m365/determinism.json
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
    ["norm_m365.py"],
    ["validate.py", "m365"],
]


def run_once():
    for st in STEPS:
        r = subprocess.run(
            [sys.executable] + st,
            cwd=HERE,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=dict(os.environ, PYTHONIOENCODING="utf-8"),
        )
        sys.stdout.write(r.stdout)
        if r.returncode:
            sys.stdout.write(r.stderr)
            raise SystemExit("실패: %s" % " ".join(st))


def digest():
    out = {}
    base = os.path.join(HERE, "out2", "m365")
    for root, _, files in os.walk(base):
        for fn in sorted(files):
            if fn in ("desktop.ini", "determinism.json"):
                continue
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, base).replace("\\", "/")
            out["out2/m365/" + rel] = hashlib.sha256(open(p, "rb").read()).hexdigest()
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
        out_path = os.path.join(HERE, "out2", "m365", "determinism.json")
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with io.open(out_path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(res, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        print("결정론: 파일 %d, 다른 파일 %d %s" % (len(b), len(diff), diff[:5]))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
