/**
 * OpenLineage 공식 JSON Schema 로 계보 이벤트를 검사한다.
 * schema/ 의 OpenLineage 파일은 OpenLineage 1.53.0 태그의 spec/ 에서 그대로 가져왔다 (OpenLineage.json 2-0-2, ColumnLineage 1-2-0, Symlinks 1-0-1).
 * AegiFacets.json 은 AEGI 전용 facet 의 스키마다.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { isRunEvent, type LineageEvent } from '../../src/lineage/types'

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema')
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'))

const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const core = read('OpenLineage.json')
ajv.addSchema(core)
const eventSchema = ajv.getSchema(core.$id)!
/** dataset.facets 에 붙는 표준 facet. 각 스키마는 facets 객체의 해당 속성만 검사한다 */
const datasetFacetSchemas = ['ColumnLineageDatasetFacet.json', 'SymlinksDatasetFacet.json'].map(f => ajv.compile(read(f)))
/** run.facets, job.facets 에 붙는 AEGI 전용 facet */
const aegiFacetSchema = ajv.compile(read('AegiFacets.json'))

export interface SchemaProblem {
  index: number
  where: string
  message: string
}

export function validateLineageEvents(events: LineageEvent[]): SchemaProblem[] {
  const problems: SchemaProblem[] = []
  const check = (index: number, where: string, schema: ValidateFunction, value: unknown) => {
    if (!schema(value)) for (const e of schema.errors ?? []) problems.push({ index, where: `${where}${e.instancePath}`, message: e.message ?? e.keyword })
  }
  events.forEach((event, index) => {
    check(index, '', eventSchema, event)
    if (isRunEvent(event)) check(index, '/run/facets', aegiFacetSchema, event.run.facets)
    check(index, '/job/facets', aegiFacetSchema, event.job.facets ?? {})
    for (const [side, list] of [['inputs', event.inputs], ['outputs', event.outputs]] as const) {
      list.forEach((d, i) => {
        for (const schema of datasetFacetSchemas) check(index, `/${side}/${i}/facets`, schema, d.facets ?? {})
      })
    }
  })
  return problems
}
