// Above Live — REST API client.
// Thin wrappers around the backend HTTP endpoints. Paths are relative so the
// Vite dev proxy (and a production reverse proxy) just work.

async function jsonFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export function getStatus() {
  return jsonFetch('/api/status');
}

export function getSettings() {
  return jsonFetch('/api/settings');
}

export function getAircraft() {
  return jsonFetch('/api/aircraft');
}

export function saveSettings(partial) {
  return jsonFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partial),
  });
}

export function resetSettings() {
  return jsonFetch('/api/settings/reset', { method: 'POST' });
}
