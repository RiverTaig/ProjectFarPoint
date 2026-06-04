import { createClient } from 'npm:@supabase/supabase-js@2';

type StravaConnection = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

export async function getFreshStravaConnection(userId: string) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stravaClientId = Deno.env.get('STRAVA_CLIENT_ID');
  const stravaClientSecret = Deno.env.get('STRAVA_CLIENT_SECRET');

  if (!supabaseUrl || !supabaseServiceRoleKey || !stravaClientId || !stravaClientSecret) {
    throw new Error('Strava integration is not configured.');
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: connection, error } = await serviceClient
    .from('strava_connections')
    .select('user_id,access_token,refresh_token,expires_at')
    .eq('user_id', userId)
    .maybeSingle<StravaConnection>();

  if (error) {
    throw error;
  }

  if (!connection) {
    throw new Error('Strava is not connected.');
  }

  if (new Date(connection.expires_at).getTime() > Date.now() + 60_000) {
    return { connection, serviceClient };
  }

  const refreshResponse = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
    }),
  });

  if (!refreshResponse.ok) {
    throw new Error('Could not refresh Strava access.');
  }

  const refreshData = await refreshResponse.json();
  const refreshedConnection = {
    ...connection,
    access_token: refreshData.access_token,
    refresh_token: refreshData.refresh_token,
    expires_at: new Date(refreshData.expires_at * 1000).toISOString(),
  };

  const { error: updateError } = await serviceClient
    .from('strava_connections')
    .update({
      access_token: refreshedConnection.access_token,
      refresh_token: refreshedConnection.refresh_token,
      expires_at: refreshedConnection.expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (updateError) {
    throw updateError;
  }

  return { connection: refreshedConnection, serviceClient };
}

export async function getAuthorizedUser(request: Request) {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase is not configured.');
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: request.headers.get('authorization') ?? '',
      },
    },
  });
  const { data, error } = await authClient.auth.getUser();

  if (error || !data.user) {
    throw new Error('You must be signed in.');
  }

  if (data.user.email?.toLowerCase() !== 'rivermadsen23@gmail.com') {
    throw new Error('Only the Project Far Point owner can import activities.');
  }

  return data.user;
}
