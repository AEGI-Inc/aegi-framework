"""AEGI 자체 점검: Slack 계정. 수집 원본만 읽는다. 사용: run_all.py 가 부른다(README.md)
Slack 사용자 원본에는 마지막 로그인 시각이 없어 IdP 에서 정지된 사용자의 남은 계정만 본다.
"""
import aegi_common as A

S = A.Standard("aegi_slack", "AEGI 자체 점검: Slack 계정", "slack")
users, _ = A.slack_accounts()
okta, _ = A.okta_accounts()
gws, _ = A.gws_accounts()
if users is None:
    S.not_collected("AEGI-SL-01", {"source": "SL-02 users.list", "field": "", "condition": "", "combine": ""}, "SL-02 사용자 원본이 수집에 없다")
else:
    A.leftover_item(S, "AEGI-SL-01", users, [("Okta", okta), ("Google Workspace", gws)], "SL-02 users.list")
S.finish()
