// Above Live — live aircraft feed.
// Prefers a WebSocket stream; if it can't connect (or drops), it transparently
// falls back to HTTP polling so the display keeps updating either way.

import { getAircraft } from './api.js';

export function createAircraftFeed({ onData, onConnection, pollIntervalMs = 1500 }) {
  let ws = null;
  let pollTimer = null;
  let reconnectTimer = null;
  let closed = false;
  let mode = 'connecting';

  function setMode(next) {
    if (mode !== next) {
      mode = next;
      onConnection?.(mode);
    }
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws`;
  }

  function startPolling() {
    if (pollTimer) return;
    setMode('polling');
    const tick = async () => {
      try {
        const data = await getAircraft();
        onData?.(data);
      } catch (_e) {
        /* keep trying */
      }
    };
    tick();
    pollTimer = setInterval(tick, pollIntervalMs);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(wsUrl());
    } catch (_e) {
      startPolling();
      return;
    }

    ws.onopen = () => {
      stopPolling(); // websocket wins
      setMode('websocket');
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'aircraft') onData?.(data);
      } catch (_e) {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => {
      // Fall back to polling while we attempt to reconnect.
      startPolling();
    };

    ws.onclose = () => {
      if (closed) return;
      startPolling();
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 3000);
    };
  }

  connect();

  return {
    close() {
      closed = true;
      stopPolling();
      clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch (_e) {
        /* noop */
      }
    },
    get mode() {
      return mode;
    },
  };
}
