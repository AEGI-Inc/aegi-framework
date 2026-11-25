"""공식 기준(표준기관·정부, SaaS 벤더 공식)별 판정 스크립트를 모두 돌리고 standard_results.json 으로 묶는다.
사용: python scripts/standards/run_all.py --raw <collected/raw/<run>> --dataset <데이터셋 폴더> [--settings-raw <설정 수집 run>] [--out <출력 폴더>]
"""
import argparse, glob, json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {"run_all", "run_all_test", "std_paths", "gws_common", "build_standard_results", "build_standard_results_test", "aegi_common", "aegi_checks_test", "build_compliance_verdicts", "build_compliance_verdicts_test", "remediations_test", "relink_findings", "relink_findings_test"}
PROVIDERS = {
    "aegi_gws": "gws",
    "aegi_okta": "okta",
    "aegi_salesforce": "salesforce",
    "aegi_slack": "slack",
    "atlassian_support": "atlassian",
    "cis_github": "github",
    "cis_gws": "gws",
    "github_docs_data_leaks": "github",
    "gsa_cio_it_11_62": "salesforce",
    "gws_checklist_medium_large": "gws",
    "gws_checklist_small": "gws",
    "gws_checklists_both": "gws",
    "gws_security_health": "gws",
    "okta_healthinsight": "okta",
    "okta_stig": "okta",
    "scuba_gws": "gws",
    "sf_healthcheck": "salesforce",
    "slack_help": "slack",
}
SETTINGS_RAW_DETECTORS = {"sf_healthcheck"}


def has_provider_raw(raw, provider):
    """판정기별 원본이 하나라도 있을 때만 판정기를 실행한다."""
    return bool(glob.glob(os.path.join(raw, provider, "*.json")))


def write_not_applicable(out_dir, slug, provider, raw):
    """수집하지 않은 SaaS는 실패가 아닌 빈 판정 결과로 남긴다."""
    result = {
        "detector": slug,
        "provider": provider,
        "raw_run": os.path.basename(raw.rstrip("\\/")),
        "not_applicable": True,
        "items": [],
    }
    with open(os.path.join(out_dir, slug + ".json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)

a = argparse.ArgumentParser()
a.add_argument("--raw", required=True, help="수집 원본 run 폴더")
a.add_argument("--dataset", required=True, help="정규화 데이터셋 폴더(objects.json)")
a.add_argument("--settings-raw", help="추가 설정 수집 run 폴더(GHS-01~03, SFS-01)")
a.add_argument("--knowledge", help="catalog-mapping 폴더(컴플라이언스 판정 계산)")
a.add_argument("--out", default=os.path.join(HERE, "out"))
args = a.parse_args()
os.makedirs(args.out, exist_ok=True)
env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1",
           AEGI_STD_RAW=os.path.abspath(args.raw), AEGI_STD_DATASET=os.path.abspath(args.dataset), AEGI_STD_OUT=os.path.abspath(args.out))
if args.settings_raw: env["AEGI_STD_SETTINGS_RAW"] = os.path.abspath(args.settings_raw)

slugs = sorted(os.path.basename(f)[:-3] for f in glob.glob(os.path.join(HERE, "*.py")) if os.path.basename(f)[:-3] not in SKIP)
failed, successful = [], []
for s in slugs:
    provider = PROVIDERS.get(s)
    if not provider:
        raise SystemExit(f"{s}의 SaaS 제공자 정의가 없다")
    detector_raw = args.settings_raw if s in SETTINGS_RAW_DETECTORS and args.settings_raw else args.raw
    if not has_provider_raw(detector_raw, provider):
        write_not_applicable(args.out, s, provider, detector_raw)
        print(f"{s:28} 해당 없음 ({provider} 원본 없음)")
        continue
    r = subprocess.run([sys.executable, os.path.join(HERE, s + ".py")], cwd=HERE, env=env, capture_output=True, text=True, encoding="utf-8")
    print(f"{s:28} {'ok' if r.returncode == 0 else 'FAIL'}")
    if r.returncode:
        failed.append(s)
        print(r.stderr[-800:])
    else:
        successful.append(s)
outs = [os.path.join(args.out, s + ".json") for s in successful]
if args.knowledge:
    node = shutil.which("node")
    if not node:
        raise SystemExit("node 실행 파일을 찾을 수 없다")
    raw_run = os.path.basename(args.raw.rstrip("\\/"))
    r_rel = subprocess.run([node, "--import", "tsx", os.path.join(HERE, "relation_checks.ts"),
                            "--dataset", os.path.abspath(args.dataset),
                            "--knowledge", os.path.abspath(args.knowledge),
                            "--out", os.path.abspath(args.out),
                            "--raw-run", raw_run],
                           cwd=HERE, env=env, capture_output=True, text=True, encoding="utf-8")
    print(f"{'relation_checks':28} {'ok' if r_rel.returncode == 0 else 'FAIL'}")
    if r_rel.returncode:
        failed.append("relation_checks")
        print(r_rel.stderr[-800:])
    else:
        for p in ["atlassian", "github", "gws", "okta", "salesforce", "slack"]:
            rel_file = os.path.join(args.out, f"aegi_relations_{p}.json")
            if os.path.exists(rel_file):
                outs.append(rel_file)
std_results_file = os.path.join(args.out, "standard_results.json")
r = subprocess.run([sys.executable, os.path.join(HERE, "build_standard_results.py"), std_results_file, *outs,
                    *[part for s in failed for part in ("--failed-detector", s)]],
                   cwd=HERE, env=env, text=True, encoding="utf-8")
if r.returncode:
    sys.exit(r.returncode)
if args.knowledge:
    r_comp = subprocess.run(
        [sys.executable, os.path.join(HERE, "build_compliance_verdicts.py"), "--results", std_results_file, "--knowledge", args.knowledge],
        cwd=HERE, env=env, text=True, encoding="utf-8"
    )
    if r_comp.returncode:
        sys.exit(r_comp.returncode)
if failed:
    sys.exit(f"판정 실패: {', '.join(failed)}. 성공한 판정 결과는 standard_results.json에 기록했다")
