-- snap_access_gaps 삭제 (2026-11-18, aegi-adapter-engine#452 뒤)
-- 옛 다리(연동 경로) 단위 Access Gap 표. 2026-11-17 부터 행을 싣지 않았고 읽는 코드도 없다.
-- Access Gap 은 위협마다 벤으로 snap_findings detail 의 accessGap 에 있다. 0003 은 이력으로 둔다.

DROP TABLE IF EXISTS snap_access_gaps;
