// GENERATED: paste this entire file into the strava-activity-content Edge Function editor.
// Do not paste into SQL Editor. Regenerate with node scripts/prepare-offline-function.mjs.
// @ts-nocheck -- generated JavaScript in a .ts dashboard entrypoint; source is typechecked separately.

// supabase/functions/_shared/cors.ts
function corsHeaders(origin) {
  const allowedOrigins = (Deno.env.get("APP_ORIGINS") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin"
  };
}

// supabase/functions/_shared/strava.ts
import { createClient } from "npm:@supabase/supabase-js@2";
async function getFreshStravaConnection(userId) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stravaClientId = Deno.env.get("STRAVA_CLIENT_ID");
  const stravaClientSecret = Deno.env.get("STRAVA_CLIENT_SECRET");
  if (!supabaseUrl || !supabaseServiceRoleKey || !stravaClientId || !stravaClientSecret) {
    throw new Error("Strava integration is not configured.");
  }
  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: connection, error } = await serviceClient.from("strava_connections").select("user_id,athlete_id,access_token,refresh_token,expires_at").eq("user_id", userId).maybeSingle();
  if (error) {
    throw error;
  }
  if (!connection) {
    throw new Error("Strava is not connected.");
  }
  if (new Date(connection.expires_at).getTime() > Date.now() + 6e4) {
    return { connection, serviceClient };
  }
  const refreshResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: stravaClientId,
      client_secret: stravaClientSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token
    })
  });
  if (!refreshResponse.ok) {
    throw new Error("Could not refresh Strava access.");
  }
  const refreshData = await refreshResponse.json();
  const refreshedConnection = {
    ...connection,
    access_token: refreshData.access_token,
    refresh_token: refreshData.refresh_token,
    expires_at: new Date(refreshData.expires_at * 1e3).toISOString()
  };
  const { error: updateError } = await serviceClient.from("strava_connections").update({
    access_token: refreshedConnection.access_token,
    refresh_token: refreshedConnection.refresh_token,
    expires_at: refreshedConnection.expires_at,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }).eq("user_id", userId);
  if (updateError) {
    throw updateError;
  }
  return { connection: refreshedConnection, serviceClient };
}
async function getAuthorizedUser(request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase is not configured.");
  }
  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: request.headers.get("authorization") ?? ""
      }
    }
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    throw new Error("You must be signed in.");
  }
  if (data.user.email?.toLowerCase() !== "rivermadsen23@gmail.com") {
    throw new Error("Only the Project Far Point owner can import activities.");
  }
  return data.user;
}

// supabase/functions/strava-activity-content/index.ts
Deno.serve(async (request) => {
  const headers = corsHeaders(request.headers.get("origin"));
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  try {
    if (request.method !== "POST") return Response.json({ error: "Method not allowed." }, { status: 405, headers });
    const user = await getAuthorizedUser(request);
    const { activityId, photoIndex } = await request.json();
    if (!Number.isSafeInteger(activityId) || activityId <= 0) throw new Error("A valid activity ID is required.");
    const { connection } = await getFreshStravaConnection(user.id);
    const authorization = { Authorization: `Bearer ${connection.access_token}` };
    const base = `https://www.strava.com/api/v3/activities/${activityId}`;
    const photoResponse = await fetch(`${base}/photos?photo_sources=true&size=1600`, { headers: authorization });
    const photoWarning = !photoResponse.ok ? "Strava photos could not be loaded. Reload to retry, or add photos manually." : "";
    if (photoIndex !== void 0 && photoWarning) throw new Error(photoWarning);
    const photos = photoResponse.ok ? await photoResponse.json() : [];
    if (!Array.isArray(photos)) throw new Error("Strava returned an invalid photo list.");
    if (photoIndex !== void 0) {
      if (!Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= Math.min(photos.length, 10)) throw new Error("Invalid photo index.");
      const urls = photos[photoIndex].urls ?? {};
      const url = urls["1600"] ?? Object.values(urls)[0];
      if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error("This Strava photo is unavailable.");
      const image = await fetch(url);
      if (!image.ok) throw new Error("Could not download a Strava photo.");
      const contentType = (image.headers.get("content-type") ?? "").split(";")[0];
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(contentType)) throw new Error("Unsupported Strava image format.");
      const blob = await image.blob();
      if (blob.size > 10 * 1024 * 1024) throw new Error("Strava photo exceeds the 10 MB image limit.");
      return new Response(blob, { headers: { ...headers, "Content-Type": "application/octet-stream", "X-Image-Type": contentType, "Access-Control-Expose-Headers": "X-Image-Type" } });
    }
    const activityResponse = await fetch(base, { headers: authorization });
    if (!activityResponse.ok) throw new Error("Could not load the Strava activity description.");
    const activity = await activityResponse.json();
    return Response.json({
      description: typeof activity.description === "string" ? activity.description : "",
      photos: photos.slice(0, 10).map((photo, index) => ({ index, name: `strava_${index + 1}`, caption: typeof photo.caption === "string" ? photo.caption : "" })),
      warning: photoWarning || (photos.length > 10 ? "Only the first 10 Strava photos were added (the activity image limit)." : "")
    }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unexpected error." }, { status: 500, headers });
  }
});
