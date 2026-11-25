"""판정 스크립트가 같이 쓰는 입력·출력 경로. run_all.py 가 환경변수로 넘긴다.
기준 정의(defs/)는 이 폴더에 있고, 수집 원본·데이터셋·출력 폴더는 실행할 때 정한다.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DEFS = os.path.join(HERE, "defs")
ITEMS = os.path.join(DEFS, "standards_items_all.json")    # 기준 항목(기준·항목 ID·제목·묶을 finding 문장)
UNIQ = os.path.join(DEFS, "findings_unique_all.json")     # 기준 항목 → 묶은 finding_id
KINDS = os.path.join(DEFS, "kinds_bottomup.json")         # finding 분류(층·묶음·종류)
TITLES = os.path.join(DEFS, "prowler_titles.json")        # Prowler compliance 파일의 요구사항 설명(CIS GitHub·GWS, DISA Okta STIG, SCuBA)


def _env(name, required=True):
    v = os.environ.get(name)
    if required and not v:
        raise SystemExit(f"{name} 가 없다. run_all.py 로 실행한다")
    return v


RAW = _env("AEGI_STD_RAW")                       # 수집 원본 run 폴더(collected/raw/<run>)
EXTRA = _env("AEGI_STD_SETTINGS_RAW", False) or RAW  # 추가 설정 수집 run 폴더(GHS-01~03, SFS-01). 없으면 본 run 에서 찾고, 파일이 없으면 해당 항목은 수집 없음
DS = _env("AEGI_STD_DATASET")                    # 정규화 데이터셋 폴더(objects.json). 걸린 대상이 그래프에 있는지만 본다
OBJ = os.path.join(DS, "objects.json")
OUT_DIR = _env("AEGI_STD_OUT")


def run_record(run_dir):
    """수집 run 폴더(collected/raw/<run>)의 실행 기록 경로(collected/runs/<run>.json). 호출마다 completeness(full·partial·failed·skipped)가 있다"""
    r = run_dir.rstrip("\\/")
    return os.path.join(os.path.dirname(os.path.dirname(r)), "runs", os.path.basename(r) + ".json")


RUNS = os.environ.get("AEGI_STD_RUN_RECORD") or run_record(RAW)
# build_standard_results.py 가 읽는다. 본 run 기록 다음에 추가 설정 수집 run 기록(본 기록에서 full 이 아닌 호출만 뒤 기록 값으로 바꾼다)
RUN_RECORDS = [RUNS] + ([run_record(EXTRA)] if os.path.abspath(EXTRA) != os.path.abspath(RAW) else [])


def out(slug):
    return os.path.join(OUT_DIR, slug + ".json")
