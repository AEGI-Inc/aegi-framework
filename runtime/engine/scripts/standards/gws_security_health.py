r"""Google Workspace Security health page 43개를 판정한다. 수집 원본만 읽는다.
이 페이지는 항목 이름만 주고 권장값을 적지 않아, 현재 값이 수집된 항목은 unknown(값만 표시), 수집되지 않은 항목은 not_collected 로 둔다.
사용: run_all.py 가 부른다(README.md)
"""
STD = "Google Workspace Security health page"
SLUG = "gws_security_health"
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


def pol_judge(iid, stype, fields, cond, test, note):
    """적용 정책 하나의 여러 필드를 test(value) 로 판정한다. None 이면 unknown"""
    e = R.eff(stype)
    if not e:
        R.absent(iid, stype, f"{stype} 가 GW-24 에 없다"); return
    r = test(e["value"])
    st = "unknown" if r is None else ("pass" if r else "fail")
    R.emit(iid, st, RULE("GW-24 " + stype, ",".join(fields), cond, "같은 설정의 정책 중 sortOrder 가 가장 큰 값"), cond, [pol_t(stype, fields, st)], note)


def all_true(fields):
    def _test(v):
        vals = [v.get(f) for f in fields]
        if any(x is False for x in vals):
            return False
        if all(x is True for x in vals):
            return True
        return None
    return _test


def drive_desktop(v):
    a, r = v.get("allowDriveForDesktop"), v.get("restrictToAuthorizedDevices")
    if a is False or r is True:
        return True
    if a is None and r is None:
        return None
    return False


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

NOREC = "원문은 항목 이름만 제공하고 권장값을 적지 않는다(Admin 콘솔 우측 아이콘에서 권장사항을 연다고만 설명). 기준이 요구하는 값이 없어 현재 값만 보여 주고 판정하지 않는다."
# 값은 GW-24 에 있으나 권장값이 원문에 없는 항목
POLICY_JUDGE = {
    "Gmail: Attachment safety": ("gmail.email_attachment_safety", ["enableEncryptedAttachmentProtection", "enableAttachmentWithScriptsProtection", "enableAnomalousAttachmentProtection"], "모두 true", all_true, "원문은 권장값이 없어 점검 문장(Gmail 첨부파일 안전)대로 판정"),
    "Gmail: Links and external images safety": ("gmail.links_and_external_images", ["enableShortenerScanning", "enableExternalImageScanning", "enableAggressiveWarningsOnUntrustedLinks"], "모두 true", all_true, "원문은 권장값이 없어 점검 문장(Gmail 링크 및 외부 이미지 안전)대로 판정"),
    "Gmail: Spoofing and authentication safety": ("gmail.spoofing_and_authentication", ["detectDomainNameSpoofing", "detectEmployeeNameSpoofing", "detectDomainSpoofingFromUnauthenticatedSenders", "detectUnauthenticatedEmails", "detectGroupsSpoofing"], "모두 true", all_true, "원문은 권장값이 없어 점검 문장(Gmail 스푸핑 및 인증 안전)대로 판정"),
    "Drive: Desktop access to Drive": ("drive_and_docs.drive_for_desktop", ["allowDriveForDesktop", "restrictToAuthorizedDevices"], "allowDriveForDesktop == false 또는 restrictToAuthorizedDevices == true", lambda _f: drive_desktop, "원문은 권장값이 없어 점검 문장(Drive 데스크톱 접근 제한)대로 판정"),
}
POLICY = {
    "Marketplace apps: Google Workspace Marketplace applications usage": ("workspace_marketplace.apps_allowlist", ["apps"]),
}
for i, (st, fields, cond, mk, note) in POLICY_JUDGE.items():
    pol_judge(i, st, fields, cond, mk(fields), note)
for i, (st, fields) in POLICY.items():
    pol_unknown(i, st, fields, NOREC)
for i, who, lbl in [
    ("Security: Two-step verification for users", [u for u in users if not u.get("isAdmin") and not u.get("suspended")], "일반 사용자"),
    ("Security: Two-step verification for admins", [u for u in users if (u.get("isAdmin") or u.get("isDelegatedAdmin")) and not u.get("suspended")], "관리자(슈퍼, 위임)"),
]:
    judge_users(i, who, "isEnforcedIn2Sv, isEnrolledIn2Sv", "isEnforcedIn2Sv == true",
                lambda u: u.get("isEnforcedIn2Sv") if isinstance(u.get("isEnforcedIn2Sv"), bool) else None,
                lambda u: {"isEnforcedIn2Sv": u.get("isEnforcedIn2Sv"), "isEnrolledIn2Sv": u.get("isEnrolledIn2Sv")},
                note=f"원문은 권장값이 없어 점검 문장({lbl} 2단계 인증 강제)대로 판정. 대상은 정지되지 않은 {lbl} (출처 미확인: 콘솔이 이 항목의 대상을 어떻게 나누는지 원문에 없음)",
                thr="2단계 인증 강제")
DNS = ["Gmail: DKIM", "Gmail: SPF record", "Gmail: DMARC", "Gmail: MX record configuration", "Gmail: MTA-STS configuration"]
for i in DNS:
    nc(i, "DNS", "TXT·MX 레코드", "DNS 조회는 수집하지 않는다")
mob_pages = R.payloads("RG-GW-directory.mobiledevices.list")
mob_devs = [d for pl in mob_pages if isinstance(pl, dict) for d in (pl.get("mobiledevices") or [])]
for i in titles:
    if i == "Device management: Mobile inactivity reports":
        if not mob_pages:
            nc(i, "Directory API mobiledevices.list", "mobiledevices[].lastSync", "RG-GW-directory.mobiledevices.list 를 수집하지 않았다")
        elif not mob_devs:
            om(i, "pass", "RG-GW-directory.mobiledevices.list", "mobiledevices", "모바일 기기가 0대라 비활성 모바일 기기가 없다")
        else:
            ts = [{**R.tkey(f"im:gws:MobileDevice:{d.get('resourceId', d.get('deviceId', ''))}"), "name": d.get("model") or d.get("resourceId", ""), "value": {"lastSync": d.get("lastSync"), "status": d.get("status")}, "status": "unknown"} for d in mob_devs]
            om(i, "org_policy", "RG-GW-directory.mobiledevices.list", "mobiledevices[].lastSync", NOREC + " 비활성 기준 일수는 조직이 정한다.", targets=ts)
    elif i.startswith("Device management:"):
        nc(i, "Cloud Identity Policy API / Mobile Management", "모바일 기기 관리 조직 설정", "모바일 관리 조직 설정이 GW-24 에 없다(RG-GW-directory.mobiledevices.list 와 RG-GW-cloudidentity.devices.list 는 기기 목록이며 조직 정책 설정이 아니다)")
done = set(POLICY_JUDGE) | set(POLICY) | set(DNS) | {"Security: Two-step verification for users", "Security: Two-step verification for admins"} | {i for i in titles if i.startswith("Device management:")}
for i in titles:
    if i not in done:
        R.absent(i, titles[i], "이 설정이 GW-24 163종에 없다(Gmail·Drive 공유·Calendar·Groups·Sites·Hangouts·보안 키 강제 설정은 GW-24 에 없음)")
finish()
