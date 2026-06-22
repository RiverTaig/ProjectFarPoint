import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { reverseGeocodeStartLocation } from '../_shared/geocode.ts';
import { getAuthorizedUser } from '../_shared/strava.ts';

type Coordinate = [number, number];

const natoWords = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliett',
  'kilo',
  'lima',
  'mike',
  'november',
  'oscar',
  'papa',
  'quebec',
  'romeo',
  'sierra',
  'tango',
  'uniform',
  'victor',
  'whiskey',
  'x-ray',
  'yankee',
  'zulu',
];

const loremSource = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur vitae mauris at neque tincidunt dictum. Integer accumsan sapien quis facilisis pretium arcu mauris tempor ipsum vitae viverra justo magna non velit.',
  'Sed non sem euismod vehicula lectus sed aliquet neque. Donec luctus nisl at posuere commodo metus justo ultrices ligula vitae pulvinar nunc libero at est. Praesent commodo augue sit amet mi varius sed dictum nibh hendrerit.',
  'Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae. Aliquam erat volutpat. Nulla facilisi. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas.',
  'Suspendisse potenti. Aenean fermentum risus vitae posuere suscipit arcu lacus dignissim augue id convallis urna magna in arcu. Morbi finibus magna id velit tincidunt a posuere justo luctus.',
  'Nam ullamcorper nisl vel tincidunt consequat massa erat pharetra justo at dictum quam velit nec neque. Donec sed augue ac sapien facilisis interdum. Etiam consequat ipsum at aliquet tincidunt lectus risus porttitor orci.',
  'Vivamus feugiat eros a ullamcorper gravida mi arcu blandit magna vel varius mi mauris sed lacus. Integer placerat turpis non neque tincidunt tincidunt. Proin vel mauris sed magna interdum congue.',
  'Phasellus at elit at mi tincidunt egestas. Maecenas ornare leo eget mauris gravida commodo. Quisque consequat orci vitae tortor dictum luctus. Integer imperdiet sem quis arcu sagittis luctus.',
  'Praesent porta nibh quis tortor luctus imperdiet. Duis ac metus sit amet augue posuere pellentesque. Nunc tempor purus in neque pharetra congue. Cras porta lorem sed mi dictum imperdiet.',
].join(' ');

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randomInteger(min: number, max: number) {
  return Math.floor(randomBetween(min, max + 1));
}

function coordinateAt(
  longitude: number,
  latitude: number,
  bearingDegrees: number,
  distanceKilometers: number,
): Coordinate {
  const earthRadiusKilometers = 6371.0088;
  const bearing = bearingDegrees * Math.PI / 180;
  const angularDistance = distanceKilometers / earthRadiusKilometers;
  const latitudeRadians = latitude * Math.PI / 180;
  const longitudeRadians = longitude * Math.PI / 180;
  const nextLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance) +
      Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const nextLongitude =
    longitudeRadians +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
      Math.cos(angularDistance) - Math.sin(latitudeRadians) * Math.sin(nextLatitude),
    );

  return [
    ((nextLongitude * 180 / Math.PI + 540) % 360) - 180,
    nextLatitude * 180 / Math.PI,
  ];
}

function randomDateBetween(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();

  return new Date(randomInteger(start, end)).toISOString();
}

