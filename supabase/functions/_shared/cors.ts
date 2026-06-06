export function corsHeaders(origin: string | null) {
  const allowedOrigins = (Deno.env.get('APP_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowedOrigin =
    origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '*';

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function isAllowedReturnTo(returnTo: string) {
  const allowedOrigins = (Deno.env.get('APP_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    return allowedOrigins.includes(new URL(returnTo).origin);
  } catch {
    return false;
  }
}
