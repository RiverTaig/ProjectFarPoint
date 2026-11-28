import { corsHeaders } from '../_shared/cors.ts';
import {
  getAuthorizedUser,
  getFreshStravaConnection,
} from '../_shared/strava.ts';
import { reverseGeocodeStartLocation } from '../_shared/geocode.ts';
import { simplifyCoordinates, geometryTolerances, type Coordinate } from '../_shared/simplifyCoordinates.ts';

type ActivityMetadata = {
  startedAt?: string;
  trailName?: string;
  pfpType?: string;
  textDescription?: string;
};

type Stream = {
  type?: string;
  data?: unknown[];
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

function cleanTimestamp(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function findStream(streams: unknown, type: string) {
  if (!streams || typeof streams !== 'object') {
    return undefined;
  }

  if (!Array.isArray(streams)) {
    return (streams as Record<string, Stream>)[type]?.data;
  }

  return streams.find((stream: Stream) => stream.type === type)?.data;
}

async function createStravaError(response: Response, fallbackMessage: string) {
  const responseText = await response.text().catch(() => '');
  const detail = responseText.slice(0, 500);

  return new Error(
    detail
      ? `${fallbackMessage} Strava returned ${response.status}: ${detail}`
      : `${fallbackMessage} Strava returned ${response.status}.`,
  );
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
    const { routeId, metadata = {} } = (await request.json()) as {
      routeId?: number | string;
      metadata?: ActivityMetadata;
    };

    if (!routeId) {
      return Response.json(
        { error: 'Route ID is required.' },
        { status: 400, headers },
      );
    }

    const routeIdString = String(routeId).trim();

    if (!/^\d+$/.test(routeIdString)) {
      return Response.json(
        { error: 'Route ID must be a number.' },
        { status: 400, headers },
      );
    }

    const { connection, serviceClient } = await getFreshStravaConnection(user.id);
    const routeResponse = await fetch(
      `https://www.strava.com/api/v3/routes/${routeIdString}`,
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
        },
      },
    );

    if (!routeResponse.ok) {
      throw await createStravaError(
        routeResponse,
        'Could not load Strava route details.',
      );
    }

    const route = await routeResponse.json();
    const streamsUrl = new URL(
      `https://www.strava.com/api/v3/routes/${routeIdString}/streams`,
    );

    streamsUrl.searchParams.set('keys', 'latlng,altitude,distance');
    streamsUrl.searchParams.set('key_by_type', 'true');

    const streamsResponse = await fetch(streamsUrl, {
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
      },
    });

    if (!streamsResponse.ok) {
      throw await createStravaError(
        streamsResponse,
        'Could not load Strava route geometry.',
      );
    }

    const streams = await streamsResponse.json();
    const latLngData = findStream(streams, 'latlng') as [number, number][] | undefined;
    const altitudeData = findStream(streams, 'altitude') as number[] | undefined;

    if (!latLngData?.length) {
      throw new Error('This route does not include route geometry.');
    }

    const coordinates: Coordinate[] = latLngData.map(([latitude, longitude], index) => {
      const altitude = altitudeData?.[index];

      return typeof altitude === 'number'
        ? [longitude, latitude, altitude]
        : [longitude, latitude];
    });

    if (coordinates.length < 2) {
      throw new Error('This route does not include enough usable geometry.');
    }

    const geometry = {
      type: 'LineString',
      coordinates,
    };
    const pfpType = cleanPfpType(metadata.pfpType);
    const startedAt =
      cleanTimestamp(metadata.startedAt) ??
      cleanTimestamp(route.created_at) ??
      new Date().toISOString();
    const startLocation = await reverseGeocodeStartLocation(coordinates[0]);
    let distanceMadeGood: number | null = null;

    if (pfpType === 'Voyager') {
      const { data: calculatedDistanceMadeGood, error: distanceMadeGoodError } =
        await serviceClient.rpc('pfp_distance_made_good_km', {
          new_geometry_geojson: geometry,
          new_started_at: startedAt,
          new_source: 'strava_route',
          new_source_activity_id: routeIdString,
          threshold_meters: 15,
          new_distance_meters: route.distance,
        });

      if (distanceMadeGoodError) {
        throw distanceMadeGoodError;
      }

      distanceMadeGood = cleanNumber(calculatedDistanceMadeGood);
    }

    const { data: importedActivity, error: upsertError } = await serviceClient
      .from('project_activities')
      .upsert(
        {
          owner_user_id: user.id,
          source: 'strava_route',
          source_activity_id: routeIdString,
          strava_type: 'Route',
          strava_url: `https://www.strava.com/routes/${routeIdString}`,
          name: route.name,
          sport_type: 'Strava Route',
          started_at: startedAt,
          distance_meters: route.distance,
          moving_time_seconds: route.estimated_moving_time,
          elapsed_time_seconds: route.estimated_moving_time,
          total_elevation_gain_meters: route.elevation_gain,
          city: startLocation.city,
          state: startLocation.state,
          province: startLocation.province,
          country: startLocation.country,
          continent: startLocation.continent,
          corrected_distance: cleanNumber(Number(route.distance) / 1000),
          distance_made_good: distanceMadeGood,
          trail_name: cleanText(metadata.trailName),
          pfp_type: pfpType,
          text_description: cleanText(metadata.textDescription),
          geometry_geojson: geometry,
          geometry_simplified_low: {
            type: 'LineString',
            coordinates: simplifyCoordinates(coordinates, geometryTolerances.low),
          },
          geometry_simplified_medium: {
            type: 'LineString',
            coordinates: simplifyCoordinates(coordinates, geometryTolerances.medium),
          },
          geometry_simplified_high: {
            type: 'LineString',
            coordinates: simplifyCoordinates(coordinates, geometryTolerances.high),
          },
          raw_activity: route,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'source,source_activity_id',
        },
      )
      .select('id,name,pfp_type,distance_made_good')
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
