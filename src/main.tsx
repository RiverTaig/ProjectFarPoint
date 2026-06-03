import { StrictMode, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import '@arcgis/core/assets/esri/themes/dark/main.css';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import Map from '@arcgis/core/Map.js';
import SceneView from '@arcgis/core/views/SceneView.js';
import './styles.css';

type LatLon = {
  latitude: number;
  longitude: number;
};

type Vector3 = [number, number, number];

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
const sampleProgressKilometers = 10000;

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
    voyagerStart,
    everestAntipode,
    Math.PI * (sampleProgressKilometers / halfJourneyKilometers),
  );
}

function GlobeView() {
  const sceneNode = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sceneNode.current) {
      return;
    }

    const map = new Map({
      basemap: 'satellite',
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
        color: [112, 130, 84, 0.62],
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
        color: [78, 116, 138, 0.62],
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
        color: [166, 224, 49, 1],
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
        color: [51, 198, 255, 1],
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
        name: 'Calgary, Alberta',
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
        text: 'Calgary, Alberta',
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

function App() {
  return (
    <main className="welcome-page">
      <section className="welcome-copy-panel" aria-labelledby="welcome-title">
        <article className="intro">
          <div className="brand-heading">
            <img
              className="brand-art"
              src="/ProjectFarPoint.png"
              alt="Project FarPoint logo with planet Earth in space"
            />
            <div className="brand-title">
              <p className="eyebrow">Welcome to Project Far Point</p>
              <h1 id="welcome-title">Project Far Point</h1>
            </div>
          </div>
          <div className="welcome-copy">
            <p>
              Project Far Point (PFP) is a geo-blog documenting my attempt to
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
              travels, in imagination, 20,038 kilometers through Australia, Asia,
              and Europe to its destination: the Cathedral of St. James in
              Santiago de Compostela, Spain - the famed terminus of the Camino
              de Santiago and the exact antipode of its starting point.
            </p>
            <p>
              The reality behind Voyager is far less direct, but no less
              meaningful. Every local walk, winter outing, river float, and day
              hike contributes to the journey. With a focus on autumn, winter,
              and spring adventures near my home in Calgary, Alberta, Voyager
              will also chronicle travels to all fifty U.S. states, Canada's
              thirteen provinces and territories, and walking explorations of
              fifty of the world's great cities.
            </p>
            <p>
              The second half of the project, the Far Point Trail, is Voyager's
              wild twin. It imagines an oceanic return voyage from Santiago back
              to the Southern Alps of New Zealand. Supporting that fictional
              route is a very real 20,038-kilometer wilderness journey linking
              some of North America's most iconic long-distance trails,
              including Canada's Great Divide Trail and Trans Canada Trail, the
              Pacific Northwest Trail, the Continental Divide Trail, the Arizona
              Trail, the Pacific Crest Trail, and the Oregon and California
              coastal trails.
            </p>
            <p>
              Together, Voyager and the Far Point Trail will one day complete a
              full circumnavigation of the Earth.
            </p>
            <p>
              The destination may be years away, but the adventure begins with
              the next step. I'm already planning a celebration in the courtyard
              of St. James Cathedral in 2038! Until then, I invite you to follow
              along and share in the journey.
            </p>
          </div>
        </article>
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
