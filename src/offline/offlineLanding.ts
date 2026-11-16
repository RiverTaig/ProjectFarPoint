import { readOfflineLink } from './offlineClient';

// Imported before the main app. Retain the password in tab memory only and
// replace the current history entry before rendering any visible controls.
export const initialOfflineLink = /^\/offline\/?$/.test(window.location.pathname)
  ? readOfflineLink(window.location.href) : null;
if (initialOfflineLink) {
  window.history.replaceState(window.history.state, '', initialOfflineLink.url);
}
