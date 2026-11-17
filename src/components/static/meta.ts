/**
 * Data provenance for the static pages (About, Methodology, Developers): how many stores were
 * scanned, the data date, the detection rules version and the App Store check range.
 *
 * Reads the API's meta endpoint (GET /api/v1/meta) through the in-process client, so the
 * numbers match what /api/v1 returns. Returns null when it can't be read; pages then fall back
 * to wording without numbers rather than inventing any.
 */
import type { DataMeta } from '~/server/api/v1/schemas/misc';

export type { DataMeta };

export async function loadMeta(): Promise<DataMeta | null> {
  // TODO(api): wire to the in-process client once src/server/api/v1 exposes it, e.g.
  //   const api = await getApi(); return (await api.getMeta()).data;
  return null;
}
