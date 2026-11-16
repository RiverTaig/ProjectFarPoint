import { passwordMatches, readBody, readRequestBytes } from './offlineSubmission.ts';
import { TrailError } from './trailExtraction.ts';

export const maxImageBytes = 10485760;
export const imageNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export type SavedImage = { name: string; caption: string | null; url: string };
export interface ContentStore {
  activity(requestId: string, ownerId: string): Promise<{ id: string; description: string; images: SavedImage[] } | null>;
  save(requestId: string, ownerId: string, description: string | null, image: Record<string, unknown> | null): Promise<void>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export function imageFormat(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return { mime: 'image/jpeg', extension: 'jpg' };
  if ([137,80,78,71,13,10,26,10].every((value,i) => bytes[i] === value)) return { mime: 'image/png', extension: 'png' };
  const text = new TextDecoder('ascii');
  if (['GIF87a','GIF89a'].includes(text.decode(bytes.slice(0,6)))) return { mime: 'image/gif', extension: 'gif' };
  if (text.decode(bytes.slice(0,4)) === 'RIFF' && text.decode(bytes.slice(8,12)) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

export function createContentHandler(deps: {
  config: () => { password: string; ownerId: string } | null;
  allowedOrigins: () => string[]; store: () => ContentStore;
}) {
  return async (request: Request) => {
    const origin = request.headers.get('origin');
    const headers: Record<string,string> = { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
      'Referrer-Policy':'no-referrer', Vary:'Origin', 'Access-Control-Allow-Methods':'POST, OPTIONS',
      'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type' };
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body,null,2),{status,headers});
    if (origin && !deps.allowedOrigins().includes(origin)) return json({status:'failed',error:'Origin is not allowed.'},403);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
    if (request.method !== 'POST') return json({status:'failed',error:'Use an explicit POST to save text or images.'},405);
    const config = deps.config();
    if (!config?.password || !/^[0-9a-f-]{36}$/i.test(config.ownerId)) return json({status:'failed',error:'Offline content is not configured.'},503);
    try {
      let body: Record<string,unknown>; let file: File | null = null;
      if (request.headers.get('content-type')?.startsWith('multipart/form-data')) {
        const bytes = await readRequestBytes(request,maxImageBytes + 65536);
        const form = await new Response(bytes.buffer as ArrayBuffer,{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();
        for (const field of ['pw','requestId','action','name','caption','file']) {
          if (form.getAll(field).length > 1) throw new TrailError('INVALID_BODY','Duplicate form field.');
        }
        body = Object.fromEntries(['pw','requestId','action','name','caption'].map((field) => [field,form.get(field)]));
        const selected = form.get('file'); file = selected instanceof File ? selected : null;
      } else body = await readBody(request,102400);
      if (!await passwordMatches(body.pw,config.password)) return json({status:'failed',code:'UNAUTHORIZED',error:'Incorrect or missing submission password.'},401);
      if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) throw new TrailError('INVALID_REQUEST','A saved offline request ID is required.');
      if (!['read','description','image'].includes(String(body.action))) throw new TrailError('INVALID_ACTION','Unknown content action.');
      const store = deps.store();
      const activity = await store.activity(body.requestId,config.ownerId);
      if (!activity) return json({status:'failed',error:'Saved offline activity was not found for the configured owner.'},404);
      if (body.action === 'read') return json({status:'content_loaded',activityId:activity.id,description:activity.description,images:activity.images});
      if (body.action === 'description') {
        if (typeof body.description !== 'string' || body.description.length > 20000) throw new TrailError('INVALID_DESCRIPTION','Description must be at most 20,000 characters.');
        await store.save(body.requestId,config.ownerId,body.description,null);
        return json({status:'content_saved',activityId:activity.id});
      }
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const caption = typeof body.caption === 'string' ? body.caption.trim() : '';
      if (!imageNamePattern.test(name) || caption.length > 1000) throw new TrailError('INVALID_IMAGE','Use a unique image name with letters, numbers, underscores or hyphens, and a caption under 1,001 characters.');
      if (!file || file.size === 0 || file.size > maxImageBytes) throw new TrailError('INVALID_IMAGE','Choose an image up to 10 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = imageFormat(bytes);
      if (!format) throw new TrailError('INVALID_IMAGE','Choose a JPEG, PNG, WebP or GIF image. HEIC files need conversion first.');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map((n) => n.toString(16).padStart(2,'0')).join('');
      const path = `${activity.id}/offline/${name.toLowerCase()}-${hash}.${format.extension}`;
      const existing = activity.images.find((image) => image.name.toLowerCase() === name.toLowerCase());
      if (activity.images.length >= 10 && !existing) throw new TrailError('IMAGE_LIMIT_REACHED','An activity can have at most 10 images.');
      await store.upload(path,bytes,format.mime);
      await store.save(body.requestId,config.ownerId,null, {name,caption,storage_path:path,
        content_type:format.mime,size_bytes:bytes.length,sort_order:activity.images.length});
      return json({status:'content_saved',activityId:activity.id,imageName:name});
    } catch (error) {
      return json({status:'failed',code:error instanceof TrailError ? error.code : 'CONTENT_SAVE_FAILED',
        error:error instanceof TrailError ? error.message : 'Could not save this content. Your hike remains saved; retry the same text or image.'},error instanceof TrailError ? 422 : 500);
    }
  };
}
