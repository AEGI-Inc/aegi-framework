import path from 'node:path'

/** 저장소(또는 배포 zip) 맨 위. 번들 실행 때는 AEGI_HOME 으로 준다 */
export const HOME = path.resolve(process.env.AEGI_HOME ?? path.join(import.meta.dirname, '..'))
export const VENDOR = path.join(HOME, 'vendor')
export const WEB_DIR = path.join(VENDOR, 'web')
export const SAMPLE_DIR = path.join(HOME, 'sample')
export const DATA_DIR = path.resolve(process.env.AEGI_DATA_DIR ?? path.join(HOME, 'data'))
export const DB_FILE = path.join(DATA_DIR, 'aegi.sqlite')
export const COLLECTED_DIR = path.join(DATA_DIR, 'collected')
export const DATASETS_DIR = path.join(DATA_DIR, 'datasets')
export const ENV_FILE = path.resolve(process.env.AEGI_ENV_FILE ?? path.join(HOME, '.env'))
export const IM_MODEL_DIR = path.join(VENDOR, 'knowledge', 'schema', 'im-model', 'model', 'v3.2')
