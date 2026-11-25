# -*- coding: utf-8 -*-
"""IR2 공통: 경로, 출처 등록부, 개체 모음(IR), 경로 위치, 결정론 쓰기.

변환기는 provider 마다 다르지만 모두 이 모듈의 IR 에 개체를 넣고 IR.write() 로 쓴다.
출력은 id 순으로 정렬하고 키를 정렬해 쓴다. 같은 입력이면 바이트 단위로 같다.
"""
import hashlib
import io
import json
import os
import re

import yaml

import ir_schema as S

HERE = os.path.dirname(os.path.abspath(__file__))               # candidate-extraction/ir2
CE = os.path.dirname(HERE)                                      # candidate-extraction
NEMO = os.path.normpath(os.path.join(CE, "..", ".."))           # finding-nemo
OUT2 = os.path.join(HERE, "out2")
REGISTRY = os.path.join(HERE, "collect", "registry.json")
LEX = os.path.join(CE, "lexicons")

_registry = None


def registry():
    global _registry
    if _registry is None:
        _registry = {e["id"]: e for e in json.load(io.open(REGISTRY, encoding="utf-8"))["sources"]}
    return _registry


def lexicon(provider):
    return yaml.safe_load(io.open(os.path.join(LEX, provider + ".yaml"), encoding="utf-8"))


def nemo(rel):
    return os.path.join(NEMO, rel)


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def load_spec(path):
    text = io.open(path, encoding="utf-8").read()
    if text.lstrip().startswith("{"):
        return json.loads(text)
    return yaml.load(text, Loader=getattr(yaml, "CSafeLoader", yaml.SafeLoader))


def dumps(row):
    return json.dumps(row, sort_keys=True, ensure_ascii=False)


def path_positions(template):
    """경로 틀 -> 위치 목록 [{param, index, after_word}]. index 는 조각 번호(0부터), after_word 는 바로 앞 낱말 조각"""
    segs = [s for s in template.strip("/").split("/") if s != ""]
    out, prev = [], None
    for i, s in enumerate(segs):
        for m in re.finditer(r"\{([^}]+)\}", s):
            out.append({"param": m.group(1), "index": i,
                        "after_word": prev if prev is not None and "{" not in prev else None})
        prev = s
    return out


def rest_kind(method, template, resp_kind=None, status=None, wrapper_array=False):
    """REST 동작 종류 (transform). 메서드와 경로 끝, 응답 모양 종류로 정한다. 근거 규칙은 KIND_RULE"""
    segs = [s for s in template.strip("/").split("/") if s]
    last = segs[-1] if segs else ""
    last_is_param = last.startswith("{") and last.endswith("}")
    m = method.upper()
    if m == "GET":
        if last_is_param:                     # 경로 끝 위치가 하나를 고른다 (응답 모양보다 먼저)
            return "read_one"
        if resp_kind == "array" or wrapper_array:
            return "read_many"
        return "read_one" if resp_kind in ("object", "union", "map") else "read_many"
    if m == "POST":
        return "create" if str(status) == "201" else "action"
    if m in ("PUT", "PATCH"):
        return "update"
    if m == "DELETE":
        return "delete"
    return "action"


KIND_RULE = ("REST 동작 종류 규칙(ir2/core.rest_kind): GET 은 경로 끝이 파라미터면 read_one, 아니면 응답이 배열이거나 "
             "목록 래퍼(객체 원소 배열 속성이 하나뿐인 객체)면 read_many, 그 밖은 read_one. POST 는 201 응답이면 create, 아니면 action. "
             "PUT, PATCH 는 update, DELETE 는 delete. 이름 표와 경로 낱말은 쓰지 않는다")


class IR:
    """provider 하나의 개체 모음"""

    def __init__(self, provider):
        self.provider = provider
        self.rows = {k: {} for k in S.KINDS}
        self.collisions = []
        self.issues = []                    # 정규화 중 발견한 문제 (validate.py 가 issues.jsonl 로 합친다)
        self.dropped = []                   # removed 로 뺀 것 (수명 1절)

    # ---- 머리
    def src(self, sid, locator, rank=None, snapshot=None):
        e = registry()[sid]
        self.add_source(sid)
        return {"source": sid, "locator": locator, "rank": rank or e["rank"], "snapshot": snapshot or e["snapshot"]}

    @staticmethod
    def life(state="active", sunset=None):
        d = {"state": state}
        if sunset:
            d["sunset"] = sunset
        return d

    def add_source(self, sid):
        if sid in self.rows["source"]:
            return
        e = registry()[sid]
        row = {"id": sid, "kind": e["kind"], "rank": e["rank"], "url": e.get("url"), "file": e["file"],
               "fetched_at": e.get("fetched_at"), "sha256": e["sha256"], "version": e.get("version"),
               "naming": e["naming"], "fetch_method": e["fetch_method"],
               "src": {"source": sid, "locator": e["file"], "rank": e["rank"], "snapshot": e["snapshot"]},
               "grade": "stated", "life": {"state": "active"}, "ext": {k: e[k] for k in ("note", "provider", "files")
                                                                        if e.get(k)}}
        self.rows["source"][sid] = row

    def add(self, kind, row, merge=False):
        """개체 하나를 넣는다. 같은 id 가 이미 있으면 같은 내용일 때만 조용히 넘어가고, 다르면 충돌로 남긴다.
        merge=True 면 목록 필드(operations)를 합친다"""
        row.setdefault("ext", {})
        row.setdefault("life", {"state": "active"})
        old = self.rows[kind].get(row["id"])
        if old is None:
            self.rows[kind][row["id"]] = row
            return row
        if merge:
            for k, v in row.items():
                if isinstance(v, list) and isinstance(old.get(k), list):
                    old[k] = sorted(set(old[k]) | set(v), key=str)
            return old
        if dumps(old) != dumps(row):
            self.collisions.append({"kind": kind, "id": row["id"]})
        return old

    def has(self, kind, rid):
        return rid in self.rows[kind]

    def get(self, kind, rid):
        return self.rows[kind].get(rid)

    def issue(self, kind, subject, needs_stage, fact, detail, evidence=None, stage="normalize"):
        self.issues.append({"stage": stage, "kind": kind, "subject": subject,
                            "needs": {"stage": needs_stage, "fact": fact, "detail": detail},
                            "evidence": evidence or {}})

    # ---- 쓰기
    def write(self):
        out = os.path.join(OUT2, self.provider, "ir")
        os.makedirs(out, exist_ok=True)
        counts = {}
        for k in S.KINDS:
            rows = sorted(self.rows[k].values(), key=lambda r: r["id"])
            with io.open(os.path.join(out, k + ".jsonl"), "w", encoding="utf-8", newline="\n") as f:
                for r in rows:
                    f.write(dumps(r) + "\n")
            counts[k] = len(rows)
        side = {"counts": counts, "collisions": sorted(self.collisions, key=dumps),
                "dropped_removed": sorted(self.dropped, key=dumps)}
        with io.open(os.path.join(out, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
            json.dump(side, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        with io.open(os.path.join(OUT2, self.provider, "normalize_issues.jsonl"), "w", encoding="utf-8",
                     newline="\n") as f:
            for r in sorted(self.issues, key=dumps):
                f.write(dumps(r) + "\n")
        return counts


def load_ir(provider):
    base = os.path.join(OUT2, provider, "ir")
    out = {}
    for k in S.KINDS:
        p = os.path.join(base, k + ".jsonl")
        out[k] = [json.loads(l) for l in io.open(p, encoding="utf-8")] if os.path.exists(p) else []
    return out
