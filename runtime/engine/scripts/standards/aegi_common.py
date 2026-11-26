"""AEGI 자체 점검(계정 수명주기, 기기)이 같이 쓰는 원본 읽기와 결과 만들기.
공개 기준에 데이터로 판정하는 항목이 없는 부분(장기 미로그인, IdP 에서 정지된 사용자의 남은 계정, 기기 상태)을 수집 원본으로 판정한다.
기준 정의는 defs/ 의 다른 기준과 같은 파일에 source_tier 3 으로 둔다. 사용: aegi_*.py 가 부른다(README.md)
"""
import std_paths as P
import collections, datetime, glob, json, os, urllib.parse

INACTIVE_DAYS = int(os.environ.get("AEGI_STD_INACTIVE_DAYS") or 90)
Q = lambda s: urllib.parse.quote(s, safe="")
_keys = None


def in_graph(key):
    global _keys
    if _keys is None:
        _keys = {o["fixture_key"] for o in json.load(open(P.OBJ, encoding="utf-8"))}
    return key in _keys


def load(prov, call, raw=None):
    """수집 원본 봉투 목록. 파일이 없으면 None(미수집)"""
    files = sorted(glob.glob(os.path.join(raw or P.RAW, prov, f"{call}-*.json")))
    if not files:
        return None
    return [json.load(open(f, encoding="utf-8")) for f in files]


def collected_at(envs):
    """판정 기준 시각. 원본 수집 시각(가장 늦은 것)이라 같은 원본이면 언제 돌려도 같다"""
    return max(parse_time(e.get("collected_at")) for e in envs)


def parse_time(v):
    if not v:
        return None
    s = str(v).replace("Z", "+00:00")
    if len(s) > 5 and s[-5] in "+-" and s[-3] != ":":  # Salesforce 2026-11-04T17:13:08.000+0000
        s = s[:-2] + ":" + s[-2:]
    try:
        t = datetime.datetime.fromisoformat(s)
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=datetime.timezone.utc)
    return None if t.year < 1980 else t  # GWS 는 로그인한 적 없으면 1970-01-01 을 준다


def emails(*values):
    return {str(v).strip().lower() for v in values if v and "@" in str(v)}


# ---- 계정 원본. 사람 계정만 돌려준다: (key, 이름, 활성 여부, 마지막 로그인, 만든 시각, 이메일 집합) ----
Account = collections.namedtuple("Account", "key name active last_login created emails")


def gws_accounts():
    envs = load("gws", "GW-03")
    if envs is None:
        return None, None
    out = []
    for e in envs:
        for u in (e["payload"] or {}).get("users", []):
            mails = emails(u.get("primaryEmail"), *[x.get("address") for x in u.get("emails", []) if isinstance(x, dict)])
            out.append(Account(f"im:gws:User:{u['id']}", u.get("primaryEmail") or u["id"], not (u.get("suspended") or u.get("archived")),
                               parse_time(u.get("lastLoginTime")), parse_time(u.get("creationTime")), mails))
    return out, collected_at(envs)


def okta_accounts():
    envs = load("okta", "OK-02")
    if envs is None:
        return None, None
    out = []
    for e in envs:
        rows = e["payload"] if isinstance(e["payload"], list) else list((e["payload"] or {}).values())
        for u in rows:
            p = u.get("profile") or {}
            out.append(Account(f"im:okta:User:{u['id']}", p.get("login") or u["id"], u.get("status") not in ("SUSPENDED", "DEPROVISIONED"),
                               parse_time(u.get("lastLogin")), parse_time(u.get("created")), emails(p.get("email"), p.get("login"))))
    return out, collected_at(envs)


SF_HUMAN = {"Standard", "PowerPartner", "PowerCustomerSuccess", "CustomerSuccess", "CspLitePortal"}


def salesforce_accounts():
    envs = load("salesforce", "SF-02")
    if envs is None:
        return None, None
    out = []
    for e in envs:
        for u in (e["payload"] or {}).get("records", []):
            if u.get("UserType") not in SF_HUMAN:  # 자동 처리, 통합 사용자 같은 시스템 계정 제외
                continue
            out.append(Account(f"im:salesforce:User:{u['Id']}", u.get("Username") or u["Id"], bool(u.get("IsActive")),
                               parse_time(u.get("LastLoginDate")), parse_time(u.get("CreatedDate")), emails(u.get("Email"))))
    return out, collected_at(envs)


def slack_accounts():
    envs = load("slack", "SL-02")
    if envs is None:
        return None, None
    out = []
    for e in envs:
        for u in (e["payload"] or {}).get("members", []):
            if u.get("is_bot") or u.get("id") == "USLACKBOT":
                continue
            p = u.get("profile") or {}
            out.append(Account(f"im:slack:200.members[*]:{u['id']}", u.get("real_name") or u.get("name") or u["id"], not u.get("deleted"),
                               None, None, emails(p.get("email"))))
    return out, collected_at(envs)


