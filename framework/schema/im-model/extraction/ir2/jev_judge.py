# -*- coding: utf-8 -*-
"""Jev(TypeSafe System One) 로 규칙이 「모름」으로 남긴 대기열을 채점한다 (2026-10-16, 시범).

    python jev_judge.py duplicates github            # 보낼 요청만 만든다 (기본, 아무것도 보내지 않는다)
    python jev_judge.py duplicates github --send     # 실제로 보낸다 (캐시에 없는 것만)
    python jev_judge.py eval github                  # 정답표(eval/<p>_duplicates_gold.json)와 비교

원칙 (Information Map 설계.md 10절):
- 결과는 근거 등급 model 로 따로 둔다. 원문, 구조, 실측 근거를 덮어쓰지 않고, 공간을 자동으로 합치지 않는다
- 같은 입력이면 같은 결과: (모델, state, 질문)의 sha256 을 키로 응답을 캐시에 둔다 (out2/<p>/map/jev_cache.jsonl)
- 공개 명세에서 나온 이름, 속성, 경로, 예시 값만 보낸다. 테넌트 실측 값(grade observed)은 보내지 않는다
- 키는 환경 변수 TYPESAFE_API_KEY 또는 setup-output/secrets/jev.txt("TYPESAFE_API_KEY=...")에서 읽고 출력하지 않는다
"""
import collections
import hashlib
import io
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
URL = "https://api.typesafe.ai/v1/systemone"
MODEL = "jev-latest"


def api_key():
    k = os.environ.get("TYPESAFE_API_KEY")
    if k:
        return k
    p = os.path.join(REPO, "setup-output", "secrets", "jev.txt")
    if os.path.exists(p):
        for line in io.open(p, encoding="utf-8"):
            name, _, val = line.strip().partition("=")
            if name == "TYPESAFE_API_KEY" and val:
                return val
    return None


def load_map(p):
    return json.load(io.open(os.path.join(HERE, "out2", p, "map", "info_map.json"), encoding="utf-8"))


def shapes(p):
    out = {}
    for l in io.open(os.path.join(HERE, "out2", p, "ir", "shape.jsonl"), encoding="utf-8"):
        s = json.loads(l)
        out[s["id"]] = s
    return out


def describe(space, sh, limit_props=40):
    """공간 하나를 글로: 단건 위치, 모양 이름, 속성 이름 (공개 명세에서 온 것만)"""
    names = sorted({(sh.get(x) or {}).get("name") or x.split(":")[-1] for x in space["shapes"]})[:8]
    props = []
    for x in space["shapes"]:
        for pr in (sh.get(x) or {}).get("props") or []:
            if pr["name"] not in props:
                props.append(pr["name"])
    return ("item positions: %s\nschema names: %s\nproperties: %s"
            % (", ".join("/" + P for P in space["item_positions"][:4]) or "(none)", ", ".join(names), ", ".join(props[:limit_props])))


def duplicate_requests(p):
    m, sh = load_map(p), shapes(p)
    reqs = []
    for d in m.get("duplicate_candidates", []):
        a, b = d["spaces"]
        A, B = m["spaces"].get(a), m["spaces"].get(b)
        if not A or not B:
            continue
        state = ("Two groups of API response schemas from the %s REST API.\n\nGroup A (%s)\n%s\n\nGroup B (%s)\n%s"
                 % (p, a, describe(A, sh), b, describe(B, sh)))
        q = {"same_object": {"type": "noul",
                             "instructions": "Do Group A and Group B describe the same kind of real-world object, so that one "
                                             "record of A and one record of B can be the same entity identified by the same id? "
                                             "Answer no if they are different object types that merely share field names."}}
        reqs.append({"pair": [a, b], "body": {"state": state, "model": MODEL, "questions": q}})
    return reqs


