// Above Live — LOCAL_ADSB provider.
// Reads a dump1090 / readsb "aircraft.json" feed, either over HTTP
// (settings.localAdsb.url) or from a local file (settings.localAdsb.path).
//
// dump1090/readsb aircraft.json looks roughly like:
//   { "now": 171000000, "aircraft": [ { "hex": "a1b2c3", "flight": "AAL123",
//     "lat": 32.7, "lon": -96.8, "alt_baro": 34000, "gs": 430, "track": 180 } ] }
//
// If the feed is unreachable/unreadable, fetchAircraft throws and the manager
// falls back to MOCK mode automatically.

import { readFile } from 'node:fs/promises';
import { normalizeList } from '../aircraftNormalizer.js';

export function createLocalAdsbProvider() {
  const name = 'local_adsb';

  async function fetchAircraft(settings) {
    const { url, path } = settings.localAdsb || {};

    let data;
    if (path) {
      const text = await readFile(path, 'utf8');
      data = JSON.parse(text);
    } else if (url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`LOCAL_ADSB HTTP ${res.status} from ${url}`);
      data = await res.json();
    } else {
      throw new Error('LOCAL_ADSB provider not configured (missing url or path)');
    }

    // dump1090/readsb stores ground speed in "gs", track/heading in "track",
    // barometric altitude in "alt_baro" — the normalizer already understands
    // these field names. "alt_baro" can be the string "ground"; coerce that.
    const rawList = (data.aircraft || []).map((a) => ({
      ...a,
      alt_baro: a.alt_baro === 'ground' ? 0 : a.alt_baro,
    }));

    return normalizeList(rawList, name, settings.home);
  }

  return { name, fetchAircraft };
}
