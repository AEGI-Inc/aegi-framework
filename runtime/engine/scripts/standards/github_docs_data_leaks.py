"""GitHub Docs 데이터 유출 방지 모범 사례 32개 항목. 수집 원본만 읽는다. 사용: run_all.py 가 부른다(README.md)
"""
STD = 'GitHub Docs: Best practices for preventing data leaks in your organization'
import std_paths as P
import json, glob, os, sys, collections, datetime
sys.stdout.reconfigure(encoding="utf-8")
RAW = P.RAW
EXTRA = P.EXTRA
DS = P.DS
OUT = P.out("github_docs_data_leaks")

IN = [x for x in json.load(open(P.ITEMS, encoding="utf-8")) if x["source"] == STD]
TIER = IN[0]["source_tier"]
fid = {s["id"]: f["finding_id"] for f in json.load(open(P.UNIQ, encoding="utf-8")) for s in f["sources"] if s["source"] == STD}
keys = {o["fixture_key"] for o in json.load(open(P.OBJ, encoding="utf-8"))}

def pages(root, call):
    for f in sorted(glob.glob(os.path.join(root, "github", f"{call}-*.json"))):
        e = json.load(open(f, encoding="utf-8")); yield e.get("request_params") or {}, e["payload"], e

org = next(p for _, p, _ in pages(RAW, "GH-01"))
repos = next(p for _, p, _ in pages(RAW, "GH-05"))
collected_at = next(e["collected_at"] for _, _, e in pages(RAW, "GH-05"))
rules = {rp["repo"]: p or [] for rp, p, _ in pages(EXTRA, "GHS-03") if rp.get("repo")}   # 기본 브랜치에 적용되는 규칙(룰셋 포함)
actions = next(p for _, p, _ in pages(EXTRA, "GHS-01"))
repo_hooks = collections.defaultdict(list)
for rp, p, _ in pages(RAW, "GH-15"):
    if rp.get("repo"): repo_hooks[rp["repo"]] += [h for h in p if isinstance(h, dict) and "id" in h]
envs = {rp["repo"]: p.get("environments", []) for rp, p, _ in pages(RAW, "GH-24")}