function createDescription() {
  const targetLength = randomInteger(1000, 2000);
  const startIndex = randomInteger(0, Math.max(0, loremSource.length - 300));
  const repeatedText = `${loremSource.slice(startIndex)} ${loremSource} ${loremSource}`;
  const firstWord = natoWords[randomInteger(0, natoWords.length - 1)];
  let secondWord = natoWords[randomInteger(0, natoWords.length - 1)];

  if (secondWord === firstWord) {
    secondWord = natoWords[(natoWords.indexOf(firstWord) + 7) % natoWords.length];
  }

  const searchNeedle = ` Search markers: ${firstWord} ${secondWord}.`;
  const imageId = randomInteger(1, 100000);
  const imageShortcode =
    `{ExternalImage url="https://picsum.photos/seed/project-far-point-${imageId}/900/520" caption="Generated test image"}`;
  const opening = `${repeatedText.slice(0, 620)}${searchNeedle}`;
  const closing = repeatedText.slice(620, targetLength + 400);

  return `${opening}\n\n${imageShortcode}\n\n${closing}`.slice(0, targetLength + imageShortcode.length + 80);
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Supabase is not configured.');
    }

    const { latitude, longitude } = await request.json().catch(() => ({}));
    const centerLatitude = Number(latitude);
    const centerLongitude = Number(longitude);

    if (
      !Number.isFinite(centerLatitude) ||
      !Number.isFinite(centerLongitude) ||
      centerLatitude < -85 ||
      centerLatitude > 85 ||
      centerLongitude < -180 ||
      centerLongitude > 180
    ) {
      return Response.json(
        { error: 'A valid map center latitude and longitude are required.' },
        { status: 400, headers },
      );
    }

    const midpoint = coordinateAt(
      centerLongitude,
      centerLatitude,
      randomBetween(0, 360),
      randomBetween(0.4, 4.8),
    );
    const bearing = randomBetween(0, 360);
    const distanceKilometers = randomBetween(100, 300);
    const start = coordinateAt(midpoint[0], midpoint[1], bearing + 180, distanceKilometers / 2);
    const end = coordinateAt(midpoint[0], midpoint[1], bearing, distanceKilometers / 2);
    const coordinates: Coordinate[] = [start, end];
    const startLocation = await reverseGeocodeStartLocation(start);
    const roundedLatitude = start[1].toFixed(5);
    const roundedLongitude = start[0].toFixed(5);
    const sourceActivityId =
      (BigInt(Date.now()) * 1000n + BigInt(randomInteger(0, 999))).toString();
    const movingTimeSeconds = Math.round(distanceKilometers * 1000 / randomBetween(8, 16));
    const pfpType = startLocation.province === 'Alberta' ? 'Far Point Trail' : 'Voyager';
    const geometry = {
      type: 'LineString',
      coordinates,
    };
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { data: activity, error } = await serviceClient
      .from('project_activities')
      .insert({
        owner_user_id: user.id,
        source: 'test_generator',
        source_activity_id: sourceActivityId,
        strava_type: null,
        strava_url: null,
        name: `Random walk at ${roundedLatitude}, ${roundedLongitude}`,
        sport_type: 'Random Walk',
        started_at: randomDateBetween('2027-01-01T00:00:00.000Z', '2037-12-31T23:59:59.999Z'),
        distance_meters: Math.round(distanceKilometers * 1000),
        moving_time_seconds: movingTimeSeconds,
        elapsed_time_seconds: movingTimeSeconds + randomInteger(0, 1200),
        total_elevation_gain_meters: randomInteger(0, 850),
        city: startLocation.city,
        state: startLocation.state,
        province: startLocation.province,
        country: startLocation.country,
        continent: startLocation.continent,
        corrected_distance: Number(distanceKilometers.toFixed(3)),
        distance_made_good: Number(distanceKilometers.toFixed(3)),
        trail_name: null,
        pfp_type: pfpType,
        text_description: createDescription(),
        geometry_geojson: geometry,
        geometry_simplified_low: geometry,
        geometry_simplified_medium: geometry,
        geometry_simplified_high: geometry,
        raw_activity: {
          generated: true,
          center: [centerLongitude, centerLatitude],
          midpoint,
          bearing,
        },
        updated_at: new Date().toISOString(),
      })
      .select(
        'id,name,sport_type,started_at,pfp_type,trail_name,city,state,province,country,continent,corrected_distance,distance_made_good,strava_type,strava_url,text_description,geometry_simplified_medium,geometry_geojson',
      )
      .single();

    if (error) {
      throw error;
    }

    return Response.json({ activity }, { headers });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unexpected error.' },
      { status: 500, headers },
    );
  }
});
