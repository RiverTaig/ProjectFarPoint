import { corsHeaders } from '../_shared/cors.ts';
import {
  getAuthorizedUser,
  getFreshStravaConnection,
} from '../_shared/strava.ts';

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

    const user = await getAuthorizedUser(request);
    const { connection } = await getFreshStravaConnection(user.id);
    const { page = 1, perPage = 30 } = await request.json().catch(() => ({}));
    const routesUrl = new URL(
      `https://www.strava.com/api/v3/athletes/${connection.athlete_id}/routes`,
    );

    routesUrl.searchParams.set('page', String(page));
    routesUrl.searchParams.set('per_page', String(Math.min(perPage, 50)));

    const response = await fetch(routesUrl, {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Could not load Strava routes.');
    }

    const routes = await response.json();

    return Response.json(
      {
        routes: routes.map((route: Record<string, unknown>) => ({
          id: typeof route.id_str === 'string' ? route.id_str : String(route.id),
          name: route.name,
          distance: route.distance,
          elevation_gain: route.elevation_gain,
          estimated_moving_time: route.estimated_moving_time,
          created_at: route.created_at,
          updated_at: route.updated_at,
          type: route.type,
          sub_type: route.sub_type,
        })),
      },
      { headers },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unexpected error.' },
      { status: 500, headers },
    );
  }
});
