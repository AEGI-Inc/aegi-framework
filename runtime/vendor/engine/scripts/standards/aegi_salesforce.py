"""AEGI 자체 점검: Salesforce 계정. 수집 원본만 읽는다. 사용: run_all.py 가 부른다(README.md)"""
import aegi_common as A

S = A.Standard("aegi_salesforce", "AEGI 자체 점검: Salesforce 계정", "salesforce")
users, now = A.salesforce_accounts()
okta, _ = A.okta_accounts()
gws, _ = A.gws_accounts()
if users is None:
    for iid in ("AEGI-SF-01", "AEGI-SF-02"):
        S.not_collected(iid, {"source": "SF-02 User", "field": "", "condition": "", "combine": ""}, "SF-02 사용자 원본이 수집에 없다")
else:
    A.inactive_item(S, "AEGI-SF-01", users, now, "SF-02 User")
    A.leftover_item(S, "AEGI-SF-02", users, [("Okta", okta), ("Google Workspace", gws)], "SF-02 User")
S.finish()
