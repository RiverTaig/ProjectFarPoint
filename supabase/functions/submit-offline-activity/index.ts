import { createClient } from 'npm:@supabase/supabase-js@2';
import { createOfflineHandler } from '../_shared/offlineSubmission.ts';
import type { OfflineStore, Prepared, TrailRegistration } from '../_shared/offlineSubmission.ts';

const handler = createOfflineHandler({
  config: () => {
    const password = Deno.env.get('OFFLINE_SUBMISSION_PASSWORD');
    const ownerId = Deno.env.get('OFFLINE_ACTIVITY_OWNER_ID');
    return password && ownerId ? { password, ownerId } : null;
  },
  allowedOrigins: () => (Deno.env.get('APP_ORIGINS') ?? 'https://projectfarpoint.com')
    .split(',').map((value) => value.trim()).filter(Boolean),
  store: (): OfflineStore => {
    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new Error('Server database configuration missing.');
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    return {
      async trail(code) {
        const { data, error } = await client.from('trails')
          .select('id,code,timezone,snap_tolerance_meters,current_version_id').eq('code', code).maybeSingle();
        if (error) throw error;
        return data?.current_version_id ? data as TrailRegistration : null;
      },
      async prepare(ownerId, trail, input, startedAt) {
        const { data, error } = await client.rpc('pfp_prepare_offline_request', {
          p_owner: ownerId, p_trail: trail.id, p_path: input.appliesTo,
          p_local: input.localDateTime, p_started: startedAt,
          p_start_lon: input.start[0], p_start_lat: input.start[1],
          p_end_lon: input.end[0], p_end_lat: input.end[1],
        });
        if (error) throw error;
        return data as Prepared;
      },
      async geometry(versionId) {
        const { data, error } = await client.from('trail_versions').select('geojson').eq('id', versionId).single();
        if (error) throw error;
        return data.geojson;
      },
      async complete(request, section) {
        const { data, error } = await client.rpc('pfp_complete_offline_request', {
          p_request: request.id, p_token: request.processing_token,
          p_geometry: section.geometry,
        });
        if (error) throw error;
        return data as Record<string, unknown>;
      },
      async fail(request, code, message) {
        const { error } = await client.rpc('pfp_fail_offline_request', {
          p_request: request.id, p_token: request.processing_token,
          p_code: code, p_message: message,
        });
        if (error) throw error;
      },
    };
  },
});

Deno.serve(handler);
