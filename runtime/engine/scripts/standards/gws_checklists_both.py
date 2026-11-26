r"""Google Workspace Security checklists (medium/large and small) 6개를 판정한다. 수집 원본만 읽는다.
두 체크리스트에 모두 있는 항목이다. 같은 설정의 CIS 항목과는 cis_gws.py 와 같은 필드·해석을 쓴다.
사용: run_all.py 가 부른다(README.md)
"""
STD = "Google Workspace Security checklists (medium/large and small)"
SLUG = "gws_checklists_both"
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

A = R.absent
A("Calendar: External sharing free/busy only", "캘린더 외부 공유 수준", "조직 설정이 GW-24 에 없다(cis_gws.py 3.1.1.1.1 과 같은 해석). 사용자별 기본 캘린더 ACL 에는 외부 공유 규칙이 없지만 조직 설정 값은 아니다")
nc("Chrome: Auto-updates", "Chrome Policy API", "자동 업데이트", "Chrome Policy API 를 수집하지 않았다", "자동 업데이트 켬")
A("Drive: Default general access Restricted", "새 파일 기본 일반 액세스", "Drive 공유 기본값이 GW-24 163종에 없다")
R.setting("Gmail: Enhanced pre-delivery scanning", "gmail.enhanced_pre_delivery_message_scanning", "enableImprovedSuspiciousContentDetection", lambda v: v.get("enableImprovedSuspiciousContentDetection") is True, "== true")
AT = ["enableEncryptedAttachmentProtection", "enableAttachmentWithScriptsProtection", "enableAnomalousAttachmentProtection"]
R.setting("Gmail: Attachment protection", "gmail.email_attachment_safety", ",".join(AT), lambda v: all(v.get(k) is True for k in AT), "세 보호 모두 true",
          note="CIS 3.1.3.4.1.1~3 의 세 필드를 모두 켜야 '추가 첨부 보호 켬'으로 읽었다")
LK = ["enableShortenerScanning", "enableExternalImageScanning", "enableAggressiveWarningsOnUntrustedLinks"]
R.setting("Gmail: Link and external content protection", "gmail.links_and_external_images", ",".join(LK), lambda v: all(v.get(k) is True for k in LK), "세 보호 모두 true",
          note="CIS 3.1.3.4.2.1~3 의 세 필드를 모두 켜야 '추가 링크·외부 콘텐츠 보호 켬'으로 읽었다")
finish()
