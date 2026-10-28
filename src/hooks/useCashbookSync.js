import { useState, useRef, useCallback, useEffect } from 'react';
import { normalizeTransactions } from '../utils';

// The 6 Main Cashbook data keys the server tracks (see src-tauri/src/server/db.rs
// ALLOWED_KEYS — must stay in sync with that list).
const SYNCED_KEYS = ['transactions', 'bills', 'brs', 'codes', 'settings', 'prev_claims'];

// `network` (host IP/PIN) and `pettyCashVoucher` (letterhead branding) are this
// machine's own local identity/config, never part of the shared settings blob.
function stripLocalOnlySettings(settings) {
  const { network: _network, pettyCashVoucher: _pettyCashVoucher, ...rest } = settings;
  return rest;
}

function apiBase(network) {
  const host = network.mode === 'host' ? '127.0.0.1' : network.hostIp;
  return `http://${host}:${network.port || 4321}`;
}

function wsUrl(network) {
  const host = network.mode === 'host' ? '127.0.0.1' : network.hostIp;
  return `ws://${host}:${network.port || 4321}/ws?pin=${encodeURIComponent(network.pin || '')}`;
}

async function apiGetAll(network) {
  const res = await fetch(`${apiBase(network)}/api/data`, { headers: { 'X-Cashbook-Pin': network.pin || '' } });
  if (res.status === 401) throw new Error('Wrong PIN');
  if (!res.ok) throw new Error(`Host responded with ${res.status}`);
  return res.json();
}

async function apiPut(network, key, value) {
  const res = await fetch(`${apiBase(network)}/api/data/${key}`, {
    method: 'PUT',
    headers: { 'X-Cashbook-Pin': network.pin || '', 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Failed to sync ${key} (${res.status})`);
}

/**
 * Wires the Main Cashbook's data to the LAN server instead of (well, in
 * addition to — localStorage keeps being written as a local cache/fallback)
 * plain localStorage, once `network.mode` is 'host' or 'client'.
 *
 * `stores` is keyed by the same 6 names as SYNCED_KEYS, each `{ value, setValue }`.
 * `onOverwritePrompt()` must return a Promise<boolean> — resolved true to proceed
 * when the initial sync would replace non-trivial local data with the host's.
 */
export function useCashbookSync({ network, stores, hasLocalData, onOverwritePrompt }) {
  const [status, setStatus] = useState('idle'); // idle | connecting | live | error
  const [error, setError] = useState('');
  const wsRef = useRef(null);
  const lastSynced = useRef({}); // key -> last JSON string synced in or out, to avoid echo loops
  const storesRef = useRef(stores);
  storesRef.current = stores;

  const applyIncoming = useCallback((key, value) => {
    const store = storesRef.current[key];
    if (!store) return;
    // The host only holds what some client PUT there; don't let a malformed
    // value (wrong shape) reach React state and crash the app.
    const wantsObject = key === 'settings';
    if (wantsObject ? (!value || typeof value !== 'object' || Array.isArray(value)) : !Array.isArray(value)) return;
    if (key === 'settings') {
      const merged = { ...store.value, ...value, network: store.value.network, pettyCashVoucher: store.value.pettyCashVoucher };
      lastSynced.current[key] = JSON.stringify(stripLocalOnlySettings(merged));
      store.setValue(merged);
    } else if (key === 'transactions') {
      // Repair legacy text ids and string amounts. lastSynced keeps the raw incoming JSON on purpose,
      // so the push effect sees the repaired list as a change and fixes the host copy too.
      lastSynced.current[key] = JSON.stringify(value);
      store.setValue(normalizeTransactions(value));
    } else {
      lastSynced.current[key] = JSON.stringify(value);
      store.setValue(value);
    }
  }, []);

  const outgoingValue = useCallback((key) => {
    const raw = storesRef.current[key].value;
    return key === 'settings' ? stripLocalOnlySettings(raw) : raw;
  }, []);

  const connectWs = useCallback((net) => {
    wsRef.current?.close();
    try {
      const ws = new WebSocket(wsUrl(net));
      wsRef.current = ws;
      ws.onopen = () => setStatus('live');
      ws.onmessage = (ev) => {
        try {
          const { key, value } = JSON.parse(ev.data);
          if (SYNCED_KEYS.includes(key)) applyIncoming(key, value);
        } catch { /* malformed push message — ignore, next one will still arrive */ }
      };
      ws.onerror = () => setStatus('error');
      ws.onclose = () => { if (wsRef.current === ws) setStatus(s => (s === 'live' ? 'error' : s)); };
    } catch {
      setStatus('error');
    }
  }, [applyIncoming]);

  const startSync = useCallback(async () => {
    if (network.mode === 'standalone') return;
    if (network.mode === 'client' && !network.hostIp?.trim()) { setError("Enter the host PC's IP address first."); setStatus('error'); return; }
    if (!network.pin?.trim()) { setError('Set a PIN first.'); setStatus('error'); return; }

    setStatus('connecting'); setError('');
    try {
      const remote = await apiGetAll(network);
      const willOverwrite = SYNCED_KEYS.some(k => k !== 'settings' && k !== 'codes' && remote[k] !== undefined && hasLocalData(k));
      if (willOverwrite) {
        const proceed = await onOverwritePrompt();
        if (!proceed) { setStatus('idle'); return; }
      }
      for (const key of SYNCED_KEYS) {
        if (remote[key] !== undefined && remote[key] !== null) {
          applyIncoming(key, remote[key]);
        } else {
          const out = outgoingValue(key);
          lastSynced.current[key] = JSON.stringify(out);
          await apiPut(network, key, out); // seed the server with this machine's existing data
        }
      }
      connectWs(network);
    } catch (e) {
      setError(e.message || 'Sync failed');
      setStatus('error');
    }
  }, [network, applyIncoming, outgoingValue, hasLocalData, onOverwritePrompt, connectWs]);

  const stopSync = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    lastSynced.current = {};
    setStatus('idle');
    setError('');
  }, []);

  // Push local changes out once live. Each key self-skips via the JSON
  // comparison if it's exactly what was just received (or already sent),
  // so this doesn't turn into a client-to-client echo loop.
  useEffect(() => {
    if (status !== 'live') return;
    SYNCED_KEYS.forEach(key => {
      const out = outgoingValue(key);
      const json = JSON.stringify(out);
      if (lastSynced.current[key] === json) return;
      lastSynced.current[key] = json;
      apiPut(network, key, out).catch(e => setError(e.message || `Failed to sync ${key}`));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores.transactions.value, stores.bills.value, stores.brs.value, stores.codes.value, stores.settings.value, stores.prev_claims.value, status]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  return { status, error, startSync, stopSync };
}
