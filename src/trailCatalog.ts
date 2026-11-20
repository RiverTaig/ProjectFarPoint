import { supabase } from './supabaseClient';

export type RegisteredTrail = {
  code: string; name: string; timezone: string; snap_tolerance_meters: number;
  current_version_id: string;
};
export type TrailGeometry = RegisteredTrail & {
  version: string; geojson: unknown; attribution: string; license: string;
};

export async function loadTrailGeometry(trail: RegisteredTrail): Promise<TrailGeometry> {
  if (!supabase) throw new Error('Trail loading requires Supabase configuration.');
  const { data, error } = await supabase.from('trail_versions')
    .select('version,geojson,attribution,license').eq('id', trail.current_version_id).single();
  if (error) throw new Error(`Could not load ${trail.code}: ${error.message}`);
  return { ...trail, ...data };
}

export async function loadRegisteredTrail(code: string): Promise<TrailGeometry> {
  if (!supabase) {
    // Preserve standalone Te Araroa examples without a configured backend.
    if (code !== 'TA') throw new Error('Trail loading requires Supabase configuration.');
    const response = await fetch(`${import.meta.env.BASE_URL}TeAraroaTrail_2026_27.geojson`);
    if (!response.ok) throw new Error(`Trail load failed (${response.status}).`);
    return { code, name: 'Te Araroa', timezone: 'Pacific/Auckland', snap_tolerance_meters: 100,
      current_version_id: 'local-ta-2026-27', version: '2026-27', geojson: await response.json(),
      attribution: 'Te Araroa Trust, 2026', license: 'Creative Commons 4.0 New Zealand' };
  }
  const { data, error } = await supabase.from('trails')
    .select('code,name,timezone,snap_tolerance_meters,current_version_id').eq('code', code).maybeSingle();
  if (error) throw new Error(`Could not load trail: ${error.message}`);
  if (!data?.current_version_id) throw new Error(`Trail ${code} has not been imported yet.`);
  return loadTrailGeometry(data);
}

export async function listFarPointTrails(): Promise<RegisteredTrail[]> {
  if (!supabase) return [];
  const trails: RegisteredTrail[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('trails')
      .select('code,name,timezone,snap_tolerance_meters,current_version_id')
      .like('code', 'FPT%').not('current_version_id', 'is', null)
      .order('code').range(offset, offset + 499);
    if (error) throw new Error(`Could not load Far Point Trail: ${error.message}`);
    trails.push(...data.filter((trail) => /^FPT[1-9]\d*$/.test(trail.code)));
    if (data.length < 500) return trails;
  }
}
