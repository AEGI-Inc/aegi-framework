r"""Google Workspace Security checklist for small businesses (1-100 users) 8개를 판정한다. 수집 원본만 읽는다.
사용: run_all.py 가 부른다(README.md)
"""
STD = "Google Workspace Security checklist for small businesses (1-100 users)"
SLUG = "gws_checklist_small"
import std_paths as P
import json, sys, glob, os, datetime, urllib.parse
from gws_common import Run, dur

RAW, UNIQ, DS, OUT = P.RAW, P.UNIQ, P.DS, P.out(SLUG)
ITEMS = P.ITEMS
_its = [i for i in json.load(open(ITEMS, encoding="utf-8")) if i["source"] == STD]
TIER = _its[0]["source_tier"]
titles = {i["id"]: i["title"] for i in _its}
R = Run(RAW, UNIQ, DS, STD, titles)
users = R.users
S = lambda **k: k
RULE = lambda src, field, cond="", comb="": {"source": src, "field": field, "condition": cond, "combine": comb}

_c = json.load(open(os.path.join(R.gw, "GW-03-0001.json"), encoding="utf-8"))
NOW = datetime.datetime.fromisoformat(_c["collected_at"].replace("Z", "+00:00"))


def nc(iid, source, field, note, cond=""):
    R.emit(iid, "not_collected", RULE(source, field, cond), cond, note=note)


def om(iid, status, source, field, note, cond="", targets=()):
    R.emit(iid, status, RULE(source, field, cond), cond, targets, note)


def judge_users(iid, pop, field, cond, test, val, note="", comb="대상 사용자마다 본다. 하나라도 위반이면 위반", thr=None):
    ts = []
    for u in pop:
        ok = test(u)
        st = "unknown" if ok is None else ("pass" if ok else "fail")
        ts.append({**R.ukey(u), "name": u["primaryEmail"], "value": val(u), "status": st})
    sts = [t["status"] for t in ts]
    st = "fail" if "fail" in sts else ("unknown" if "unknown" in sts else "pass")
    R.emit(iid, st, RULE("GW-03 users", field, cond, comb), thr if thr is not None else cond, ts, note)


def pol_t(stype, fields, st="unknown"):
    e = R.eff(stype)
    return {**R.pkey(e["name"]), "name": stype, "value": {k: e["value"].get(k) for k in fields}, "status": st}


def pol_unknown(iid, stype, fields, note, cond=""):
    """값은 있으나 기준에 판정할 값이 없어 현재 값만 보여 준다"""
    if not R.eff(stype):
        R.absent(iid, stype, f"{stype} 가 GW-24 에 없다"); return
    R.emit(iid, "unknown", RULE("GW-24 " + stype, ",".join(fields), cond, "같은 설정의 정책 중 sortOrder 가 가장 큰 값"), cond, [pol_t(stype, fields)], note)


def lastlogin(u):
    t = u.get("lastLoginTime") or ""
    if t.startswith("1970"): return None
    return datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))


email2id = {u["primaryEmail"]: u["id"] for u in users}
tokens = []
for p in sorted(glob.glob(os.path.join(R.gw, "GW-05-*.json"))):
    e = json.load(open(p, encoding="utf-8"))
    for t in (e["payload"] or {}).get("items", []):
        em = e["request_params"]["user"]
        tokens.append({"user": em, "uid": email2id.get(em), "client": t["clientId"], "name": t.get("displayText"), "scopes": t.get("scopes", [])})
tok_key = lambda t: R.tkey(f"im:gws:Token:{t['uid']}|{t['client']}")

org_domains = set()
for pg in R.payloads("GW-02"):
    for d in pg.get("domains", []):
        org_domains.add(d["domainName"].lower())
        for a in d.get("domainAliases", []): org_domains.add(a["domainAliasName"].lower())

files = {}
perms = {}
for p in sorted(glob.glob(os.path.join(R.gw, "GW-07-*.json"))):
    e = json.load(open(p, encoding="utf-8")); pl = e["payload"] or {}
    for f in pl.get("files", []): files[f["id"]] = f
    if "permissions" in pl: perms[e["request_params"]["file"]] = pl["permissions"]


def perm_class(p):
    """anyone=인터넷 전체, domain=조직 도메인 전체, external=조직 밖 사용자·그룹·도메인"""
    t = p.get("type")
    if t == "anyone": return "anyone"
    if t == "domain": return "company" if (p.get("domain") or "").lower() in org_domains or not p.get("domain") else "external"
    if t in ("user", "group"):
        d = (p.get("emailAddress") or "").split("@")[-1].lower()
        return "internal_principal" if d in org_domains else "external"
    return "other"


def file_share(cls, role):
    """파일마다 (cls, role) 권한이 있는지. 반환: 대상 목록, 상태"""
    ts = []
    for fid, f in files.items():
        if fid not in perms:
            ts.append({**R.tkey("im:gws:File:" + fid), "name": f.get("name"), "value": "권한 목록 미수집", "status": "unknown"}); continue
        hit = [p for p in perms[fid] if perm_class(p) == cls and p.get("role") == role]
        ts.append({**R.tkey("im:gws:File:" + fid), "name": f.get("name"), "value": sorted({f"{perm_class(p)}:{p.get('role')}" for p in perms[fid]}), "status": "fail" if hit else "pass"})
    sts = [t["status"] for t in ts]
    return ts, ("fail" if "fail" in sts else ("unknown" if "unknown" in sts else "pass"))


