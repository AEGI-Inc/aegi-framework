"""AEGI 자체 점검: Okta 계정. 수집 원본만 읽는다. 사용: run_all.py 가 부른다(README.md)"""
import aegi_common as A

S = A.Standard("aegi_okta", "AEGI 자체 점검: Okta 계정", "okta")
users, now = A.okta_accounts()
gws, _ = A.gws_accounts()
if users is None:
    for iid in ("AEGI-OKTA-01", "AEGI-OKTA-02"):
        S.not_collected(iid, {"source": "OK-02 users", "field": "", "condition": "", "combine": ""}, "OK-02 사용자 원본이 수집에 없다")
else:
    A.inactive_item(S, "AEGI-OKTA-01", users, now, "OK-02 users")
    A.leftover_item(S, "AEGI-OKTA-02", users, [("Google Workspace", gws)], "OK-02 users")
S.finish()
