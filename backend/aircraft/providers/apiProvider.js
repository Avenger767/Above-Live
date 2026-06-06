// Above Live — adapter-based API provider.
// Selects an adapter by settings.api.adapter (or API_PROVIDER env var) and uses
// it to fetch + normalize real aircraft data. Falls back to MOCK on any failure.
//
// Adapter interface (each file in ./adapters/ exports):
//   name: string            — key used in settings/env
//   label: string           — human-readable display name
//   requiresKey: boolean    — whether API_KEY is mandatory
//   isConfigured(settings)  — returns true if the adapter can run
//   buildRequest(settings)  — returns { url, headers }
//   parseResponse(data)     — returns array of raw objects for the normalizer

import { normalizeList } from '../aircraftNormalizer.js';
import * as airplaneslive from './adapters/airplaneslive.js';
import * as opensky from './adapters/opensky.js';
import * as adsbexchange from './adapters/adsbexchange.js';
import * as generic from './adapters/generic.js';

export const ADAPTERS = { airplaneslive, opensky, adsbexchange, generic };

export function getAdapterInfo(settings) {
  const key = (settings?.api?.adapter || 'airplaneslive').toLowerCase();
  const adapter = ADAPTERS[key] || ADAPTERS.airplaneslive;
  return {
    adapter: key,
    adapterLabel: adapter.label,
    requiresKey: adapter.requiresKey,
    configured: adapter.isConfigured(settings),
  };
}

export function createApiProvider() {
  const name = 'api';

  async function fetchAircraft(settings) {
    const key = (settings?.api?.adapter || 'airplaneslive').toLowerCase();
    const adapter = ADAPTERS[key];

    if (!adapter) {
      throw new Error(`Unknown API adapter "${key}". Valid options: ${Object.keys(ADAPTERS).join(', ')}`);
    }

    if (!adapter.isConfigured(settings)) {
      throw new Error(
        `API adapter "${adapter.label}" is not configured` +
        (adapter.requiresKey ? ' — set API_KEY in .env' : ' — set API_BASE_URL in .env')
      );
    }

    const { url, headers } = adapter.buildRequest(settings);

    let res;
    try {
      res = await fetch(url, {
        headers: { Accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(12000),
      });
    } catch (err) {
      throw new Error(`${adapter.label} request failed: ${err.message}`);
    }

    if (!res.ok) {
      throw new Error(`${adapter.label} HTTP ${res.status} — ${url}`);
    }

    const data = await res.json();
    const rawList = adapter.parseResponse(data);

    if (!Array.isArray(rawList)) {
      throw new Error(`${adapter.label} returned unexpected response shape`);
    }

    console.log(`[api] ${adapter.label} → ${rawList.length} raw aircraft`);
    return normalizeList(rawList, name, settings.home);
  }

  return { name, fetchAircraft };
}
