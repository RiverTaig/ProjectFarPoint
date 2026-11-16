import { buildTrailIndex, extractTrailSection, parseOfflineUrl, TrailError } from './trailExtraction.ts';

export type SubmissionInput = ReturnType<typeof parseOfflineUrl>;
export type Section = ReturnType<typeof extractTrailSection>;
export type TrailRegistration = { id: string; code: string; timezone: string; snap_tolerance_meters: number };
export type ClaimedRequest = {
  id: string; processing_token: string; trail_version_id: string;
  trail_timezone: string; started_at: string;
};
export type Prepared = { state: 'claimed'; request: ClaimedRequest }
  | { state: 'completed'; result: Record<string, unknown> }
  | { state: 'processing'; requestId: string };
export interface OfflineStore {
  trail(code: string): Promise<TrailRegistration | null>;
  prepare(ownerId: string, trail: TrailRegistration, input: SubmissionInput, startedAt: string): Promise<Prepared>;
  geometry(versionId: string): Promise<unknown>;
  complete(request: ClaimedRequest, section: Section): Promise<Record<string, unknown>>;
  fail(request: ClaimedRequest, code: string, message: string): Promise<void>;
}
export type OfflineConfig = { password: string; ownerId: string };

// Find every UTC instant matching this local wall time. Sampling offsets on
// both sides of the date detects daylight-saving gaps and repeated hours.
export function resolveLocalDateTime(local: string, timezone: string): string {
  const parts = [local.slice(0, 4), local.slice(4, 6), local.slice(6, 8), local.slice(9, 11), local.slice(11, 13)].map(Number);
  const naive = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const localMillis = (instant: number) => {
    const fields = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day),
      Number(fields.hour), Number(fields.minute), Number(fields.second));
  };
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const instant = naive + hours * 3600000;
    offsets.add(localMillis(instant) - instant);
  }
  const candidates = [...offsets].map((offset) => naive - offset).filter((instant) => localMillis(instant) === naive);
  if (candidates.length !== 1) throw new TrailError('INVALID_LOCAL_TIME', candidates.length
    ? 'Hike time falls in a repeated daylight-saving hour. Choose an unambiguous local time.'
    : 'Hike time does not exist due to a daylight-saving clock change. Correct dt.');
  return new Date(candidates[0]).toISOString();
}

export async function passwordMatches(supplied: unknown, expected: string) {
  if (typeof supplied !== 'string') return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([supplied, expected].map(async (value) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function readRequestBytes(request: Request, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new TrailError('INVALID_BODY', 'A request body is required.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new TrailError('INVALID_BODY', `Request exceeds ${limit} bytes.`); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function readBody(request: Request, limit = 4096): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new TrailError('INVALID_BODY', 'Send application/json with t, p, dt, s, e, and pw.');
  }
  const bytes = await readRequestBytes(request, limit);
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new TrailError('INVALID_BODY', 'Request body is not valid JSON.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TrailError('INVALID_BODY', 'Request body must be a JSON object.');
  return body as Record<string, unknown>;
}

export function createOfflineHandler(dependencies: {
  config: () => OfflineConfig | null;
  store: () => OfflineStore;
  allowedOrigins: () => string[];
}) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    };
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value, null, 2), { status, headers });
    if (origin && !dependencies.allowedOrigins().includes(origin)) return json({ status: 'failed', code: 'ORIGIN_NOT_ALLOWED', error: 'Origin is not allowed.' }, 403);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') { headers.Allow = 'POST, OPTIONS'; return json({ status: 'failed', code: 'METHOD_NOT_ALLOWED', error: 'Use an explicit POST submission; opening a link never creates an activity.' }, 405); }
    const config = dependencies.config();
    if (!config?.password || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(config.ownerId)) {
      return json({ status: 'failed', code: 'NOT_CONFIGURED', error: 'Offline submission is not configured.' }, 503);
    }
    let store: OfflineStore | undefined;
    let claimed: ClaimedRequest | undefined;
    try {
      const body = await readBody(request);
      if (!await passwordMatches(body.pw, config.password)) return json({ status: 'failed', code: 'UNAUTHORIZED', error: 'Incorrect or missing submission password.' }, 401);
      // Whitelist fields. Never persist/log the original URL, pw, or caller-
      // supplied owner/geometry/distance: all trusted data is resolved server-side.
      const url = new URL('https://projectfarpoint.com/offline');
      for (const field of ['t', 'p', 'dt', 's', 'e']) {
        if (typeof body[field] !== 'string' || !body[field] || body[field].length > 100) throw new TrailError('INVALID_URL', `Supply a valid ${field} string.`);
        url.searchParams.set(field, body[field]);
      }
      if (!/^[A-Z][A-Z0-9]{0,15}$/.test(body.t as string)) throw new TrailError('UNKNOWN_TRAIL', 'Unknown trail code.');
      // Validate structure/calendar before doing any database work.
      const preliminary = parseOfflineUrl(url.href, { code: body.t as string, timezone: 'UTC' });
      store = dependencies.store();
      const trail = await store.trail(preliminary.trail);
      if (!trail) throw new TrailError('UNKNOWN_TRAIL', 'No published geometry is registered for this trail.');
      const input = { ...preliminary, timezone: trail.timezone };
      const startedAt = resolveLocalDateTime(input.localDateTime, trail.timezone);
      const prepared = await store.prepare(config.ownerId, trail, input, startedAt);
      if (prepared.state === 'completed') return json(prepared.result);
      if (prepared.state === 'processing') {
        headers['Retry-After'] = '5';
        return json({ status: 'processing', requestId: prepared.requestId, retryAfterSeconds: 5,
          message: 'This request is already processing. Resubmit the same parameters shortly to retrieve its result.' }, 202);
      }
      claimed = prepared.request;
      const geometry = await store.geometry(claimed.trail_version_id);
      const section = extractTrailSection(buildTrailIndex(geometry), input.start, input.end, Number(trail.snap_tolerance_meters));
      const result = await store.complete(claimed, section);
      return json(result);
    } catch (error) {
      const code = error instanceof TrailError ? error.code : 'PROCESSING_FAILED';
      // Do not reflect database error details or secrets to public callers.
      const message = error instanceof TrailError ? error.message : 'Could not finish processing. Resubmit the same request to retry.';
      if (store && claimed) {
        try { await store.fail(claimed, code, message); }
        catch { /* A lost response may already have committed. Retry is safe. */ }
      }
      return json({ status: 'failed', code, error: message, ...(claimed ? { requestId: claimed.id } : {}) }, error instanceof TrailError ? 422 : 500);
    }
  };
}
