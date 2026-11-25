"""CIS GitHub Benchmark 1.2.0 120개 항목을 기준 하나 단위로 판정한다. 수집 원본만 읽는다.
항목 문장과 Audit 절차는 Prowler 사본(CIS 원문은 로그인 필요)을 따른다. 기본 브랜치에 적용되는 규칙은 추가 설정 수집의
GHS-03(rules/branches/main, 룰셋에서 온 규칙)으로 본다. 클래식 브랜치 보호는 GH-09 가 404 라 없다.
사용: run_all.py 가 부른다(README.md)
"""
import std_paths as P
import json, glob, os, sys, collections, datetime

RAW, EXTRA, UNIQ, DS, OUT = P.RAW, P.EXTRA, P.UNIQ, P.DS, P.out("cis_github")
STD = "CIS GitHub Benchmark 1.2.0"
titles = json.load(open(P.TITLES, encoding="utf-8"))["cis_github"]  # Prowler compliance 파일의 요구사항 설명
fid = {s["id"]: f["finding_id"] for f in json.load(open(UNIQ, encoding="utf-8")) for s in f["sources"] if s["source"].startswith("CIS GitHub")}
keys = {o["fixture_key"] for o in json.load(open(os.path.join(DS, "objects.json"), encoding="utf-8"))}

def pages(root, call):
    for f in sorted(glob.glob(os.path.join(root, "github", f"{call}-*.json"))):
        e = json.load(open(f, encoding="utf-8")); yield e.get("request_params") or {}, e["payload"], e

org = next(p for _, p, _ in pages(RAW, "GH-01"))
repos = next(p for _, p, _ in pages(RAW, "GH-05"))
collected_at = next(e["collected_at"] for _, _, e in pages(RAW, "GH-05"))
rules = {rp["repo"]: p or [] for rp, p, _ in pages(EXTRA, "GHS-03") if rp.get("repo")}
actions = next(p for _, p, _ in pages(EXTRA, "GHS-01"))
workflow = next(p for _, p, _ in pages(EXTRA, "GHS-02"))
owners = [m for rp, p, _ in pages(RAW, "GH-02") if rp.get("role") == "admin" for m in p]
hooks = [h for _, p, _ in pages(RAW, "GH-15") for h in (p if isinstance(p, list) else [p]) if isinstance(h, dict) and "id" in h]
insts = [i for _, p, _ in pages(RAW, "GH-14") for i in (p if isinstance(p, list) else p.get("installations", []) if isinstance(p, dict) else []) if isinstance(i, dict) and "app_slug" in i]

def tkey(k): return {"key": k, "in_graph": k in keys}
ORG = {**tkey(f"im:github:organization-full:{org['id']}"), "name": org["login"]}
items = {}
def emit(iid, status, rule, threshold="", targets=(), note=""):
    """status: pass | fail | unknown(값은 있으나 판정 못 함) | not_collected(수집 없음) | org_policy(조직이 정한 값 필요) | manual(사람 검토)"""
    items[iid] = {"item_id": iid, "title": titles.get(iid, ""), "finding_id": fid.get(iid), "status": status,
                  "threshold": threshold, "rule": rule, "targets": list(targets), "note": note}
def worst(ts):
    order = {"fail": 3, "unknown": 2, "pass": 1}
    return max((t["status"] for t in ts), key=lambda s: order[s]) if ts else "unknown"
def org_field(iid, field, test, want, note=""):
    v = org.get(field); st = "unknown" if v is None else ("pass" if test(v) else "fail")
    emit(iid, st, {"source": "GH-01 /orgs/{org}", "field": field, "condition": want, "combine": "조직 하나"}, want, [{**ORG, "value": v, "status": st}], note)
def manual(iid, what, note=""): emit(iid, "manual", {"source": "없음", "field": what, "condition": "", "combine": ""}, note=note)
def absent(iid, what, note=""): emit(iid, "not_collected", {"source": "없음", "field": what, "condition": "", "combine": ""}, note=note or "수집 호출이 없다")

manual("1.1.1", "모든 코드를 버전 관리 플랫폼에서 관리", "SaaS 설정값이 아니다")
manual("1.1.2", "코드 변경을 작업 관리 시스템과 연결", "SaaS 설정값이 아니다")

