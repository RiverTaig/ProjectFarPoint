import { corsHeaders } from '../_shared/cors.ts';
import {
  getAuthorizedUser,
  getFreshStravaConnection,
} from '../_shared/strava.ts';

type Coordinate = [number, number] | [number, number, number];

type ActivityMetadata = {
  city?: string;
  state?: string;
  province?: string;
  country?: string;
  correctedDistance?: number | string | null;
  distanceMadeGood?: number | string | null;
  trailName?: string;
  pfpType?: string;
  textDescription?: string;
};

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function cleanPfpType(value: unknown) {
  if (value === 'Voyager' || value === 'Far Point Trail') {
    return value;
  }

  return null;
}

function perpendicularDistance(point: Coordinate, start: Coordinate, end: Coordinate) {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }

  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / Math.hypot(dx, dy);
}

function simplifyCoordinates(coordinates: Coordinate[], tolerance: number): Coordinate[] {
  if (coordinates.length <= 2) {
    return coordinates;
  }

  let maxDistance = 0;
  let index = 0;

  for (let i = 1; i < coordinates.length - 1; i += 1) {
    const distance = perpendicularDistance(
      coordinates[i],
      coordinates[0],
      coordinates[coordinates.length - 1],
    );

    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }

  if (maxDistance <= tolerance) {
    return [coordinates[0], coordinates[coordinates.length - 1]];
  }

  const left = simplifyCoordinates(coordinates.slice(0, index + 1), tolerance);
  const right = simplifyCoordinates(coordinates.slice(index), tolerance);

  return [...left.slice(0, -1), ...right];
}

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
    const { activityId, metadata = {} } = (await request.json()) as {
      activityId?: number | string;
      metadata?: ActivityMetadata;
    };

    if (!activityId) {
      return Response.json(
        { error: 'Activity ID is required.' },
        { status: 400, headers },
      );
    }

    const { connection, serviceClient } = await getFreshStravaConnection(user.id);
    const activityResponse = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
        },
      },
    );

    if (!activityResponse.ok) {
      throw new Error('Could not load Strava activity details.');
    }

    const activity = await activityResponse.json();
    const country = cleanText(metadata.country) ?? cleanText(activity.location_country);
    const state = cleanText(metadata.state) ?? cleanText(activity.location_state);
    const province =
      cleanText(metadata.province) ??
      (country === 'Canada' ? cleanText(activity.location_state) : null);
    const streamsUrl = new URL(
      `https://www.strava.com/api/v3/activities/${activityId}/streams`,
    );

    streamsUrl.searchParams.set('keys', 'latlng,altitude');
    streamsUrl.searchParams.set('key_by_type', 'true');

    const streamsResponse = await fetch(streamsUrl, {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
      },
    });

    if (!streamsResponse.ok) {
      throw new Error('Could not load Strava activity geometry.');
    }

    const streams = await streamsResponse.json();
    const latLngData = streams.latlng?.data as [number, number][] | undefined;
    const altitudeData = streams.altitude?.data as number[] | undefined;

    if (!latLngData?.length) {
      throw new Error('This activity does not include route geometry.');
    }

    const coordinates: Coordinate[] = latLngData.map(([latitude, longitude], index) => {
      const altitude = altitudeData?.[index];

      return typeof altitude === 'number'
        ? [longitude, latitude, altitude]
        : [longitude, latitude];
    });
    const geometry = {
      type: 'LineString',
      coordinates,
    };

    const { data: importedActivity, error: upsertError } = await serviceClient
      .from('project_activities')
      .upsert(
        {
          owner_user_id: user.id,
          source: 'strava',
          source_activity_id: Number(activity.id),
          name: activity.name,
          sport_type: activity.sport_type ?? activity.type,
          started_at: activity.start_date,
          distance_meters: activity.distance,
          moving_time_seconds: activity.moving_time,
          elapsed_time_seconds: activity.elapsed_time,
          total_elevation_gain_meters: activity.total_elevation_gain,
          city: cleanText(metadata.city) ?? cleanText(activity.location_city),
          state,
          province,
          country,
          corrected_distance: cleanNumber(metadata.correctedDistance),
          distance_made_good: cleanNumber(metadata.distanceMadeGood),
          trail_name: cleanText(metadata.trailName),
          pfp_type: cleanPfpType(metadata.pfpType),
          text_description: cleanText(metadata.textDescription),
          geometry_geojson: geometry,
          geometry_simplified_low: {
            type: 'LineString',
            coordinates: simplifyCoordinates(coordinates, 0.02),
          },
          geometry_simplified_medium: {
            type: 'LineString',
            coordinates: simplifyCoordinates(coordinates, 0.005),
          },
          geometry_simplified_high: {
            type: 'LineString',
            coordinates: simplifyCoordinates(coordinates, 0.001),
          },
          raw_activity: activity,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'source,source_activity_id',
        },
      )
      .select('id,name')
      .single();

    if (upsertError) {
      throw upsertError;
    }

    return Response.json({ activity: importedActivity }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unexpected error.' },
      { status: 500, headers },
    );
  }
});