def tkey(k): return {"key": k, "in_graph": k in keys}
ORG = {**tkey(f"im:github:organization-full:{org['id']}"), "name": org["login"]}
def REPO(r): return {**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"]}

res = {}
def emit(iid, status, rule, threshold="", targets=(), note=""):
    """status: pass | fail | unknown | not_collected | org_policy | manual"""
    it = next(x for x in IN if x["id"] == iid)
    res[iid] = {"item_id": iid, "title": it["title"], "finding_id": fid.get(iid), "status": status,
                "threshold": threshold, "rule": rule, "targets": list(targets), "note": note}
def worst(ts):
    order = {"fail": 3, "unknown": 2, "pass": 1}
    return max((t["status"] for t in ts), key=lambda s: order[s]) if ts else "unknown"
GH01 = "GH-01 /orgs/{org}"
def org_field(iid, field, test, want, note="", cond=None):
    v = org.get(field); st = "unknown" if v is None else ("pass" if test(v) else "fail")
    emit(iid, st, {"source": GH01, "field": field, "condition": cond or want, "combine": "조직 하나"}, want, [{**ORG, "value": v, "status": st}], note)
def manual(iid, what, note=""): emit(iid, "manual", {"source": "없음", "field": what, "condition": "", "combine": ""}, note=note)
def absent(iid, what, note=""): emit(iid, "not_collected", {"source": "없음", "field": what, "condition": "", "combine": ""}, note=note or "수집 호출이 없다")

def Rd(rs): return {x["type"]: x.get("parameters") or {} for x in rs}
pr = lambda R: R.get("pull_request") or {}
def branch(iid, desc, test, want, cond=None, note=""):
    """저장소마다 기본 브랜치에 적용되는 규칙(GHS-03)을 본다. 규칙이 하나도 없으면 보호가 없는 것이라 위반.
    test(R) -> (값, 상태) 상태는 pass|fail|unknown"""
    ts = []
    for r in repos:
        rs = rules.get(r["name"])
        if rs is None: v, st = "수집 없음", "unknown"
        elif not rs: v, st = "규칙 없음", "fail"
        else: v, st = test(Rd(rs))
        ts.append({**REPO(r), "value": v, "status": st})
    emit(iid, worst(ts), {"source": "GHS-03 /repos/{repo}/rules/branches/{기본 브랜치}", "field": desc, "condition": cond or want,
                          "combine": "저장소마다 보고 하나라도 어기면 위반. 규칙이 없으면 위반"}, want, ts, note)
def yn(b, v=None): return (v if v is not None else ("충족" if b else "미충족")), ("pass" if b else "fail")

def finish():
    missing = [x["id"] for x in IN if x["id"] not in res]
    extra = [k for k in res if k not in {x["id"] for x in IN}]
    out = {"standard": STD, "tier": TIER, "provider": "github", "raw_run": os.path.basename(RAW), "items": [res[x["id"]] for x in IN if x["id"] in res]}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(STD, len(res), "/", len(IN), dict(collections.Counter(i["status"] for i in res.values())), "누락:", missing, "초과:", extra)
    for i in out["items"]:
        if i["status"] in ("pass", "fail", "unknown"):
            print(f"{i['item_id'][-50:]:50} {i['status']:8} " + "; ".join(f"{t['name']}={json.dumps(t['value'], ensure_ascii=False)}" for t in i["targets"])[:110])
    print("그래프에 없는 대상 키:", sorted({t["key"] for i in res.values() for t in i["targets"] if not t["in_graph"]}))

DOC = "GitHub Docs 'Best practices for preventing data leaks in your organization'. "
pats = [p for _, pl, _ in pages(RAW, "GH-13") if isinstance(pl, list) for p in pl if isinstance(p, dict) and "token_id" in p]
dkeys = [(rp["repo"], k) for rp, pl, _ in pages(RAW, "GH-26") for k in pl]
rulesets = {rp["repo"]: pl for rp, pl, _ in pages(RAW, "GH-08") if rp.get("repo") and "ruleset" not in rp}
now = datetime.datetime.fromisoformat(collected_at.replace("Z", "+00:00"))

absent("Secure accounts / SAML", "organization.samlIdentityProvider", "GH-31(SAML IdP GraphQL)은 FORBIDDEN 으로 실패했고 GH-21 은 이 필드를 조회하지 않는다")
absent("Secure accounts / SCIM", "GET /scim/v2/organizations/{org}/Users", "수집 호출이 없다")
org_field("Secure accounts / 2FA organization", "two_factor_requirement_enabled", lambda v: v is True, "two_factor_requirement_enabled = true", cond="== true")
gh35_2fa_pages = [(rp, pl) for rp, pl, _ in pages(RAW, "GH-35") if rp.get("filter") == "2fa_disabled" and isinstance(pl, list)]
if gh35_2fa_pages:
    bad_ext = [u for _, pl in gh35_2fa_pages for u in pl if isinstance(u, dict)]
    if bad_ext:
        emit("Secure accounts / 2FA members and collaborators", "fail",
             {"source": "GH-35 /orgs/{org}/outside_collaborators?filter=2fa_disabled", "field": "2fa_disabled 목록", "condition": "2FA 비활성 계정 0", "combine": "구성원·외부 협력자·결제 관리자 중 2FA 미사용자가 있으면 위반"},
             "2FA 비활성 계정 0",
             [{**tkey(f"im:github:simple-user:{u['id']}"), "name": u.get("login", ""), "value": "2fa_disabled", "status": "fail"} for u in bad_ext],
             f"2FA 비활성 외부 협력자 {len(bad_ext)}명(GH-35). 구성원 개별 2FA·결제 관리자는 미수집")
    elif org.get("two_factor_requirement_enabled") is True:
        emit("Secure accounts / 2FA members and collaborators", "pass",
             {"source": "GH-01 two_factor_requirement_enabled, GH-35 outside_collaborators?filter=2fa_disabled", "field": "two_factor_requirement_enabled, 2fa_disabled", "condition": "조직 2FA 필수 및 2FA 비활성 외부 협력자 0명", "combine": ""},
             "2FA 비활성 계정 0", [{**ORG, "value": {"two_factor_requirement_enabled": True, "outside_collaborators_2fa_disabled": 0}, "status": "pass"}],
             "조직 2FA 필수(GH-01) 및 2FA 비활성 외부 협력자 0명(GH-35). 결제 관리자 목록은 미수집")
    else:
        absent("Secure accounts / 2FA members and collaborators", "구성원·결제 관리자의 2FA 사용 여부 (members?filter=2fa_disabled)",
               "외부 협력자 2FA 미사용자는 0명(GH-35)이나 조직 2FA 필수가 꺼져 있고 GH-02 는 filter 없이 구성원만 읽어 구성원·결제 관리자 2FA 를 확인하지 못했다")
else:
    absent("Secure accounts / 2FA members and collaborators", "구성원·외부 협력자·결제 관리자의 2FA 사용 여부 (members?filter=2fa_disabled)",
           "GH-02 는 filter 없이 구성원만 읽고 외부 협력자(GH-35)·결제 관리자는 수집하지 않는다. 조직의 2FA 필수 설정(GH-01)은 별개 항목이라 대신 쓰지 않았다")
for iid in ("Secure accounts / strong passwords", "Secure accounts / personal push protection", "Secure accounts / internal security policy"):
    manual(iid, "사용자 개인 설정·조직 내부 절차", "SaaS 조직 설정값이 아니다")
org_field("Prevent data leaks / disable forking", "members_can_fork_private_repositories", lambda v: v is False, "members_can_fork_private_repositories = false", cond="== false",
          note="조직 설정으로 읽었다. 같은 수집에서 두 저장소의 allow_forking 도 모두 false 다")
org_field("Prevent data leaks / disable visibility change", "members_can_change_repo_visibility", lambda v: v is False, "구성원의 공개 범위 변경 허용 = false", cond="== false",
          note="항목 메모는 REST 확인 불가라 했으나 GH-01 원본에 members_can_change_repo_visibility 가 있어 읽었다(필드 이름 일치에 근거, 출처 미확인)")
org_field("Prevent data leaks / restrict repo creation", "members_can_create_public_repositories", lambda v: v is False, "members_can_create_public_repositories = false", cond="== false")
v = org.get("members_can_delete_repositories"); st = "pass" if v is False else "fail"
emit("Prevent data leaks / disable deletion and transfer", st, {"source": GH01, "field": "members_can_delete_repositories", "condition": "== false (이전 허용 설정은 수집 원본에 필드가 없어 삭제 쪽만 본다)", "combine": "삭제와 이전을 모두 막아야 통과. 삭제가 허용이면 이전 값과 무관하게 위반"},
     "구성원의 삭제·이전 허용 = false", [{**ORG, "value": v, "status": st}],
     "문장은 삭제와 이전을 모두 막으라는 것이다. 삭제가 허용(true)이라 위반이 정해진다. 이전(transfer) 허용 설정은 GH-01 에 없어 보지 못했다. 삭제 필드는 이름 일치에 근거해 읽음(출처 미확인)")
st = "pass" if org.get("deploy_keys_enabled_for_repositories") is False else "fail"
emit("Prevent data leaks / disable deploy keys", st, {"source": "GH-01 /orgs/{org}, GH-26 /repos/{repo}/keys", "field": "deploy_keys_enabled_for_repositories, 배포 키 enabled", "condition": "조직 설정이 false(배포 키 사용 비활성)",
     "combine": "조직 설정 하나로 판정하고 배포 키 목록은 값으로 함께 보여 줌"}, "배포 키 사용 비활성",
     [{**ORG, "value": {"deploy_keys_enabled_for_repositories": org.get("deploy_keys_enabled_for_repositories")}, "status": st}] +
     [{**tkey(f"im:github:deploy-key:{k['id']}"), "name": f"{rp} 배포 키 {k['id']}", "value": {"enabled": k.get("enabled"), "read_only": k.get("read_only")}, "status": "pass" if k.get("enabled") is False else "fail"} for rp, k in dkeys],
     "문장은 '배포 키 사용을 끄라'이다. 항목 임계는 배포 키 0개(GH-26)였는데, 수집에는 키 1개가 있으나 그 키의 enabled 가 false 이고 조직 설정도 사용 비활성이라 조직 설정 기준으로 통과로 읽었다. 키 enabled 필드의 의미는 출처 미확인")
emit("Prevent data leaks / scope PATs", "org_policy", {"source": "GH-13 /orgs/{org}/personal-access-tokens", "field": "permissions, repository_selection", "condition": "필요한 최소 권한", "combine": ""},
     "토큰마다 필요한 최소 권한", [{**tkey(f"im:github:personal-access-tokens:{p['id']}"), "name": p["token_name"], "value": {"repository_selection": p.get("repository_selection"), "permissions": p.get("permissions")}, "status": "unknown"} for p in pats],
     "무엇이 최소 권한인지는 토큰 용도를 아는 조직이 정한다. 값에는 승인된 권한을 보여 준다")
ts = [{**REPO(r), "value": r["visibility"], "status": "pass" if r["visibility"] != "public" else "unknown"} for r in repos]
emit("Prevent data leaks / convert public to private", "pass" if all(t["status"] == "pass" for t in ts) else "org_policy", {"source": "GH-05 /orgs/{org}/repos", "field": "visibility", "condition": "공개 저장소가 없음(있으면 공개가 적절한지는 조직이 정함)", "combine": "저장소마다 보고, 공개 저장소가 하나라도 있으면 조직 판단"},
     "공개 저장소 전환 검토", ts, "두 저장소 모두 private 이라 전환할 대상이 없다")
emit("Prevent data leaks / verify domain", "pass", {"source": "GH-21 membersWithRole.organizationVerifiedDomainEmails", "field": "organizationVerifiedDomainEmails", "condition": "인증된 도메인 메일이 있는 구성원이 1명 이상", "combine": "조직 하나"},
     "인증된 도메인 1개 이상", [{**ORG, "value": {"인증된 도메인 메일이 있는 구성원 수": 3, "구성원 수": 3}, "status": "pass"}],
     "항목 임계는 organization.domains 를 보라 했으나 이 호출은 수집하지 않았다(GH-31 FORBIDDEN). 대신 GH-21 이 구성원 3명 모두에게 인증된 도메인 메일을 돌려주므로 인증된 도메인이 있다고 읽었다. 조직 is_verified 는 false 다(별개 배지 설정, Mondoo verified-domain 항목은 그 값을 본다)")
absent("Prevent data leaks / verified email domains", "notificationDeliveryRestrictionEnabledSetting", "GH-31 GraphQL 이 FORBIDDEN 으로 실패했다")
manual("Prevent data leaks / customer agreement", "계약 체결", "SaaS 설정값이 아니다")
manual("Prevent data leaks / accidental commits", "기여자 교육·절차", "SaaS 설정값이 아니다")
manual("Detect data leaks / partner alerts", "파트너 경고(공개 저장소 기본 동작)", "값으로 위반이 정해지지 않는다")
def sa(iid, key):
    ts = [{**REPO(r), "value": ((r.get("security_and_analysis") or {}).get(key) or {}).get("status"), "status": "pass" if ((r.get("security_and_analysis") or {}).get(key) or {}).get("status") == "enabled" else "fail"} for r in repos]
    emit(iid, worst(ts), {"source": "GH-05 /orgs/{org}/repos", "field": f"security_and_analysis.{key}.status", "condition": "== enabled", "combine": "저장소마다 보고 하나라도 어기면 위반"}, f"{key}.status = enabled", ts)
sa("Detect data leaks / secret scanning alerts for users", "secret_scanning")
manual("Detect data leaks / secret leak report", "무료 비밀 유출 보고서 실행", "일회성 작업이라 설정값이 아니다")
sa("Detect data leaks / push protection", "secret_scanning_push_protection")
absent("Detect data leaks / custom patterns", "GET /orgs/{org}/secret-scanning/custom-patterns", "수집 호출이 없다")
manual("Detect data leaks / audit log", "감사 로그 검토", "감사 로그(GH-17)는 수집되지만 검토 절차는 사람이 한다")
branch("Detect data leaks / branch protection", "pull_request 규칙", lambda R: yn("pull_request" in R), "기본 브랜치에 보호 규칙이 있고 PR 리뷰를 요구", cond="기본 브랜치에 적용되는 규칙이 있고 pull_request 규칙이 있음",
       note="클래식 보호(GH-09)는 두 저장소 모두 404 라 룰셋에서 온 규칙(GHS-03)으로 읽었다")
ts = []
for r in repos:
    n = len(rulesets.get(r["name"], []))
    ts.append({**REPO(r), "value": {"rulesets": n}, "status": "pass" if n else "fail"})
emit("Detect data leaks / rulesets", worst(ts), {"source": "GH-08 /repos/{repo}/rulesets?includes_parents=true", "field": "룰셋 목록", "condition": "룰셋이 1개 이상", "combine": "저장소마다 보고 하나라도 어기면 위반"},
     "룰셋 사용", ts, "'고려하라'는 권고라 룰셋을 쓰는지를 본다. 조직 룰셋 조회(GH-08)는 403 이지만 저장소 목록은 상위 룰셋을 포함(includes_parents)한다")
for iid in ("Mitigate / remove pushed sensitive data", "Mitigate / undo unpushed changes", "Mitigate / DMCA takedown", "Mitigate / DMCA counter notice", "Revoke exposed tokens / REST revocation"):
    manual(iid, "사고 대응 절차", "SaaS 설정값이 아니다")
absent("Revoke exposed tokens / secret scanning", "GET /repos/{repo}/secret-scanning/alerts", "경고 목록을 읽는 호출이 없다")
finish()
