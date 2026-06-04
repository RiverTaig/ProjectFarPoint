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
    const activitiesUrl = new URL('https://www.strava.com/api/v3/athlete/activities');

    activitiesUrl.searchParams.set('page', String(page));
    activitiesUrl.searchParams.set('per_page', String(Math.min(perPage, 50)));

    const response = await fetch(activitiesUrl, {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Could not load Strava activities.');
    }

    const activities = await response.json();

    return Response.json(
      {
        activities: activities.map((activity: Record<string, unknown>) => ({
          id: activity.id,
          name: activity.name,
          sport_type: activity.sport_type ?? activity.type,
          start_date: activity.start_date,
          distance: activity.distance,
          moving_time: activity.moving_time,
          elapsed_time: activity.elapsed_time,
          total_elevation_gain: activity.total_elevation_gain,
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
