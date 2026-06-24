import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CSSProperties,
  ChangeEvent,
  FormEvent,
  ReactNode,
  TouchEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import '@arcgis/core/assets/esri/themes/dark/main.css';
import Camera from '@arcgis/core/Camera.js';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Map from '@arcgis/core/Map.js';
import SceneView from '@arcgis/core/views/SceneView.js';
import type { ResourceHandle } from '@arcgis/core/core/Handles.js';
import type LayerView from '@arcgis/core/views/layers/LayerView.js';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import './styles.css';

type LatLon = {
  latitude: number;
  longitude: number;
};

type Vector3 = [number, number, number];

type ProjectActivity = {
  id: string;
  name: string;
  sport_type: string | null;
  started_at: string | null;
  pfp_type: 'Voyager' | 'Far Point Trail' | null;
  trail_name: string | null;
  city: string | null;
  state: string | null;
  province: string | null;
  country: string | null;
  continent: string | null;
  corrected_distance: number | string | null;
  distance_made_good: number | string | null;
  strava_type: 'Activity' | 'Route' | null;
  strava_url: string | null;
  text_description: string | null;
  geometry_simplified_medium: {
    type: 'LineString';
    coordinates: number[][];
  } | null;
  geometry_geojson: {
    type: 'LineString';
    coordinates: number[][];
  } | null;
};

type SelectedProjectActivity = Pick<
  ProjectActivity,
  | 'id'
  | 'name'
  | 'sport_type'
  | 'started_at'
  | 'pfp_type'
  | 'trail_name'
  | 'city'
  | 'state'
  | 'province'
  | 'country'
  | 'continent'
  | 'corrected_distance'
  | 'distance_made_good'
  | 'strava_type'
  | 'strava_url'
  | 'text_description'
>;

type ProjectActivityImage = {
  id: string;
  activity_id: string;
  name: string;
  storage_bucket: string;
  storage_path: string;
  caption: string | null;
  alt_text: string | null;
  sort_order: number;
};

type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
  location_city: string | null;
  location_state: string | null;
  location_country: string | null;
};

type StravaRoute = {
  id: string;
  name: string;
  distance: number;
  elevation_gain: number | null;
  estimated_moving_time: number | null;
  created_at: string | null;
  updated_at: string | null;
  type: number | null;
  sub_type: number | null;
};

type StravaImportKind = 'activity' | 'route';
type StravaImportItem = StravaActivity | StravaRoute;

type ActivityMetadata = {
  startedAt: string;
  trailName: string;
  pfpType: 'Voyager' | 'Far Point Trail';
  textDescription: string;
};

type ActivityImageInput = {
  id: string;
  name: string;
  caption: string;
  file: File | null;
};

type ProjectPathFilter = 'Voyager' | 'Far Point Trail' | '';
type SearchSortField = 'date' | 'distance' | 'name' | 'location';
type SearchSortDirection = 'asc' | 'desc';

type SearchPanelProps = {
  onActivitySelect: (activity: ProjectActivity) => void;
};

type ProgressPath = 'Voyager' | 'Far Point Trail';

type ProgressPosition = {
  activity: ProjectActivity;
  progressKilometers: number;
  position: LatLon;
};

const projectActivitySelectColumns =
  'id,name,sport_type,started_at,pfp_type,trail_name,city,state,province,country,continent,corrected_distance,distance_made_good,strava_type,strava_url,text_description,geometry_simplified_medium,geometry_geojson';

const voyagerStart: LatLon = {
  latitude: -42.880468,
  longitude: 171.454274,
};

const everestSummit: LatLon = {
  latitude: 27.98785,
  longitude: 86.925026,
};

const everestAntipode: LatLon = {
  latitude: -everestSummit.latitude,
  longitude: normalizeLongitude(everestSummit.longitude + 180),
};

const calgary: LatLon = {
  latitude: 51.0447,
  longitude: -114.0719,
};

const halfJourneyKilometers = 20038;
const earthCircumferenceKilometers = halfJourneyKilometers * 2;
const sampleProgressKilometers = 1000;
const guideRouteWidth = 3.4;
const progressMarkersVisibleWidthKilometers = 300;
const progressLabelsVisibleWidthKilometers = 100;

const voyagerAntipode: LatLon = {
  latitude: -voyagerStart.latitude,
  longitude: normalizeLongitude(voyagerStart.longitude + 180),
};

function degreesToRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function normalizeLongitude(longitude: number) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function toVector({ latitude, longitude }: LatLon): Vector3 {
  const latitudeRadians = degreesToRadians(latitude);
  const longitudeRadians = degreesToRadians(longitude);
  const cosLatitude = Math.cos(latitudeRadians);

  return [
    cosLatitude * Math.cos(longitudeRadians),
    cosLatitude * Math.sin(longitudeRadians),
    Math.sin(latitudeRadians),
  ];
}

function toLatLon([x, y, z]: Vector3): LatLon {
  return {
    latitude: radiansToDegrees(Math.atan2(z, Math.hypot(x, y))),
    longitude: normalizeLongitude(radiansToDegrees(Math.atan2(y, x))),
  };
}

function dot(left: Vector3, right: Vector3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalize([x, y, z]: Vector3): Vector3 {
  const length = Math.hypot(x, y, z);

  return [x / length, y / length, z / length];
}

function greatCirclePoint(start: Vector3, direction: Vector3, angle: number) {
  return normalize([
    Math.cos(angle) * start[0] + Math.sin(angle) * direction[0],
    Math.cos(angle) * start[1] + Math.sin(angle) * direction[1],
    Math.cos(angle) * start[2] + Math.sin(angle) * direction[2],
  ]);
}

function splitPathAtAntimeridian(path: number[][]) {
  const paths: number[][][] = [[path[0]]];
  let previousLatitude = path[0][1];
  let previousUnwrappedLongitude = path[0][0];

  for (const [longitude, latitude] of path.slice(1)) {
    let unwrappedLongitude = longitude;

    while (unwrappedLongitude - previousUnwrappedLongitude > 180) {
      unwrappedLongitude -= 360;
    }

    while (unwrappedLongitude - previousUnwrappedLongitude < -180) {
      unwrappedLongitude += 360;
    }

    const longitudeDelta = unwrappedLongitude - previousUnwrappedLongitude;
    const crossesAntimeridian =
      Math.abs(longitudeDelta) > 0 &&
      (Math.abs(previousUnwrappedLongitude) < 180 ||
        Math.abs(unwrappedLongitude) < 180) &&
      Math.trunc(previousUnwrappedLongitude / 180) !==
        Math.trunc(unwrappedLongitude / 180);

    if (crossesAntimeridian) {
      const boundary = longitudeDelta > 0 ? 180 : -180;
      const oppositeBoundary = longitudeDelta > 0 ? -180 : 180;
      const progress =
        (boundary - previousUnwrappedLongitude) / longitudeDelta;
      const boundaryLatitude =
        previousLatitude + progress * (latitude - previousLatitude);
      const currentPath = paths[paths.length - 1];

      currentPath.push([boundary, boundaryLatitude]);
      paths.push([[oppositeBoundary, boundaryLatitude]]);
    }

    paths[paths.length - 1].push([normalizeLongitude(unwrappedLongitude), latitude]);
    previousLatitude = latitude;
    previousUnwrappedLongitude = unwrappedLongitude;
  }

  return paths;
}

function createAntipodalRoutePath(
  startPoint: LatLon,
  waypoint: LatLon,
  maxAngle = Math.PI,
) {
  const start = toVector(startPoint);
  const waypointVector = toVector(waypoint);
  const direction = normalize([
    waypointVector[0] - dot(waypointVector, start) * start[0],
    waypointVector[1] - dot(waypointVector, start) * start[1],
    waypointVector[2] - dot(waypointVector, start) * start[2],
  ]);
  const waypointAngle = Math.atan2(
    dot(waypointVector, direction),
    dot(waypointVector, start),
  );
  const routeAngles = Array.from(
    { length: 180 },
    (_, index) => (maxAngle * index) / 179,
  );

  if (waypointAngle > 0 && waypointAngle < maxAngle) {
    routeAngles.push(waypointAngle);
    routeAngles.sort((left, right) => left - right);
  }

  const path = routeAngles.map((angle) => {
    const { latitude, longitude } = toLatLon(
      greatCirclePoint(start, direction, angle),
    );

    return [longitude, latitude];
  });

  return splitPathAtAntimeridian(path);
}

function createVoyagerRoutePath() {
  return createAntipodalRoutePath(voyagerStart, everestSummit);
}

function createFarPointTrailPath() {
  return createAntipodalRoutePath(voyagerStart, everestAntipode);
}

function createVoyagerProgressPath() {
  return createAntipodalRoutePath(
    voyagerStart,
    everestSummit,
    Math.PI * (sampleProgressKilometers / halfJourneyKilometers),
  );
}

function createFarPointProgressPath() {
  return createAntipodalRoutePath(
    voyagerAntipode,
    everestAntipode,
    Math.PI * (sampleProgressKilometers / halfJourneyKilometers),
  );
}

function getGreatCirclePosition(
  startPoint: LatLon,
  waypoint: LatLon,
  distanceKilometers: number,
) {
  const start = toVector(startPoint);
  const waypointVector = toVector(waypoint);
  const direction = normalize([
    waypointVector[0] - dot(waypointVector, start) * start[0],
    waypointVector[1] - dot(waypointVector, start) * start[1],
    waypointVector[2] - dot(waypointVector, start) * start[2],
  ]);
  const angle = Math.PI * (distanceKilometers / halfJourneyKilometers);

  return toLatLon(greatCirclePoint(start, direction, angle));
}

function getProgressPosition(path: ProgressPath, distanceKilometers: number) {
  const wrappedDistance =
    ((distanceKilometers % earthCircumferenceKilometers) +
      earthCircumferenceKilometers) %
    earthCircumferenceKilometers;
  const isPastFirstHalf = wrappedDistance > halfJourneyKilometers;
  const segmentDistance = isPastFirstHalf
    ? wrappedDistance - halfJourneyKilometers
    : wrappedDistance;

  if (path === 'Voyager') {
    return isPastFirstHalf
      ? getGreatCirclePosition(voyagerAntipode, everestAntipode, segmentDistance)
      : getGreatCirclePosition(voyagerStart, everestSummit, segmentDistance);
  }

  return isPastFirstHalf
    ? getGreatCirclePosition(voyagerStart, everestSummit, segmentDistance)
    : getGreatCirclePosition(voyagerAntipode, everestAntipode, segmentDistance);
}

function createActivityPaths(activity: ProjectActivity) {
  const geometry = activity.geometry_geojson ?? activity.geometry_simplified_medium;

  if (!geometry?.coordinates?.length) {
    return [];
  }

  return splitPathAtAntimeridian(
    geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude]),
  );
}

function getActivityLineColor(activity: ProjectActivity): [number, number, number, number] {
  if (activity.pfp_type === 'Far Point Trail') {
    return [166, 224, 49, 0.96];
  }

  return [51, 198, 255, 0.96];
}

function createActivityLineSymbol(activity: ProjectActivity, isSelected = false) {
  return {
    type: 'simple-line',
    color: isSelected ? [255, 220, 70, 1] : getActivityLineColor(activity),
    width: isSelected ? 7 : 4,
  } as const;
}

function getKilometerValue(value: number | string | null) {
  if (value === null || value === '') {
    return 0;
  }

  const numberValue = typeof value === 'string' ? Number(value) : value;

  return Number.isFinite(numberValue) ? Math.max(numberValue, 0) : 0;
}

function getActivityStartTime(activity: ProjectActivity) {
  if (!activity.started_at) {
    return Number.POSITIVE_INFINITY;
  }

  const time = new Date(activity.started_at).getTime();

  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function createProgressPositions(activities: ProjectActivity[]) {
  const positions: ProgressPosition[] = [];
  const activitiesByPath = new globalThis.Map<ProgressPath, ProjectActivity[]>();

  activities.forEach((activity) => {
    if (activity.pfp_type !== 'Voyager' && activity.pfp_type !== 'Far Point Trail') {
      return;
    }

    const pathActivities = activitiesByPath.get(activity.pfp_type) ?? [];
    pathActivities.push(activity);
    activitiesByPath.set(activity.pfp_type, pathActivities);
  });

  activitiesByPath.forEach((pathActivities, path) => {
    let runningTotal = 0;

    pathActivities
      .sort((left, right) => {
        const dateDifference = getActivityStartTime(left) - getActivityStartTime(right);

        if (dateDifference !== 0) {
          return dateDifference;
        }

        return left.id.localeCompare(right.id);
      })
      .forEach((activity) => {
        runningTotal += getKilometerValue(activity.distance_made_good);
        positions.push({
          activity,
          progressKilometers: runningTotal,
          position: getProgressPosition(path, runningTotal),
        });
      });
  });

  return positions;
}

function createProgressMarkerSymbol(activity: ProjectActivity, isSelected = false) {
  const isFarPoint = activity.pfp_type === 'Far Point Trail';
  const fillColor = isSelected
    ? '#ffdc46'
    : isFarPoint
      ? '#a6e031'
      : '#33c6ff';
  const haloColor = isFarPoint ? '#24340d' : '#082b3d';
  const size = isSelected ? 30 : 24;
  const pinSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44">
      <path d="M16 42 10.6 27.6C5.2 25.5 2 20.7 2 15.4 2 7.8 8.3 2 16 2s14 5.8 14 13.4c0 5.3-3.2 10.1-8.6 12.2L16 42Z" fill="${fillColor}" stroke="#020611" stroke-width="3"/>
      <circle cx="16" cy="15.5" r="6.1" fill="#fffef8" fill-opacity="0.92" stroke="${haloColor}" stroke-width="2"/>
    </svg>
  `.trim();

  return {
    type: 'picture-marker',
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pinSvg)}`,
    width: size,
    height: Math.round(size * 1.375),
    yoffset: Math.round((size * 1.375) / 2),
  } as const;
}

