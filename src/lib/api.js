import { mock } from './mock.js';

const API_URL = (import.meta.env.VITE_API_URL || '').trim();
export const POLL_MS = Number(import.meta.env.VITE_POLL_MS) || 4000;

/** gas  = served by Apps Script itself (google.script.run)
 *  http = hosted elsewhere (Vercel…), calls the Apps Script web app over HTTPS
 *  demo = no backend configured, fake data */
export const MODE = window.google?.script?.run ? 'gas' : API_URL ? 'http' : 'demo';

export class NetError extends Error {}

export const isNetErr = (e) =>
  e instanceof NetError || /network|http 0|connection|timed? ?out|failed to fetch|offline/i.test(String(e?.message || e));

export const isAuthErr = (e) => String(e?.message || e).includes('AUTH');

/** call('apiSet', auth, keys, field, value) — same signature in every mode. */
export async function call(action, ...args) {
  if (MODE === 'demo') return mock[action](...args);

  if (MODE === 'gas') {
    return new Promise((resolve, reject) =>
      window.google.script.run
        .withSuccessHandler(resolve)
        .withFailureHandler((e) => reject(isNetErr(e) ? new NetError(e.message) : new Error(e?.message || e)))
        [action](...args),
    );
  }

  let res;
  try {
    // text/plain avoids a CORS preflight, which Apps Script can't answer.
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, args }),
      redirect: 'follow',
    });
  } catch (e) {
    throw new NetError(e.message);
  }
  if (!res.ok) throw new NetError('HTTP ' + res.status);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Backend did not return JSON. Check the web app is deployed with access "Anyone".');
  }
  if (!json.ok) throw new Error(json.error || 'Request failed');
  return json.data;
}
