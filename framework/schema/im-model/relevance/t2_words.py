# -*- coding: utf-8 -*-
"""T2 보안 속성 사전, 낱말 단위판 (2026-11-01).
필드 이름을 낱말로 나눈 뒤(camelCase, snake_case, 점, 숫자 경계) 낱말 하나 또는 이어진 낱말 묶음이 사전과 같을 때만 맞는다.
옛 판(relevance.py SEC 정규식)은 부분 문자열로 맞춰 TimeZone 의 zone, FormFactor 의 factor, Associated 의 sso 같은 우연을 냈다.
사전 항목은 옛 정규식의 개념을 그대로 옮겼고, 뜻이 넓은 낱말(zone, factor, external, share)은 묶음으로만 받는다."""
import re

# 낱말 하나로 충분한 것 (복수형은 아래 norm 에서 줄인다)
WORDS = {
    # 권한, 역할
    "permission", "perm", "privilege", "role", "grant", "grantee", "owner", "admin", "administrator", "superuser",
    # 공유, 노출
    "sharing", "visibility", "guest",
    # 인증
    "mfa", "2fa", "2sv", "authenticator", "password", "passwd", "sso", "saml", "oidc", "oauth", "oauth2",
    # 비밀, 키
    "secret", "credential", "certificate", "cert", "signing", "kid", "jwk", "jwks",
    # 네트워크, 신뢰
    "gateway", "proxy", "trusted", "untrusted", "trust", "allowlist", "whitelist", "blocklist", "denylist",
    # 세션, 수명
    "expire", "expired", "expiry", "expiration", "expires", "lockout",
    # 암호화, 외부 연결
    "encrypt", "encrypted", "encryption", "webhook",
    # 위임, 대리
    "delegate", "delegated", "delegation", "impersonate", "impersonation", "impersonated",
    # 동의, 위험
    "consent", "threat", "risk",
    # 2026-11-01 추가: 보안 설정 묶음, 프로비저닝, 토큰 클레임
    "security", "policy", "provisioning", "behavior", "claim",
}

# 이어진 낱말 묶음으로만 받는 것
PHRASES = {
    ("is", "admin"), ("admin", "role"), ("access", "level"), ("access", "token"), ("refresh", "token"), ("api", "key"),
    ("private", "key"), ("public", "key"), ("ip", "range"), ("ip", "address"), ("ip", "allowlist"), ("ip", "whitelist"),
    ("ip", "allow"), ("ip", "white"), ("network", "zone"), ("ip", "zone"), ("exclude", "zone"), ("include", "zone"),
    ("excluded", "zone"), ("included", "zone"), ("allow", "list"), ("white", "list"),
    ("block", "list"), ("deny", "list"), ("session", "timeout"), ("session", "lifetime"), ("session", "max"),
    ("run", "as"), ("redirect", "uri"), ("redirect", "url"), ("callback", "url"), ("factor", "type"),
    ("factor", "id"), ("factor", "status"), ("two", "factor"), ("multi", "factor"), ("second", "factor"),
    ("external", "sharing"), ("external", "share"), ("share", "type"), ("share", "with"), ("shared", "with"),
    ("sharing", "model"), ("default", "sharing"),
    ("send", "as"), ("resource", "set"),
}

_SPLIT1 = re.compile(r"([a-z0-9])([A-Z])")
_SPLIT2 = re.compile(r"([A-Z]+)([A-Z][a-z])")


def words(name):
    s = _SPLIT2.sub(r"\1_\2", _SPLIT1.sub(r"\1_\2", name))
    return [w for w in re.split(r"[^A-Za-z0-9]+", s.lower()) if w]


def norm(w):
    # 복수형만 줄인다 (permissions -> permission, privileges -> privilege, roles -> role)
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def hits(name):
    """맞은 사전 항목 목록. 비면 보안 속성이 아니다."""
    ws = [norm(w) for w in words(name)]
    raw = words(name)
    found = []
    for i, w in enumerate(ws):
        if w in WORDS or raw[i] in WORDS:
            found.append(raw[i])
        if i + 1 < len(ws):
            pair = (w, ws[i + 1])
            pair_raw = (raw[i], raw[i + 1])
            if pair in PHRASES or pair_raw in PHRASES:
                found.append(" ".join(pair_raw))
    return found
