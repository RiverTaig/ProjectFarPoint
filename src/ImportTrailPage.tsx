import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from './supabaseClient';
import { parseTrailGpx } from './trailGpx';

type Trail = ReturnType<typeof parseTrailGpx>;
export default function ImportTrailPage({ authorized, account }: { authorized: boolean; account: React.ReactNode }) {
  const [trail, setTrail] = useState<Trail | null>(null);
  const [version, setVersion] = useState('1');
  const [timezone, setTimezone] = useState('America/Edmonton');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selection = useRef(0);
  const importing = useRef(false);

  async function selectFile(file?: File) {
    const id = ++selection.current;
    setTrail(null); setError(''); setMessage(''); setReading(Boolean(file));
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error('Choose a GPX file smaller than 10 MB.');
      const parsed = parseTrailGpx(await file.text(), file.name);
      if (selection.current === id) setTrail(parsed);
    } catch (failure) {
      if (selection.current === id) setError(failure instanceof Error ? failure.message : 'Could not read GPX.');
    } finally { if (selection.current === id) setReading(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!authorized || !supabase || !trail || importing.current) return;
    importing.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error: failure } = await supabase.rpc('pfp_import_trail_gpx', {
        p_filename: trail.feature.properties.source, p_version: version.trim(),
        p_timezone: timezone.trim(), p_geojson: trail.feature,
      });
      if (failure) {
        if (failure.code === 'PGRST202' || failure.code === '42883') throw new Error('Trail import needs its one-time Supabase setup. Run the owner trail import migration first.');
        throw new Error(failure.message);
      }
      if (!data || !['imported', 'already_imported'].includes(data.status)) throw new Error('Could not confirm the import. Retry the same file and version to check its result.');
      setMessage(`${data.code} version ${data.version}: ${data.status === 'already_imported' ? 'already imported' : 'imported'} — ${Number(data.vertices).toLocaleString()} points.${data.current ? ' Ready to view on the map.' : ' A newer version is already on the map.'}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not import trail. Retry the same file to check its result.'); }
    finally { importing.current = false; setBusy(false); }
  }

  return <main className='activity-admin-page'><section className='activity-admin-shell'>
    <header className='activity-admin-header'><a className='back-link' href='/'>Back to Project Far Point</a>{account}</header>
    <div className='activity-admin-content'>
      <p className='eyebrow'>Project Far Point Admin</p><h1>Import Trail GPX</h1>
      {!authorized ? <p className='activity-admin-copy'>Sign in with the Project Far Point owner account to import trail segments.</p> : <>
        <p className='activity-admin-copy'>Choose a Far Point Trail segment such as FPT_2.gpx. Importing adds its reference line to the map; completed hikes are recorded separately.</p>
        <form className='activity-import-panel' onSubmit={submit}>
          <label className='manual-route-field'><span>GPX file</span><input type='file' accept='.gpx,application/gpx+xml' disabled={busy} onChange={(event) => void selectFile(event.target.files?.[0])} /></label>
          {reading && <p role='status'>Reading GPX…</p>}
          {trail && <p>{trail.code} · {trail.feature.properties.name} · {trail.vertices.toLocaleString()} points · {trail.sections} section{trail.sections === 1 ? '' : 's'}</p>}
          <label className='manual-route-field'><span>Version</span><input value={version} onChange={(event) => {setVersion(event.target.value);setMessage('');}} required maxLength={64} pattern='[A-Za-z0-9.\-]+' disabled={busy} /></label>
          <label className='manual-route-field'><span>Trail timezone</span><input value={timezone} onChange={(event) => {setTimezone(event.target.value);setMessage('');}} required disabled={busy} list='trail-timezones' /></label>
          <datalist id='trail-timezones'>{['America/Edmonton','America/Vancouver','America/Whitehorse','America/Anchorage','Pacific/Auckland'].map((value) => <option key={value} value={value} />)}</datalist>
          <p>Use the trail’s local timezone. Keep version 1 for new segments; choose a new version when correcting an existing trail.</p>
          <button className='auth-submit' disabled={!trail || busy || reading || !supabase} type='submit'>{busy ? 'Importing…' : 'Import Trail GPX'}</button>
        </form>
        {error && <p className='auth-error' role='alert'>{error}</p>}
        {message && <p className='auth-status' role='status'>{message} <a className='back-link' href='/'>View map</a></p>}
      </>}
    </div>
  </section></main>;
}
