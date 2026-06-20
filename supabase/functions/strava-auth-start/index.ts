import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, isAllowedReturnTo } from '../_shared/cors.ts';

const ownerEmail = 'rivermadsen23@gmail.com';

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  const headers = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }

  try {
    if (request.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed.' },
        { status: 405, headers },
      );
    }

    const { returnTo } = await request.json();

    if (!returnTo || !isAllowedReturnTo(returnTo)) {
      return Response.json(
        { error: 'Invalid return URL.' },
        { status: 400, headers },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const stravaClientId = Deno.env.get('STRAVA_CLIENT_ID');
    const stravaRedirectUri = Deno.env.get('STRAVA_REDIRECT_URI');

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !supabaseServiceRoleKey ||
      !stravaClientId ||
      !stravaRedirectUri
    ) {
      return Response.json(
        { error: 'Strava integration is not configured.' },
        { status: 500, headers },
      );
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: request.headers.get('authorization') ?? '',
        },
      },
    });
    const { data: userData, error: userError } = await authClient.auth.getUser();

    if (userError || !userData.user) {
      return Response.json(
        { error: 'You must be signed in.' },
        { status: 401, headers },
      );
    }

    if (userData.user.email?.toLowerCase() !== ownerEmail) {
      return Response.json(
        { error: 'Only the Project Far Point owner can connect Strava.' },
        { status: 403, headers },
      );
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const state = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error: insertError } = await serviceClient
      .from('strava_oauth_states')
      .insert({
        state,
        user_id: userData.user.id,
        return_to: returnTo,
        expires_at: expiresAt,
      });

    if (insertError) {
      throw insertError;
    }

    const authorizationUrl = new URL('https://www.strava.com/oauth/authorize');
    authorizationUrl.searchParams.set('client_id', stravaClientId);
    authorizationUrl.searchParams.set('redirect_uri', stravaRedirectUri);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('approval_prompt', 'force');
    authorizationUrl.searchParams.set('scope', 'read,read_all,activity:read_all');
    authorizationUrl.searchParams.set('state', state);

    return Response.json(
      { authorizationUrl: authorizationUrl.toString() },
      { headers },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unexpected error.' },
      { status: 500, headers },
    );
  }
});
