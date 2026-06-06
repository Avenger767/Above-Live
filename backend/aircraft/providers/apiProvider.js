// Above Live — API provider (scaffold for a future internet flight API).
//
// This intentionally does NOT hardcode any paid service. It gives you a clean
// place to plug one in later. The contract is simple:
//   - Build a request from settings.api.baseUrl + settings.api.apiKey
//   - Fetch the data
//   - Map each record into the raw shape the normalizer understands
//
// If no baseUrl/apiKey is configured, fetchAircraft throws so the manager can
// fall back to MOCK mode automatically.

import { normalizeList } from '../aircraftNormalizer.js';

export function createApiProvider() {
  const name = 'api';

  async function fetchAircraft(settings) {
    const { baseUrl, apiKey } = settings.api || {};

    if (!baseUrl || !apiKey) {
      // Fail clearly; the manager catches this and falls back to MOCK.
      throw new Error('API provider not configured (missing API_BASE_URL or API_KEY)');
    }

    // ---------------------------------------------------------------------
    // EXAMPLE request — adapt this block to whichever provider you choose.
    // The home location + range are available so you can request a bounding
    // box around home rather than the whole world.
    // ---------------------------------------------------------------------
    const url = `${baseUrl.replace(/\/$/, '')}/aircraft`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`API provider HTTP ${res.status} from ${url}`);
    }

    const data = await res.json();

    // Adjust this line to point at wherever the array of aircraft lives in the
    // response (e.g. data.states, data.ac, data.flights, etc.).
    const rawList = Array.isArray(data) ? data : data.aircraft || data.states || [];

    return normalizeList(rawList, name, settings.home);
  }

  return { name, fetchAircraft };
}
