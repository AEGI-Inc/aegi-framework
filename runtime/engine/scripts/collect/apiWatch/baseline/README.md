# api-watch 기준선 (`baseline/`)

이 폴더에는 각 출처(`sources.yaml`)의 원본 스냅샷에서 추출한 API 표면 기준선 JSON(`<source_id>.json`)이 들어간다.
`npm run api-watch -- baseline --source <id> --file <스펙 파일 경로>` 명령으로 생성한다.
