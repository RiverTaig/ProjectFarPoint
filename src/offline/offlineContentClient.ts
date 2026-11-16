export type ImageDraft = { id: string; name: string; caption: string; file: File; saved: boolean };
export type SavedPhoto = { name: string; caption: string | null; url: string };
export const imageNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export function validateImageDrafts(images: ImageDraft[]) {
  if (images.length > 10) throw new Error('Choose at most 10 images.');
  const names = new Set<string>();
  for (const image of images) {
    const name = image.name.trim();
    if (!imageNamePattern.test(name)) throw new Error('Image names must use 1–64 letters, numbers, underscores or hyphens.');
    if (names.has(name.toLowerCase())) throw new Error('Each image needs a unique name.');
    names.add(name.toLowerCase());
    if (image.file.size === 0 || image.file.size > 10485760) throw new Error('Each image must be between 1 byte and 10 MB.');
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(image.file.type)) throw new Error('Choose JPEG, PNG, WebP or GIF files. Convert HEIC images before choosing them.');
    if (image.caption.length > 1000) throw new Error('Image captions must be at most 1,000 characters.');
  }
}
export function appendMissingImageReferences(text: string, names: string[]) {
  const referenced = new Set<string>();
  for (const match of text.matchAll(/\{(Image|ImageCarousel)\s+([^{}]+)\}/gi)) {
    const attribute = match[1].toLowerCase() === 'image' ? 'name' : 'images';
    const value = match[2].match(new RegExp(`\\b${attribute}="([^"]*)"`, 'i'))?.[1];
    value?.split(',').forEach((name) => referenced.add(name.trim().toLowerCase()));
  }
  const missing = names.filter((name) => !referenced.has(name.toLowerCase()));
  return missing.length ? `${text.trimEnd()}${text.trim() ? '\n\n' : ''}{ImageCarousel images="${missing.join(',')}"}` : text;
}
export async function offlineContentRequest(
  requestId: string, password: string,
  action: { type: 'read' } | { type: 'description'; description: string } | { type: 'image'; image: ImageDraft },
  configuration: { url?: string; anonKey?: string }, send: typeof fetch = fetch,
): Promise<{ description?: string; images?: SavedPhoto[] }> {
  if (!configuration.url || !password) throw new Error('Server configuration and submission password are required.');
  const url = new URL(configuration.url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Content upload requires a secure connection.');
  url.pathname = `${url.pathname.replace(/\/$/,'')}/functions/v1/offline-activity-content`; url.search = ''; url.hash = '';
  const headers: Record<string,string> = configuration.anonKey ? {apikey:configuration.anonKey} : {};
  let body: BodyInit;
  if (action.type === 'image') {
    const form = new FormData();
    form.set('requestId',requestId); form.set('pw',password); form.set('action','image');
    form.set('name',action.image.name.trim()); form.set('caption',action.image.caption);
    form.set('file',action.image.file); body = form;
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({requestId,pw:password,action:action.type,...(action.type === 'description' ? {description:action.description} : {})});
  }
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(),120000);
  try {
    const response = await send(url.href,{method:'POST',headers,body,signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});
    let result: {status?: string; error?: string; description?: string; images?: SavedPhoto[]};
    try { result = await response.json(); } catch { throw new Error('The content service returned an unreadable response.'); }
    if (!response.ok || !['content_saved','content_loaded'].includes(result?.status ?? '')) {
      throw new Error(typeof result?.error === 'string' ? result.error.replaceAll(password,'[hidden]') : 'The content service could not save this item.');
    }
    return result;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) throw new Error('Could not confirm the upload. Your hike remains saved; retry the same content.');
    throw error;
  } finally { clearTimeout(timeout); }
}
