// GENERATED: paste this entire file into the offline-activity-content Edge Function editor.
// Do not paste into SQL Editor. Regenerate with node scripts/prepare-offline-function.mjs.
// @ts-nocheck -- generated JavaScript in a .ts dashboard entrypoint; source is typechecked separately.

// supabase/functions/offline-activity-content/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// supabase/functions/_shared/trailExtraction.ts
var TrailError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};

// supabase/functions/_shared/offlineSubmission.ts
async function passwordMatches(supplied, expected) {
  if (typeof supplied !== "string") return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([supplied, expected].map(async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))));
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
async function readRequestBytes(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new TrailError("INVALID_BODY", "A request body is required.");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new TrailError("INVALID_BODY", `Request exceeds ${limit} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
async function readBody(request, limit = 4096) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new TrailError("INVALID_BODY", "Send application/json with t, p, dt, s, e, and pw.");
  }
  const bytes = await readRequestBytes(request, limit);
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TrailError("INVALID_BODY", "Request body is not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TrailError("INVALID_BODY", "Request body must be a JSON object.");
  return body;
}

// supabase/functions/_shared/offlineContent.ts
var maxImageBytes = 10485760;
var imageNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
function imageFormat(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: "image/jpeg", extension: "jpg" };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value)) return { mime: "image/png", extension: "png" };
  const text = new TextDecoder("ascii");
  if (["GIF87a", "GIF89a"].includes(text.decode(bytes.slice(0, 6)))) return { mime: "image/gif", extension: "gif" };
  if (text.decode(bytes.slice(0, 4)) === "RIFF" && text.decode(bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  return null;
}
function createContentHandler(deps) {
  return async (request) => {
    const origin = request.headers.get("origin");
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      Vary: "Origin",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type"
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers });
    if (origin && !deps.allowedOrigins().includes(origin)) return json({ status: "failed", error: "Origin is not allowed." }, 403);
    if (origin) headers["Access-Control-Allow-Origin"] = origin;
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json({ status: "failed", error: "Use an explicit POST to save text or images." }, 405);
    const config = deps.config();
    if (!config?.password || !/^[0-9a-f-]{36}$/i.test(config.ownerId)) return json({ status: "failed", error: "Offline content is not configured." }, 503);
    try {
      let body;
      let file = null;
      if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
        const bytes2 = await readRequestBytes(request, maxImageBytes + 65536);
        const form = await new Response(bytes2.buffer, { headers: { "Content-Type": request.headers.get("content-type") } }).formData();
        for (const field of ["pw", "requestId", "action", "name", "caption", "file"]) {
          if (form.getAll(field).length > 1) throw new TrailError("INVALID_BODY", "Duplicate form field.");
        }
        body = Object.fromEntries(["pw", "requestId", "action", "name", "caption"].map((field) => [field, form.get(field)]));
        const selected = form.get("file");
        file = selected instanceof File ? selected : null;
      } else body = await readBody(request, 102400);
      if (!await passwordMatches(body.pw, config.password)) return json({ status: "failed", code: "UNAUTHORIZED", error: "Incorrect or missing submission password." }, 401);
      if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) throw new TrailError("INVALID_REQUEST", "A saved offline request ID is required.");
      if (!["read", "description", "image"].includes(String(body.action))) throw new TrailError("INVALID_ACTION", "Unknown content action.");
      const store = deps.store();
      const activity = await store.activity(body.requestId, config.ownerId);
      if (!activity) return json({ status: "failed", error: "Saved offline activity was not found for the configured owner." }, 404);
      if (body.action === "read") return json({ status: "content_loaded", activityId: activity.id, description: activity.description, images: activity.images });
      if (body.action === "description") {
        if (typeof body.description !== "string" || body.description.length > 2e4) throw new TrailError("INVALID_DESCRIPTION", "Description must be at most 20,000 characters.");
        await store.save(body.requestId, config.ownerId, body.description, null);
        return json({ status: "content_saved", activityId: activity.id });
      }
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const caption = typeof body.caption === "string" ? body.caption.trim() : "";
      if (!imageNamePattern.test(name) || caption.length > 1e3) throw new TrailError("INVALID_IMAGE", "Use a unique image name with letters, numbers, underscores or hyphens, and a caption under 1,001 characters.");
      if (!file || file.size === 0 || file.size > maxImageBytes) throw new TrailError("INVALID_IMAGE", "Choose an image up to 10 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = imageFormat(bytes);
      if (!format) throw new TrailError("INVALID_IMAGE", "Choose a JPEG, PNG, WebP or GIF image. HEIC files need conversion first.");
      const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
      const path = `${activity.id}/offline/${name.toLowerCase()}-${hash}.${format.extension}`;
      const existing = activity.images.find((image) => image.name.toLowerCase() === name.toLowerCase());
      if (activity.images.length >= 10 && !existing) throw new TrailError("IMAGE_LIMIT_REACHED", "An activity can have at most 10 images.");
      await store.upload(path, bytes, format.mime);
      await store.save(body.requestId, config.ownerId, null, {
        name,
        caption,
        storage_path: path,
        content_type: format.mime,
        size_bytes: bytes.length,
        sort_order: activity.images.length
      });
      return json({ status: "content_saved", activityId: activity.id, imageName: name });
    } catch (error) {
      return json({
        status: "failed",
        code: error instanceof TrailError ? error.code : "CONTENT_SAVE_FAILED",
        error: error instanceof TrailError ? error.message : "Could not save this content. Your hike remains saved; retry the same text or image."
      }, error instanceof TrailError ? 422 : 500);
    }
  };
}

// supabase/functions/offline-activity-content/index.ts
Deno.serve(createContentHandler({
  config: () => {
    const password = Deno.env.get("OFFLINE_SUBMISSION_PASSWORD");
    const ownerId = Deno.env.get("OFFLINE_ACTIVITY_OWNER_ID");
    return password && ownerId ? { password, ownerId } : null;
  },
  allowedOrigins: () => (Deno.env.get("APP_ORIGINS") ?? "https://projectfarpoint.com").split(",").map((value) => value.trim()).filter(Boolean),
  store: () => {
    const client = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
    return {
      async activity(requestId, ownerId) {
        const { data: r, error } = await client.from("offline_activity_requests").select("result_activity_id").eq("id", requestId).eq("owner_user_id", ownerId).eq("status", "completed").maybeSingle();
        if (error) throw error;
        if (!r?.result_activity_id) return null;
        const { data: a, error: ae } = await client.from("project_activities").select("id,text_description").eq("id", r.result_activity_id).eq("owner_user_id", ownerId).eq("source", "offline").eq("offline_request_id", requestId).is("superseded_by_activity_id", null).maybeSingle();
        if (ae) throw ae;
        if (!a) return null;
        const { data: images, error: ie } = await client.from("project_activity_images").select("name,caption,storage_bucket,storage_path").eq("activity_id", a.id).order("sort_order").order("created_at");
        if (ie) throw ie;
        return { id: a.id, description: a.text_description ?? "", images: (images ?? []).map((image) => ({
          name: image.name,
          caption: image.caption,
          url: client.storage.from(image.storage_bucket).getPublicUrl(image.storage_path).data.publicUrl
        })) };
      },
      async upload(path, bytes, contentType) {
        const { error } = await client.storage.from("project-activity-images").upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
        if (error && !["409", "Duplicate"].includes(String(error.statusCode))) throw error;
      },
      async save(requestId, ownerId, description, image) {
        const { error } = await client.rpc("pfp_save_offline_content", { p_request: requestId, p_owner: ownerId, p_description: description, p_image: image });
        if (error?.message.includes("IMAGE_NAME_IN_USE")) throw new TrailError("IMAGE_NAME_IN_USE", "That image name is already used for a different photo. Choose another name.");
        if (error?.message.includes("IMAGE_LIMIT_REACHED")) throw new TrailError("IMAGE_LIMIT_REACHED", "An activity can have at most 10 images.");
        if (error) throw error;
      }
    };
  }
}));
