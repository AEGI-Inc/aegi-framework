/// <reference types="vite/client" />

/** 실측 v2 (aegi-schema 기준 어댑터). dev 서버에서만, 파일이 있을 때만. 없으면 null */
declare module 'virtual:aegi-measured-v2' {
  import type { RawDataset } from './data/datasetStore'
  const measured: RawDataset | null
  export default measured
}

/** IM Object Profile 카탈로그(1,977개) 기반 정규화 및 투영 데이터셋 (ver IM). dev 서버에서만, 파일이 있을 때만. 없으면 null */
declare module 'virtual:aegi-measured-im' {
  import type { RawDataset } from './data/datasetStore'
  const measuredIm: RawDataset | null
  export default measuredIm
}
