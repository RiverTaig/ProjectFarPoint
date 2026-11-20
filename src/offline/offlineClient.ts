import { parseOfflineUrl } from './trailExtraction.ts';

export function readOfflineLink(value: string, base = 'https://projectfarpoint.com') {
  const link = new URL(value, base);
  const passwords = link.searchParams.getAll('pw');
  link.searchParams.delete('pw');
  return {
    url: link.href, password: passwords.length === 1 ? passwords[0] : '', passwordSupplied: passwords.length > 0,
    passwordError: passwords.length > 1 ? 'The link contains more than one password. Enter the submission password below.' : '',
    previewOnly: link.searchParams.get('preview') === '1',
  };
}

export function offlineSubmissionBody(value: string, password: string) {
  const link = new URL(value);
  if (link.searchParams.get('preview') === '1') throw new Error('Example links are preview only. Use a real hike link to submit.');
  parseOfflineUrl(value, { code: link.searchParams.get('t') ?? '', timezone: 'UTC' });
  if (!password) throw new Error('Enter the submission password.');
  return { ...Object.fromEntries(['t', 'p', 'dt', 's', 'e'].map((key) => [key, link.searchParams.get(key)!])), pw: password };
}

export type SubmissionResult = Record<string, unknown> & {
  status: 'completed' | 'already_processed' | 'processing' | 'failed';
};
const resultFields = new Set(['status', 'requestId', 'activityId', 'trail', 'trailName', 'trailVersion',
  'appliesTo', 'dateTime', 'localDateTime', 'timezone', 'start', 'end', 'snappedStart', 'snappedEnd',
  'distanceMeters', 'distanceKilometers', 'creditedKilometers', 'startSnapMeters', 'endSnapMeters',
  'code', 'error', 'message', 'retryAfterSeconds']);

export async function submitOfflineActivity(
  value: string, password: string, configuration: { url?: string; anonKey?: string },
  send: typeof fetch = fetch,
): Promise<SubmissionResult> {
  const body = offlineSubmissionBody(value, password);
  if (!configuration.url) throw new Error('Activity submission is not configured on this website.');
  const endpoint = new URL(configuration.url);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
    throw new Error('Activity submission requires a secure server connection.');
  }
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/functions/v1/submit-offline-activity`;
  endpoint.search = ''; endpoint.hash = '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await send(endpoint.href, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(configuration.anonKey ? { apikey: configuration.anonKey } : {}) },
      body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
    });
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response. Retry the same hike to check its result.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The server returned an unexpected response. Retry the same hike to check its result.');
    const record = data as Record<string, unknown>;
    if (!['completed', 'already_processed', 'processing', 'failed'].includes(String(record.status))
      || (!response.ok && record.status !== 'failed')
      || (['completed', 'already_processed'].includes(String(record.status)) && typeof record.activityId !== 'string')) {
      throw new Error('The server returned an unexpected response. Retry the same hike to check its result.');
    }
    // Render only documented fields, with a final secret scrub for error text.
    const scrub = (item: unknown): unknown => typeof item === 'string' ? item.replaceAll(password, '[hidden]')
      : Array.isArray(item) ? item.map(scrub)
      : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'pw' && key !== 'password').map(([key, child]) => [key, scrub(child)])) : item;
    return Object.fromEntries(Object.entries(record).filter(([key]) => resultFields.has(key)).map(([key, item]) => [key, scrub(item)])) as SubmissionResult;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('The server returned')) throw error;
    throw new Error('Could not confirm the submission. Retry the same hike; the server prevents duplicate activities.');
  } finally { clearTimeout(timeout); }
}