def ckey(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def cache_path(p):
    return os.path.join(HERE, "out2", p, "map", "jev_cache.jsonl")


def load_cache(p):
    c = {}
    if os.path.exists(cache_path(p)):
        for l in io.open(cache_path(p), encoding="utf-8"):
            r = json.loads(l)
            c[r["key"]] = r["response"]
    return c


def send(body, key):
    req = urllib.request.Request(URL, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def run_duplicates(p, do_send):
    reqs = duplicate_requests(p)
    cache = load_cache(p)
    key = api_key() if do_send else None
    if do_send and not key:
        sys.exit("TYPESAFE_API_KEY 가 없다 (환경 변수 또는 setup-output/secrets/jev.txt)")
    out, sent = [], 0
    with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        for r in reqs:
            k = ckey(r["body"])
            resp = cache.get(k)
            if resp is None and do_send:
                try:
                    resp = send(r["body"], key)
                except urllib.error.HTTPError as e:
                    print("HTTP %s %s" % (e.code, r["pair"]))
                    continue
                cf.write(json.dumps({"key": k, "pair": r["pair"], "response": resp}, ensure_ascii=False, sort_keys=True) + "\n")
                sent += 1
            ans = ((resp or {}).get("answers") or {}).get("same_object") or {}
            out.append({"pair": r["pair"], "probability": ans.get("noul", ans.get("probability")), "answer": ans,
                        "model": (resp or {}).get("model"), "state_chars": len(r["body"]["state"])})
    path = os.path.join(HERE, "out2", p, "map", "jev_duplicates.json")
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"requests": len(reqs), "sent": sent, "cached": sum(1 for o in out if o["model"]),
                      "max_state_chars": max([o["state_chars"] for o in out] or [0])}, ensure_ascii=False))


def run_eval(p):
    gold = json.load(io.open(os.path.join(HERE, "eval", "%s_duplicates_gold.json" % p), encoding="utf-8"))
    res = {tuple(sorted(o["pair"])): o for o in json.load(io.open(os.path.join(HERE, "out2", p, "map", "jev_duplicates.json"),
                                                                   encoding="utf-8"))}
    rows = []
    for g in gold["pairs"]:
        o = res.get(tuple(sorted(g["pair"])))
        if not o or o.get("probability") is None or g.get("uncertain"):
            continue
        rows.append((g["same"], o["probability"], g["pair"]))
    for th in (0.5, 0.7, 0.9):
        tp = sum(1 for s, pr, _ in rows if s and pr >= th)
        fp = sum(1 for s, pr, _ in rows if not s and pr >= th)
        fn = sum(1 for s, pr, _ in rows if s and pr < th)
        print("threshold %.1f: 맞게 같음 %d, 잘못 같음 %d, 놓침 %d (평가 %d쌍)" % (th, tp, fp, fn, len(rows)))
    for s, pr, pair in sorted(rows, key=lambda x: -x[1]):
        print("  %-5s %.3f %s" % ("same" if s else "diff", pr, pair))


