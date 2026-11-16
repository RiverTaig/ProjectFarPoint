import { useEffect, useState } from 'react';
import type { ImageDraft } from './offlineContentClient';
import { imageNamePattern } from './offlineContentClient';

export default function OfflineImageEditor({ image, disabled, change, remove, insert }: {
  image: ImageDraft; disabled: boolean; change: (image: ImageDraft) => void; remove: () => void; insert: () => void;
}) {
  const [url,setUrl] = useState('');
  useEffect(() => { const objectUrl = URL.createObjectURL(image.file); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl); },[image.file]);
  return <fieldset className="offline-image-editor" disabled={disabled}>
    <legend>{image.file.name}{image.saved ? ' · Saved' : ''}</legend>
    <img src={url || undefined} alt={image.caption || image.name} />
    <label>Image name<input value={image.name} maxLength={64} disabled={image.saved} onChange={(event) => change({...image,name:event.target.value})} /></label>
    <label>Caption<input value={image.caption} maxLength={1000} disabled={image.saved} onChange={(event) => change({...image,caption:event.target.value})} /></label>
    <div className="offline-image-actions">
      <button type="button" disabled={!imageNamePattern.test(image.name.trim())} onClick={insert}>Insert image reference</button>
      {!image.saved && <button type="button" onClick={remove}>Remove image</button>}
    </div>
  </fieldset>;
}
