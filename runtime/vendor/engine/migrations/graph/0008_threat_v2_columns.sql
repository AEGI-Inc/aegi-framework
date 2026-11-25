-- 위협 판정 V2 (docs/spec/AEGI_THREAT_JUDGMENT_V2.md 8절). 나란히 비교 기간에는 옛 위협 행과 새 위협 행(rule_id threat-v2)이 같이 있다.
-- 옛 행은 네 열이 비어 있다. 옛 판정 삭제 단계에서 옛 행과 옛 열을 정리한다
ALTER TABLE snap_findings ADD COLUMN primary_type TEXT;
ALTER TABLE snap_findings ADD COLUMN types TEXT;
ALTER TABLE snap_findings ADD COLUMN occurrence TEXT;
ALTER TABLE snap_findings ADD COLUMN certainty TEXT;
