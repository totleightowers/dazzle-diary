/**
 * Where the app's data comes from.
 *
 * One client, two backends. In the app it runs the same logic in the page
 * against IndexedDB; against a host that serves the API over HTTP it talks to
 * that instead. Everything above this file is identical either way.
 */
const LOCAL = typeof window !== 'undefined' && !!window.LOGBOOK_STANDALONE;

let local = null;
async function localApi(path, opts) {
  if (!local) local = await import('./local/store.js');
  return local.localApi(path, opts);
}

export async function api(path, opts = {}) {
  if (LOCAL) {
    try {
      return await localApi(path, opts);
    } catch (e) {
      throw Object.assign(new Error(e.message || 'Something went wrong'), { status: e.status || 500 });
    }
  }
  const res = await fetch('/api' + path, opts);
  const text = await res.text();
  // not every route answers with JSON — /export is text/csv
  let body;
  if ((res.headers.get('content-type') || '').includes('json')) {
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  } else body = text;
  if (!res.ok) throw Object.assign(
    new Error((body && body.message) || (body && body.error) || res.statusText),
    { status: res.status, body });
  return body;
}

export const isStandalone = () => LOCAL;
