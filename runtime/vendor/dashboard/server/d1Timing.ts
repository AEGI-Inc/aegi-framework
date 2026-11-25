import type { D1Like, D1Statement } from './exceptions'

/** D1 query count and summed wait time of one request, for the Server-Timing header. Results pass through unchanged. */
export interface D1Stat { queries: number; ms: number }

const INNER = Symbol('inner')
type Timed = D1Statement & { [INNER]: D1Statement }

export function timedD1(db: D1Like, stat: D1Stat): D1Like {
  const wrap = (inner: D1Statement): Timed => {
    const timed = async <T>(run: () => Promise<T>): Promise<T> => {
      const started = Date.now()
      try { return await run() } finally { stat.queries++; stat.ms += Date.now() - started }
    }
    return {
      [INNER]: inner,
      bind: (...values: unknown[]) => wrap(inner.bind(...values)),
      first: <T>() => timed(() => inner.first<T>()),
      all: <T>() => timed(() => inner.all<T>()),
      run: () => timed(() => inner.run()),
    }
  }
  // Keep the store's own fields: the public demo's pinned snapshot (withSnapshotPin) rides on the D1 object, and losing it reads graph_head instead
  return {
    ...db,
    prepare: sql => wrap(db.prepare(sql)),
    batch: statements => {
      const started = Date.now()
      return db.batch(statements.map(s => (s as Timed)[INNER] ?? s)).finally(() => { stat.queries += statements.length; stat.ms += Date.now() - started })
    },
  }
}