function createProgressLabelSymbol(activity: ProjectActivity) {
  return {
    type: 'text',
    text: activity.trail_name || activity.name,
    color: activity.pfp_type === 'Far Point Trail'
      ? [219, 255, 127, 1]
      : [155, 228, 255, 1],
    haloColor: [2, 6, 17, 0.96],
    haloSize: 1.4,
    font: {
      family: 'Inter, Arial, sans-serif',
      size: 10.5,
      weight: 'bold',
    },
    yoffset: 14,
  } as const;
}

function getHaversineKilometers(start: LatLon, end: LatLon) {
  const earthRadiusKilometers = 6371.0088;
  const startLatitude = degreesToRadians(start.latitude);
  const endLatitude = degreesToRadians(end.latitude);
  const latitudeDelta = degreesToRadians(end.latitude - start.latitude);
  const longitudeDelta = degreesToRadians(end.longitude - start.longitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    earthRadiusKilometers *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function getViewWidthKilometers(view: SceneView) {
  if (!view.width || !view.height) {
    return Number.POSITIVE_INFINITY;
  }

  const centerY = view.height / 2;
  const leftPoint = view.toMap({ x: 0, y: centerY });
  const rightPoint = view.toMap({ x: view.width, y: centerY });

  if (!leftPoint || !rightPoint) {
    return Number.POSITIVE_INFINITY;
  }

  const leftLatitude = leftPoint.latitude;
  const leftLongitude = leftPoint.longitude;
  const rightLatitude = rightPoint.latitude;
  const rightLongitude = rightPoint.longitude;

  if (
    typeof leftLatitude !== 'number' ||
    typeof leftLongitude !== 'number' ||
    typeof rightLatitude !== 'number' ||
    typeof rightLongitude !== 'number' ||
    !Number.isFinite(leftLatitude) ||
    !Number.isFinite(leftLongitude) ||
    !Number.isFinite(rightLatitude) ||
    !Number.isFinite(rightLongitude)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return getHaversineKilometers(
    {
      latitude: leftLatitude,
      longitude: leftLongitude,
    },
    {
      latitude: rightLatitude,
      longitude: rightLongitude,
    },
  );
}

function formatDateTimeLocalInput(value?: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return offsetDate.toISOString().slice(0, 16);
}

function localDateTimeInputToIso(value: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function createActivityMetadata(item?: StravaImportItem): ActivityMetadata {
  const isActivity = Boolean(item && 'start_date' in item);
  const activity = isActivity ? (item as StravaActivity) : null;
  const route = !isActivity ? (item as StravaRoute | undefined) : null;

  return {
    startedAt: formatDateTimeLocalInput(activity?.start_date ?? route?.created_at),
    trailName: '',
    pfpType: 'Voyager',
    textDescription: '',
  };
}

function prepareActivityMetadata(metadata: ActivityMetadata): ActivityMetadata {
  return {
    ...metadata,
    startedAt: localDateTimeInputToIso(metadata.startedAt),
  };
}

async function getFunctionErrorMessage(error: unknown, fallbackMessage: string) {
  const context =
    typeof error === 'object' && error !== null && 'context' in error
      ? (error as { context?: Response }).context
      : null;

  if (context) {
    try {
      const body = await context.clone().json();
      const message = body?.error ?? body?.message;

      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    } catch {
      try {
        const text = await context.clone().text();

        if (text.trim()) {
          return text;
        }
      } catch {
        // Fall through to the generic error below.
      }
    }
  }

  return error instanceof Error && error.message !== 'Edge Function returned a non-2xx status code'
    ? error.message
    : fallbackMessage;
}

function extractStravaRouteId(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return '';
  }

  const routeIdMatch = trimmedValue.match(/(?:^|\/routes\/)(\d+)(?:[/?#]|$)/);

  return routeIdMatch?.[1] ?? trimmedValue;
}

function createActivityImageInput(): ActivityImageInput {
  return {
    id: crypto.randomUUID(),
    name: '',
    caption: '',
    file: null,
  };
}

function createLoremIpsumDescription() {
  const paragraphs = [
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Curabitur vitae mauris at neque tincidunt dictum. Integer accumsan, sapien quis facilisis pretium, arcu mauris tempor ipsum, vitae viverra justo magna non velit. Sed non sem euismod, vehicula lectus sed, aliquet neque. Donec luctus, nisl at posuere commodo, metus justo ultrices ligula, vitae pulvinar nunc libero at est. Praesent commodo augue sit amet mi varius, sed dictum nibh hendrerit.',
    'Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Aliquam erat volutpat. Nulla facilisi. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. "Quoted trail notes" and single-quoted observations can live here safely because this text is stored as data, not HTML. Suspendisse potenti. Aenean fermentum, risus vitae posuere suscipit, arcu lacus dignissim augue, id convallis urna magna in arcu.',
    'Morbi finibus magna id velit tincidunt, a posuere justo luctus. Nam ullamcorper, nisl vel tincidunt consequat, massa erat pharetra justo, at dictum quam velit nec neque. Donec sed augue ac sapien facilisis interdum. Etiam consequat, ipsum at aliquet tincidunt, lectus risus porttitor orci, non malesuada lectus urna id turpis. Vivamus feugiat, eros a ullamcorper gravida, mi arcu blandit magna, vel varius mi mauris sed lacus.',
  ];

  return paragraphs.join('\n\n').slice(0, 1000);
}

function formatKilometers(value: number | string | null) {
  if (value === null || value === '') {
    return null;
  }

  const numberValue = typeof value === 'string' ? Number(value) : value;

  if (!Number.isFinite(numberValue)) {
    return null;
  }

  return `${numberValue.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })} km`;
}

function formatActivityDateTime(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const videoShortcodeOrYouTubeUrlPattern =
  /\{(Video|Image|ImageCarousel|ExternalImage)\s+([^{}]+)\}|https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\/[^\s<>"']+/gi;
const quotedAttributePattern = /(\w+)="([^"]*)"/g;
const trailingUrlPunctuationPattern = /[),.;:!?]+$/;
const imageNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const mobileMapControlMinX = 6;
const mobileMapControlMaxX = 94;
const mobileMapOpacityMin = 0.25;
const mobileMapOpacityMax = 1;
const mobileMapStoryPreset = {
  controlX: 32,
  height: 34,
  opacity: 0.46,
};
const mobileMapFocusPreset = {
  controlX: mobileMapControlMaxX,
  height: 70,
  opacity: mobileMapOpacityMax,
};

function parseYouTubeStartSeconds(startTime: string) {
  if (/^\d+$/.test(startTime)) {
    return startTime;
  }

  const hours = Number(startTime.match(/(\d+)h/)?.[1] ?? 0);
  const minutes = Number(startTime.match(/(\d+)m/)?.[1] ?? 0);
  const seconds = Number(startTime.match(/(\d+)s/)?.[1] ?? 0);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  return totalSeconds > 0 ? String(totalSeconds) : '';
}

function getYouTubeEmbedUrl(rawUrl: string) {
  try {
    const parsedUrl = new URL(rawUrl);
    const hostname = parsedUrl.hostname.replace(/^(www|m)\./, '');
    let videoId: string | null = null;

    if (hostname === 'youtu.be') {
      videoId = parsedUrl.pathname.split('/').filter(Boolean)[0] ?? null;
    }

    if (hostname === 'youtube.com') {
      if (parsedUrl.pathname === '/watch') {
        videoId = parsedUrl.searchParams.get('v');
      } else {
        const [, route, id] = parsedUrl.pathname.split('/');

        if (['embed', 'shorts', 'live'].includes(route)) {
          videoId = id ?? null;
        }
      }
    }

    if (!videoId) {
      return null;
    }

    const embedUrl = new URL(
      `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`,
    );
    const playlistId = parsedUrl.searchParams.get('list');
    const startTime = parsedUrl.searchParams.get('t') ?? parsedUrl.searchParams.get('start');

    if (playlistId) {
      embedUrl.searchParams.set('list', playlistId);
    }

    if (startTime) {
      const startSeconds = parseYouTubeStartSeconds(startTime);

      if (startSeconds) {
        embedUrl.searchParams.set('start', startSeconds);
      }
    }

    return embedUrl.toString();
  } catch {
    return null;
  }
}

function splitTrailingUrlPunctuation(url: string) {
  const punctuation = url.match(trailingUrlPunctuationPattern)?.[0] ?? '';

  return {
    url: punctuation ? url.slice(0, -punctuation.length) : url,
    punctuation,
  };
}

function parseQuotedAttributes(value: string) {
  const attributes: Record<string, string> = {};

  for (const match of value.matchAll(quotedAttributePattern)) {
    attributes[match[1]] = match[2];
  }

  return attributes;
}

function getImageFileExtension(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';

  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extension)) {
    return extension === 'jpeg' ? 'jpg' : extension;
  }

  switch (file.type) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'jpg';
  }
}

function getActivityImagePublicUrl(image: ProjectActivityImage) {
  if (!supabase) {
    return '';
  }

  return supabase.storage
    .from(image.storage_bucket)
    .getPublicUrl(image.storage_path).data.publicUrl;
}

function setBasemapLabelsVisible(map: Map, isVisible: boolean) {
  map.basemap?.referenceLayers?.forEach((layer) => {
    layer.visible = isVisible;
  });
}

async function playOpeningGlobeAnimation(view: SceneView) {
  const finalCamera = new Camera({
    position: {
      longitude: -3.7,
      latitude: 39.8,
      z: 6500000,
    },
    heading: 0,
    tilt: 0,
  });

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await view.goTo(finalCamera, { animate: false });
    return;
  }

  const cameraStops = [
    new Camera({
      position: {
        longitude: -58,
        latitude: 18,
        z: 23000000,
      },
      heading: 0,
      tilt: 0,
    }),
    new Camera({
      position: {
        longitude: -12,
        latitude: 33,
        z: 12500000,
      },
      heading: 0,
      tilt: 0,
    }),
    finalCamera,
  ];

  for (const camera of cameraStops) {
    await view.goTo(camera, {
      duration: 4200,
      easing: 'ease-in-out',
    });
  }
}

type GlobeViewProps = {
  session: Session | null;
  selectedActivityId: string | null;
  focusActivityId: string | null;
  focusActivityKey: number;
  focusProgressActivityId: string | null;
  focusProgressActivityKey: number;
  onActivitySelect: (activity: SelectedProjectActivity) => void;
};

function GlobeView({
  session,
  selectedActivityId,
  focusActivityId,
  focusActivityKey,
  focusProgressActivityId,
  focusProgressActivityKey,
  onActivitySelect,
}: GlobeViewProps) {
  const sceneNode = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<SceneView | null>(null);
  const importedActivityGraphics = useRef(new globalThis.Map<string, Graphic>());
  const progressActivityGraphics = useRef(new globalThis.Map<string, Graphic>());
  const focusedProgressLayerRef = useRef<GraphicsLayer | null>(null);
  const selectedActivityGraphic = useRef<Graphic | null>(null);
  const selectedProgressGraphic = useRef<Graphic | null>(null);
  const [isGlobeReady, setIsGlobeReady] = useState(false);
  const [isGeneratingTestActivity, setIsGeneratingTestActivity] = useState(false);
  const [testGeneratorStatus, setTestGeneratorStatus] = useState('');
  const [testGeneratorError, setTestGeneratorError] = useState('');
  const loadingLogoUrl = `${import.meta.env.BASE_URL}ProjectFarPointLoader.png`;

  useEffect(() => {
    const previousGraphic = selectedActivityGraphic.current;

    if (previousGraphic) {
      previousGraphic.symbol = createActivityLineSymbol(
        previousGraphic.attributes.activity as ProjectActivity,
      );
      selectedActivityGraphic.current = null;
    }

    if (!selectedActivityId) {
      return;
    }

    const nextGraphic = importedActivityGraphics.current.get(selectedActivityId);

    if (nextGraphic) {
      nextGraphic.symbol = createActivityLineSymbol(
        nextGraphic.attributes.activity as ProjectActivity,
        true,
      );
      selectedActivityGraphic.current = nextGraphic;
    }
  }, [selectedActivityId]);

  useEffect(() => {
    const previousProgressGraphic = selectedProgressGraphic.current;

    if (previousProgressGraphic) {
      previousProgressGraphic.symbol = createProgressMarkerSymbol(
        previousProgressGraphic.attributes.activity as ProjectActivity,
      );
      selectedProgressGraphic.current = null;
    }

    if (!selectedActivityId) {
      return;
    }

    const nextProgressGraphic = progressActivityGraphics.current.get(selectedActivityId);

    if (nextProgressGraphic) {
      nextProgressGraphic.symbol = createProgressMarkerSymbol(
        nextProgressGraphic.attributes.activity as ProjectActivity,
        true,
      );
      selectedProgressGraphic.current = nextProgressGraphic;
    }
  }, [selectedActivityId]);

  useEffect(() => {
    if (!focusActivityId || focusActivityKey === 0) {
      return;
    }

    const targetActivityId = focusActivityId;
    let retryCount = 0;
    let retryTimeout: number | null = null;

    function focusActivity() {
      const view = viewRef.current;
      const graphic = importedActivityGraphics.current.get(targetActivityId);
      const extent = graphic?.geometry?.extent;

      if (!view || !extent) {
        if (retryCount < 12) {
          retryCount += 1;
          retryTimeout = window.setTimeout(focusActivity, 250);
        }

        return;
      }

      focusedProgressLayerRef.current?.removeAll();
      view.goTo(extent.expand(1.35), {
        animate: true,
        duration: 900,
      }).catch(() => {
        // The view may be interrupted by a user pan/zoom.
      });
    }

    focusActivity();

    return () => {
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [focusActivityId, focusActivityKey]);

  useEffect(() => {
    if (!focusProgressActivityId || focusProgressActivityKey === 0) {
      return;
    }

    const targetActivityId = focusProgressActivityId;
    let retryCount = 0;
    let retryTimeout: number | null = null;

    function focusProgressPosition() {
      const view = viewRef.current;
      const graphic = progressActivityGraphics.current.get(targetActivityId);
      const focusedProgressLayer = focusedProgressLayerRef.current;

      if (!view || !graphic?.geometry || !focusedProgressLayer) {
        if (retryCount < 12) {
          retryCount += 1;
          retryTimeout = window.setTimeout(focusProgressPosition, 250);
        }

        return;
      }

      const activity = graphic.attributes.activity as ProjectActivity;

      focusedProgressLayer.removeAll();
      focusedProgressLayer.add(
        new Graphic({
          geometry: graphic.geometry,
          symbol: createProgressMarkerSymbol(activity, true),
          attributes: {
            activityId: activity.id,
            activity,
            isFocusedProgressPosition: true,
          },
        }),
      );
      focusedProgressLayer.add(
        new Graphic({
          geometry: graphic.geometry,
          symbol: createProgressLabelSymbol(activity),
          attributes: {
            activityId: activity.id,
            activity,
            isFocusedProgressLabel: true,
          },
        }),
      );
      view.goTo(
        {
          target: graphic.geometry,
          scale: 18000000,
          tilt: 0,
        },
        {
          animate: true,
          duration: 1200,
        },
      ).catch(() => {
        // The view may be interrupted by a user pan/zoom.
      });
    }

    focusProgressPosition();

    return () => {
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [focusProgressActivityId, focusProgressActivityKey]);

  useEffect(() => {
    if (!sceneNode.current) {
      return;
    }

    setIsGlobeReady(false);
    let isDestroyed = false;
    let importedActivitiesLayer: GraphicsLayer | null = null;
    const projectActivities = new globalThis.Map<string, ProjectActivity>();

    const map = new Map({
      basemap: 'hybrid',
      ground: 'world-elevation',
    });
    const voyagerRouteLayer = new GraphicsLayer({
      title: 'Project Far Point routes',
      elevationInfo: {
        mode: 'on-the-ground',
      },
    });
    const progressMarkerLayer = new GraphicsLayer({
      title: 'Progress positions',
      visible: false,
      elevationInfo: {
        mode: 'on-the-ground',
      },
    });
    const progressLabelLayer = new GraphicsLayer({
      title: 'Progress position labels',
      visible: false,
      elevationInfo: {
        mode: 'on-the-ground',
      },
    });
    const focusedProgressLayer = new GraphicsLayer({
      title: 'Focused progress position',
      elevationInfo: {
        mode: 'on-the-ground',
      },
    });
    focusedProgressLayerRef.current = focusedProgressLayer;
    const voyagerRoute = new Graphic({
      geometry: {
        type: 'polyline',
        paths: createVoyagerRoutePath(),
        spatialReference: {
          wkid: 4326,
        },
      },
      symbol: {
        type: 'simple-line',
        color: [76, 143, 174, 0.7],
        width: guideRouteWidth,
      },
      attributes: {
        name: 'Voyager',
        start: `${voyagerStart.latitude}, ${voyagerStart.longitude}`,
        end: `${voyagerAntipode.latitude}, ${voyagerAntipode.longitude}`,
        via: `${everestSummit.latitude}, ${everestSummit.longitude}`,
      },
    });
    const farPointTrail = new Graphic({
      geometry: {
        type: 'polyline',
        paths: createFarPointTrailPath(),
        spatialReference: {
          wkid: 4326,
        },
      },
      symbol: {
        type: 'simple-line',
        color: [112, 130, 84, 0.62],
        width: guideRouteWidth,
      },
      attributes: {
        name: 'Far Point Trail',
        start: `${voyagerStart.latitude}, ${voyagerStart.longitude}`,
        end: `${voyagerAntipode.latitude}, ${voyagerAntipode.longitude}`,
        via: `${everestAntipode.latitude}, ${everestAntipode.longitude}`,
      },
    });
    const voyagerProgress = new Graphic({
      geometry: {
        type: 'polyline',
        paths: createVoyagerProgressPath(),
        spatialReference: {
          wkid: 4326,
        },
      },
      symbol: {
        type: 'simple-line',
        color: [51, 198, 255, 1],
        width: 7,
      },
      attributes: {
        name: 'Voyager progress',
        distance: `${sampleProgressKilometers} km`,
      },
    });
    const farPointProgress = new Graphic({
      geometry: {
        type: 'polyline',
        paths: createFarPointProgressPath(),
        spatialReference: {
          wkid: 4326,
        },
      },
      symbol: {
        type: 'simple-line',
        color: [166, 224, 49, 1],
        width: 7,
      },
      attributes: {
        name: 'Far Point Trail progress',
        distance: `${sampleProgressKilometers} km`,
      },
    });
    const cathedralMarker = new Graphic({
      geometry: {
        type: 'point',
        longitude: voyagerAntipode.longitude,
        latitude: voyagerAntipode.latitude,
        spatialReference: {
          wkid: 4326,
        },
      },
      symbol: {
        type: 'simple-marker',
        style: 'diamond',
        color: [248, 246, 239, 0.96],
        size: 14,
        outline: {
          color: [79, 180, 255, 0.96],
          width: 2.5,
        },
      },
      attributes: {
        name: 'St. James Cathedral',
      },
    });
    const cathedralLabel = new Graphic({
      geometry: {
        type: 'point',
        longitude: voyagerAntipode.longitude,
        latitude: voyagerAntipode.latitude,
        spatialReference: {
          wkid: 4326,
        },
      },
      symbol: {
        type: 'text',
        text: 'St. James Cathedral',
        color: [255, 253, 247, 1],
        haloColor: [2, 6, 17, 0.92],
        haloSize: 1.5,
        font: {
          family: 'Inter, Arial, sans-serif',
          size: 12,
          weight: 'bold',
        },
        yoffset: 18,
      },
      attributes: {
        name: 'St. James Cathedral label',
      },
    });
    const calgaryMarker = new Graphic({
      geometry: {
        type: 'point',
        longitude: calgary.longitude,
        latitude: calgary.latitude,
        spatialReference: {
          wkid: 4326,
        },
      },
      symbol: {
        type: 'simple-marker',
        style: 'diamond',
        color: [248, 246, 239, 0.96],
        size: 14,
        outline: {
          color: [79, 180, 255, 0.96],
          width: 2.5,
        },
      },
      attributes: {
        name: 'Calgary',
      },
    });
    const calgaryLabel = new Graphic({
      geometry: {
        type: 'point',
        longitude: calgary.longitude,
        latitude: calgary.latitude,
        spatialReference: {
          wkid: 4326,
        },
      },
      symbol: {
        type: 'text',
        text: 'Calgary',
        color: [255, 253, 247, 1],
        haloColor: [2, 6, 17, 0.92],
        haloSize: 1.5,
        font: {
          family: 'Inter, Arial, sans-serif',
          size: 12,
          weight: 'bold',
        },
        yoffset: 18,
      },
      attributes: {
        name: 'Calgary, Alberta label',
      },
    });

    voyagerRouteLayer.add(voyagerRoute);
    voyagerRouteLayer.add(farPointTrail);
    voyagerRouteLayer.add(voyagerProgress);
    voyagerRouteLayer.add(farPointProgress);
    voyagerRouteLayer.add(cathedralMarker);
    voyagerRouteLayer.add(cathedralLabel);
    voyagerRouteLayer.add(calgaryMarker);
    voyagerRouteLayer.add(calgaryLabel);
    map.add(voyagerRouteLayer);
    map.add(progressMarkerLayer);
    map.add(progressLabelLayer);
    map.add(focusedProgressLayer);

    function rebuildProgressGraphics() {
      progressMarkerLayer.removeAll();
      progressLabelLayer.removeAll();
      progressActivityGraphics.current.clear();

      createProgressPositions(Array.from(projectActivities.values())).forEach(
        ({ activity, progressKilometers, position }) => {
          const geometry = {
            type: 'point',
            longitude: position.longitude,
            latitude: position.latitude,
            spatialReference: {
              wkid: 4326,
            },
          } as const;
          const isSelected = activity.id === selectedActivityId;
          const markerGraphic = new Graphic({
            geometry,
            symbol: createProgressMarkerSymbol(activity, isSelected),
            attributes: {
              activityId: activity.id,
              name: activity.name,
              progressKilometers,
              activity,
              isProgressPosition: true,
            },
          });
          const labelGraphic = new Graphic({
            geometry,
            symbol: createProgressLabelSymbol(activity),
            attributes: {
              activityId: activity.id,
              name: activity.name,
              progressKilometers,
              activity,
              isProgressLabel: true,
            },
          });

          progressActivityGraphics.current.set(activity.id, markerGraphic);
          progressMarkerLayer.add(markerGraphic);
          progressLabelLayer.add(labelGraphic);

          if (isSelected) {
            selectedProgressGraphic.current = markerGraphic;
          }
        },
      );
    }

    function updateProgressLayerVisibility() {
      const view = viewRef.current;

      if (!view) {
        return;
      }

      const widthKilometers = getViewWidthKilometers(view);
      progressMarkerLayer.visible =
        widthKilometers <= progressMarkersVisibleWidthKilometers;
      progressLabelLayer.visible =
        widthKilometers <= progressLabelsVisibleWidthKilometers;
    }

    function addProjectActivityGraphic(projectActivity: ProjectActivity) {
      const paths = createActivityPaths(projectActivity);

      if (!paths.length) {
        return null;
      }

      if (!importedActivitiesLayer) {
        importedActivitiesLayer = new GraphicsLayer({
          title: 'Imported activities',
          elevationInfo: {
            mode: 'on-the-ground',
          },
        });
        map.add(importedActivitiesLayer);
      }

      const activityGraphic = new Graphic({
        geometry: {
          type: 'polyline',
          paths,
          spatialReference: {
            wkid: 4326,
          },
        },
        symbol: createActivityLineSymbol(projectActivity),
        attributes: {
          activityId: projectActivity.id,
          name: projectActivity.name,
          sport_type: projectActivity.sport_type,
          activity: projectActivity,
        },
      });

      importedActivityGraphics.current.set(projectActivity.id, activityGraphic);
      importedActivitiesLayer.add(activityGraphic);
      projectActivities.set(projectActivity.id, projectActivity);

      return activityGraphic;
    }

    if (supabase) {
      supabase
        .from('project_activities')
        .select(projectActivitySelectColumns)
        .not('geometry_geojson', 'is', null)
        .then(({ data, error }) => {
          if (isDestroyed || error || !data?.length) {
            return;
          }

          importedActivitiesLayer = new GraphicsLayer({
            title: 'Imported activities',
            elevationInfo: {
              mode: 'on-the-ground',
            },
          });

          data.forEach((activity) => addProjectActivityGraphic(activity as ProjectActivity));

          map.add(importedActivitiesLayer);
          rebuildProgressGraphics();
          updateProgressLayerVisibility();
        });
    }

    const view = new SceneView({
      container: sceneNode.current,
      map,
      viewingMode: 'global',
      camera: {
        position: {
          longitude: -113.95,
          latitude: 51.05,
          z: 28000000,
        },
        heading: 0,
        tilt: 0,
      },
      environment: {
        background: {
          type: 'color',
          color: [2, 6, 17, 1],
        },
        starsEnabled: true,
        atmosphereEnabled: true,
      },
      ui: {
        components: ['compass'],
      },
    });
    viewRef.current = view;
    setBasemapLabelsVisible(map, true);
    const progressVisibilityHandle = view.watch('extent', updateProgressLayerVisibility);
    const imageryLayerHandles: ResourceHandle[] = [];
    let openingAnimationTimeout: number | null = null;
    let initialImageryStableTimeout: number | null = null;
    let initialImageryFallbackTimeout: number | null = null;
    let hasStartedOpeningAnimation = false;
    const startOpeningAnimation = () => {
      if (isDestroyed || hasStartedOpeningAnimation) {
        return;
      }

      hasStartedOpeningAnimation = true;
      setIsGlobeReady(true);

      openingAnimationTimeout = window.setTimeout(() => {
        if (isDestroyed) {
          return;
        }

        playOpeningGlobeAnimation(view).catch(() => {
          // The animation may be interrupted if the user navigates away or moves the globe.
        });
      }, 280);
    };
    const waitForInitialImagery = async () => {
      const basemapLayers = [
        ...(map.basemap?.baseLayers?.toArray() ?? []),
        ...(map.basemap?.referenceLayers?.toArray() ?? []),
      ];

      if (basemapLayers.length === 0) {
        startOpeningAnimation();
        return;
      }

      const layerViews = (
        await Promise.all(
          basemapLayers.map((layer) =>
            view.whenLayerView(layer).catch(() => null),
          ),
        )
      ).filter((layerView): layerView is LayerView => Boolean(layerView));

      if (isDestroyed || layerViews.length === 0) {
        startOpeningAnimation();
        return;
      }

      const areInitialLayersReady = () =>
        layerViews.every((layerView) => !layerView.updating);
      const scheduleOpeningAfterStableImagery = () => {
        if (initialImageryStableTimeout) {
          window.clearTimeout(initialImageryStableTimeout);
        }

        initialImageryStableTimeout = window.setTimeout(
          startOpeningAnimation,
          2200,
        );
      };

      layerViews.forEach((layerView) => {
        imageryLayerHandles.push(
          layerView.watch('updating', () => {
            if (initialImageryStableTimeout) {
              window.clearTimeout(initialImageryStableTimeout);
              initialImageryStableTimeout = null;
            }

            if (areInitialLayersReady()) {
              scheduleOpeningAfterStableImagery();
            }
          }),
        );
      });

      if (areInitialLayersReady()) {
        scheduleOpeningAfterStableImagery();
      }
    };

    view.when(() => {
      if (isDestroyed) {
        return;
      }

      updateProgressLayerVisibility();
      waitForInitialImagery().catch(startOpeningAnimation);
      initialImageryFallbackTimeout = window.setTimeout(
        startOpeningAnimation,
        30000,
      );
    });
    const clickHandle = view.on('click', async (event) => {
      if (!importedActivitiesLayer && progressMarkerLayer.graphics.length === 0) {
        return;
      }

      const hitTest = await view.hitTest(event, {
        include: importedActivitiesLayer
          ? [progressMarkerLayer, importedActivitiesLayer]
          : progressMarkerLayer,
      });
      const progressResult = hitTest.results.find((result) => {
        const graphic = 'graphic' in result ? result.graphic : null;

        return Boolean(graphic?.attributes?.isProgressPosition);
      });
      const progressGraphic =
        progressResult && 'graphic' in progressResult
          ? progressResult.graphic
          : null;
      const progressActivity = progressGraphic?.attributes?.activity as
        | SelectedProjectActivity
        | undefined;

      if (progressGraphic && progressActivity) {
        const progressGeometry = progressGraphic.geometry;

        if (!progressGeometry) {
          return;
        }

        focusedProgressLayer.removeAll();
        const previousProgressGraphic = selectedProgressGraphic.current;

        if (previousProgressGraphic && previousProgressGraphic !== progressGraphic) {
          previousProgressGraphic.symbol = createProgressMarkerSymbol(
            previousProgressGraphic.attributes.activity as ProjectActivity,
          );
        }

        progressGraphic.symbol = createProgressMarkerSymbol(
          progressGraphic.attributes.activity as ProjectActivity,
          true,
        );
        selectedProgressGraphic.current = progressGraphic;
        onActivitySelect(progressActivity);
        view.goTo(
          {
            target: progressGeometry,
            scale: 140000,
            tilt: 0,
          },
          {
            animate: true,
            duration: 900,
          },
        ).catch(() => {
          // The view may be interrupted by a user pan/zoom.
        });
        return;
      }

      const activityResult = hitTest.results.find((result) => {
        const graphic = 'graphic' in result ? result.graphic : null;

        return Boolean(graphic?.attributes?.activityId);
      });
      const graphic =
        activityResult && 'graphic' in activityResult
          ? activityResult.graphic
          : null;
      const activity = graphic?.attributes?.activity as
        | SelectedProjectActivity
        | undefined;

      if (!graphic || !activity) {
        return;
      }

      focusedProgressLayer.removeAll();
      const previousGraphic = selectedActivityGraphic.current;

      if (previousGraphic && previousGraphic !== graphic) {
        previousGraphic.symbol = createActivityLineSymbol(
          previousGraphic.attributes.activity as ProjectActivity,
        );
      }

      graphic.symbol = createActivityLineSymbol(
        graphic.attributes.activity as ProjectActivity,
        true,
      );
      selectedActivityGraphic.current = graphic;
      onActivitySelect(activity);
    });
    const testActivityButton = document.createElement('button');

    testActivityButton.className = 'map-test-activity-button';
    testActivityButton.type = 'button';
    testActivityButton.textContent = 'Generate Test Activity';
    testActivityButton.addEventListener('click', async () => {
      if (!supabase || !isProjectOwner(session)) {
        return;
      }

      testActivityButton.disabled = true;
      testActivityButton.textContent = 'Generating...';
      setTestGeneratorStatus('');
      setTestGeneratorError('');
      setIsGeneratingTestActivity(true);

      try {
        const center = view.center;
        const longitude = center?.longitude;
        const latitude = center?.latitude;

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          throw new Error('Could not read the current map center.');
        }

        const { data, error } = await supabase.functions.invoke('generate-test-activity', {
          body: {
            latitude,
            longitude,
          },
        });

        if (error) {
          throw new Error(
            await getFunctionErrorMessage(error, 'Could not generate a test activity.'),
          );
        }

        const projectActivity = data.activity as ProjectActivity | undefined;

        if (!projectActivity) {
          throw new Error('The generated activity was not returned.');
        }

        const graphic = addProjectActivityGraphic(projectActivity);
        rebuildProgressGraphics();
        updateProgressLayerVisibility();

        if (graphic) {
          if (selectedActivityGraphic.current) {
            selectedActivityGraphic.current.symbol = createActivityLineSymbol(
              selectedActivityGraphic.current.attributes.activity as ProjectActivity,
            );
          }

          graphic.symbol = createActivityLineSymbol(projectActivity, true);
          selectedActivityGraphic.current = graphic;
        }

        onActivitySelect(projectActivity);
        setTestGeneratorStatus(`Generated ${projectActivity.name}.`);
      } catch (error) {
        setTestGeneratorError(
          error instanceof Error ? error.message : 'Could not generate a test activity.',
        );
      } finally {
        testActivityButton.disabled = false;
        testActivityButton.textContent = 'Generate Test Activity';
        setIsGeneratingTestActivity(false);
      }
    });

    if (isProjectOwner(session)) {
      view.ui.add(testActivityButton, 'top-right');
    }

    return () => {
      isDestroyed = true;
      importedActivityGraphics.current.clear();
      progressActivityGraphics.current.clear();
      focusedProgressLayer.removeAll();
      selectedActivityGraphic.current = null;
      selectedProgressGraphic.current = null;
      focusedProgressLayerRef.current = null;
      viewRef.current = null;
      if (openingAnimationTimeout) {
        window.clearTimeout(openingAnimationTimeout);
      }
      if (initialImageryStableTimeout) {
        window.clearTimeout(initialImageryStableTimeout);
      }
      if (initialImageryFallbackTimeout) {
        window.clearTimeout(initialImageryFallbackTimeout);
      }
      imageryLayerHandles.forEach((handle) => handle.remove());
      clickHandle.remove();
      progressVisibilityHandle.remove();
      testActivityButton.remove();
      view.destroy();
    };
  }, [onActivitySelect, session]);

  return (
    <div className={`globe-view-shell${isGlobeReady ? ' globe-view-ready' : ' globe-view-loading'}`}>
      <div className="globe-view" ref={sceneNode} aria-label="3D globe" />
      {!isGlobeReady && (
        <div className="globe-loading-scrim" aria-live="polite">
          <img
            className="globe-loading-logo"
            src={loadingLogoUrl}
            alt="Project Far Point"
          />
          <p>Loading globe imagery</p>
        </div>
      )}
      {isProjectOwner(session) && (
        <div className="map-test-activity-status" aria-live="polite">
          {isGeneratingTestActivity && <p>Generating test activity...</p>}
          {testGeneratorStatus && <p>{testGeneratorStatus}</p>}
          {testGeneratorError && <p className="map-test-activity-error">{testGeneratorError}</p>}
        </div>
      )}
    </div>
  );
}

type AuthMode = 'signIn' | 'signUp' | 'reset' | 'updatePassword';

const ownerEmail = 'rivermadsen23@gmail.com';

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}?adminPage`;
}

function isProjectOwner(session: Session | null) {
  return session?.user.email?.toLowerCase() === ownerEmail;
}

function useSupabaseSession() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  return session;
}

type AuthPanelProps = {
  session: Session | null;
};

function AuthPanel({ session }: AuthPanelProps) {
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setEmail(data.session.user.email ?? '');
      }
    });

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsOpen(true);
        setMode('updatePassword');
        setStatus('Enter a new password to finish resetting your account.');
      }
    });

    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  if (!supabase) {
    return (
      <div className="auth-panel auth-panel-muted">
        Add Supabase environment variables to enable login.
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setStatus('');
    setIsSubmitting(true);

    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.');
      }

      if (mode === 'signIn') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          throw signInError;
        }

        setStatus('Signed in.');
        setIsOpen(false);
      }

      if (mode === 'signUp') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getAuthRedirectUrl(),
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        setStatus('Check your email to verify your account.');
      }

      if (mode === 'reset') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email,
          {
            redirectTo: getAuthRedirectUrl(),
          },
        );

        if (resetError) {
          throw resetError;
        }

        setStatus('Check your email for a password reset link.');
      }

      if (mode === 'updatePassword') {
        const { error: updateError } = await supabase.auth.updateUser({
          password,
        });

        if (updateError) {
          throw updateError;
        }

        setPassword('');
        setMode('signIn');
        setStatus('Password updated.');
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Something went wrong.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (!supabase) {
      return;
    }

    setError('');
    setStatus('');
    setIsSubmitting(true);

    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError(signOutError.message);
    } else {
      setIsOpen(false);
      setEmail('');
      setPassword('');
    }

    setIsSubmitting(false);
  }

  const buttonText = {
    signIn: 'Sign in',
    signUp: 'Create account',
    reset: 'Send reset link',
    updatePassword: 'Update password',
  }[mode];

  return (
    <div className="auth-panel">
      <div className="auth-row">
        <button
          className="auth-toggle"
          type="button"
          onClick={() => setIsOpen((wasOpen) => !wasOpen)}
        >
          {session ? session.user.email : 'Log in'}
        </button>
        {isProjectOwner(session) && (
          <a className="owner-action-link" href="?adminPage=addActivity">
            Add Activity to Project Far Point
          </a>
        )}
      </div>

      {isOpen && (
        <div className="auth-popover">
          {session && mode !== 'updatePassword' ? (
            <>
              <p className="auth-status">Signed in as {session.user.email}</p>
              <button
                className="auth-submit"
                type="button"
                onClick={handleSignOut}
                disabled={isSubmitting}
              >
                Sign out
              </button>
            </>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <label>
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required={mode !== 'updatePassword'}
                  autoComplete="email"
                />
              </label>

              {mode !== 'reset' && (
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={6}
                    autoComplete={
                      mode === 'signIn' ? 'current-password' : 'new-password'
                    }
                  />
                </label>
              )}

              <button
                className="auth-submit"
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Working...' : buttonText}
              </button>

              <div className="auth-actions">
                {mode !== 'signIn' && (
                  <button type="button" onClick={() => setMode('signIn')}>
                    Sign in
                  </button>
                )}
                {mode !== 'signUp' && mode !== 'updatePassword' && (
                  <button type="button" onClick={() => setMode('signUp')}>
                    Create account
                  </button>
                )}
                {mode !== 'reset' && mode !== 'updatePassword' && (
                  <button type="button" onClick={() => setMode('reset')}>
                    Forgot password
                  </button>
                )}
              </div>
            </form>
          )}

          {status && <p className="auth-status">{status}</p>}
          {error && <p className="auth-error">{error}</p>}
        </div>
      )}
    </div>
  );
}

type AddActivityPageProps = {
  session: Session | null;
};

function AddActivityPage({ session }: AddActivityPageProps) {
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [importKind, setImportKind] = useState<StravaImportKind>('activity');
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [routes, setRoutes] = useState<StravaRoute[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [manualRouteReference, setManualRouteReference] = useState('');
  const [activityMetadata, setActivityMetadata] = useState<ActivityMetadata>(
    createActivityMetadata(),
  );
  const [activityImages, setActivityImages] = useState<ActivityImageInput[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [isImportingActivity, setIsImportingActivity] = useState(false);
  const searchParams = new URLSearchParams(window.location.search);
  const stravaStatus = searchParams.get('strava');
  const selectedActivity = activities.find(
    (activity) => activity.id === selectedActivityId,
  );
  const selectedRoute = routes.find((route) => route.id === selectedRouteId);
  const selectedImportItem = importKind === 'activity' ? selectedActivity : selectedRoute;
  const importKindLabel = importKind === 'activity' ? 'activity' : 'route';
  const importKindLabelPlural = importKind === 'activity' ? 'activities' : 'routes';
  const manualRouteId = extractStravaRouteId(manualRouteReference);
  const routeIdToImport = manualRouteId || selectedRouteId;
  const canShowImportForm =
    (importKind === 'activity' && activities.length > 0) ||
    importKind === 'route';

  useEffect(() => {
    setActivityMetadata(createActivityMetadata(selectedImportItem));
    setActivityImages([]);
  }, [selectedImportItem]);

  function handleMetadataChange(
    event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
    const { name, value } = event.target;

    setActivityMetadata((currentMetadata) => ({
      ...currentMetadata,
      [name]: value,
    }));
  }

  function handleGenerateLoremIpsum() {
    setActivityMetadata((currentMetadata) => ({
      ...currentMetadata,
      textDescription: createLoremIpsumDescription(),
    }));
  }

  function handleAddImageInput() {
    setActivityImages((currentImages) =>
      currentImages.length >= 10 ? currentImages : [...currentImages, createActivityImageInput()],
    );
  }

  function handleRemoveImageInput(imageId: string) {
    setActivityImages((currentImages) =>
      currentImages.filter((image) => image.id !== imageId),
    );
  }

  function handleImageInputChange(
    imageId: string,
    field: 'name' | 'caption',
    value: string,
  ) {
    setActivityImages((currentImages) =>
      currentImages.map((image) =>
        image.id === imageId ? { ...image, [field]: value } : image,
      ),
    );
  }

  function handleImageFileChange(imageId: string, file: File | null) {
    setActivityImages((currentImages) =>
      currentImages.map((image) =>
        image.id === imageId ? { ...image, file } : image,
      ),
    );
  }

  function validateActivityImages() {
    const names = new Set<string>();

    for (const image of activityImages) {
      const name = image.name.trim();

      if (!name && !image.file && !image.caption.trim()) {
        continue;
      }

      if (!name || !image.file) {
        throw new Error('Each image needs both a name and a file.');
      }

      if (!imageNamePattern.test(name)) {
        throw new Error(
          'Image names must start with a letter or number and can only use letters, numbers, hyphens, and underscores.',
        );
      }

      const normalizedName = name.toLowerCase();

      if (names.has(normalizedName)) {
        throw new Error(`Image name "${name}" is already used for this activity.`);
      }

      names.add(normalizedName);
    }
  }

  async function uploadActivityImages(activityId: string) {
    const readyImages = activityImages.filter((image) => image.name.trim() && image.file);

    if (readyImages.length === 0) {
      return 0;
    }

    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    for (const [index, image] of readyImages.entries()) {
      const file = image.file;

      if (!file) {
        continue;
      }

      const name = image.name.trim();
      const extension = getImageFileExtension(file);
      const storagePath = `${activityId}/${name}.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from('project-activity-images')
        .upload(storagePath, file, {
          cacheControl: '31536000',
          contentType: file.type || undefined,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Image upload failed for "${name}": ${uploadError.message}`);
      }

      const { error: imageError } = await supabase
        .from('project_activity_images')
        .upsert(
          {
            activity_id: activityId,
            name,
            storage_bucket: 'project-activity-images',
            storage_path: storagePath,
            caption: image.caption.trim() || null,
            alt_text: image.caption.trim() || name,
            sort_order: index,
            content_type: file.type || null,
            size_bytes: file.size,
          },
          {
            onConflict: 'activity_id,name',
          },
        );

      if (imageError) {
        throw new Error(`Image metadata failed for "${name}": ${imageError.message}`);
      }
    }

    return readyImages.length;
  }

  function handleImportKindChange(nextImportKind: StravaImportKind) {
    setStatus('');
    setError('');
    setImportKind(nextImportKind);
  }

  async function handleLoadStravaItems() {
    setStatus('');
    setError('');
    setIsLoadingItems(true);

    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.');
      }

      const { data, error: functionError } = await supabase.functions.invoke(
        importKind === 'activity' ? 'strava-list-activities' : 'strava-list-routes',
        {
          body: {
            page: 1,
            perPage: 30,
          },
        },
      );

      if (functionError) {
        throw new Error(
          await getFunctionErrorMessage(
            functionError,
            `Could not load Strava ${importKindLabelPlural}.`,
          ),
        );
      }

      if (importKind === 'activity') {
        setActivities(data.activities ?? []);
        setSelectedActivityId(data.activities?.[0]?.id ?? null);
        setStatus(`Loaded ${data.activities?.length ?? 0} Strava activities.`);
      } else {
        setRoutes(data.routes ?? []);
        setSelectedRouteId(data.routes?.[0]?.id ?? null);
        setStatus(`Loaded ${data.routes?.length ?? 0} Strava routes.`);
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : `Could not load Strava ${importKindLabelPlural}.`,
      );
    } finally {
      setIsLoadingItems(false);
    }
  }

  async function handleImportActivity() {
    setStatus('');
    setError('');

    if (
      (importKind === 'activity' && !selectedActivityId) ||
      (importKind === 'route' && !routeIdToImport)
    ) {
      setError(`Choose a ${importKindLabel} to import.`);
      return;
    }

    setIsImportingActivity(true);

    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.');
      }

      validateActivityImages();

      const { data, error: functionError } = await supabase.functions.invoke(
        importKind === 'activity' ? 'strava-import-activity' : 'strava-import-route',
        {
          body: {
            ...(importKind === 'activity'
              ? { activityId: selectedActivityId }
              : { routeId: routeIdToImport }),
            metadata: prepareActivityMetadata(activityMetadata),
          },
        },
      );

      if (functionError) {
        throw new Error(
          await getFunctionErrorMessage(
            functionError,
            `Could not import Strava ${importKindLabel}.`,
          ),
        );
      }

      const importedActivityId = data.activity?.id;

      if (!importedActivityId) {
        throw new Error('The imported activity id was not returned.');
      }

      const uploadedImageCount = await uploadActivityImages(importedActivityId);

      const distanceMadeGood = formatKilometers(data.activity?.distance_made_good ?? null);
      const imageMessage =
        uploadedImageCount > 0
          ? ` Uploaded ${uploadedImageCount} image${uploadedImageCount === 1 ? '' : 's'}.`
          : '';
      const importMessage =
        data.activity?.pfp_type === 'Voyager' && distanceMadeGood
          ? `Imported ${data.activity?.name ?? importKindLabel} with ${distanceMadeGood} made good.${imageMessage}`
          : `Imported ${data.activity?.name ?? importKindLabel}.${imageMessage}`;

      setStatus(importMessage);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : `Could not import Strava ${importKindLabel}.`,
      );
    } finally {
      setIsImportingActivity(false);
    }
  }

  async function handleConnectStrava() {
    setStatus('');
    setError('');
    setIsConnecting(true);

    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.');
      }

      if (!isProjectOwner(session)) {
        throw new Error('Only the Project Far Point owner can connect Strava.');
      }

      const { data, error: functionError } = await supabase.functions.invoke(
        'strava-auth-start',
        {
          body: {
            returnTo: window.location.href,
          },
        },
      );

      if (functionError) {
        throw new Error(
          await getFunctionErrorMessage(
            functionError,
            'Could not start Strava authorization.',
          ),
        );
      }

      if (!data?.authorizationUrl) {
        throw new Error('The Strava authorization URL was not returned.');
      }

      window.location.assign(data.authorizationUrl);
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : 'Could not start Strava authorization.',
      );
      setIsConnecting(false);
    }
  }

  return (
    <main className="activity-admin-page">
      <section className="activity-admin-shell">
        <header className="activity-admin-header">
          <a className="back-link" href="?adminPage">
            Back to Project Far Point
          </a>
          <AuthPanel session={session} />
        </header>

        <div className="activity-admin-content">
          <p className="eyebrow">Project Far Point Admin</p>
          <h1>Add Activity to Project Far Point</h1>
          <p className="activity-admin-copy">
            Connect Strava, choose one completed activity or planned route, and
            import its geometry for display on the globe.
          </p>

          {stravaStatus === 'connected' && (
            <p className="activity-success">
              Strava is connected. The next step is listing your activities or
              routes for import.
            </p>
          )}

          <button
            className="strava-connect-button"
            type="button"
            onClick={handleConnectStrava}
            disabled={isConnecting || !isProjectOwner(session)}
          >
            {isConnecting ? 'Opening Strava...' : 'Connect Strava'}
          </button>

          <div className="activity-import-panel">
            <div className="activity-import-kind" aria-label="Import source">
              <button
                className={
                  importKind === 'activity'
                    ? 'activity-import-kind-option activity-import-kind-option-active'
                    : 'activity-import-kind-option'
                }
                type="button"
                onClick={() => handleImportKindChange('activity')}
              >
                Activities
              </button>
              <button
                className={
                  importKind === 'route'
                    ? 'activity-import-kind-option activity-import-kind-option-active'
                    : 'activity-import-kind-option'
                }
                type="button"
                onClick={() => handleImportKindChange('route')}
              >
                Routes
              </button>
            </div>

            <button
              className="activity-secondary-button"
              type="button"
              onClick={handleLoadStravaItems}
              disabled={isLoadingItems || !isProjectOwner(session)}
            >
              {isLoadingItems
                ? `Loading ${importKindLabelPlural}...`
                : `Load Strava ${importKindLabelPlural}`}
            </button>

            {importKind === 'route' && (
              <label className="manual-route-field">
                <span>Route URL or ID</span>
                <input
                  value={manualRouteReference}
                  onChange={(event) => setManualRouteReference(event.target.value)}
                  placeholder="https://www.strava.com/routes/3434650877561151628"
                />
              </label>
            )}

            {canShowImportForm && (
              <>
                {((importKind === 'activity' && activities.length > 0) ||
                  (importKind === 'route' && routes.length > 0)) && (
                  <div
                    className="activity-list"
                    role="listbox"
                    aria-label={`Strava ${importKindLabelPlural}`}
                  >
                    {importKind === 'activity'
                      ? activities.map((activity) => (
                          <button
                            className={
                              activity.id === selectedActivityId
                                ? 'activity-option activity-option-selected'
                                : 'activity-option'
                            }
                            type="button"
                            key={activity.id}
                            onClick={() => setSelectedActivityId(activity.id)}
                          >
                            <span>{activity.name}</span>
                            <small>
                              {new Date(activity.start_date).toLocaleDateString()} ·{' '}
                              {(activity.distance / 1000).toFixed(2)} km ·{' '}
                              {activity.sport_type}
                            </small>
                          </button>
                        ))
                      : routes.map((route) => (
                          <button
                            className={
                              route.id === selectedRouteId && !manualRouteId
                                ? 'activity-option activity-option-selected'
                                : 'activity-option'
                            }
                            type="button"
                            key={route.id}
                            onClick={() => {
                              setManualRouteReference('');
                              setSelectedRouteId(route.id);
                            }}
                          >
                            <span>{route.name}</span>
                            <small>
                              {(route.distance / 1000).toFixed(2)} km
                              {route.elevation_gain !== null &&
                                ` · ${Math.round(route.elevation_gain).toLocaleString()} m gain`}
                              {route.updated_at &&
                                ` · Updated ${new Date(route.updated_at).toLocaleDateString()}`}
                            </small>
                          </button>
                        ))}
                  </div>
                )}

                <div className="activity-metadata-form">
                  <label>
                    <span>Project path</span>
                    <select
                      name="pfpType"
                      value={activityMetadata.pfpType}
                      onChange={handleMetadataChange}
                    >
                      <option value="Voyager">Voyager</option>
                      <option value="Far Point Trail">Far Point Trail</option>
                    </select>
                  </label>

                  <label>
                    <span>Trail name</span>
                    <input
                      name="trailName"
                      value={activityMetadata.trailName}
                      onChange={handleMetadataChange}
                      placeholder="Optional"
                    />
                  </label>

                  <label>
                    <span>Started at</span>
                    <input
                      name="startedAt"
                      type="datetime-local"
                      value={activityMetadata.startedAt}
                      onChange={handleMetadataChange}
                    />
                  </label>

                  <label className="activity-description-field">
                    <span>Text description</span>
                    <textarea
                      name="textDescription"
                      value={activityMetadata.textDescription}
                      onChange={handleMetadataChange}
                      rows={10}
                      placeholder="Write the route notes, story, conditions, links, or other context here."
                    />
                  </label>

                  <button
                    className="activity-secondary-button activity-lorem-button"
                    type="button"
                    onClick={handleGenerateLoremIpsum}
                  >
                    Generate Lorem Ipsum
                  </button>

                  <div className="activity-image-upload-section">
                    <div className="activity-image-upload-header">
                      <span>Activity images</span>
                      <button
                        className="activity-secondary-button"
                        type="button"
                        onClick={handleAddImageInput}
                        disabled={activityImages.length >= 10}
                      >
                        Add image
                      </button>
                    </div>

                    {activityImages.length > 0 && (
                      <div className="activity-image-upload-list">
                        {activityImages.map((image, index) => (
                          <div className="activity-image-upload-row" key={image.id}>
                            <label>
                              <span>Name</span>
                              <input
                                value={image.name}
                                onChange={(event) =>
                                  handleImageInputChange(
                                    image.id,
                                    'name',
                                    event.target.value,
                                  )
                                }
                                placeholder={index === 0 ? 'dog' : 'butterfly'}
                              />
                            </label>

                            <label>
                              <span>Caption</span>
                              <input
                                value={image.caption}
                                onChange={(event) =>
                                  handleImageInputChange(
                                    image.id,
                                    'caption',
                                    event.target.value,
                                  )
                                }
                                placeholder={index === 0 ? 'my dog' : 'pretty butterfly'}
                              />
                            </label>

                            <label className="activity-image-file-field">
                              <span>File</span>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                onChange={(event) =>
                                  handleImageFileChange(
                                    image.id,
                                    event.target.files?.[0] ?? null,
                                  )
                                }
                              />
                            </label>

                            <button
                              className="activity-image-remove-button"
                              type="button"
                              onClick={() => handleRemoveImageInput(image.id)}
                              aria-label={`Remove image ${index + 1}`}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  className="strava-connect-button"
                  type="button"
                  onClick={handleImportActivity}
                  disabled={
                    isImportingActivity ||
                    (importKind === 'activity' && !selectedActivityId) ||
                    (importKind === 'route' && !routeIdToImport)
                  }
                >
                  {isImportingActivity
                    ? 'Importing...'
                    : `Import selected ${importKindLabel}`}
                </button>
              </>
            )}
          </div>

          {!isProjectOwner(session) && (
            <p className="activity-error">
              Sign in as the Project Far Point owner to import Strava
              activities or routes.
            </p>
          )}
          {status && <p className="activity-status">{status}</p>}
          {error && <p className="activity-error">{error}</p>}
        </div>
      </section>
    </main>
  );
}

type ActivityStoryProps = {
  activity: SelectedProjectActivity;
  onBack: () => void;
  onFocusActivity: (activityId: string) => void;
  onFocusProgressPosition: (activityId: string) => void;
  isArriving?: boolean;
};

type MobileMode = 'project' | 'progress' | 'search' | 'donate';
type DesktopContentTab = 'story' | 'search';

type ActivityImageCarouselProps = {
  images: ProjectActivityImage[];
  onOpenImage: (image: ProjectActivityImage) => void;
};

function ActivityImageCarousel({ images, onOpenImage }: ActivityImageCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const safeActiveIndex = images.length > 0 ? activeIndex % images.length : 0;
  const activeImage = images[safeActiveIndex];

  useEffect(() => {
    setActiveIndex(0);
  }, [images]);

  if (!activeImage) {
    return null;
  }

  function showPreviousImage() {
    setActiveIndex((currentIndex) =>
      images.length === 0
        ? 0
        : (currentIndex - 1 + images.length) % images.length,
    );
  }

  function showNextImage() {
    setActiveIndex((currentIndex) =>
      images.length === 0 ? 0 : (currentIndex + 1) % images.length,
    );
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event: TouchEvent<HTMLDivElement>) {
    const startX = touchStartX.current;
    const endX = event.changedTouches[0]?.clientX ?? null;

    touchStartX.current = null;

    if (startX === null || endX === null || Math.abs(startX - endX) < 44) {
      return;
    }

    if (endX < startX) {
      showNextImage();
    } else {
      showPreviousImage();
    }
  }

  return (
    <figure
      className="route-story-carousel"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="route-story-carousel-stage">
        {images.length > 1 && (
          <button
            className="route-story-carousel-control route-story-carousel-previous"
            type="button"
            onClick={showPreviousImage}
            aria-label="Previous image"
          >
            <span aria-hidden="true">‹</span>
          </button>
        )}

        <button
          className="route-story-carousel-button"
          type="button"
          onClick={() => onOpenImage(activeImage)}
        >
          <img
            key={activeImage.id}
            src={getActivityImagePublicUrl(activeImage)}
            alt={activeImage.alt_text || activeImage.caption || activeImage.name}
            loading="lazy"
          />
        </button>

        {images.length > 1 && (
          <button
            className="route-story-carousel-control route-story-carousel-next"
            type="button"
            onClick={showNextImage}
            aria-label="Next image"
          >
            <span aria-hidden="true">›</span>
          </button>
        )}
      </div>

      <div className="route-story-carousel-footer">
        {activeImage.caption && <figcaption>{activeImage.caption}</figcaption>}
        {images.length > 1 && (
          <span className="route-story-carousel-count">
            {safeActiveIndex + 1} / {images.length}
          </span>
        )}
      </div>
    </figure>
  );
}

function renderActivityImageFigure(
  image: ProjectActivityImage,
  key: string,
  onOpenImage: (image: ProjectActivityImage) => void,
  captionOverride?: string,
) {
  const imageUrl = getActivityImagePublicUrl(image);
  const caption = captionOverride?.trim() || image.caption?.trim();

  return (
    <figure className="route-story-image" key={key}>
      <button
        className="route-story-image-button"
        type="button"
        onClick={() => onOpenImage(image)}
      >
        <img
          src={imageUrl}
          alt={image.alt_text || caption || image.name}
          loading="lazy"
        />
      </button>
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function renderExternalActivityImageFigure(
  url: string,
  key: string,
  caption?: string,
) {
  return (
    <figure className="route-story-image" key={key}>
      <img src={url} alt={caption || 'Generated test activity'} loading="lazy" />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}

function renderActivityImageCarousel(
  images: ProjectActivityImage[],
  key: string,
  onOpenImage: (image: ProjectActivityImage) => void,
) {
  if (images.length === 0) {
    return null;
  }

  return (
    <ActivityImageCarousel
      images={images}
      key={key}
      onOpenImage={onOpenImage}
    />
  );
}

function renderActivityParagraph(
  paragraph: string,
  paragraphIndex: number,
  images: ProjectActivityImage[],
  onOpenImage: (image: ProjectActivityImage) => void,
) {
  const parts: ReactNode[] = [];
  let textStart = 0;
  const imagesByName = new globalThis.Map(
    images.map((image) => [image.name.toLowerCase(), image]),
  );

  for (const match of paragraph.matchAll(videoShortcodeOrYouTubeUrlPattern)) {
    const rawMatch = match[0];
    const matchIndex = match.index ?? 0;
    const shortcodeType = match[1] ?? 'Video';
    const shortcodeAttributes = match[2]
      ? parseQuotedAttributes(match[2])
      : null;
    let renderedShortcode: ReactNode = null;

    if (shortcodeType === 'Image' && shortcodeAttributes) {
      const imageName = shortcodeAttributes.name?.trim().toLowerCase();
      const image = imageName ? imagesByName.get(imageName) : null;

      if (!image) {
        continue;
      }

      renderedShortcode = renderActivityImageFigure(
        image,
        `image-${paragraphIndex}-${matchIndex}`,
        onOpenImage,
        shortcodeAttributes.caption,
      );
    } else if (shortcodeType === 'ImageCarousel' && shortcodeAttributes) {
      const carouselImages =
        shortcodeAttributes.images
          ?.split(',')
          .map((name) => imagesByName.get(name.trim().toLowerCase()))
          .filter((image): image is ProjectActivityImage => Boolean(image)) ?? [];

      renderedShortcode = renderActivityImageCarousel(
        carouselImages,
        `carousel-${paragraphIndex}-${matchIndex}`,
        onOpenImage,
      );
    } else if (shortcodeType === 'ExternalImage' && shortcodeAttributes) {
      const imageUrl = shortcodeAttributes.url?.trim();

      if (!imageUrl) {
        continue;
      }

      renderedShortcode = renderExternalActivityImageFigure(
        imageUrl,
        `external-image-${paragraphIndex}-${matchIndex}`,
        shortcodeAttributes.caption,
      );
    } else {
      const rawUrl = shortcodeAttributes?.url ?? rawMatch;
      const { url } = shortcodeAttributes
        ? { url: rawUrl }
        : splitTrailingUrlPunctuation(rawUrl);
      const embedUrl = getYouTubeEmbedUrl(url);
      const caption = shortcodeAttributes?.caption?.trim();

      if (!embedUrl) {
        continue;
      }

      renderedShortcode = (
        <figure className="route-story-video" key={`video-${paragraphIndex}-${matchIndex}`}>
          <div className="route-story-video-frame">
            <iframe
              src={embedUrl}
              title={caption || 'Activity video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
            />
          </div>
          {caption && <figcaption>{caption}</figcaption>}
        </figure>
      );
    }

    if (!renderedShortcode) {
      continue;
    }

    if (matchIndex > textStart) {
      parts.push(
        <p key={`text-${paragraphIndex}-${textStart}`}>
          {paragraph.slice(textStart, matchIndex)}
        </p>,
      );
    }

    parts.push(renderedShortcode);

    textStart = matchIndex + rawMatch.length;
  }

  if (textStart < paragraph.length) {
    parts.push(
      <p key={`text-${paragraphIndex}-${textStart}`}>
        {paragraph.slice(textStart)}
      </p>,
    );
  }

  return parts.length > 0
    ? parts
    : [<p key={`text-${paragraphIndex}`}>{paragraph}</p>];
}

function ActivityStory({
  activity,
  onBack,
  onFocusActivity,
  onFocusProgressPosition,
  isArriving = false,
}: ActivityStoryProps) {
  const [activityImages, setActivityImages] = useState<ProjectActivityImage[]>([]);
  const [activeImage, setActiveImage] = useState<ProjectActivityImage | null>(null);
  const openActivityImage = useCallback((image: ProjectActivityImage) => {
    setActiveImage(image);
  }, []);
  const description = activity.text_description?.trim();
  const paragraphs = description
    ? description.split(/\n{2,}/).map((paragraph) => paragraph.trim())
    : ['No route description has been added yet.'];
  const correctedDistance = formatKilometers(activity.corrected_distance);
  const distanceMadeGood = formatKilometers(activity.distance_made_good);
  const activityDateTime = formatActivityDateTime(activity.started_at);
  const stravaLinkLabel = activity.strava_type
    ? `Strava ${activity.strava_type}`
    : 'Strava';
  const activityRouteClass =
    activity.pfp_type === 'Far Point Trail'
      ? 'journey-far-point'
      : 'journey-voyager';
  const activeImageUrl = activeImage ? getActivityImagePublicUrl(activeImage) : '';

  useEffect(() => {
    let isCancelled = false;

    if (!supabase) {
      setActivityImages([]);
      return;
    }

    supabase
      .from('project_activity_images')
      .select('id,activity_id,name,storage_bucket,storage_path,caption,alt_text,sort_order')
      .eq('activity_id', activity.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (isCancelled) {
          return;
        }

        if (error) {
          console.error('Could not load activity images.', error);
          setActivityImages([]);
          return;
        }

        setActivityImages(data ?? []);
      });

    return () => {
      isCancelled = true;
    };
  }, [activity.id]);

  return (
    <article className={`route-story${isArriving ? ' route-story-arriving' : ''}`}>
      <p className={`eyebrow ${activityRouteClass}`}>
        {activity.pfp_type ?? 'Project Far Point Route'}
      </p>
      <h2>{activity.trail_name || activity.name}</h2>
      <div className="route-story-meta" aria-label="Route details">
        <button
          className="route-story-back"
          type="button"
          onClick={onBack}
          aria-label="Back to Project Far Point"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M3 10.8 12 3l9 7.8" />
            <path d="M5.5 9.2V21h13V9.2" />
            <path d="M9.5 21v-6.2h5V21" />
          </svg>
        </button>
        {activityDateTime && <span>{activityDateTime}</span>}
        {correctedDistance && <span>Distance: {correctedDistance}</span>}
        {distanceMadeGood && <span>Made good: {distanceMadeGood}</span>}
        <button
          className="route-story-map-link"
          type="button"
          onClick={() => onFocusActivity(activity.id)}
        >
          Zoom to Activity
        </button>
        {activity.pfp_type && (
          <button
            className="route-story-map-link route-story-progress-link"
            type="button"
            onClick={() => onFocusProgressPosition(activity.id)}
          >
            Progress Position
          </button>
        )}
        {activity.strava_url && (
          <a
            className="route-story-strava-link"
            href={activity.strava_url}
            target="_blank"
            rel="noreferrer noopener"
          >
            {stravaLinkLabel}
          </a>
        )}
      </div>
      <div className="route-story-copy">
        {paragraphs.flatMap((paragraph, index) =>
          renderActivityParagraph(paragraph, index, activityImages, openActivityImage),
        )}
      </div>
      {activeImage && (
        <div
          className="route-story-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={activeImage.caption || activeImage.name}
          onClick={() => setActiveImage(null)}
        >
          <button
            className="route-story-lightbox-close"
            type="button"
            onClick={() => setActiveImage(null)}
            aria-label="Close image"
          >
            Close
          </button>
          <figure
            className="route-story-lightbox-figure"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={activeImageUrl}
              alt={activeImage.alt_text || activeImage.caption || activeImage.name}
            />
            {activeImage.caption && <figcaption>{activeImage.caption}</figcaption>}
          </figure>
        </div>
      )}
    </article>
  );
}

function JourneySummary() {
  return (
    <aside className="journey-summary" aria-label="Project route summary">
      <div className="summary-item summary-voyager">
        <span className="summary-kicker journey-voyager">Voyager</span>
        <span className="summary-label">New Zealand to Santiago de Compostela</span>
        <span className="summary-progress-text">
          <strong>1,000 km</strong> of 20,038 km completed <strong>(5%)</strong>
        </span>
        <span className="summary-progress" aria-hidden="true">
          <span className="summary-progress-fill summary-progress-voyager" />
        </span>
      </div>
      <div className="summary-item summary-far-point">
        <span className="summary-kicker journey-far-point">Far Point Trail</span>
        <span className="summary-label">Santiago de Compostela to New Zealand</span>
        <span className="summary-progress-text">
          <strong>1,000 km</strong> of 20,038 km completed <strong>(5%)</strong>
        </span>
        <span className="summary-progress" aria-hidden="true">
          <span className="summary-progress-fill summary-progress-far-point" />
        </span>
      </div>
      <div className="summary-route">
        <span className="route-dot route-dot-start" />
        <span className="route-line route-line-voyager" />
        <span className="route-dot route-dot-middle" />
        <span className="route-line route-line-far-point" />
        <span className="route-dot route-dot-end" />
      </div>
    </aside>
  );
}

function CharityPanel() {
  return (
    <aside className="charity-panel" aria-label="Charity donations">
      <p className="charity-kicker">Future fundraiser</p>
      <p className="charity-copy">
        Members will be able to support trail stewardship through a partner
        charity, likely the Great Divide Trail Association.
      </p>
      <div className="charity-stats" aria-label="Donation impact">
        <span><strong>0</strong> members</span>
        <span><strong>$0</strong> donated</span>
      </div>
      <a className="donate-link" href="#donate" aria-disabled="true">
        Donate
      </a>
    </aside>
  );
}

function getActivityDistanceValue(activity: ProjectActivity) {
  const value = Number(activity.corrected_distance);

  return Number.isFinite(value) ? value : 0;
}

function getActivityDateValue(activity: ProjectActivity) {
  if (!activity.started_at) {
    return 0;
  }

  const value = new Date(activity.started_at).getTime();

  return Number.isNaN(value) ? 0 : value;
}

function getActivityDisplayName(activity: ProjectActivity) {
  return activity.trail_name || activity.name;
}

function getActivityLocationLabel(activity: ProjectActivity) {
  return [
    activity.city,
    activity.province ?? activity.state,
    activity.country,
    activity.continent,
  ]
    .filter(Boolean)
    .join(', ');
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value?.trim()))),
  ).sort((left, right) => left.localeCompare(right));
}

function SearchPanel({ onActivitySelect }: SearchPanelProps) {
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [projectPath, setProjectPath] = useState<ProjectPathFilter>('');
  const [nameQuery, setNameQuery] = useState('');
  const [continent, setContinent] = useState('');
  const [country, setCountry] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [keywordQuery, setKeywordQuery] = useState('');
  const [sortField, setSortField] = useState<SearchSortField>('date');
  const [sortDirection, setSortDirection] = useState<SearchSortDirection>('desc');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isCancelled = false;

    if (!supabase) {
      return;
    }

    setIsLoading(true);
    setError('');

    async function loadSearchActivities() {
      try {
        if (!supabase) {
          return;
        }

        const { data, error } = await supabase
          .from('project_activities')
          .select(projectActivitySelectColumns)
          .not('geometry_geojson', 'is', null);

        if (isCancelled) {
          return;
        }

        if (error) {
          setError('Could not load activities for search.');
          setActivities([]);
          return;
        }

        setActivities((data ?? []) as ProjectActivity[]);
      } catch {
        if (!isCancelled) {
          setError('Could not load activities for search.');
          setActivities([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSearchActivities();

    return () => {
      isCancelled = true;
    };
  }, []);

  const pathActivities = useMemo(
    () =>
      projectPath
        ? activities.filter((activity) => activity.pfp_type === projectPath)
        : [],
    [activities, projectPath],
  );
  const availableNames = useMemo(
    () => uniqueSorted(pathActivities.flatMap((activity) => [activity.name, activity.trail_name])),
    [pathActivities],
  );
  const availableContinents = useMemo(
    () => uniqueSorted(pathActivities.map((activity) => activity.continent)),
    [pathActivities],
  );
  const continentActivities = useMemo(
    () =>
      continent
        ? pathActivities.filter((activity) => activity.continent === continent)
        : pathActivities,
    [continent, pathActivities],
  );
  const availableCountries = useMemo(
    () => uniqueSorted(continentActivities.map((activity) => activity.country)),
    [continentActivities],
  );
  const countryActivities = useMemo(
    () =>
      country
        ? continentActivities.filter((activity) => activity.country === country)
        : continentActivities,
    [continentActivities, country],
  );
  const regionField = country === 'Canada' ? 'province' : 'state';
  const regionLabel = country === 'Canada' ? 'Province' : 'State';
  const canFilterRegion = country === 'Canada' || country === 'United States';
  const availableRegions = useMemo(
    () =>
      canFilterRegion
        ? uniqueSorted(countryActivities.map((activity) => activity[regionField]))
        : [],
    [canFilterRegion, countryActivities, regionField],
  );
  const regionActivities = useMemo(
    () =>
      canFilterRegion && region
        ? countryActivities.filter((activity) => activity[regionField] === region)
        : countryActivities,
    [canFilterRegion, countryActivities, region, regionField],
  );
  const availableCities = useMemo(
    () => uniqueSorted(regionActivities.map((activity) => activity.city)),
    [regionActivities],
  );
  const keywordTerms = useMemo(
    () =>
      keywordQuery
        .split(',')
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean),
    [keywordQuery],
  );
  const filteredActivities = useMemo(() => {
    if (!projectPath) {
      return [];
    }

    const cleanNameQuery = nameQuery.trim().toLowerCase();

    return pathActivities
      .filter((activity) => {
        if (cleanNameQuery) {
          const searchableName = [activity.name, activity.trail_name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          if (!searchableName.includes(cleanNameQuery)) {
            return false;
          }
        }

        if (continent && activity.continent !== continent) {
          return false;
        }

        if (country && activity.country !== country) {
          return false;
        }

        if (canFilterRegion && region && activity[regionField] !== region) {
          return false;
        }

        if (city && activity.city !== city) {
          return false;
        }

        if (keywordTerms.length > 0) {
          const searchableText = [
            activity.name,
            activity.trail_name,
            activity.text_description,
            activity.city,
            activity.state,
            activity.province,
            activity.country,
            activity.continent,
            activity.sport_type,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();

          return keywordTerms.some((keyword) => searchableText.includes(keyword));
        }

        return true;
      })
      .sort((left, right) => {
        let comparison = 0;

        if (sortField === 'date') {
          comparison = getActivityDateValue(left) - getActivityDateValue(right);
        } else if (sortField === 'distance') {
          comparison = getActivityDistanceValue(left) - getActivityDistanceValue(right);
        } else if (sortField === 'name') {
          comparison = getActivityDisplayName(left).localeCompare(getActivityDisplayName(right));
        } else {
          comparison = getActivityLocationLabel(left).localeCompare(getActivityLocationLabel(right));
        }

        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [
    canFilterRegion,
    city,
    continent,
    country,
    keywordTerms,
    nameQuery,
    pathActivities,
    projectPath,
    region,
    regionField,
    sortDirection,
    sortField,
  ]);

  function handleProjectPathChange(nextProjectPath: Exclude<ProjectPathFilter, ''>) {
    setProjectPath(nextProjectPath);
    setContinent('');
    setCountry('');
    setRegion('');
    setCity('');
  }

  function handleContinentChange(value: string) {
    setContinent(value);
    setCountry('');
    setRegion('');
    setCity('');
  }

  function handleCountryChange(value: string) {
    setCountry(value);
    setRegion('');
    setCity('');
  }

  function handleRegionChange(value: string) {
    setRegion(value);
    setCity('');
  }

  function handleClearFilters() {
    setNameQuery('');
    setContinent('');
    setCountry('');
    setRegion('');
    setCity('');
    setKeywordQuery('');
    setSortField('date');
    setSortDirection('desc');
  }

  return (
    <section className="search-panel" aria-label="Search activities">
      <div className="search-panel-header">
        <div>
          <p className="eyebrow">Search</p>
          <h2>Find an Activity</h2>
        </div>
        <button className="search-clear-button" type="button" onClick={handleClearFilters}>
          Clear
        </button>
      </div>

      <div className="search-path-toggle" aria-label="Project path">
        <button
          className={projectPath === 'Voyager' ? 'search-path-active' : ''}
          type="button"
          onClick={() => handleProjectPathChange('Voyager')}
        >
          Voyager
        </button>
        <button
          className={projectPath === 'Far Point Trail' ? 'search-path-active' : ''}
          type="button"
          onClick={() => handleProjectPathChange('Far Point Trail')}
        >
          Far Point Trail
        </button>
      </div>

      {!projectPath && (
        <p className="search-empty-state">Choose Voyager or Far Point Trail to start searching.</p>
      )}

      {projectPath && (
        <>
          <div className="search-controls">
            <label className="search-field search-field-wide">
              <span>Activity name</span>
              <input
                value={nameQuery}
                onChange={(event) => setNameQuery(event.target.value)}
                list="activity-name-options"
                placeholder="Start typing an activity name"
              />
              <datalist id="activity-name-options">
                {availableNames.slice(0, 250).map((name) => (
                  <option value={name} key={name} />
                ))}
              </datalist>
            </label>

            <label className="search-field">
              <span>Continent</span>
              <select
                value={continent}
                onChange={(event) => handleContinentChange(event.target.value)}
              >
                <option value="">Any continent</option>
                {availableContinents.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="search-field">
              <span>Country</span>
              <select
                value={country}
                onChange={(event) => handleCountryChange(event.target.value)}
              >
                <option value="">Any country</option>
                {availableCountries.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            {canFilterRegion && (
              <label className="search-field">
                <span>{regionLabel}</span>
                <select
                  value={region}
                  onChange={(event) => handleRegionChange(event.target.value)}
                >
                  <option value="">
                    Any {regionLabel.toLowerCase()}
                  </option>
                  {availableRegions.map((value) => (
                    <option value={value} key={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="search-field">
              <span>City</span>
              <select value={city} onChange={(event) => setCity(event.target.value)}>
                <option value="">Any city</option>
                {availableCities.map((value) => (
                  <option value={value} key={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="search-field search-field-wide">
              <span>Keywords</span>
              <input
                value={keywordQuery}
                onChange={(event) => setKeywordQuery(event.target.value)}
                placeholder="alpha, bravo, charlie"
              />
            </label>

            <label className="search-field">
              <span>Sort by</span>
              <select
                value={sortField}
                onChange={(event) => setSortField(event.target.value as SearchSortField)}
              >
                <option value="date">Date</option>
                <option value="distance">Distance</option>
                <option value="name">Name</option>
                <option value="location">Location</option>
              </select>
            </label>

            <label className="search-field">
              <span>Order</span>
              <select
                value={sortDirection}
                onChange={(event) => setSortDirection(event.target.value as SearchSortDirection)}
              >
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
            </label>
          </div>

          <div className="search-results-header">
            <span>
              {isLoading
                ? 'Loading activities...'
                : `${filteredActivities.length.toLocaleString()} result${
                    filteredActivities.length === 1 ? '' : 's'
                  }`}
            </span>
            {error && <span className="search-error">{error}</span>}
          </div>

          <div className="search-results" role="list">
            {filteredActivities.slice(0, 150).map((activity) => {
              const distance = formatKilometers(activity.corrected_distance);
              const date = formatActivityDateTime(activity.started_at);
              const location = getActivityLocationLabel(activity);

              return (
                <button
                  className="search-result"
                  type="button"
                  role="listitem"
                  key={activity.id}
                  onClick={() => onActivitySelect(activity)}
                >
                  <span className="search-result-name">{getActivityDisplayName(activity)}</span>
                  <span className="search-result-meta">
                    {date && <span>{date}</span>}
                    {distance && <span>{distance}</span>}
                    {location && <span>{location}</span>}
                  </span>
                </button>
              );
            })}

            {!isLoading && filteredActivities.length === 0 && (
              <p className="search-empty-state">No activities match those filters.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function App() {
  const session = useSupabaseSession();
  const storyPanelRef = useRef<HTMLElement | null>(null);
  const isDraggingMapControl = useRef(false);
  const mapControlStart = useRef({ x: 0, y: 0 });
  const hasMovedMapControl = useRef(false);
  const [selectedActivity, setSelectedActivity] =
    useState<SelectedProjectActivity | null>(null);
  const [selectedActivityAnimationKey, setSelectedActivityAnimationKey] = useState(0);
  const [mobileMode, setMobileMode] = useState<MobileMode>('project');
  const [showMapHandleHint, setShowMapHandleHint] = useState(true);
  const [mobileMapHeight, setMobileMapHeight] = useState(48);
  const [mobileMapControlX, setMobileMapControlX] = useState(94);
  const [mobileMapOpacity, setMobileMapOpacity] = useState(1);
  const [desktopContentTab, setDesktopContentTab] =
    useState<DesktopContentTab>('story');
  const [mapFocusActivityId, setMapFocusActivityId] = useState<string | null>(null);
  const [mapFocusActivityKey, setMapFocusActivityKey] = useState(0);
  const [mapProgressFocusActivityId, setMapProgressFocusActivityId] =
    useState<string | null>(null);
  const [mapProgressFocusActivityKey, setMapProgressFocusActivityKey] = useState(0);
  const [showLogoLightbox, setShowLogoLightbox] = useState(false);
  const logoUrl = `${import.meta.env.BASE_URL}ProjectFarPoint.png`;

  const applyMobileMapPreset = useCallback(
    (preset: typeof mobileMapStoryPreset | typeof mobileMapFocusPreset) => {
      setMobileMapHeight(preset.height);
      setMobileMapControlX(preset.controlX);
      setMobileMapOpacity(preset.opacity);
    },
    [],
  );

  const toggleMobileMapPreset = useCallback(() => {
    const isFocusedMap = mobileMapHeight >= 58 && mobileMapOpacity > 0.85;

    applyMobileMapPreset(isFocusedMap ? mobileMapStoryPreset : mobileMapFocusPreset);
  }, [applyMobileMapPreset, mobileMapHeight, mobileMapOpacity]);

  const updateMobileMapFromPointer = useCallback((clientX: number, clientY: number) => {
    const viewportWidth = Math.max(window.innerWidth, 1);
    const viewportHeight = Math.max(window.innerHeight, 1);
    const nextControlX = Math.min(
      mobileMapControlMaxX,
      Math.max(mobileMapControlMinX, (clientX / viewportWidth) * 100),
    );
    const nextHeight = Math.min(
      76,
      Math.max(28, ((viewportHeight - clientY) / viewportHeight) * 100),
    );
    const opacityProgress =
      (nextControlX - mobileMapControlMinX) /
      (mobileMapControlMaxX - mobileMapControlMinX);
    const nextOpacity =
      mobileMapOpacityMin +
      opacityProgress * (mobileMapOpacityMax - mobileMapOpacityMin);

    setMobileMapHeight(nextHeight);
    setMobileMapControlX(nextControlX);
    setMobileMapOpacity(nextOpacity);
  }, []);

  function handleMobileMapControlPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    isDraggingMapControl.current = true;
    hasMovedMapControl.current = false;
    mapControlStart.current = {
      x: event.clientX,
      y: event.clientY,
    };
    setShowMapHandleHint(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateMobileMapFromPointer(event.clientX, event.clientY);
  }

  function handleMobileMapControlPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!isDraggingMapControl.current) {
      return;
    }

    if (
      Math.hypot(
        event.clientX - mapControlStart.current.x,
        event.clientY - mapControlStart.current.y,
      ) > 7
    ) {
      hasMovedMapControl.current = true;
    }

    updateMobileMapFromPointer(event.clientX, event.clientY);
  }

  function handleMobileMapControlPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    isDraggingMapControl.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!hasMovedMapControl.current) {
      toggleMobileMapPreset();
    }
  }

  const handleMobileModeChange = useCallback((nextMode: MobileMode) => {
    setMobileMode(nextMode);
    window.requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 980px)').matches) {
        window.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    });
  }, []);

  const handleActivitySelect = useCallback((activity: SelectedProjectActivity) => {
    setSelectedActivity(activity);
    setSelectedActivityAnimationKey((currentKey) => currentKey + 1);
    setMobileMode('project');
    setDesktopContentTab('story');
    window.requestAnimationFrame(() => {
      if (window.matchMedia('(max-width: 980px)').matches) {
        storyPanelRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    });
  }, []);
  const handleSearchActivitySelect = useCallback((activity: ProjectActivity) => {
    setSelectedActivity(activity);
    setSelectedActivityAnimationKey((currentKey) => currentKey + 1);
    setMapFocusActivityId(activity.id);
    setMapFocusActivityKey((currentKey) => currentKey + 1);
  }, []);
  const handleActivityFocus = useCallback((activityId: string) => {
    setMapFocusActivityId(activityId);
    setMapFocusActivityKey((currentKey) => currentKey + 1);
  }, []);
  const handleProgressPositionFocus = useCallback((activityId: string) => {
    setMapProgressFocusActivityId(activityId);
    setMapProgressFocusActivityKey((currentKey) => currentKey + 1);
  }, []);
  const handleBackToIntro = useCallback(() => {
    setSelectedActivity(null);
  }, []);
  const handleDesktopContentTabChange = useCallback((nextTab: DesktopContentTab) => {
    setDesktopContentTab(nextTab);
  }, []);
  const appStyle = {
    '--mobile-map-height': mobileMapHeight,
    '--mobile-map-control-x': mobileMapControlX,
    '--mobile-map-opacity': mobileMapOpacity,
  } as CSSProperties;
  const searchParams = new URLSearchParams(window.location.search);
  const showAdminPage = searchParams.has('adminPage');
  const adminPage = searchParams.get('adminPage');

  if (!showAdminPage) {
    return (
      <main className="coming-soon-page">
        <h1>Coming Soon</h1>
      </main>
    );
  }

  if (adminPage === 'addActivity') {
    return <AddActivityPage session={session} />;
  }

  return (
    <main
      className={`welcome-page mobile-mode-${mobileMode}`}
      style={appStyle}
    >
      <div className="mobile-shell-header">
        <div className="mobile-brand-heading">
          <button
            className="brand-mark brand-mark-button"
            type="button"
            onClick={() => setShowLogoLightbox(true)}
            aria-label="Open Project Far Point logo"
          >
            <img
              className="brand-art"
              src={logoUrl}
              alt="Project FarPoint logo with planet Earth in space"
            />
          </button>
          <div className="brand-title">
            <p className="eyebrow">Welcome to Project Far Point</p>
            <p className="mobile-brand-title">Project Far Point</p>
          </div>
        </div>
        <div className="mobile-nav-account">
          <AuthPanel session={session} />
        <button
          className={mobileMode === 'donate' ? 'mobile-mode-active' : ''}
          type="button"
          onClick={() => handleMobileModeChange('donate')}
        >
          Donate
        </button>
        </div>
      </div>
      <nav className="mobile-mode-nav" aria-label="Mobile view">
        <button
          className={mobileMode === 'project' ? 'mobile-mode-active' : ''}
          type="button"
          onClick={() => handleMobileModeChange('project')}
        >
          Project Far Point
        </button>
        <button
          className={mobileMode === 'progress' ? 'mobile-mode-active' : ''}
          type="button"
          onClick={() => handleMobileModeChange('progress')}
        >
          Progress
        </button>
        <button
          className={mobileMode === 'search' ? 'mobile-mode-active' : ''}
          type="button"
          onClick={() => handleMobileModeChange('search')}
        >
          Search
        </button>
      </nav>
      <section
        className="welcome-copy-panel"
        ref={storyPanelRef}
        aria-labelledby="welcome-title"
      >
        <header className="brand-header">
          <div className="brand-heading">
            <button
              className="brand-mark brand-mark-button"
              type="button"
              onClick={() => setShowLogoLightbox(true)}
              aria-label="Open Project Far Point logo"
            >
              <img
                className="brand-art"
                src={logoUrl}
                alt="Project FarPoint logo with planet Earth in space"
              />
            </button>
            <div className="brand-title">
              <p className="eyebrow">Welcome to Project Far Point</p>
              <h1 id="welcome-title">Project Far Point</h1>
            </div>
          </div>
          <AuthPanel session={session} />
        </header>
        <div className="desktop-content-tabs" role="tablist" aria-label="Project content">
          <button
            className={desktopContentTab === 'story' ? 'desktop-content-tab-active' : ''}
            type="button"
            role="tab"
            aria-selected={desktopContentTab === 'story'}
            onClick={() => handleDesktopContentTabChange('story')}
          >
            Story
          </button>
          <button
            className={desktopContentTab === 'search' ? 'desktop-content-tab-active' : ''}
            type="button"
            role="tab"
            aria-selected={desktopContentTab === 'search'}
            onClick={() => handleDesktopContentTabChange('search')}
          >
            Search
          </button>
        </div>
        <article className={`intro${desktopContentTab === 'search' ? ' intro-hidden-desktop' : ''}`}>
          {selectedActivity ? (
            <ActivityStory
              key={`${selectedActivity.id}-${selectedActivityAnimationKey}`}
              activity={selectedActivity}
              onBack={handleBackToIntro}
              onFocusActivity={handleActivityFocus}
              onFocusProgressPosition={handleProgressPositionFocus}
              isArriving
            />
          ) : (
            <div className="welcome-copy">
              <p>
                Project Far Point is a geo-blog documenting my attempt to
                travel a cumulative distance equal to the circumference of the
                Earth: 40,076 kilometers. Over the course of a decade or more,
                thousands of walks, backpacking trips, paddling adventures,
                ski tours, and snowshoe excursions will become the real-world
                building blocks of two imagined journeys that together circle
                the globe: <strong className="journey-voyager">Voyager</strong>{' '}
                and the{' '}
                <strong className="journey-far-point">Far Point Trail</strong>.

              </p>
              <p>
                Voyager begins high in the remote Southern Alps of New Zealand and
                travels, <i>in imagination</i>, 20,038 kilometers through Australia, Asia, over the summit of Mount Everest,
                and through Europe to its destination: the Cathedral of St. James in
                Santiago de Compostela, Spain - the famed terminus of the Camino
                de Santiago and the exact opposite side of the Earth - the antipode of its starting point.
              </p>
              <p>
                The reality behind Voyager is far less direct, but no less
                meaningful. The intention of Voyager is to visit 100 parks located throughout 
                the world and walk, kayak, raft,ski or snowshoe 100 kilometers in each. The parks are the places where the virtual
                 Voyager's path intersects with the real world, and the activities are the steps that move it forward. With each new
                  adventure, Voyager's progress path will grow on the globe, bringing it closer to its destination
                   and creating a rich tapestry of stories, photos, and videos along the way.
              </p>
              <p>
                The second half of the project, the Far Point Trail, is Voyager's
                wild twin. It imagines an oceanic return voyage from the cathedral in Santiago de Compostela back
                to the Southern Alps of New Zealand. Supporting that fictional
                route is a very real 20,038-kilometer wilderness journey linking
                some of North America's most iconic long-distance trails,
                including Canada's Great Divide Trail and Trans Canada Trail, the
                Pacific Northwest Trail, the Continental Divide Trail, the Arizona
                Trail, the Pacific Crest Trail, and the Oregon and California
                coastal trails.
              </p>
              <p>
                Together, Voyager and the Far Point Trail will one day complete a full virtual
                circumnavigation of the Earth. Explore the map by clicking on the routes and markers to learn more about the journeys and follow along as the progress paths grow with each new adventure.
                You will find photos, videos, and stories from the adventures, as well as reflections on the experience of connecting with the world through travel and imagination.
              </p>
              <p>
                The destination may be years away, but the adventure begins with
                the next step. I'm already planning a celebration in the courtyard
                of St. James Cathedral in 2038! Until then, I invite you to follow
                along and share in the journey.
              </p>
            </div>
          )}
        </article>
        <div className={`desktop-search-content${desktopContentTab === 'story' ? ' desktop-search-content-hidden' : ''}`}>
          <SearchPanel onActivitySelect={handleSearchActivitySelect} />
        </div>
        <div className="mobile-mode-content mobile-progress-content">
          <JourneySummary />
        </div>
        <div className="mobile-mode-content mobile-donate-content">
          <CharityPanel />
        </div>
        <div className="mobile-mode-content mobile-search-content">
          <SearchPanel onActivitySelect={handleSearchActivitySelect} />
        </div>
      </section>
      <section className="experience-panel" aria-label="Project progress and map">
        <div className="experience-top">
          <JourneySummary />
          <CharityPanel />
        </div>
        <div className="globe-panel" aria-label="Interactive 3D globe">
          <button
            className={`mobile-map-control${showMapHandleHint ? ' mobile-map-control-with-hint' : ''}`}
            type="button"
            aria-label="Drag to resize and fade the map"
            onPointerDown={handleMobileMapControlPointerDown}
            onPointerMove={handleMobileMapControlPointerMove}
            onPointerUp={handleMobileMapControlPointerUp}
            onPointerCancel={handleMobileMapControlPointerUp}
          >
            <span aria-hidden="true">Drag Me!</span>
          </button>
          <GlobeView
            session={session}
            selectedActivityId={selectedActivity?.id ?? null}
            focusActivityId={mapFocusActivityId}
            focusActivityKey={mapFocusActivityKey}
            focusProgressActivityId={mapProgressFocusActivityId}
            focusProgressActivityKey={mapProgressFocusActivityKey}
            onActivitySelect={handleActivitySelect}
          />
        </div>
      </section>
      {showLogoLightbox && (
        <div
          className="route-story-lightbox logo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Project Far Point logo"
          onClick={() => setShowLogoLightbox(false)}
        >
          <button
            className="route-story-lightbox-close"
            type="button"
            onClick={() => setShowLogoLightbox(false)}
            aria-label="Close logo"
          >
            Close
          </button>
          <figure
            className="route-story-lightbox-figure logo-lightbox-figure"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={logoUrl}
              alt="Project FarPoint logo with planet Earth in space"
            />
          </figure>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
