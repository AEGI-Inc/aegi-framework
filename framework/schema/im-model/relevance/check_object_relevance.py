# -*- coding: utf-8 -*-
"""객체 타입 보안 관련성 세 시험 v1 (2026-11-01 고정). LLM 없이 파일만 읽는다. 설명: README.md

T1 접근 구조: 엔진이 실제로 쓰는 관계 선언(계획, 규칙, 참조 선언)이나 정규화 출력의 실제 관계에서
   접근(G, M) 또는 신뢰(A, F, T) 효과를 내는 관계의 끝이다. 정책 의미 관계(applies_to 등)의 끝도 넣는다.
T2 보안 속성: Profile 필드 이름이나 타입 이름이 보안 낱말 사전(t2_words.py)에 낱말 단위로 맞는다.
T3 소비처: 판정, 접근 규칙, 연결 규칙, 정답셋 파일이 provider 와 타입 이름을 함께 적는다.

    AEGI_ENGINE=<aegi-adapter-engine 클론> python schema/im-model/relevance/check_object_relevance.py \
        --dataset <정규화 출력 폴더> [--dataset <폴더> ...] [--out <결과 json>]

AEGI_ENGINE 이 없으면 knowledge 옆 폴더 aegi-adapter-engine 을 쓴다.
"""
import argparse, collections, glob, io, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
E = os.environ.get("AEGI_ENGINE") or os.path.join(os.path.dirname(K), "aegi-adapter-engine")
os.environ["AEGI_ENGINE"] = E
sys.path.insert(0, os.path.join(K, "schema", "validation"))
sys.path.insert(0, HERE)
import check_im_relations as cir  # noqa: E402
import t2_words  # noqa: E402
import yaml  # noqa: E402

profiles, overlays, eff, types = cir.engine_model(E)
sem = yaml.safe_load(io.open(os.path.join(K, "schema", "ontology", "relation_semantics.yaml"), encoding="utf-8"))

# ---- T1: 관계 끝 (구조 U 만 내는 연결은 빼고, 효과 없는 정책 의미 관계는 넣는다) ----
ACCESS = {"G", "M", "A", "F", "T"}
POLICY_SEMANTIC = {"applies_to", "excludes", "evaluates", "permits", "trusts", "authenticates_with"}


def pair_kinds(rt, sifs, tifs):
    out = set()
    for ef in ((sem.get("relations") or {}).get(rt) or {}).get("effects") or []:
        pairs = set(ef.get("pairs") or [])
        for a in sifs or []:
            for b in tifs or []:
                if "%s>%s" % (a, b) in pairs:
                    out |= {e.get("kind") for e in ef.get("emits") or []}
    return out


ends = collections.defaultdict(set)
for src, key, rt, s, t, prov, d in cir.declarations(eff, types):
    for (sl, sifs, sn) in s:
        for (tl, tifs, tn) in t:
            kinds = pair_kinds(rt, sifs, tifs)
            if kinds & ACCESS or rt in POLICY_SEMANTIC:
                tag = "%s(%s)" % (rt, "".join(sorted(kinds & ACCESS)) or "정책")
                if sn:
                    ends[sn].add(tag)
                if tn:
                    ends[tn].add(tag)


# ---- T2: 필드 이름과 타입 이름 ----
def fields_of(d):
    f = d.get("fields") or {}
    names = list(f.keys()) if isinstance(f, dict) else [x.get("name") for x in f if isinstance(x, dict)]
    for rule in d.get("runtime_rules") or []:
        names += list((rule.get("properties") or {}).keys())
    return [n for n in names if n]


# ---- T3: 소비처 파일 ----
CONSUMER_GLOBS = [
    (K, ["schema/ontology/*.yaml", "groundtruth/**/*.yaml", "groundtruth/**/*.json", "groundtruth/**/*.md"]),
    (E, ["src/detection/**/*.ts", "scripts/accessRules/**/*.ts", "groundtruth/**/*.yaml", "src/events/**/*.ts", "scripts/collect/shared/*.ts"]),
]
texts = []
for root, globs in CONSUMER_GLOBS:
    for g in globs:
        for p in glob.glob(os.path.join(root, g), recursive=True):
            if os.path.isfile(p) and not p.endswith(".test.ts") and os.path.getsize(p) < 3_000_000:
                try:
                    texts.append((os.path.relpath(p, os.path.dirname(root)).replace("\\", "/"), io.open(p, encoding="utf-8", errors="ignore").read()))
                except Exception:
                    pass
