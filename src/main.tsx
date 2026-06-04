import { StrictMode, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import '@arcgis/core/assets/esri/themes/dark/main.css';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Map from '@arcgis/core/Map.js';
import SceneView from '@arcgis/core/views/SceneView.js';
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
  geometry_simplified_medium: {
    type: 'LineString';
    coordinates: number[][];
  } | null;
  geometry_geojson: {
    type: 'LineString';
    coordinates: number[][];
  } | null;
};

type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  distance: number;
  moving_time: number;
  total_elevation_gain: number;
};

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
const sampleProgressKilometers = 1000;

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

function createActivityPaths(activity: ProjectActivity) {
  const geometry = activity.geometry_geojson ?? activity.geometry_simplified_medium;

  if (!geometry?.coordinates?.length) {
    return [];
  }

  return splitPathAtAntimeridian(
    geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude]),
  );
}

function GlobeView() {
  const sceneNode = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sceneNode.current) {
      return;
    }

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
        color: [78, 116, 138, 0.62],
        width: 3,
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
        width: 3,
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

    if (supabase) {
      supabase
        .from('project_activities')
        .select('id,name,sport_type,geometry_simplified_medium,geometry_geojson')
        .not('geometry_geojson', 'is', null)
        .then(({ data, error }) => {
          if (error || !data?.length) {
            return;
          }

          const importedActivitiesLayer = new GraphicsLayer({
            title: 'Imported activities',
            elevationInfo: {
              mode: 'on-the-ground',
            },
          });

          data.forEach((activity) => {
            const paths = createActivityPaths(activity as ProjectActivity);

            if (!paths.length) {
              return;
            }

            importedActivitiesLayer.add(
              new Graphic({
                geometry: {
                  type: 'polyline',
                  paths,
                  spatialReference: {
                    wkid: 4326,
                  },
                },
                symbol: {
                  type: 'simple-line',
                  color: [255, 253, 247, 0.88],
                  width: 3,
                },
                attributes: {
                  name: activity.name,
                  sport_type: activity.sport_type,
                },
              }),
            );
          });

          map.add(importedActivitiesLayer);
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
        components: ['zoom', 'navigation-toggle', 'compass'],
      },
    });

    return () => {
      view.destroy();
    };
  }, []);

  return <div className="globe-view" ref={sceneNode} aria-label="3D globe" />;
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
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [selectedActivityId, setSelectedActivityId] = useState<number | null>(null);
  const [isLoadingActivities, setIsLoadingActivities] = useState(false);
  const [isImportingActivity, setIsImportingActivity] = useState(false);
  const searchParams = new URLSearchParams(window.location.search);
  const stravaStatus = searchParams.get('strava');

  async function handleLoadActivities() {
    setStatus('');
    setError('');
    setIsLoadingActivities(true);

    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.');
      }

      const { data, error: functionError } = await supabase.functions.invoke(
        'strava-list-activities',
        {
          body: {
            page: 1,
            perPage: 30,
          },
        },
      );

      if (functionError) {
        throw functionError;
      }

      setActivities(data.activities ?? []);
      setSelectedActivityId(data.activities?.[0]?.id ?? null);
      setStatus(`Loaded ${data.activities?.length ?? 0} Strava activities.`);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load Strava activities.',
      );
    } finally {
      setIsLoadingActivities(false);
    }
  }

  async function handleImportActivity() {
    setStatus('');
    setError('');

    if (!selectedActivityId) {
      setError('Choose an activity to import.');
      return;
    }

    setIsImportingActivity(true);

    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.');
      }

      const { data, error: functionError } = await supabase.functions.invoke(
        'strava-import-activity',
        {
          body: {
            activityId: selectedActivityId,
          },
        },
      );

      if (functionError) {
        throw functionError;
      }

      setStatus(`Imported ${data.activity?.name ?? 'activity'}.`);
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : 'Could not import Strava activity.',
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
        throw functionError;
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
            Connect Strava, choose one completed activity, and import its
            geometry for display on the globe.
          </p>

          {stravaStatus === 'connected' && (
            <p className="activity-success">
              Strava is connected. The next step is listing your activities for
              import.
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
            <button
              className="activity-secondary-button"
              type="button"
              onClick={handleLoadActivities}
              disabled={isLoadingActivities || !isProjectOwner(session)}
            >
              {isLoadingActivities ? 'Loading activities...' : 'Load Strava activities'}
            </button>

            {activities.length > 0 && (
              <>
                <div className="activity-list" role="listbox" aria-label="Strava activities">
                  {activities.map((activity) => (
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
                  ))}
                </div>

                <button
                  className="strava-connect-button"
                  type="button"
                  onClick={handleImportActivity}
                  disabled={isImportingActivity || !selectedActivityId}
                >
                  {isImportingActivity ? 'Importing...' : 'Import selected activity'}
                </button>
              </>
            )}
          </div>

          {!isProjectOwner(session) && (
            <p className="activity-error">
              Sign in as the Project Far Point owner to import Strava
              activities.
            </p>
          )}
          {status && <p className="activity-status">{status}</p>}
          {error && <p className="activity-error">{error}</p>}
        </div>
      </section>
    </main>
  );
}

function App() {
  const session = useSupabaseSession();
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
    <main className="welcome-page">
      <section className="welcome-copy-panel" aria-labelledby="welcome-title">
        <header className="brand-header">
          <div className="brand-heading">
            <div className="brand-mark">
              <img
                className="brand-art"
                src={`${import.meta.env.BASE_URL}ProjectFarPoint.png`}
                alt="Project FarPoint logo with planet Earth in space"
              />
            </div>
            <div className="brand-title">
              <p className="eyebrow">Welcome to Project Far Point</p>
              <h1 id="welcome-title">Project Far Point</h1>
            </div>
          </div>
          <AuthPanel session={session} />
        </header>
        <div className="intro-shell">
          <article className="intro">
            <div className="welcome-copy">
              <p>
                Project Far Point is a geo-blog documenting my attempt to
                travel a cumulative distance equal to the circumference of the
                Earth: 40,076 kilometers. Over the course of a decade or more,
                thousands of walks, backpacking trips, paddling adventures, ski
                tours, and snowshoe excursions will become the real-world
                building blocks of two imagined journeys that together circle the
                globe: <strong className="journey-voyager">Voyager</strong> and
                the <strong className="journey-far-point">Far Point Trail</strong>.
              </p>
              <p>
                Voyager begins high in the remote Southern Alps of New Zealand and
                travels, <i>in imagination</i>, 20,038 kilometers through Australia, Asia, over the summit of Mount Everest,
                and through Europe to its destination: the Cathedral of St. James in
                Santiago de Compostela, Spain - the famed terminus of the Camino
                de Santiago and the exact opposite side of the Earth (antipode) of its starting point.
              </p>
              <p>
                The reality behind Voyager is far less direct, but no less
                meaningful. Every local walk, winter outing, river float, and day
                hike contributes to the journey. With a focus on autumn, winter,
                and spring adventures near my home in Calgary, Alberta, Voyager
                will also chronicle travels to all fifty U.S. states, Canada's
                thirteen provinces and territories, and walking explorations of
                many of the world's great cities.
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
          </article>
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
        </div>
      </section>
      <section className="globe-panel" aria-label="Interactive 3D globe">
        <GlobeView />
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
