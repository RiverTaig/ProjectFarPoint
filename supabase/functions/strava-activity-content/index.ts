import { corsHeaders } from '../_shared/cors.ts';
import { getAuthorizedUser, getFreshStravaConnection } from '../_shared/strava.ts';

Deno.serve(async (request) => {
  const headers = corsHeaders(request.headers.get('origin'));
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  try {
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });
    const user = await getAuthorizedUser(request);
    const { activityId, photoIndex } = await request.json();
    if (!Number.isSafeInteger(activityId) || activityId <= 0) throw new Error('A valid activity ID is required.');
    const { connection } = await getFreshStravaConnection(user.id);
    const authorization = { Authorization: `Bearer ${connection.access_token}` };
    const base = `https://www.strava.com/api/v3/activities/${activityId}`;
    const photoResponse = await fetch(`${base}/photos?photo_sources=true&size=1600`, { headers: authorization });
    const photoWarning = !photoResponse.ok ? 'Strava photos could not be loaded. Reload to retry, or add photos manually.' : '';
    if (photoIndex !== undefined && photoWarning) throw new Error(photoWarning);
    const photos = photoResponse.ok ? await photoResponse.json() : [];
    if (!Array.isArray(photos)) throw new Error('Strava returned an invalid photo list.');
    if (photoIndex !== undefined) {
      if (!Number.isInteger(photoIndex) || photoIndex < 0 || photoIndex >= Math.min(photos.length, 10)) throw new Error('Invalid photo index.');
      const urls = photos[photoIndex].urls ?? {};
      const url = urls['1600'] ?? Object.values(urls)[0];
      if (typeof url !== 'string' || new URL(url).protocol !== 'https:') throw new Error('This Strava photo is unavailable.');
      // The URL comes from Strava, never from the caller. Do not forward credentials to the image host.
      const image = await fetch(url);
      if (!image.ok) throw new Error('Could not download a Strava photo.');
      const contentType = (image.headers.get('content-type') ?? '').split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(contentType)) throw new Error('Unsupported Strava image format.');
      const blob = await image.blob();
      if (blob.size > 10 * 1024 * 1024) throw new Error('Strava photo exceeds the 10 MB image limit.');
      return new Response(blob, { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'X-Image-Type': contentType, 'Access-Control-Expose-Headers': 'X-Image-Type' } });
    }
    const activityResponse = await fetch(base, { headers: authorization });
    if (!activityResponse.ok) throw new Error('Could not load the Strava activity description.');
    const activity = await activityResponse.json();
    return Response.json({
      description: typeof activity.description === 'string' ? activity.description : '',
      photos: photos.slice(0, 10).map((photo, index) => ({ index, name: `strava_${index + 1}`, caption: typeof photo.caption === 'string' ? photo.caption : '' })),
      warning: photoWarning || (photos.length > 10 ? 'Only the first 10 Strava photos were added (the activity image limit).' : ''),
    }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Unexpected error.' }, { status: 500, headers });
  }
});