calacl = []
for p in sorted(glob.glob(os.path.join(R.gw, "GW-22-*.json"))):
    e = json.load(open(p, encoding="utf-8")); u = e["request_params"]["user"]
    for r in (e["payload"] or {}).get("items", []): calacl.append((u, r))
acl_key = lambda u, r: R.tkey("im:gws:AclRule:" + urllib.parse.quote(u, safe="") + "|" + urllib.parse.quote(r["id"], safe=""))


def public_calendar(iid, cond, note=""):
    ts = []
    for u, r in calacl:
        bad = (r.get("scope") or {}).get("type") == "default" and r.get("role") != "none"
        ts.append({**acl_key(u, r), "name": f"{u} 기본 캘린더 {r['id']}", "value": {"scope": r.get("scope"), "role": r.get("role")}, "status": "fail" if bad else "pass"})
    R.emit(iid, "fail" if any(t["status"] == "fail" for t in ts) else "pass",
           RULE("GW-22 calendars/primary/acl", "items[].scope.type, role", cond, "캘린더 ACL 규칙마다 본다. 하나라도 위반이면 위반"), cond, ts,
           ("GW-22 는 사용자별 기본(primary) 캘린더 ACL 만 수집하고 정지 사용자와 보조 캘린더는 없다. " + note).strip())


def finish():
    R.write(OUT, STD, TIER, RAW)

act = [u for u in users if not u.get("suspended")]
ID = {t: i for i, t in titles.items()}
def iid(prefix): return next(i for i in titles if i.startswith(prefix))

if not R.eff("security.password"):
    R.absent(iid("1."), "security.password", "security.password 가 GW-24 에 없다")
else:
    om(iid("1."), "org_policy", "GW-24 security.password", "minimumLength, allowReuse", "'긴(long)' 비밀번호의 길이 기준이 문장에 없어 조직이 정해야 한다. 재사용 금지(allowReuse == false)는 충족한다. 현재 값을 보여 준다",
       "긴 비밀번호 + 재사용 금지", [pol_t("security.password", ["minimumLength", "allowReuse"], "org_policy")])
adm = [u for u in act if u.get("isAdmin") or u.get("isDelegatedAdmin")]
judge_users(iid("2."), adm, "isAdmin, isDelegatedAdmin, isEnforcedIn2Sv", "정지되지 않은 관리자(슈퍼·위임) 전원 isEnforcedIn2Sv == true", lambda u: bool(u.get("isEnforcedIn2Sv")), lambda u: u.get("isEnforcedIn2Sv"),
            note="'핵심 사용자(key users)'는 조직이 정하는 범위라 관리자만 봤다. 대상 선정은 cis_gws.py 4.1.1.1 과 같다")
sadm = [u for u in act if u.get("isAdmin")]
gw03_full = False
for _p in sorted(glob.glob(os.path.join(R.gw, "GW-03-*.json"))):
    _e = json.load(open(_p, encoding="utf-8"))
    if "projection=full" in (_e.get("endpoint") or "") or (_e.get("request_params") or {}).get("projection") == "full":
        gw03_full = True
        break
def rec(u):
    if not u.get("recoveryEmail"): return False
    if u.get("recoveryPhone"): return True
    return False if gw03_full else None
judge_users(iid("3."), sadm, "isAdmin, recoveryEmail, recoveryPhone", "복구 이메일과 복구 전화가 모두 있음", rec,
            lambda u: {"recoveryEmail": "있음" if u.get("recoveryEmail") else "없음",
                       "recoveryPhone": "있음" if u.get("recoveryPhone") else ("없음" if gw03_full else "필드 없음")},
            note="값은 읽지 않고 유무만 봤다. GW-03 은 projection=full 로 수집하므로 recoveryPhone 필드가 없으면 등록되지 않은 것으로 판정한다. 슈퍼관리자만 봤다('admin account')" if gw03_full else "값은 읽지 않고 유무만 봤다. projection=full 확인이 없어 recoveryPhone 필드 없음은 unknown 으로 뒀다. 슈퍼관리자만 봤다('admin account')")
M = lambda i, f, n="": om(i, "manual", "없음", f, n or "값으로 위반이 정해지지 않는다")
M(iid("4."), "2SV 백업 코드 생성·보관", "백업 코드 보관 여부는 API 로 알 수 없다(verificationCodes 호출도 수집하지 않았다)")
n = len(sadm)
R.emit(iid("5."), "pass" if n >= 2 else "fail", RULE("GW-03 users", "isAdmin(슈퍼관리자)", "정지되지 않은 슈퍼관리자 수 >= 2", "수"), "2명 이상",
       [{**R.ukey(u), "name": u["primaryEmail"], "value": True, "status": "pass" if n >= 2 else "fail"} for u in sadm], f"슈퍼관리자 {n}명. '별도 사람이 관리'하는지는 값에 없어 보지 않았다")
M(iid("6."), "슈퍼관리자 비밀번호 재설정용 계정·DNS 정보 확보")
M(iid("7."), "슈퍼관리자의 일상 업무 로그인", "cis_gws.py 1.1.2 와 같은 권장사항으로 값으로 정해지지 않는다")
nc(iid("11."), "DNS", "SPF TXT 레코드", "DNS 조회는 수집하지 않는다", "SPF 존재")
finish()
