// The shopper's chosen location ("near me"): from GPS or a Google area search, remembered on this device.
import { useEffect, useState } from 'react';

const KEY = 'shopper-location';
const EVENT = 'vfl-location';

export function getSavedLocation() {
  try {
    const loc = JSON.parse(localStorage.getItem(KEY));
    return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) ? loc : null;
  } catch {
    return null;
  }
}

/** loc: { lat, lng, label, source: 'gps' | 'search' } */
export function saveLocation(loc) {
  localStorage.setItem(KEY, JSON.stringify({ ...loc, savedAt: Date.now() }));
  window.dispatchEvent(new Event(EVENT));
}

export function clearLocation() {
  localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVENT));
}

/** [location | null] — updates everywhere on the page when it changes. */
export function useShopperLocation() {
  const [loc, setLoc] = useState(getSavedLocation);
  useEffect(() => {
    const on = () => setLoc(getSavedLocation());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return loc;
}
