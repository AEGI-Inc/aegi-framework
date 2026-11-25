"""AEGI 자체 점검(aegi_*.py) 시험. 합성 원본으로 장기 미로그인, IdP 정지 사용자의 남은 계정, 기기 상태, 미수집을 본다.
사용: python3 -m unittest scripts/standards/aegi_checks_test.py
"""
import json, os, subprocess, sys, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
NOW = "2026-11-10T09:00:00Z"


def write_json(path, value):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(value, f)


def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def envelope(prov, call, payload, params=None):
    return {"provider": prov, "call_id": call, "collected_at": NOW, "request_params": params or {}, "payload": payload}


class AegiChecksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.raw = os.path.join(self.tmp.name, "raw", "run1")
        self.out = os.path.join(self.tmp.name, "out")
        self.ds = os.path.join(self.tmp.name, "ds")
        for d in (self.out, self.ds):
            os.makedirs(d)
        write_json(os.path.join(self.ds, "objects.json"), [{"fixture_key": "im:okta:User:o1"}])

    def tearDown(self):
        self.tmp.cleanup()

    def put(self, prov, name, env):
        os.makedirs(os.path.join(self.raw, prov), exist_ok=True)
        write_json(os.path.join(self.raw, prov, name), env)

    def run_detector(self, slug):
        env = dict(os.environ, PYTHONIOENCODING="utf-8", AEGI_STD_RAW=self.raw, AEGI_STD_DATASET=self.ds, AEGI_STD_OUT=self.out)
        r = subprocess.run([sys.executable, os.path.join(HERE, slug + ".py")], cwd=HERE, env=env, capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(r.returncode, 0, r.stderr)
        return {i["item_id"]: i for i in read_json(os.path.join(self.out, slug + ".json"))["items"]}

    def users(self):
        self.put("gws", "GW-03-0001.json", envelope("gws", "GW-03", {"users": [
            {"id": "g1", "primaryEmail": "a@example.test", "suspended": True, "lastLoginTime": "2026-11-01T00:00:00.000Z", "creationTime": "2026-01-01T00:00:00.000Z"},
            {"id": "g2", "primaryEmail": "b@example.test", "suspended": False, "lastLoginTime": "1970-01-01T00:00:00.000Z", "creationTime": "2026-01-01T00:00:00.000Z"},
            {"id": "g3", "primaryEmail": "c@example.test", "suspended": False, "lastLoginTime": "2026-11-09T00:00:00.000Z", "creationTime": "2026-01-01T00:00:00.000Z"},
        ]}))
        self.put("okta", "OK-02-0001.json", envelope("okta", "OK-02", [
            {"id": "o1", "status": "ACTIVE", "lastLogin": "2026-11-08T00:00:00.000Z", "created": "2026-01-01T00:00:00.000Z", "profile": {"login": "a@example.test", "email": "a@example.test"}},
            {"id": "o2", "status": "SUSPENDED", "lastLogin": None, "created": "2026-01-01T00:00:00.000Z", "profile": {"login": "c@example.test", "email": "c@example.test"}},
            {"id": "o3", "status": "ACTIVE", "lastLogin": None, "created": "2026-11-01T00:00:00.000Z", "profile": {"login": "d@example.test", "email": "d@example.test"}},
        ]))

    def test_okta_inactive_and_leftover(self):
        self.users()
        items = self.run_detector("aegi_okta")
        # o1 은 최근 로그인, o3 은 로그인한 적 없지만 만든 지 9일이라 아직 기간 안. o2 는 정지라 보지 않음
        self.assertEqual(items["AEGI-OKTA-01"]["status"], "pass")
        # o1 은 GWS 에서 정지된 a@ 와 같은 이메일
        leftover = items["AEGI-OKTA-02"]
        self.assertEqual(leftover["status"], "fail")
        bad = [t for t in leftover["targets"] if t["status"] == "fail"]
        self.assertEqual([t["key"] for t in bad], ["im:okta:User:o1"])
        self.assertTrue(bad[0]["in_graph"])

    def test_gws_inactive_never_logged_in(self):
        self.users()
        items = self.run_detector("aegi_gws")
        inactive = items["AEGI-GWS-01"]
        self.assertEqual(inactive["status"], "fail")  # g2 는 로그인 기록 없이 만든 지 90일 넘음
        self.assertEqual({t["key"]: t["status"] for t in inactive["targets"]}, {"im:gws:User:g2": "fail", "im:gws:User:g3": "pass"})
        # g3 은 Okta 에서 정지된 c@ 와 같은 이메일
        self.assertEqual(items["AEGI-GWS-02"]["status"], "fail")
        # 기기 원본이 없으면 미수집
        for iid in ("AEGI-GWS-03", "AEGI-GWS-04", "AEGI-GWS-05"):
            self.assertEqual(items[iid]["status"], "not_collected")

    def test_gws_devices(self):
        self.users()
        self.put("gws", "RG-GW-cloudidentity.devices.list-0001.json", envelope("gws", "RG-GW", {"devices": [
            {"name": "devices/d1", "deviceType": "WINDOWS", "encryptionState": "ENCRYPTED"},
            {"name": "devices/d2", "deviceType": "ANDROID", "encryptionState": "NOT_ENCRYPTED"},
            {"name": "devices/d3", "deviceType": "WINDOWS"},
        ]}))
        self.put("gws", "RG-GW-cloudidentity.devices.deviceUsers.list-0001.json", envelope("gws", "RG-GW", {"deviceUsers": [
            {"name": "devices/d1/deviceUsers/u1", "userEmail": "c@example.test", "managementState": "APPROVED", "passwordState": "PASSWORD_SET"},
            {"name": "devices/d2/deviceUsers/u2", "userEmail": "c@example.test", "managementState": "PENDING_APPROVAL"},
        ]}, {"devicesId": "d1"}))
        items = self.run_detector("aegi_gws")
        self.assertEqual(items["AEGI-GWS-03"]["status"], "fail")
        self.assertEqual(sorted(t["status"] for t in items["AEGI-GWS-03"]["targets"]), ["fail", "fail", "pass"])
        d3 = next(t for t in items["AEGI-GWS-03"]["targets"] if t["key"].endswith("d3"))
        self.assertEqual(d3["value"], "관리 에이전트 없음(상태 확인 불가)")
        self.assertEqual(items["AEGI-GWS-04"]["status"], "fail")  # u2 는 비밀번호 상태 값 없음
        u2 = next(t for t in items["AEGI-GWS-04"]["targets"] if t["status"] == "fail")
        self.assertEqual(u2["value"], "관리 에이전트 없음(상태 확인 불가)")
        self.assertEqual(items["AEGI-GWS-05"]["status"], "fail")
        self.assertEqual(items["AEGI-GWS-05"]["targets"][0]["key"], "im:gws:GoogleAppsCloudidentityDevicesV1DeviceUser:d1|devices%2Fd1%2FdeviceUsers%2Fu1")

    def test_leftover_without_directories_is_not_collected(self):
        self.put("slack", "SL-02-0001.json", envelope("slack", "SL-02", {"members": [{"id": "S1", "deleted": False, "profile": {"email": "a@example.test"}}]}))
        items = self.run_detector("aegi_slack")
        self.assertEqual(items["AEGI-SL-01"]["status"], "not_collected")

    def test_salesforce_skips_system_users(self):
        self.users()
        self.put("salesforce", "SF-02-0001.json", envelope("salesforce", "SF-02", {"records": [
            {"Id": "s1", "Username": "a@example.test.sf", "Email": "a@example.test", "IsActive": True, "UserType": "Standard", "LastLoginDate": "2026-11-09T00:00:00.000+0000", "CreatedDate": "2026-01-01T00:00:00.000+0000"},
            {"Id": "s2", "Username": "auto@example.test", "Email": "auto@example.test", "IsActive": True, "UserType": "AutomatedProcess", "LastLoginDate": None, "CreatedDate": "2025-01-01T00:00:00.000+0000"},
        ]}))
        items = self.run_detector("aegi_salesforce")
        self.assertEqual([t["key"] for t in items["AEGI-SF-01"]["targets"]], ["im:salesforce:User:s1"])
        self.assertEqual(items["AEGI-SF-01"]["status"], "pass")
        self.assertEqual(items["AEGI-SF-02"]["status"], "fail")  # a@ 는 GWS 에서 정지


if __name__ == "__main__":
    unittest.main()