# ---------------------------------------------------------------------- 형식 2 (jev_tasks.py): 원자 진술 여럿 + 코드 합치기
def run_task2(p, do_send):
    import ast
    import jev_tasks as T
    m, sh = load_map(p), shapes(p)
    cache = load_cache(p)
    key = api_key() if do_send else None
    out, sent = [], 0
    with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        for d in m.get("duplicate_candidates", []):
            a, b = d["spaces"]
            A, B = m["spaces"].get(a), m["spaces"].get(b)
            if not A or not B:
                continue
            shared = set()
            for why, _ in d["why"]:
                if "[" in why and why.rstrip().endswith("]"):
                    try:
                        shared |= set(ast.literal_eval(why[why.index("["):]))
                    except (ValueError, SyntaxError):
                        pass
            body = {"state": T.duplicate_state(p, a, b, A, B, sh, shared), "model": T.MODEL, "questions": T.DUPLICATE_QUESTIONS}
            k = ckey(body)
            resp = cache.get(k)
            if resp is None and do_send:
                resp = send(body, key)
                cf.write(json.dumps({"key": k, "pair": [a, b], "task": "duplicates2", "response": resp}, ensure_ascii=False,
                                    sort_keys=True) + "\n")
                sent += 1
            ans = {q: (v.get("noul") if v.get("type") == "noul" else v.get("score"))
                   for q, v in ((resp or {}).get("answers") or {}).items()}
            out.append({"pair": [a, b], "answers": ans, "combined": T.duplicate_combine(ans), "model": (resp or {}).get("model")})
    with io.open(os.path.join(HERE, "out2", p, "map", "jev_duplicates2.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"pairs": len(out), "sent": sent}, ensure_ascii=False))


def auc(rows):
    """정답(같음 True)과 점수 쌍의 AUC: 같음 하나와 다름 하나를 고를 때 같음 점수가 더 높을 확률"""
    pos = [s for y, s in rows if y]
    neg = [s for y, s in rows if not y]
    if not pos or not neg:
        return None
    return round(sum((x > y) + 0.5 * (x == y) for x in pos for y in neg) / (len(pos) * len(neg)), 3)


def eval_task2(p):
    gold = {tuple(sorted(g["pair"])): g for g in json.load(io.open(os.path.join(HERE, "eval", "%s_duplicates_gold.json" % p),
                                                                    encoding="utf-8"))["pairs"] if not g.get("uncertain")}
    v1 = {tuple(sorted(o["pair"])): o["probability"] for o in json.load(io.open(os.path.join(HERE, "out2", p, "map",
                                                                                         "jev_duplicates.json"), encoding="utf-8"))}
    v2 = {tuple(sorted(o["pair"])): o for o in json.load(io.open(os.path.join(HERE, "out2", p, "map", "jev_duplicates2.json"),
                                                                  encoding="utf-8"))}
    keys = [k for k in gold if k in v2 and v2[k]["combined"] is not None]
    print("평가 쌍 %d (같음 %d)" % (len(keys), sum(1 for k in keys if gold[k]["same"])))
    print("AUC 형식1 한 질문: %s" % auc([(gold[k]["same"], v1[k]) for k in keys if v1.get(k) is not None]))
    for q in ("same_entity", "same_identifier", "variant_of_parent", "scoped_view"):
        rows = [(gold[k]["same"], v2[k]["answers"].get(q)) for k in keys if v2[k]["answers"].get(q) is not None]
        if q == "variant_of_parent":
            rows = [(y, 1 - s) for y, s in rows]
        print("AUC 형식2 %-18s %s" % (q + (" (1-p)" if q == "variant_of_parent" else ""), auc(rows)))
    rows = [(gold[k]["same"], v2[k]["combined"]) for k in keys]
    print("AUC 형식2 합친 점수        %s" % auc(rows))
    for th in (0.4, 0.5, 0.6, 0.7):
        tp = sum(1 for y, s in rows if y and s >= th)
        fp = sum(1 for y, s in rows if not y and s >= th)
        fn = sum(1 for y, s in rows if y and s < th)
        print("  합친 점수 >= %.1f: 맞게 같음 %d, 잘못 같음 %d, 놓침 %d" % (th, tp, fp, fn))
    for k in sorted(keys, key=lambda k: -v2[k]["combined"]):
        a = v2[k]["answers"]
        print("  %-4s %.2f | se %.2f si %.2f vp %.2f sv %.2f | %s" % ("같음" if gold[k]["same"] else "다름", v2[k]["combined"],
              a.get("same_entity", -1), a.get("same_identifier", -1), a.get("variant_of_parent", -1), a.get("scoped_view", -1), list(k)))


# ---------------------------------------------------------------------- 과제: 레코드와 자기 식별자 (2026-10-18)
def record_candidates(p, limit=600):
    """공간이 아닌 객체 모양 중 공개 예시 값이 있는 것 -> (모양, 메서드, 경로, [(필드, 예시)])"""
    from map3 import Map3
    m = Map3(p)
    m.model_keys = []                                      # 후보는 Jev 키를 적용하기 전 상태로 고른다 (판정을 덮어쓰지 않게)
    m.build_edges()
    m.spaces()
    m.ids()
    seen, out = set(), []

    def walk(v, sid, path, depth=0):
        s = m.shapes.get(sid) or {}
        if depth > 6 or not s:
            return
        if s["kind"] == "array" and isinstance(v, list):
            for x in v[:2]:
                yield from walk(x, (s.get("items") or {}).get("shape"), path + "[*]", depth + 1)
        elif s["kind"] == "union":
            for a in s.get("alts") or []:
                yield from walk(v, a, path, depth + 1)
        elif s["kind"] == "object" and isinstance(v, dict):
            props = {pr["name"]: pr for pr in s.get("props") or []}
            # 예시가 모양과 맞을 때만 (2026-10-18 D7: Jira searchSecuritySchemes 예시는 원소 하나인데 모양은 PageBean 이었다)
            if v and sum(1 for k in v if k in props) * 2 < len(v):
                return
            yield sid, path, v
            for k, x in v.items():
                if k in props and props[k].get("shape") and isinstance(x, (dict, list)):
                    yield from walk(x, props[k]["shape"], path + "." + k, depth + 1)
    for ins in sorted(m.insts, key=lambda r: r["id"]):
        if ins["grade"] != "example" or "operation" not in ins["of"]:
            continue
        o = m.ops.get(ins["of"]["operation"])
        if not o:
            continue
        for sid, path, v in walk(ins["value"], m.resp(o), "$"):
            if sid in seen or sid in m.shape_space or sid in m.local_shapes:
                continue
            fields = [(k, str(x)[:40]) for k, x in v.items() if isinstance(x, (str, int, float)) and not isinstance(x, bool)]
            if len(fields) < 2:
                continue
            seen.add(sid)
            out.append((sid, o["name"], path, fields[:25]))
    # 예시가 없는 고아 뿌리 모양: 필드 이름만으로 (루프 19, Confluence 처럼 예시가 거의 없는 provider)
    mp = os.path.join(HERE, "out2", p, "map", "info_map.json")
    if os.path.exists(mp):
        orph = sorted({it["det"][7:] for it in json.load(io.open(mp, encoding="utf-8"))["items"] if it["det"].startswith("orphan:")})
        for sid in orph:
            if sid in seen or sid not in m.shapes or sid in m.shape_space:
                continue
            fields = [(pr["name"], "") for pr in m.shapes[sid].get("props") or [] if pr.get("scalar") is not None]
            if len(fields) < 2:
                continue
            seen.add(sid)
            op = next((o["name"] for o in m.ops.values() if sid in m.obj(m.resp(o) or "")), "")
            out.append((sid, op, "$", fields[:25]))
    return out[:limit]


def run_records(p, do_send):
    import jev_tasks as T
    cache = load_cache(p)
    key = api_key() if do_send else None
    out, sent = [], 0
    with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        for sid, meth, path, fields in record_candidates(p):
            body = {"state": T.record_state(meth, path, fields), "model": T.MODEL, "questions": T.record_questions2(fields)}
            k = ckey(body)
            resp = cache.get(k)
            if resp is None and do_send:
                try:
                    resp = send(body, key)
                except urllib.error.HTTPError as e:
                    print("HTTP %s %s" % (e.code, sid))
                    continue
                cf.write(json.dumps({"key": k, "shape": sid, "task": "records", "response": resp}, ensure_ascii=False,
                                    sort_keys=True) + "\n")
                sent += 1
            a = (resp or {}).get("answers") or {}
            oi = a.get("own_identifier") or {}
            out.append({"shape": sid, "method": meth, "path": path, "is_entity": (a.get("is_entity") or {}).get("noul"),
                        "key": oi.get("choice"), "key_p": (oi.get("probabilities") or {}).get(oi.get("choice")),
                        "fields": [f for f, _ in fields], "model": (resp or {}).get("model"),
                        "parts": {q[6:]: v.get("noul") for q, v in a.items() if q.startswith("part__")}})
    with io.open(os.path.join(HERE, "out2", p, "map", "jev_records.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"objects": len(out), "sent": sent}, ensure_ascii=False))


def local_candidates(p):
    """부모 안(local) 공간 -> (공간 이름, 경로 틀, 마지막 인자, 부모 인자들, 스키마 이름, 속성 이름). 공개 명세 값만"""
    from map3 import Map3, segs
    m = Map3(p)
    m.build_edges()
    m.spaces()
    out = []
    for sp in sorted(m.space.values(), key=lambda x: x["name"]):
        if sp["form"] != "local":
            continue
        for P in sp["item_positions"][:1]:
            o = m.ops[sorted(m.item_pos[P])[0]]
            t = o["path"]["template"]
            ps = [x[1:-1] for x in segs(t) if x.startswith("{")]
            if len(ps) < 2:
                continue
            props = []
            for x in sp["shapes"]:
                for pr in (m.shapes.get(x) or {}).get("props") or []:
                    if pr["name"] not in props:
                        props.append(pr["name"])
            names = sorted({(m.shapes.get(x) or {}).get("name") or "" for x in sp["shapes"]} - {""})
            out.append((sp["name"], "/" + t, ps[-1], ps[:-1], names[0] if names else None, props[:30]))
    return out


def run_locals(p, do_send):
    import jev_tasks as T
    cache = load_cache(p)
    key = api_key() if do_send else None
    out, sent = [], 0
    with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        for name, ep, kp, pp, schema, fields in local_candidates(p):
            body = {"state": T.local_state(ep, kp, pp, schema, fields), "model": T.MODEL, "questions": T.local_questions()}
            k = ckey(body)
            resp = cache.get(k)
            if resp is None and do_send:
                try:
                    resp = send(body, key)
                except urllib.error.HTTPError as e:
                    print("HTTP %s %s" % (e.code, name))
                    continue
                cf.write(json.dumps({"key": k, "shape": name, "task": "locals", "response": resp}, ensure_ascii=False,
                                    sort_keys=True) + "\n")
                sent += 1
            a = (resp or {}).get("answers") or {}
            out.append({"space": name, "endpoint": ep, "key_param": kp, "parent_params": pp, "model": (resp or {}).get("model"),
                        "independent1": (a.get("independent") or {}).get("noul"), "is_link": (a.get("is_link") or {}).get("noul"),
                        "other_kind": (a.get("other_kind") or {}).get("noul"), "same_value": (a.get("same_value") or {}).get("noul")})
            ok, sv = out[-1]["other_kind"], out[-1]["same_value"]
            out[-1]["independent"] = round((ok * sv) ** 0.5, 3) if ok is not None and sv is not None else None
    with io.open(os.path.join(HERE, "out2", p, "map", "jev_locals.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"locals": len(out), "sent": sent}, ensure_ascii=False))


def run_localkey(p, do_send):
    import jev_tasks as T
    cache = load_cache(p)
    key = api_key() if do_send else None
    links = {r["space"] for r in json.load(io.open(os.path.join(HERE, "out2", p, "map", "jev_locals.json"), encoding="utf-8"))
             if (r.get("is_link") or 0) >= 0.8}
    out, sent = [], 0
    with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        for name, ep, kp, pp, schema, fields in local_candidates(p):
            if name not in links:
                continue
            body = {"state": T.local_state(ep, kp, pp, schema, fields), "model": T.MODEL, "questions": T.localkey_questions()}
            k = ckey(body)
            resp = cache.get(k)
            if resp is None and do_send:
                try:
                    resp = send(body, key)
                except urllib.error.HTTPError as e:
                    print("HTTP %s %s" % (e.code, name))
                    continue
                cf.write(json.dumps({"key": k, "shape": name, "task": "localkey", "response": resp}, ensure_ascii=False,
                                    sort_keys=True) + "\n")
                sent += 1
            kr = ((resp or {}).get("answers") or {}).get("key_role") or {}
            out.append({"space": name, "endpoint": ep, "key_param": kp, "model": (resp or {}).get("model"), "choice": kr.get("choice"),
                        "p_entity": (kr.get("probabilities") or {}).get("connected_entity")})
    with io.open(os.path.join(HERE, "out2", p, "map", "jev_localkey.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"links": len(out), "sent": sent}, ensure_ascii=False))


def run_keyfields(p, do_send):
    """복합키 자격증명 오브젝트의 키 재료 중 대상이 안 정해진 필드 -> 원문 ID 형식이 있는 공간 중 하나 (Choice)"""
    import jev_tasks as T
    from map3 import Map3
    m = Map3(p)
    m.run()
    cache = load_cache(p)
    key = api_key() if do_send else None
    # 선택지: 원문 ID 형식이 붙은 공간과 역할 목록. 설명은 공개 명세의 단건 위치, 스키마 이름, 속성 이름
    names = sorted(set(m.idf_space.values()) | set(m.catalog_keys))
    sp_by = {sp["name"]: sp for sp in m.space.values()}
    opts = {}
    for n in names:
        sp = sp_by.get(n)
        if not sp:
            continue
        v = T.space_view(sp, m.shapes, max_props=12)
        fmts = [f["match"]["pattern"] for f in m.idfs if m.idf_space.get(f["id"]) == n and (f.get("match") or {}).get("pattern")][:2]
        opts[n] = "Object group with id pattern %s, endpoints %s, schemas %s, fields %s" % (fmts, v["endpoints"][:2], v["schemas"][:3], v["fields"][:8])
    out, sent = [], 0
    with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        for sid, prop in m.key_unresolved:
            sh = m.shapes[sid]
            sib = [pr["name"] for pr in sh.get("props") or []][:15]
            meth = sid.split(":op:")[1].split(":resp:")[0] if ":op:" in sid else sid
            path = sid.split(":resp:")[1] if ":resp:" in sid else "$"
            body = {"state": T.keyfield_state(meth, path, prop, sib), "model": T.MODEL, "questions": T.keyfield_question(opts)}
            k = ckey(body)
            resp = cache.get(k)
            if resp is None and do_send:
                try:
                    resp = send(body, key)
                except urllib.error.HTTPError as e:
                    print("HTTP %s %s.%s" % (e.code, sid, prop))
                    continue
                cf.write(json.dumps({"key": k, "shape": sid, "task": "keyfields", "response": resp}, ensure_ascii=False,
                                    sort_keys=True) + "\n")
                sent += 1
            t = ((resp or {}).get("answers") or {}).get("target") or {}
            out.append({"shape": sid, "prop": prop, "model": (resp or {}).get("model"), "choice": t.get("choice"),
                        "p": (t.get("probabilities") or {}).get(t.get("choice"))})
    with io.open(os.path.join(HERE, "out2", p, "map", "jev_keyfields.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"fields": len(out), "sent": sent, "options": len(opts)}, ensure_ascii=False))


def spacekey_candidates(p):
    """자기 키 필드가 정해지지 않은 공간의 대표 모양 하나 -> (공간, 모양, 동작, [(필드, 예시)]). 문서 예시 값만 (테넌트 값 제외)"""
    from map3 import Map3
    m = Map3(p)
    m.build_edges()
    m.spaces()
    m.ids()
    keyed = {v["target"] for v in m.id_role.values() if v["role"] in ("self_key", "address_key") and isinstance(v.get("target"), str)}
    ex = {}
    for ins in sorted(m.insts, key=lambda r: r["id"]):
        if ins["grade"] != "example" or "operation" not in ins["of"]:
            continue
        o = m.ops.get(ins["of"]["operation"])
        if not o or not m.resp(o) or not isinstance(ins["value"], dict) and not isinstance(ins["value"], list):
            continue
        vs = ins["value"] if isinstance(ins["value"], list) else [ins["value"]]
        for x in m.obj(m.resp(o)) + m.element(m.resp(o)):
            if x in ex or not m.shape_space.get(x):
                continue
            props = {pr["name"] for pr in m.shapes[x].get("props") or []}
            for v in vs[:1]:
                if isinstance(v, dict):
                    cand = v
                    if not (set(v) & props):            # 봉투 안 원소
                        arr = [y for y in v.values() if isinstance(y, list) and y and isinstance(y[0], dict)]
                        cand = arr[0][0] if arr else {}
                    f = [(k, str(y)[:40]) for k, y in cand.items() if k in props and isinstance(y, (str, int)) and not isinstance(y, bool)]
                    if len(f) >= 2:
                        ex[x] = (o["name"], f[:25])
    out = []
    seen = set()
    for x, (op, f) in sorted(ex.items()):
        sp = m.shape_space[x]
        if sp in keyed or sp in seen:
            continue
        seen.add(sp)
        out.append((sp, x, op, f))
    return out


def run_spacekeys(p, do_send):
    import jev_tasks as T
    cache = load_cache(p)
    key = api_key() if do_send else None
    out, sent = [], 0
    with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        for sp, sid, meth, fields in spacekey_candidates(p):
            body = {"state": T.record_state(meth, "$", fields), "model": T.MODEL, "questions": T.record_questions(fields)}
            k = ckey(body)
            resp = cache.get(k)
            if resp is None and do_send:
                try:
                    resp = send(body, key)
                except urllib.error.HTTPError as e:
                    print("HTTP %s %s" % (e.code, sp))
                    continue
                cf.write(json.dumps({"key": k, "shape": sid, "task": "spacekeys", "response": resp}, ensure_ascii=False,
                                    sort_keys=True) + "\n")
                sent += 1
            a = (resp or {}).get("answers") or {}
            oi = a.get("own_identifier") or {}
            out.append({"space": sp, "shape": sid, "method": meth, "model": (resp or {}).get("model"), "key": oi.get("choice"),
                        "key_p": (oi.get("probabilities") or {}).get(oi.get("choice")), "is_entity": (a.get("is_entity") or {}).get("noul")})
    with io.open(os.path.join(HERE, "out2", p, "map", "jev_spacekeys.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"spaces": len(out), "sent": sent}, ensure_ascii=False))


def reffield_candidates(p):
    """원인 B (2026-10-18): 공간 레코드 안의 문자열 필드와 문자열 배열 중 역할이 없는 것 -> {모양: [(경로, 필드, 예시)]}.
    enum, 날짜, URI, 이메일 형식과 자격증명 값은 뺀다. 박힌 레코드는 공간이 아니면 세 단계까지 펼친다"""
    from map3 import Map3, MATERIAL_NAMES
    m = Map3(p)
    m.build_edges()
    m.spaces()
    m.ids(include_model_refs=False)
    forms = ("global", "local", "singleton", "local_singleton", "model_key", "write_addressed")
    ok_sp = {s["name"] for s in m.space.values() if s["form"] in forms}
    vals = collections.defaultdict(list)
    for ins in m.insts:
        if ins["grade"] == "example":
            for sid, name, v, _ in m.instance_fields(ins):
                if len(vals[(sid, name)]) < 2 and v not in vals[(sid, name)]:
                    vals[(sid, name)].append(v[:40])
    out = collections.OrderedDict()
    seen = set()
    for x, spn in sorted(m.shape_space.items()):
        if spn not in ok_sp:
            continue
        stack = [(x, "", 0)]
        while stack:
            sid, pre, d = stack.pop()
            if (sid, pre) in seen or d > 3:
                continue
            seen.add((sid, pre))
            for pr in (m.shapes.get(sid) or {}).get("props") or []:
                sub = m.shapes.get(pr.get("shape") or "") or {}
                arr = sub.get("kind") == "array" and not (sub.get("items") or {}).get("shape")
                if sub.get("kind") in ("object", "union") and not m.shape_space.get(pr["shape"]):
                    for y in m.obj(pr["shape"]) or [pr["shape"]]:              # union 이면 대안마다 (Okta 정책 조건)
                        if not m.shape_space.get(y):
                            stack.append((y, pre + pr["name"] + ".", d + 1))
                    continue
                if not (pr.get("scalar") == "string" or arr):
                    continue
                if pr.get("enum") or pr.get("format") in ("date-time", "date", "uri", "email", "url") or pr["name"] in MATERIAL_NAMES:
                    continue
                r = m.id_role.get((sid, pr["name"]))
                if r and (r["role"] == "self_key" or r.get("target")):
                    continue
                out.setdefault(sid, []).append((pre + pr["name"], pr["name"], vals.get((sid, pr["name"])) or [], arr))
    return m, out


def run_reffields(p, do_send, shape_names=None, target_names=None):
    import jev_tasks as T
    m, cands = reffield_candidates(p)
    if shape_names:
        cands = collections.OrderedDict((sid, fields) for sid, fields in cands.items()
                                       if sid in shape_names or (m.shapes[sid].get("name") or sid.split(":")[-1]) in shape_names)
    cache = load_cache(p)
    key = api_key() if do_send else None
    if do_send and not key:
        sys.exit("TYPESAFE_API_KEY 가 없다 (환경 변수 또는 setup-output/secrets/jev.txt)")
    # 선택지: 지금 지도에서 참조 대상이 된 적이 있는 공간과 원문, 학습 형식이 있는 공간 (많이 가리켜진 순 60개)
    im = load_map(p)
    indeg = collections.Counter(b for a, b, n in im["refs"])
    fmt = {v for v in m.idf_space.values() if isinstance(v, str)}
    names = target_names or sorted(set(indeg) | fmt, key=lambda n: (-indeg.get(n, 0), n))
    sp_by = {s["name"]: s for s in m.space.values()}
    if target_names and any(n not in sp_by for n in target_names):
        raise ValueError("지도에 없는 대상 공간: %s" % sorted(set(target_names) - set(sp_by)))
    opts = {}
    for n in names:
        if n in sp_by and len(opts) < 60:
            v = T.space_view(sp_by[n], m.shapes, max_props=8)
            opts[n] = "Object at endpoints %s, schemas %s, fields %s" % (v["endpoints"][:2], v["schemas"][:2], v["fields"][:8])
    dest = os.path.join(HERE, "out2", p, "map", "jev_reffields.json")
    previous = json.load(io.open(dest, encoding="utf-8")) if os.path.exists(dest) else []
    saved = {(r["shape"], r["path"]): r for r in previous}
    out, sent = [], 0
    with io.open(cache_path(p), "a", encoding="utf-8", newline="\n") as cf:
        def ask(body, tag):
            nonlocal sent
            k = ckey(body)
            resp = cache.get(k)
            if resp is None and do_send:
                try:
                    resp = send(body, key)
                except Exception as e:                                   # noqa: BLE001
                    print("Jev 실패 %s %s" % (tag, e))
                    return None
                cf.write(json.dumps({"key": k, "shape": tag, "task": "reffields", "response": resp}, ensure_ascii=False,
                                    sort_keys=True) + "\n")
                cf.flush()
                cache[k] = resp
                sent += 1
            return resp
        for sid, fields in cands.items():
            sh = m.shapes[sid]
            meth = sid.split(":op:")[1].split(":resp:")[0] if ":op:" in sid else (sh.get("name") or sid.split(":")[-1])
            for i in range(0, len(fields), 12):
                chunk = fields[i:i + 12]
                state = {"record_schema": meth, "fields": [{"name": f, "example": ", ".join(ex), "is_list": arr} for f, _, ex, arr in chunk]}
                q = {"part__" + f.replace(".", "__"): (T.list_part_question(f) if arr else T.part_question(f)) for f, _, _, arr in chunk}
                resp = ask({"state": state, "model": T.MODEL, "questions": q}, sid)
                ans = (resp or {}).get("answers") or {}
                for f, prop, ex, arr in chunk:
                    pp = (ans.get("part__" + f.replace(".", "__")) or {}).get("noul")
                    row = {"shape": sid, "path": f, "prop": prop, "part": pp, "model": (resp or {}).get("model")}
                    complete = pp is not None
                    if pp is not None and pp >= 0.7 and opts:
                        st2 = {"record_schema": meth, "field": f, "example": ", ".join(ex), "other_fields_in_record": [x[0] for x in fields][:15]}
                        r2 = ask({"state": st2, "model": T.MODEL, "questions": T.keyfield_question(opts)}, sid + "#" + f)
                        t = ((r2 or {}).get("answers") or {}).get("target") or {}
                        row["choice"], row["p"] = t.get("choice"), (t.get("probabilities") or {}).get(t.get("choice"))
                        complete = row["choice"] is not None and row["p"] is not None
                        if target_names:
                            row["target_options"] = list(opts)
                    # 일부 모양만 재판정하거나 통신이 끊겨도 앞서 완료한 결과를 지우지 않는다.
                    if complete:
                        saved[(sid, f)] = row
                    out.append(row)
    with io.open(dest, "w", encoding="utf-8", newline="\n") as f:
        json.dump([saved[k] for k in sorted(saved)], f, ensure_ascii=False, indent=1, sort_keys=True)
    print(json.dumps({"provider": p, "shapes": len(cands), "fields": len(out), "sent": sent,
                      "part>=0.7": sum(1 for r in out if (r["part"] or 0) >= 0.7),
                      "target>=0.7": sum(1 for r in out if r.get("choice") not in (None, "none") and (r.get("p") or 0) >= 0.7)}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    a = sys.argv[1:]
    if len(a) >= 2 and a[0] == "duplicates":
        run_duplicates(a[1], "--send" in a)
    elif len(a) >= 2 and a[0] == "eval":
        run_eval(a[1])
    elif len(a) >= 2 and a[0] == "duplicates2":
        run_task2(a[1], "--send" in a)
    elif len(a) >= 2 and a[0] == "eval2":
        eval_task2(a[1])
    elif len(a) >= 2 and a[0] == "reffields":
        def option_values(flag):
            if flag not in a:
                return None
            vals = []
            for value in a[a.index(flag) + 1:]:
                if value.startswith("--"):
                    break
                vals.append(value)
            if not vals:
                sys.exit("%s 뒤에 이름이 필요하다" % flag)
            return vals
        run_reffields(a[1], "--send" in a, option_values("--shapes"), option_values("--targets"))
    elif len(a) >= 2 and a[0] == "spacekeys":
        run_spacekeys(a[1], "--send" in a)
    elif len(a) >= 2 and a[0] == "keyfields":
        run_keyfields(a[1], "--send" in a)
    elif len(a) >= 2 and a[0] == "localkey":
        run_localkey(a[1], "--send" in a)
    elif len(a) >= 2 and a[0] == "locals":
        run_locals(a[1], "--send" in a)
    elif len(a) >= 2 and a[0] == "records":
        run_records(a[1], "--send" in a)
    else:
        sys.exit(__doc__)
