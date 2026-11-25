-- 위협 유형 개편(2026-11-19, aegi-knowledge schema/ontology/threat_types.yaml). 정보 노출(information_exposure)을 비인가 접근(unauthorized_access)으로 바꿨다.
-- 이미 남긴 예외의 분류 키도 새 키로 옮긴다. 권한 상승, 데이터 반출, 추적성 상실 키는 그대로다.
UPDATE threat_exceptions SET scenario_key = 'unauthorized_access' WHERE scenario_key = 'information_exposure';
