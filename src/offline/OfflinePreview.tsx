import { useEffect, useRef, useState } from 'react';
import Map from '@arcgis/core/Map.js';
import MapView from '@arcgis/core/views/MapView.js';
import * as reactiveUtils from '@arcgis/core/core/reactiveUtils.js';
import Graphic from '@arcgis/core/Graphic.js';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js';
import GeoJSONLayer from '@arcgis/core/layers/GeoJSONLayer.js';
import { buildTrailIndex, extractTrailSection, parseOfflineUrl, TrailError } from './trailExtraction';
import type { Coordinate, TrailIndex } from './trailExtraction';
import './offlinePreview.css';
import { previewExamples } from './previewExamples';
import { initialOfflineLink } from './offlineLanding';
import { readOfflineLink, submitOfflineActivity } from './offlineClient';
import type { SubmissionResult } from './offlineClient';
import OfflineImageEditor from './OfflineImageEditor';
import { appendMissingImageReferences, offlineContentRequest, validateImageDrafts } from './offlineContentClient';
import type { ImageDraft, SavedPhoto } from './offlineContentClient';

type Preview = { request: ReturnType<typeof parseOfflineUrl>; section: ReturnType<typeof extractTrailSection> };
const asset = `${import.meta.env.BASE_URL}TeAraroaTrail_2026_27.geojson`;
const pointText = (p: Coordinate) => `${p[0].toFixed(6)}, ${p[1].toFixed(6)}`;

function TrailMap({ preview }: { preview: Preview | null }) {
  const node = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const graphicsRef = useRef<GraphicsLayer | null>(null);
  const [ready, setReady] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [mapError, setMapError] = useState('');
  useEffect(() => {
    let disposed = false;
    // React StrictMode cleans up its first effect immediately. Avoid starting
    // network work for that discarded view, which ArcGIS reports as aborts.
    queueMicrotask(() => {
      if (disposed || !node.current) return;
      const graphics = new GraphicsLayer();
      const map = new Map({ basemap: 'hybrid', layers: [new GeoJSONLayer({
        url: asset, title: 'Te Araroa reference trail', popupEnabled: false,
        renderer: { type: 'simple', symbol: { type: 'simple-line', color: [220, 220, 220, 0.6], width: 2 } },
      }), graphics] });
      const view = new MapView({ container: node.current, map, constraints: { snapToZoom: false } });
      viewRef.current = view; graphicsRef.current = graphics;
      view.when().then(() => { if (!disposed) setReady(true); }).catch((error: unknown) => {
        if (!disposed) setMapError(`Map unavailable: ${error instanceof Error ? error.message : 'could not load basemap'}. Extraction results are still available.`);
      });
    });
    return () => { disposed = true; viewRef.current?.destroy(); viewRef.current = null; graphicsRef.current = null; };
  }, []);
  useEffect(() => {
    const graphics = graphicsRef.current;
    const view = viewRef.current;
    if (!ready || !graphics || !view) return;
    let disposed = false;
    graphics.removeAll(); setDrawn(false); setMapError('');
    if (!preview) return;
    const { section, request } = preview;
    const color = request.appliesTo === 'Voyager' ? '#33c6ff' : '#a6e031';
    const route = new Graphic({ geometry: { type: 'polyline', paths: [section.geometry.coordinates], spatialReference: { wkid: 4326 } },
      symbol: { type: 'simple-line', color, width: 5 } });
    graphics.add(route);
    for (const [label, supplied, snap] of [
      ['Start', request.start, section.snappedStart], ['End', request.end, section.snappedEnd],
    ] as const) {
      graphics.add(new Graphic({ geometry: { type: 'polyline', paths: [[supplied, snap.coordinate]], spatialReference: { wkid: 4326 } },
        symbol: { type: 'simple-line', color: '#ffffff', width: 2, style: 'dash' } }));
      graphics.add(new Graphic({ geometry: { type: 'point', longitude: supplied[0], latitude: supplied[1] },
        symbol: { type: 'simple-marker', style: 'x', size: 13, color: '#ffffff', outline: { color: '#ffffff', width: 2 } } }));
      graphics.add(new Graphic({ geometry: { type: 'point', longitude: snap.coordinate[0], latitude: snap.coordinate[1] },
        symbol: { type: 'simple-marker', style: label === 'Start' ? 'circle' : 'diamond', size: 12,
          color, outline: { color: '#07101b', width: 2 } } }));
      graphics.add(new Graphic({ geometry: { type: 'point', longitude: snap.coordinate[0], latitude: snap.coordinate[1] },
        symbol: { type: 'text', text: label, color: '#ffffff', haloColor: '#07101b', haloSize: 2,
          yoffset: 15, font: { size: 12, weight: 'bold' } } }));
    }
    (async () => {
      if (route.geometry?.extent) await view.goTo(route.geometry.extent.expand(1.35), { animate: false });
      await reactiveUtils.whenOnce(() => !view.updating);
      if (!disposed) setDrawn(true);
    })().catch((error: unknown) => {
      if (!disposed && !(error instanceof Error && error.name === 'AbortError')) setMapError('Could not finish drawing the map. Extraction results are still available.');
    });
    return () => { disposed = true; };
  }, [preview, ready]);
  return <div hidden={!preview}>
    {!drawn && !mapError && <p role="status">Drawing trail map…</p>}
    <div ref={node} className="offline-map" data-drawn={drawn} aria-label="Extracted trail section map" />
    {mapError && <p role="alert">{mapError}</p>}</div>;
}

