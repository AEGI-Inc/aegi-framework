import measuredV2Local from 'virtual:aegi-measured-v2'
import type { EventReader } from './eventTools'
import { queryLocalEvents } from './eventTools'
import type { TimelineEvent, EventLink } from '../timeline/timelineAnalysis'

/** Local fixtures only. Deployed event tools execute on the server and never enumerate Timeline pages. */
export const readLocalEvents: EventReader = async (name, args, signal) => {
  signal?.throwIfAborted()
  const events = (measuredV2Local?.events as { events?: TimelineEvent[] } | undefined)?.events
  const links = (measuredV2Local?.event_links as { links?: EventLink[] } | undefined)?.links ?? null
  return events ? queryLocalEvents(events, links, name, args) : { events: [], links: null, total: 0, available: false }
}