# ---- 결과 만들기(다른 기준 스크립트와 같은 모양) ----
class Standard:
    def __init__(self, slug, std, provider):
        self.slug, self.std, self.provider = slug, std, provider
        self.items = [i for i in json.load(open(P.ITEMS, encoding="utf-8")) if i["source"] == std]
        if not self.items:
            raise SystemExit(f"defs/standards_items_all.json 에 {std} 항목이 없다")
        self.fid = {s["id"]: f["finding_id"] for f in json.load(open(P.UNIQ, encoding="utf-8")) for s in f["sources"] if s["source"] == std}
        self.results = {}

    def emit(self, iid, status, rule, threshold="", targets=(), note=""):
        item = next(i for i in self.items if i["id"] == iid)
        self.results[iid] = {"item_id": iid, "title": item["title"], "finding_id": self.fid.get(iid), "status": status,
                             "threshold": threshold, "rule": rule, "targets": list(targets), "note": note}

    def not_collected(self, iid, rule, note):
        self.emit(iid, "not_collected", rule, note=note)

    def finish(self):
        ids = [i["id"] for i in self.items]
        missing = [i for i in ids if i not in self.results]
        if missing:
            raise SystemExit(f"{self.slug}: 판정하지 않은 항목 {missing}")
        out = {"standard": self.std, "tier": self.items[0]["source_tier"], "provider": self.provider, "raw_run": os.path.basename(P.RAW.rstrip("\\/")),
               "items": [self.results[i] for i in ids]}
        json.dump(out, open(P.out(self.slug), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print(self.slug, len(ids), "items", dict(collections.Counter(r["status"] for r in self.results.values())))


def target(key, name, value, status):
    return {"key": key, "in_graph": in_graph(key), "name": name, "value": value, "status": status}


def worst(targets):
    order = {"fail": 3, "unknown": 2, "pass": 1}
    return max((t["status"] for t in targets), key=lambda s: order[s]) if targets else "pass"


def inactive_item(std, iid, accounts, now, source):
    """활성 사람 계정 가운데 마지막 로그인(로그인한 적 없으면 만든 시각)이 INACTIVE_DAYS 일보다 오래된 계정"""
    rule = {"source": source, "field": "마지막 로그인 시각(없으면 만든 시각)", "condition": f"활성 계정은 {INACTIVE_DAYS}일 안에 로그인",
            "combine": "활성 사람 계정마다 판정, 하나라도 넘으면 위반"}
    limit = now - datetime.timedelta(days=INACTIVE_DAYS)
    ts = []
    for a in accounts:
        if not a.active:
            continue
        seen = a.last_login or a.created
        if seen is None:
            ts.append(target(a.key, a.name, "로그인과 생성 시각 없음", "unknown"))
            continue
        ts.append(target(a.key, a.name, seen.date().isoformat() + ("" if a.last_login else " 생성, 로그인 기록 없음"), "fail" if seen < limit else "pass"))
    std.emit(iid, worst(ts), rule, f"{INACTIVE_DAYS}일", ts, f"기준 시각은 원본 수집 시각 {now.date().isoformat()}. 기간은 AEGI_STD_INACTIVE_DAYS 로 바꾼다")


def leftover_item(std, iid, accounts, directories, source):
    """IdP(디렉터리)에서 정지된 사용자와 같은 이메일을 쓰는 활성 계정. directories 는 [(이름, 계정 목록 또는 None)]"""
    names = [n for n, _ in directories]
    rule = {"source": source + ", " + ", ".join(f"{n} 사용자 상태" for n in names), "field": "이메일, 활성 여부",
            "condition": f"{', '.join(names)} 에서 정지된 사용자의 이메일로 활성 계정 없음", "combine": "같은 이메일(소문자)로 잇고 활성 계정마다 판정"}
    have = [(n, accs) for n, accs in directories if accs is not None]
    if not have:
        std.not_collected(iid, rule, f"{', '.join(names)} 사용자 원본이 수집에 없다")
        return
    disabled = {}
    for n, accs in have:
        for a in accs:
            if not a.active:
                for m in a.emails:
                    disabled.setdefault(m, n)
    ts = []
    for a in accounts:
        if not a.active or not a.emails:
            continue
        hit = sorted({disabled[m] for m in a.emails if m in disabled})
        ts.append(target(a.key, a.name, f"{', '.join(hit)} 에서 정지됨" if hit else "정지된 디렉터리 사용자 아님", "fail" if hit else "pass"))
    note = "이메일이 없는 계정은 잇지 못해 보지 않았다."
    if len(have) < len(directories):
        note += f" 수집에 없는 디렉터리: {', '.join(n for n, accs in directories if accs is None)}."
    std.emit(iid, worst(ts), rule, "정지된 사용자의 활성 계정 없음", ts, note)
