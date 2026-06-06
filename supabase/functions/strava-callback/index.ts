import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async (request) => {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');

  function redirectWithError(returnTo: string | null, message: string) {
    const fallbackOrigin =
      (Deno.env.get('APP_ORIGINS') ?? '').split(',')[0] ??
      'http://localhost:5174';
    const redirectUrl = new URL(returnTo ?? `${fallbackOrigin}/?adminPage=addActivity`);
    redirectUrl.searchParams.set('strava', 'error');
    redirectUrl.searchParams.set('message', message);

    return Response.redirect(redirectUrl.toString(), 302);
  }

  if (!code || !state) {
    return redirectWithError(null, 'Missing Strava authorization code.');
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stravaClientId = Deno.env.get('STRAVA_CLIENT_ID');
  const stravaClientSecret = Deno.env.get('STRAVA_CLIENT_SECRET');

  if (!supabaseUrl || !supabaseServiceRoleKey || !stravaClientId || !stravaClientSecret) {
    return redirectWithError(null, 'Strava integration is not configured.');
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: stateRecord, error: stateError } = await serviceClient
    .from('strava_oauth_states')
    .select('state,user_id,return_to,expires_at')
    .eq('state', state)
    .maybeSingle();

  if (stateError || !stateRecord) {
    return redirectWithError(null, 'Strava authorization state was not found.');
  }

  if (new Date(stateRecord.expires_at).getTime() < Date.now()) {
    return redirectWithError(stateRecord.return_to, 'Strava authorization expired.');
  }

  const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    return redirectWithError(stateRecord.return_to, 'Could not connect Strava.');
  }

  const tokenData = await tokenResponse.json();
  const expiresAt = new Date(tokenData.expires_at * 1000).toISOString();

  const { error: upsertError } = await serviceClient
    .from('strava_connections')
    .upsert({
      user_id: stateRecord.user_id,
      athlete_id: tokenData.athlete.id,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      scope: tokenData.scope,
      athlete: tokenData.athlete,
      updated_at: new Date().toISOString(),
    });

  if (upsertError) {
    return redirectWithError(stateRecord.return_to, 'Could not save Strava connection.');
  }

  await serviceClient
    .from('strava_oauth_states')
    .delete()
    .eq('state', stateRecord.state);

  const redirectUrl = new URL(stateRecord.return_to);
  redirectUrl.searchParams.set('adminPage', 'addActivity');
  redirectUrl.searchParams.set('strava', 'connected');

  return Response.redirect(redirectUrl.toString(), 302);
});