# ---- 1.1 기본 브랜치 보호:저장소마다 기본 브랜치에 적용되는 규칙. 규칙이 하나도 없으면 CIS Audit 대로 위반 ----
def branch(iid, desc, test, want, note=""):
    ts = []
    for r in repos:
        rs = rules.get(r["name"])
        if rs is None: v, st = "수집 없음", "unknown"
        elif not rs: v, st = "규칙 없음", "fail"
        else:
            res = test({x["type"]: x.get("parameters") or {} for x in rs})
            v, st = res if isinstance(res, tuple) else (res, None)
            st = st or ("pass" if v else "fail")
            v = v if not isinstance(v, bool) else ("충족" if v else "미충족")
        ts.append({**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"], "value": v, "status": st})
    emit(iid, worst(ts), {"source": "GHS-03 /repos/{repo}/rules/branches/{기본 브랜치}", "field": desc, "condition": want, "combine": "저장소마다 보고 하나라도 어기면 위반. 규칙이 없으면 위반"}, want, ts, note)
pr = lambda R: R.get("pull_request") or {}
branch("1.1.3", "pull_request.required_approving_review_count", lambda R: ("pull_request" in R and pr(R).get("required_approving_review_count", 0) >= 2, None), ">= 2")
branch("1.1.4", "pull_request.dismiss_stale_reviews_on_push", lambda R: pr(R).get("dismiss_stale_reviews_on_push") is True, "== true")
branch("1.1.5", "pull_request.dismissal_restriction.enabled", lambda R: (pr(R).get("dismissal_restriction") or {}).get("enabled") is True, "== true",
       note="허용된 사람이 신뢰할 만한지는 조직이 정한다. 제한이 켜져 있는지만 본다")
absent("1.1.6", "CODEOWNERS 파일", "저장소 파일을 읽는 호출은 .github/workflows 만 있다")
branch("1.1.7", "pull_request.require_code_owner_review", lambda R: pr(R).get("require_code_owner_review") is True, "== true")
absent("1.1.8", "브랜치 목록과 마지막 커밋 시각")
branch("1.1.9", "required_status_checks 규칙", lambda R: "required_status_checks" in R, "규칙 있음")
branch("1.1.10", "required_status_checks.strict_required_status_checks_policy", lambda R: (R.get("required_status_checks") or {}).get("strict_required_status_checks_policy") is True, "== true")
branch("1.1.11", "pull_request.required_review_thread_resolution", lambda R: pr(R).get("required_review_thread_resolution") is True, "== true")
branch("1.1.12", "required_signatures 규칙", lambda R: "required_signatures" in R, "규칙 있음")
branch("1.1.13", "required_linear_history 규칙, pull_request.allowed_merge_methods", lambda R: "required_linear_history" in R or "merge" not in pr(R).get("allowed_merge_methods", ["merge"]),
       "선형 이력 규칙이 있거나 병합 커밋 방식이 빠짐")
branch("1.1.14", "룰셋 bypass_actors", lambda R: ("bypass 목록 미수집", "unknown"), "관리자도 규칙을 우회할 수 없음",
       note="룰셋 응답에 bypass_actors 가 없어(current_user_can_bypass 만 있음) 규칙이 있는 저장소는 판정하지 못한다")
branch("1.1.15", "푸시 제한", lambda R: ("룰셋의 푸시 제한 대응 규칙 미확인", "unknown"), "푸시·병합 가능한 사람 제한",
       note="CIS 는 클래식 보호의 'Restrict who can push' 를 본다. 룰셋에서 이에 맞는 규칙을 확인하지 못해 규칙이 있는 저장소는 판정하지 못한다")
branch("1.1.16", "non_fast_forward 규칙", lambda R: "non_fast_forward" in R, "규칙 있음(강제 푸시 차단)")
branch("1.1.17", "deletion 규칙", lambda R: "deletion" in R, "규칙 있음(삭제 차단)")
manual("1.1.18", "PR 위험 스캔 워크플로", "필수 상태 검사의 이름이 코드 스캐닝인지는 값으로 알 수 없다")
manual("1.1.19", "브랜치 보호 변경 감사", "감사 로그(GH-17)는 수집되지만 검토 절차는 사람이 한다")
branch("1.1.20", "기본 브랜치에 적용되는 규칙", lambda R: True, "규칙 1개 이상")

# ---- 1.2 저장소 관리 ----
absent("1.2.1", "SECURITY.md 파일")
org_field("1.2.2", "members_can_create_repositories", lambda v: v is False, "== false")
for iid, f in [("1.2.3", "members_can_delete_repositories"), ("1.2.4", "members_can_delete_issues")]:
    emit(iid, "manual", {"source": "GH-01 /orgs/{org}", "field": f, "condition": "켜져 있으면 저장소 관리자가, 꺼져 있으면 조직 소유자가 신뢰할 만한지 확인", "combine": ""},
         targets=[{**ORG, "value": org.get(f), "status": "unknown"}], note="CIS Audit 은 설정값으로 위반을 정하지 않고, 값에 따라 누구를 검토할지 정한다")
manual("1.2.5", "포크 추적")
manual("1.2.6", "공개 범위 변경 추적", "감사 로그(GH-17)는 수집되지만 추적 절차는 사람이 한다")
now = datetime.datetime.fromisoformat(collected_at.replace("Z", "+00:00"))
ts = []
for r in repos:
    days = (now - datetime.datetime.fromisoformat(r["pushed_at"].replace("Z", "+00:00"))).days
    st = "pass" if r.get("archived") or days <= 90 else ("fail" if days > 180 else "unknown")
    ts.append({**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"], "value": {"pushed_days_ago": days, "archived": r.get("archived")}, "status": st})
emit("1.2.7", worst(ts), {"source": "GH-05 /orgs/{org}/repos", "field": "pushed_at, archived", "condition": "최근 3~6개월 안에 활동했거나 보관됨", "combine": "90일 안이면 통과, 180일 넘으면 위반, 그 사이는 판정 못 함"},
     "3~6개월", ts, note=f"기준 시각은 수집 시각 {collected_at}")

# ---- 1.3 접근 관리 ----
absent("1.3.1", "휴면 사용자 보고서", "Enterprise 의 Dormant Users 보고서를 수집하지 않는다")
org_field("1.3.2", "members_can_create_teams", lambda v: v is False, "== false")
emit("1.3.3", "org_policy", {"source": "GH-02 /orgs/{org}/members?role=admin", "field": "소유자 수", "condition": "최소 인원", "combine": ""},
     targets=[{**tkey(f"im:github:simple-user:{m['id']}"), "name": m["login"], "value": "owner", "status": "unknown"} for m in owners], note=f"소유자 {len(owners)}명. CIS 는 숫자를 정하지 않았다")
gh35_2fa_pages = [(rp, pl) for rp, pl, _ in pages(RAW, "GH-35") if rp.get("filter") == "2fa_disabled" and isinstance(pl, list)]
if gh35_2fa_pages:
    bad_ext = [u for _, pl in gh35_2fa_pages for u in pl if isinstance(u, dict)]
    st_ext = "fail" if bad_ext else "pass"
    emit("1.3.4", st_ext, {"source": "GH-35 /orgs/{org}/outside_collaborators?filter=2fa_disabled", "field": "2fa_disabled 목록", "condition": "0명", "combine": "외부 협력자 중 2FA 미사용자가 1명이라도 있으면 위반"},
         "2FA 비활성 외부 협력자 0명",
         [{**tkey(f"im:github:simple-user:{u['id']}"), "name": u.get("login", ""), "value": "2fa_disabled", "status": "fail"} for u in bad_ext],
         f"2FA 비활성 외부 협력자 {len(bad_ext)}명")
else:
    absent("1.3.4", "외부 협력자의 2FA", "GH-35(outside_collaborators?filter=2fa_disabled) 수집 호출이 없다")
org_field("1.3.5", "two_factor_requirement_enabled", lambda v: v is True, "== true")
emit("1.3.6", "org_policy", {"source": "GH-29 초대 목록", "field": "초대 메일 도메인", "condition": "회사가 승인한 도메인", "combine": ""}, note="승인 도메인 목록은 조직이 정한다")
ghs04_pages = list(pages(RAW, "GHS-04")) or list(pages(EXTRA, "GHS-04"))
if ghs04_pages:
    ghs04_by_repo = collections.defaultdict(list)
    for rp, pl, _ in ghs04_pages:
        if rp.get("repo") and isinstance(pl, list):
            ghs04_by_repo[rp["repo"]].extend(c for c in pl if isinstance(c, dict))
    ts = []
    for r in repos:
        if r["name"] not in ghs04_by_repo:
            ts.append({**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"], "value": "수집 없음", "status": "unknown"})
        else:
            admins = sum(1 for c in ghs04_by_repo[r["name"]] if (c.get("permissions") or {}).get("admin") is True)
            st = "pass" if admins >= 2 else "fail"
            ts.append({**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"], "value": {"admin_count": admins}, "status": st})
    emit("1.3.7", worst(ts), {"source": "GHS-04 /repos/{org}/{repo}/collaborators?affiliation=all", "field": "permissions.admin", "condition": "저장소마다 관리자 2명 이상", "combine": "저장소마다 보고 하나라도 2명 미만이면 위반"}, "2명 이상", ts,
         note="상속된 관리자 포함 전체 협업자(affiliation=all)의 permissions.admin 수로 판정")
else:
    emit("1.3.7", "unknown", {"source": "GH-06 collaborators(affiliation=direct)", "field": "permissions.admin", "condition": "저장소마다 관리자 2명", "combine": ""}, "2명",
         note="협력자를 direct 만 수집해 조직 소유자처럼 상속받은 관리자가 빠진다")
org_field("1.3.8", "default_repository_permission", lambda v: v in ("read", "none"), "read 또는 none")
org_field("1.3.9", "is_verified", lambda v: v is True, "== true")
absent("1.3.10", "알림 이메일 도메인 제한")
absent("1.3.11", "SSH 인증기관")
absent("1.3.12", "IP 허용 목록")
manual("1.3.13", "코드 이상 징후 추적")

# ---- 1.4 서드파티 ----
absent("1.4.1", "OAuth 앱 접근 제한", "GitHub App 은 기본으로 소유자만 설치한다(CIS Audit). OAuth 앱 제한 설정은 수집하지 않는다")
absent("1.4.2", "앱 마지막 사용 시각", "GH-14 설치 정보에 마지막 사용 시각이 없다")
emit("1.4.3", "manual", {"source": "GH-14 installations", "field": "permissions, repository_selection", "condition": "필요한 최소 권한", "combine": ""},
     targets=[{**tkey(f"im:github:installation:{i['id']}"), "name": i["app_slug"], "value": {"repos": i.get("repository_selection"), "write": sorted(k for k, v in (i.get("permissions") or {}).items() if v in ("write", "admin"))}, "status": "unknown"} for i in insts],
     note="최소 권한인지는 앱 용도를 보고 사람이 정한다. 값에는 쓰기 권한 목록만 적었다")
hk = []
for h in hooks:
    cfg = h.get("config") or {}
    u = cfg.get("url")
    scheme = u.get("scheme") if isinstance(u, dict) else None
    insecure = cfg.get("insecure_ssl")
    if insecure == "1" or (scheme is not None and scheme != "https"):
        st = "fail"
    elif scheme == "https" and insecure == "0":
        st = "pass"
    else:
        st = "unknown"
    hk.append({**tkey(f"im:github:org-hook:{h['id']}"), "name": f"hook {h['id']}", "value": {"scheme": scheme, "insecure_ssl": insecure}, "status": st})
hook_note = "수집 원본에 url 스킴이 없어 https 여부를 알 수 없다" if (not hk or any(t["value"]["scheme"] is None for t in hk)) else f"웹훅 {len(hk)}개 확인"
for iid in ("1.4.4", "2.1.10", "4.3.4"):
    emit(iid, worst(hk), {"source": "GH-15 hooks", "field": "config.url 스킴, config.insecure_ssl", "condition": "https 이고 SSL 검증 켜짐", "combine": "웹훅 하나라도 어기면 위반"},
         "https", hk, note=hook_note)

# ---- 1.5 코드 위험 ----
def sa(iid, key, want="enabled"):
    ts = [{**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"], "value": ((r.get("security_and_analysis") or {}).get(key) or {}).get("status"),
           "status": "pass" if ((r.get("security_and_analysis") or {}).get(key) or {}).get("status") == want else "fail"} for r in repos]
    emit(iid, worst(ts), {"source": "GH-05 /orgs/{org}/repos", "field": f"security_and_analysis.{key}.status", "condition": f"== {want}", "combine": "저장소마다 보고 하나라도 어기면 위반"}, want, ts)
for iid in ("1.5.1", "2.3.8", "5.1.3"): sa(iid, "secret_scanning")
manual("1.5.2", "CI 지시문 스캔 도구"); manual("1.5.3", "IaC 스캔 도구")
ghs05_pages = list(pages(RAW, "GHS-05")) or list(pages(EXTRA, "GHS-05"))
if ghs05_pages:
    ghs05_by_repo = {rp["repo"]: pl for rp, pl, _ in ghs05_pages if rp.get("repo") and isinstance(pl, dict)}
    ts = []
    for r in repos:
        cs_val = ((r.get("security_and_analysis") or {}).get("code_security") or {}).get("status")
        if r["name"] in ghs05_by_repo:
            state = ghs05_by_repo[r["name"]].get("state")
            st = "pass" if state == "configured" else ("fail" if state == "not-configured" else "unknown")
            ts.append({**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"], "value": {"default_setup_state": state, "code_security": cs_val}, "status": st})
        else:
            ts.append({**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"], "value": {"default_setup_state": None, "code_security": cs_val}, "status": "unknown"})
    emit("1.5.4", worst(ts), {"source": "GHS-05 /repos/{org}/{repo}/code-scanning/default-setup, GH-05 code_security", "field": "state, security_and_analysis.code_security.status", "condition": "state == configured", "combine": "저장소마다 보고 하나라도 not-configured 면 위반, 403·미수집은 판정 불가"}, "configured", ts,
         note="일부 저장소는 GHS-05 원본이 없거나 403 권한 부족으로 판정하지 못한다" if any(t["status"] == "unknown" for t in ts) else f"저장소 {len(ts)}개 코드 스캐닝 기본 설정 확인")
else:
    emit("1.5.4", "unknown", {"source": "GH-05", "field": "security_and_analysis.code_security, 코드 스캐닝 기본 설정", "condition": "코드 스캐닝 켜짐 또는 스캔 워크플로 있음", "combine": ""},
         note="code_security 는 두 저장소 모두 disabled 다. 코드 스캐닝 기본 설정(code-scanning/default-setup)과 워크플로 내용은 수집하지 않아 판정하지 못한다")
for iid in ("1.5.5", "3.2.2"): absent(iid, "Dependabot 알림(vulnerability-alerts) 상태", "GH-05 에는 dependabot_security_updates 만 있다")
manual("1.5.6", "라이선스 스캔 도구")

# ---- 2 빌드 파이프라인 ----
for iid in ("2.1.1", "2.1.2", "2.1.3", "2.1.4", "2.1.6", "2.1.8", "2.1.9", "2.2.1", "2.2.2", "2.2.3", "2.2.4", "2.2.5", "2.2.6", "2.2.7", "2.2.8",
            "2.3.1", "2.3.2", "2.3.3", "2.3.4", "2.3.6", "2.3.7", "2.4.1", "2.4.2", "2.4.3", "2.4.4", "2.4.5", "2.4.6"):
    manual(iid, "빌드 파이프라인 운영", "SaaS 설정값이 아니다")
emit("2.1.5", "org_policy", {"source": "GHS-01 /orgs/{org}/actions/permissions", "field": "enabled_repositories, allowed_actions", "condition": "알려진·승인된 사용자만 빌드 환경 접근", "combine": ""},
     targets=[{**ORG, "value": actions, "status": "unknown"}], note="누가 승인된 사용자인지는 조직이 정한다")
manual("2.1.7", "빌드 시크릿 저장 방식")
emit("2.1.11", "org_policy", {"source": "GH-02 role=admin", "field": "소유자 수", "condition": "최소 인원", "combine": ""}, note=f"소유자 {len(owners)}명")
emit("2.3.5", "org_policy", {"source": "GHS-01, GHS-02", "field": "enabled_repositories, can_approve_pull_request_reviews", "condition": "필요한 사람만 파이프라인 실행", "combine": ""},
     targets=[{**ORG, "value": {**actions, **workflow}, "status": "unknown"}])

# ---- 3 의존성, 4 산출물, 5 배포 ----
for iid in ("3.1.1", "3.1.2", "3.1.3", "3.1.4", "3.1.5", "3.1.6", "3.1.7", "3.1.8", "3.2.1", "3.2.3", "3.2.4", "4.1.1", "4.1.2", "4.1.3", "4.2.1",
            "4.3.1", "4.3.2", "4.4.1", "5.1.1", "5.1.2", "5.1.5", "5.1.6", "5.1.7", "5.2.1", "5.2.2", "5.2.4"):
    manual(iid, "의존성·산출물·배포 운영", "SaaS 설정값이 아니다")
manual("4.3.3", "패키지 설정 변경 감사", "감사 로그(GH-17)는 수집되지만 검토 절차는 사람이 한다")
gh33_pages = [(rp, pl) for rp, pl, _ in pages(RAW, "GH-33") if isinstance(pl, list)]
if gh33_pages:
    pkgs = [p for _, pl in gh33_pages for p in pl if isinstance(p, dict)]
    if not pkgs:
        emit("4.2.2", "pass", {"source": "GH-33 /orgs/{org}/packages", "field": "패키지 목록", "condition": "패키지 업로드 권한자를 최소 신뢰 사용자로 제한", "combine": "조직 패키지가 0개면 업로드 권한 대상이 없다"},
             "최소 신뢰 사용자", [], "GH-33 packages 수집 결과 조직 패키지가 0개다(업로드 권한 대상 패키지 없음)")
    else:
        emit("4.2.2", "org_policy", {"source": "GH-33 /orgs/{org}/packages", "field": "name, package_type, visibility", "condition": "최소 신뢰 사용자만 업로드 권한 보유", "combine": ""},
             "최소 신뢰 사용자",
             [{**tkey(f"im:github:package:{p['id']}"), "name": p.get("name", ""), "value": {"package_type": p.get("package_type"), "visibility": p.get("visibility")}, "status": "unknown"} for p in pkgs],
             "패키지 목록(GH-33)은 수집됐으나 패키지별 업로드 권한자 목록은 이 API 에 없고 최소 신뢰 사용자 기준은 조직이 정한다")
else:
    absent("4.2.2", "패키지 업로드 권한", "GH-33 packages 호출이 없다")
org_field("4.2.3", "two_factor_requirement_enabled", lambda v: v is True, "== true")
absent("4.2.4", "SAML SSO", "GH-21 GraphQL 은 samlIdentityProvider 를 조회하지 않는다")
emit("4.2.5", "pass" if repos and all(r["visibility"] == "private" for r in repos) else "org_policy", {"source": "GH-05", "field": "visibility", "condition": "접근 통제가 필요한 저장소는 비공개", "combine": ""},
     targets=[{**tkey(f"im:github:Repository:{r['id']}"), "name": r["name"], "value": r["visibility"], "status": "pass" if r["visibility"] == "private" else "unknown"} for r in repos], note="비공개 저장소는 충족. 공개, internal 저장소가 접근 통제가 필요한지는 조직이 정한다")
absent("4.2.6", "패키지 레지스트리 관리자")
emit("5.1.4", "org_policy", {"source": "GH-06 collaborators", "field": "permissions, role_name", "condition": "신뢰할 만한 사람만 배포 설정 접근", "combine": ""})
emit("5.2.3", "org_policy", {"source": "GH-24 environments", "field": "환경 보호 규칙", "condition": "운영 환경은 소수의 신뢰할 만한 사람만", "combine": ""}, note="환경이 0개다")

out = {"standard": STD, "tier": 1, "provider": "github", "raw_run": os.path.basename(RAW.rstrip("\\/")), "items": [items[k] for k in titles if k in items]}
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(items), "items", dict(collections.Counter(i["status"] for i in items.values())), "누락:", sorted(set(titles) - set(items)))
for i in out["items"]:
    if i["status"] in ("pass", "fail", "unknown"):
        print(f"{i['item_id']:8} {i['status']:8} " + "; ".join(f"{t['name']}={json.dumps(t['value'], ensure_ascii=False)}" for t in i["targets"])[:110])
print("그래프에 없는 대상 키:", sorted({t["key"] for i in items.values() for t in i["targets"] if not t["in_graph"]}))