PROV_ALIASES = {"atlassian": ["atlassian", "jira", "confluence"], "gws": ["gws", "google"], "salesforce": ["salesforce", "sf"],
                "okta": ["okta"], "github": ["github", "gh"], "slack": ["slack"], "worker": ["worker"]}


def consumers(prov, typ):
    hits = []
    aliases = PROV_ALIASES.get(prov, [prov])
    q = re.escape(typ)
    qual = re.compile(r"(?:%s)[:./|]%s(?![\w-])" % ("|".join(aliases), q), re.I)
    bare = re.compile(r"""(['"`]|object_type:\s*|type:\s*)%s(['"`]|\s*$)""" % q, re.M)
    for path, txt in texts:
        if qual.search(txt):
            hits.append(path)
            continue
        if bare.search(txt) and any(re.search(r"\b%s\b" % a, txt, re.I) for a in aliases):
            hits.append(path)
    return hits


def profile_for(file):
    name = file[len("overlays/"):] if file.startswith("overlays/") else file
    got = eff.get(name)
    return got[0] if got else None


def load_list(path, key):
    x = json.load(io.open(path, encoding="utf-8"))
    return x if isinstance(x, list) else x[key]


def judge_dataset(path):
    objs = load_list(os.path.join(path, "objects.json"), "objects")
    by = collections.OrderedDict()
    for o in objs:
        k = (o["canonical"]["provider"], o["canonical"]["object_type"])
        v = by.setdefault(k, {"n": 0, "ifs": o["canonical"].get("interfaces") or [], "file": (o.get("fixture_meta") or {}).get("im_profile", {}).get("file")})
        v["n"] += 1
    okey = {o["fixture_key"]: o for o in objs}
    observed = collections.defaultdict(set)
    for r in load_list(os.path.join(path, "relations.json"), "relations"):
        c = r["canonical"]
        refs = c["references"]
        so, to = okey.get(refs["source"]["value"]), okey.get(refs["target"]["value"])
        if not so or not to:
            continue
        kinds = pair_kinds(c["relation_type"], so["canonical"].get("interfaces"), to["canonical"].get("interfaces"))
        if kinds & ACCESS or c["relation_type"] in POLICY_SEMANTIC:
            tag = "실측:%s(%s)" % (c["relation_type"], "".join(sorted(kinds & ACCESS)) or "정책")
            extra = [refs.get("role", {}).get("value"), (c.get("properties") or {}).get("via_assignment")]
            for o in [so, to] + [okey[x] for x in extra if isinstance(x, str) and x in okey]:
                observed[(o["canonical"]["provider"], o["canonical"]["object_type"])].add(tag)
    rows = []
    for (prov, typ), v in by.items():
        d = profile_for(v["file"] or "") or {}
        t1 = sorted(ends.get(typ, set()) | observed.get((prov, typ), set()))
        t2 = sorted({n for n in fields_of(d) if t2_words.hits(n)}) + ["type:" + h for h in t2_words.hits(typ)]
        t3 = consumers(prov, typ)
        rows.append(dict(provider=prov, type=typ, n=v["n"], t1=t1, t2=t2[:8], t2n=len(t2), t3=t3[:4], t3n=len(t3), profile=v["file"]))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", action="append", required=True, help="정규화 출력 폴더(objects.json, relations.json)")
    ap.add_argument("--out", help="타입별 결과 json")
    a = ap.parse_args()
    out = {}
    for path in a.dataset:
        rows = judge_dataset(path)
        out[os.path.basename(os.path.normpath(path))] = rows
        fails = [r for r in rows if not (r["t1"] or r["t2"] or r["t3"])]
        print("== %s: 타입 %d, 객체 %d | 전부 실패 타입 %d(객체 %d) | 시험별 통과 타입 T1 %d, T2 %d, T3 %d" % (
            path, len(rows), sum(r["n"] for r in rows), len(fails), sum(r["n"] for r in fails),
            *(sum(1 for r in rows if r[t]) for t in ("t1", "t2", "t3"))))
        for r in sorted(fails, key=lambda r: -r["n"]):
            print("   %s/%s %d" % (r["provider"], r["type"], r["n"]))
    if a.out:
        json.dump(out, io.open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("consumer files:", len(texts))


if __name__ == "__main__":
    main()
