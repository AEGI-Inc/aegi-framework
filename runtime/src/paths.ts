import fs from 'node:fs'
import path from 'node:path'

/** 저장소(또는 배포 zip) 맨 위. 번들 실행 때는 AEGI_HOME 으로 준다 */
export const HOME = path.resolve(process.env.AEGI_HOME ?? path.join(import.meta.dirname, '..'))
export const ENGINE_DIR = path.join(HOME, 'engine')
export const DASHBOARD_DIR = path.join(HOME, 'dashboard')
export const WEB_DIR = path.join(HOME, 'web')
export const SAMPLE_DIR = path.join(HOME, 'sample')
export const DATA_DIR = path.resolve(process.env.AEGI_DATA_DIR ?? path.join(HOME, 'data'))
export const DB_FILE = path.join(DATA_DIR, 'aegi.sqlite')
export const COLLECTED_DIR = path.join(DATA_DIR, 'collected')
export const DATASETS_DIR = path.join(DATA_DIR, 'datasets')
export const ENV_FILE = path.resolve(process.env.AEGI_ENV_FILE ?? path.join(HOME, '.env'))
const BUNDLED_IM_MODEL_DIR = path.join(HOME, 'im-model', 'v3.2')
export const IM_MODEL_DIR = fs.existsSync(BUNDLED_IM_MODEL_DIR)
  ? BUNDLED_IM_MODEL_DIR
  : path.resolve(HOME, '..', 'framework', 'schema', 'im-model', 'model', 'v3.2')