export default function OfflinePreview() {
  const [url, setUrl] = useState(initialOfflineLink?.url ?? window.location.href);
  const [password, setPassword] = useState(initialOfflineLink?.password ?? '');
  const [passwordError, setPasswordError] = useState(initialOfflineLink?.passwordError ?? '');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const [retryReady, setRetryReady] = useState(true);
  const [index, setIndex] = useState<TrailIndex | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const initialUrl = useRef(initialOfflineLink?.url ?? window.location.href);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  let isExample = false;
  try { isExample = new URL(url, window.location.origin).searchParams.get('preview') === '1'; } catch { /* Invalid pasted URLs are handled by preview validation. */ }
  const configured = Boolean(import.meta.env.VITE_SUPABASE_URL);
  const [description,setDescription] = useState('');
  const [descriptionDirty,setDescriptionDirty] = useState(false);
  const [images,setImages] = useState<ImageDraft[]>([]);
  const [savedPhotos,setSavedPhotos] = useState<SavedPhoto[]>([]);
  const [contentError,setContentError] = useState('');
  const [contentMessage,setContentMessage] = useState('');
  const descriptionInput = useRef<HTMLTextAreaElement>(null);
  const contentDirty = descriptionDirty || images.some((image) => !image.saved) || Boolean(contentError);
  const otherSavedPhotos = savedPhotos.filter((photo) => !images.some((image) => image.saved && image.name.trim().toLowerCase() === photo.name.toLowerCase()));
  const activitySaved = Boolean(result && ['completed','already_processed'].includes(result.status));
  const configuration = {url:import.meta.env.VITE_SUPABASE_URL,anonKey:import.meta.env.VITE_SUPABASE_ANON_KEY};

  function insertReference(reference: string) {
    const input = descriptionInput.current;
    const start = input?.selectionStart ?? description.length;
    const end = input?.selectionEnd ?? start;
    setDescription(description.slice(0,start) + `\n\n${reference}\n\n` + description.slice(end));
    setDescriptionDirty(true); input?.focus();
  }

  function changeLink(value: string) {
    setPreview(null); setError(''); setResult(null); setRetryAt(0);
    setDescription(''); setDescriptionDirty(false); setImages([]); setSavedPhotos([]); setContentError(''); setContentMessage('');
    if (!value) { setUrl(''); return; }
    try {
      const link = readOfflineLink(value, window.location.origin);
      setUrl(link.url); setPasswordError(link.passwordError);
      if (link.passwordSupplied) setPassword(link.password);
    } catch { setError('Enter a valid satellite message URL.'); }
  }

  useEffect(() => {
    setRetryReady(retryAt <= Date.now());
    if (retryAt <= Date.now()) return;
    const timer = window.setTimeout(() => setRetryReady(true), retryAt - Date.now());
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  async function submit() {
    if (submittingRef.current || isExample || !preview || !retryReady) return;
    submittingRef.current = true; setSubmitting(true); setContentError(''); setContentMessage('');
    let saved = activitySaved ? result : null;
    try {
      validateImageDrafts(images);
      if (description.length > 20000) throw new Error('Description must be at most 20,000 characters.');
      const response = saved ?? await submitOfflineActivity(url, password, {
        url: import.meta.env.VITE_SUPABASE_URL, anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      });
      setResult(response);
      if (['completed','already_processed'].includes(response.status)) {
        saved = response;
        if (descriptionDirty || images.length || contentError) {
          if (typeof response.requestId !== 'string') throw new Error('The server did not return a request ID for saving content.');
          const loaded = await offlineContentRequest(response.requestId,password,{type:'read'},configuration);
          setSavedPhotos(loaded.images ?? []);
          const finalText = appendMissingImageReferences(descriptionDirty ? description : loaded.description ?? '',images.map((image) => image.name.trim()));
          if (finalText.length > 20000) throw new Error('Description including image references exceeds 20,000 characters.');
          for (const image of images.filter((image) => !image.saved)) {
            setContentMessage(`Uploading ${image.name}…`);
            await offlineContentRequest(response.requestId,password,{type:'image',image},configuration);
            setImages((current) => current.map((item) => item.id === image.id ? {...item,saved:true} : item));
          }
          setDescription(finalText); setDescriptionDirty(true);
          await offlineContentRequest(response.requestId,password,{type:'description',description:finalText},configuration);
          setDescriptionDirty(false); setContentMessage('Text and images saved.');
          try {
            const refreshed = await offlineContentRequest(response.requestId,password,{type:'read'},configuration);
            setSavedPhotos(refreshed.images ?? []);
          } catch {
            setContentMessage('Text and images saved.');
          }
        }
      }
      if (response.status === 'processing') {
        const seconds = typeof response.retryAfterSeconds === 'number' && Number.isFinite(response.retryAfterSeconds)
          ? Math.min(300, Math.max(1, response.retryAfterSeconds)) : 5;
        setRetryAt(Date.now() + seconds * 1000);
      }
    } catch (failure) {
      if (saved) {
        setResult(saved); setContentError(failure instanceof Error ? failure.message : 'Your hike is saved, but its text or images could not be saved.');
        setContentMessage('Hike saved. Finish the text and image upload by retrying below.');
      } else setResult({ status: 'failed', code: 'SUBMISSION_NOT_CONFIRMED',
        error: failure instanceof Error ? failure.message : 'Could not confirm submission. Retry the same hike.' });
    } finally {
      submittingRef.current = false; setSubmitting(false);
      window.setTimeout(() => resultHeading.current?.focus(), 0);
    }
  }

  function extract(value: string, trail: TrailIndex) {
    setPreview(null); setError('');
    try {
      const request = parseOfflineUrl(value);
      const section = extractTrailSection(trail, request.start, request.end);
      setPreview({ request, section });
    } catch (failure) {
      setError(failure instanceof TrailError ? `${failure.code}: ${failure.message}`
        : failure instanceof Error ? failure.message : 'Could not extract this section.');
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch(asset, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error(`Trail load failed (${response.status}).`);
      return response.json();
    }).then((feature: unknown) => {
      if (controller.signal.aborted) return;
      const trail = buildTrailIndex(feature);
      setIndex(trail);
      if (new URL(initialUrl.current).searchParams.has('t')) extract(initialUrl.current, trail);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setLoadError(failure instanceof Error ? failure.message : 'Could not load trail.');
    });
    return () => controller.abort();
  }, []);

  function download() {
    if (!preview) return;
    const file = { type: 'Feature', properties: {
      trail: 'TA', version: '2026-27', appliesTo: preview.request.appliesTo,
      localDateTime: preview.request.localDateTime, timezone: preview.request.timezone,
      distanceMeters: preview.section.distanceMeters,
      attribution: 'Te Araroa Trust, 2026', license: 'Creative Commons 4.0 New Zealand',
    }, geometry: preview.section.geometry };
    const href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/geo+json' }));
    const link = document.createElement('a'); link.href = href; link.download = 'offline-trail-preview.geojson'; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  return <main className="offline-preview">
    <a href="/">← Project Far Point</a>
    <h1>Offline trail activity</h1>
    <p>Review the hike below, then press Submit to save it. Opening this page or previewing a route does not create an activity.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (index) extract(url, index); }}>
      <label htmlFor="offline-url">Satellite message URL</label>
      <textarea id="offline-url" value={url} onChange={(event) => changeLink(event.target.value)} disabled={submitting} spellCheck={false} rows={3} />
      <button disabled={!index || submitting} type="submit">{index ? 'Preview trail section' : 'Loading trail…'}</button>
    </form>
    <details className="offline-examples"><summary>Try a test URL</summary>
      <p>These illustrative hikes are preview only and cannot be submitted.</p>
      <ul>{previewExamples.map((example) => <li key={example.query}><a href={`/offline${example.query}&preview=1`} aria-disabled={submitting} onClick={(event) => {
        if (submitting) { event.preventDefault(); return; }
        if (!index || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const next = `${window.location.origin}/offline${example.query}&preview=1`;
        changeLink(next); setPassword(''); extract(next, index);
      }}>{example.name}</a></li>)}</ul>
    </details>
    {loadError && <p className="offline-error" role="alert">{loadError}</p>}
    {error && <p className="offline-error" role="alert">{error}</p>}
    {index && <p className="offline-note">Te Araroa 2026–27 · Pacific/Auckland · {index.chains.length} connected chains · 100 m snapping limit</p>}
    {preview && <>
      <section className="offline-result" aria-label="Extraction result">
        <h2>{(preview.section.distanceMeters / 1000).toFixed(2)} km · {preview.request.appliesTo}</h2>
        <p>Hike start: {preview.request.localDateTime.slice(0, 4)}-{preview.request.localDateTime.slice(4, 6)}-{preview.request.localDateTime.slice(6, 8)} {preview.request.localDateTime.slice(9, 11)}:{preview.request.localDateTime.slice(11, 13)} (Pacific/Auckland)</p>
        <p>This is a preview. The server uses the registered trail to calculate the final distance and progress credit when you submit.</p>
      </section>
    </>}
    {index && <TrailMap preview={preview} />}
    {preview && <section className="offline-result-details">
        <p>Colored circle: snapped start · diamond: snapped end · white crosses: supplied positions.</p>
        <div className="offline-table-wrap"><table><thead><tr><th>Endpoint</th><th>Supplied longitude, latitude</th><th>Snapped longitude, latitude</th><th>Snap distance</th></tr></thead>
          <tbody>{([
            ['Start', preview.request.start, preview.section.snappedStart],
            ['End', preview.request.end, preview.section.snappedEnd],
          ] as const).map(([label, supplied, snapped]) => <tr key={label}><th>{label}</th><td>{pointText(supplied)}</td><td>{pointText(snapped.coordinate)}</td><td>{snapped.distanceMeters.toFixed(1)} m</td></tr>)}</tbody></table></div>
        <button type="button" onClick={download}>Download extracted GeoJSON</button>
        <details><summary>Readable extraction result</summary><pre>{JSON.stringify({
          status: 'preview_only', ...preview.request, distanceMeters: preview.section.distanceMeters,
          chain: preview.section.chain, vertexCount: preview.section.geometry.coordinates.length,
          snappedStart: preview.section.snappedStart, snappedEnd: preview.section.snappedEnd,
        }, null, 2)}</pre></details>
      </section>}
    <section className="offline-submit" aria-label="Save offline activity">
      <h2>Save this hike</h2>
      {isExample ? <p>This example is preview only. Paste a real hike link above to submit an activity.</p> : <>
        <label htmlFor="offline-description">Description of the day’s walk</label>
        <textarea id="offline-description" ref={descriptionInput} rows={8} value={description} disabled={submitting} maxLength={20000}
          placeholder="Paste the satellite message here, then add image references wherever the photos should appear."
          onChange={(event) => {setDescription(event.target.value);setDescriptionDirty(true);}} />
        <details><summary>How to reference images</summary>
          <p>Give each image a short name, such as camp. Place <code>{'{Image name="camp"}'}</code> in the description to show it there. Its caption appears with it.</p>
          <p>For a swipeable gallery, use <code>{'{ImageCarousel images="camp,view"}'}</code>. Insert buttons below do this for you. New photos without references are added as a gallery after your text.</p>
        </details>
        <label htmlFor="offline-images">Add photos from your phone</label>
        <input id="offline-images" type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" disabled={submitting || images.length >= 10}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []); event.target.value = '';
            const drafts = selected.map((file) => ({id:crypto.randomUUID(),name:`photo_${crypto.randomUUID().slice(0,8)}`,caption:'',file,saved:false}));
            try { validateImageDrafts([...images,...drafts]);setImages([...images,...drafts]);setContentError(''); }
            catch (failure) {setContentError(failure instanceof Error ? failure.message : 'Could not add images.');}
          }} />
        <p className="offline-note">Up to 10 images per hike, 10 MB each. JPEG, PNG, WebP or GIF. Convert HEIC photos before selecting them.</p>
        {images.map((image) => <OfflineImageEditor key={image.id} image={image} disabled={submitting}
          change={(next) => setImages((current) => current.map((item) => item.id === image.id ? next : item))}
          remove={() => setImages((current) => current.filter((item) => item.id !== image.id))}
          insert={() => insertReference(`{Image name="${image.name.trim()}"}`)} />)}
        {images.length > 1 && <button type="button" disabled={submitting} onClick={() => {
          try {validateImageDrafts(images);insertReference(`{ImageCarousel images="${images.map((image) => image.name.trim()).join(',')}"}`);}
          catch (failure) {setContentError(failure instanceof Error ? failure.message : 'Check image names.');}
        }}>Insert gallery reference</button>}
        {otherSavedPhotos.length > 0 && <div className="offline-saved-photos"><h3>Saved photos</h3>{otherSavedPhotos.map((image) => <figure key={image.name}>
          <img src={image.url} alt={image.caption || image.name} /><figcaption>{image.name}{image.caption ? ` — ${image.caption}` : ''}</figcaption>
          <button type="button" disabled={submitting} onClick={() => insertReference(`{Image name="${image.name}"}`)}>Insert saved image reference</button>
        </figure>)}</div>}
        <label htmlFor="offline-password">Submission password</label>
        <input id="offline-password" type="password" value={password} autoComplete="off"
          onChange={(event) => { setPassword(event.target.value); setPasswordError(''); }} disabled={submitting} />
        <p className="offline-note">{password ? 'Password supplied. It is hidden from the link shown above.' : 'Enter the password if it was not included in the link. Refreshing the page may require entering it again.'}</p>
        {passwordError && <p className="offline-error" role="alert">{passwordError}</p>}
        {!configured && <p className="offline-error">Submission is not configured on this website.</p>}
        {!preview && <p>Preview a valid hike above before submitting.</p>}
        <button type="button" onClick={() => void submit()}
          disabled={!configured || !preview || !password || Boolean(passwordError) || submitting || !retryReady || (activitySaved && !contentDirty)}>
          {submitting ? 'Saving…' : activitySaved && contentDirty ? 'Save text and images' : result?.status === 'processing' ? (retryReady ? 'Check submission' : 'Please wait before checking…') : result?.status === 'failed' ? 'Retry submission' : 'Submit activity'}
        </button>
        {contentMessage && <p role="status">{contentMessage}</p>}
        {contentError && <p className="offline-error" role="alert">{contentError}</p>}
        {submitting && <p role="status">Saving this hike. Please keep this page open.</p>}
      </>}
      {result && <div className={`offline-submission-result ${result.status === 'failed' ? 'offline-error' : ''}`}>
        <h3 ref={resultHeading} tabIndex={-1}>
          {activitySaved && contentError ? 'Hike saved; text or images need attention' : activitySaved && submitting ? 'Hike saved; finishing text and images' : result.status === 'completed' ? 'Activity saved' : result.status === 'already_processed' ? 'Activity already saved' : result.status === 'processing' ? 'Submission is still processing' : 'Submission needs attention'}
        </h3>
        {result.status === 'processing' && <p>Wait briefly, then press Check submission. Checking the same hike will not create a duplicate.</p>}
        {result.status === 'failed' && <p role="alert">{typeof result.error === 'string' ? result.error : 'The submission could not be confirmed.'}</p>}
        {(result.status === 'completed' || result.status === 'already_processed') && <p>{contentError || submitting ? 'The hike is saved. Its text and images still need to finish saving.' : 'The server confirmed this hike is saved.'}</p>}
        <pre aria-label="Submission JSON result">{JSON.stringify(result, null, 2)}</pre>
      </div>}
    </section>
  </main>;
}
