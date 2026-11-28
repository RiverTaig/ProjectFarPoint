// Isolated PostGIS check; uses no remote database writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { geometryTolerances, simplifyCoordinates } from '../supabase/functions/_shared/simplifyCoordinates.ts';
const require = createRequire(join(process.env.PFP_SQL_TEST_MODULE_ROOT ?? join(tmpdir(), 'pfp-geometry-db-test'), 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const { postgis } = require('@electric-sql/pglite-postgis');
const pg = new PGlite({ extensions: { postgis } });
try {
  await pg.exec(`create extension postgis;
    create table project_activities (id integer primary key, source text, name text, trail_name text,
    text_description text, distance_made_good numeric, geometry_geojson jsonb,
    geometry_simplified_low jsonb, geometry_simplified_medium jsonb, geometry_simplified_high jsonb);`);
  const coordinates = [[-122.65,45.56,10],[-122.645,45.56,11],[-122.64,45.56,12],[-122.64,45.563,13],[-122.65,45.563,14],[-122.65,45.56,10]];
  const full = { type: 'LineString', coordinates };
  const old = { type: 'LineString', coordinates: [coordinates[0],coordinates[2],coordinates.at(-1)] };
  for (const [i, source] of ['strava', 'strava_route', 'offline'].entries()) {
    await pg.query(`insert into project_activities values ($1,$2,'Loop','Loop trail','Keep my story and {Image name="strava_1"}',1.62,$3,$4,$4,$4)`, [i, source, full, old]);
  }
  const migration = readFileSync(new URL('../supabase/migrations/20261128120000_repair_strava_display_geometry.sql', import.meta.url), 'utf8');
  await pg.exec(migration);
  const rows = (await pg.query('select * from project_activities order by id')).rows;
  for (const row of rows) {
    assert.deepEqual(row.geometry_geojson, full);
    assert.equal(row.text_description, 'Keep my story and {Image name="strava_1"}');
    assert.equal(Number(row.distance_made_good), 1.62);
    if (row.source === 'offline') assert.deepEqual(row.geometry_simplified_medium, old);
    else assert.deepEqual(row.geometry_simplified_medium.coordinates, simplifyCoordinates(coordinates, geometryTolerances.medium));
  }
  await pg.exec(migration);
  assert.deepEqual((await pg.query('select * from project_activities order by id')).rows, rows);
  console.log('PASS: repair restores loop geometry, matches importer, preserves full tracks/text/credit and offline activities, and is safe to rerun.');
} finally { await pg.close(); }
