// Google Maps helpers (Maps JavaScript API + Places API (New) + Geocoding). The script is loaded on demand, only
// on screens that search addresses or show a map. Without an API key (appConfig.mapsKey) callers fall back to
// typed addresses + the device's GPS.

let loading = null;

/** Loads the Maps JS API once and resolves to `google.maps`. */
export function loadGoogleMaps(key) {
  if (!key) return Promise.reject(new Error('Google Maps is not configured'));
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const cb = `__vflMaps${Date.now()}`;
    window[cb] = () => {
      delete window[cb];
      resolve(window.google.maps);
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&region=IN&callback=${cb}`;
    s.async = true;
    s.onerror = () => {
      loading = null;
      reject(new Error('Could not load Google Maps'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Address suggestions in India for `input`. Returns [{ id, main, secondary, prediction }]. */
export async function searchPlaces(key, input, { sessionToken, near } = {}) {
  const maps = await loadGoogleMaps(key);
  const { AutocompleteSuggestion } = await maps.importLibrary('places');
  const req = { input, includedRegionCodes: ['in'], sessionToken };
  if (near) req.locationBias = { center: near, radius: 30_000 };
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
  return suggestions
    .filter((s) => s.placePrediction)
    .map((s) => ({
      id: s.placePrediction.placeId,
      main: s.placePrediction.mainText?.toString() || s.placePrediction.text.toString(),
      secondary: s.placePrediction.secondaryText?.toString() || '',
      prediction: s.placePrediction,
    }));
}

export async function newSessionToken(key) {
  const maps = await loadGoogleMaps(key);
  const { AutocompleteSessionToken } = await maps.importLibrary('places');
  return new AutocompleteSessionToken();
}

const component = (components, type) => components?.find((c) => c.types.includes(type))?.longText || '';

/** Full details for a chosen suggestion: { address, city, lat, lng, placeId, name }. */
export async function placeDetails(suggestion) {
  const place = suggestion.prediction.toPlace();
  await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location', 'addressComponents'] });
  const c = place.addressComponents;
  return {
    name: place.displayName || '',
    address: place.formattedAddress || '',
    city: component(c, 'locality') || component(c, 'administrative_area_level_3') || component(c, 'administrative_area_level_2'),
    area: component(c, 'sublocality_level_1') || component(c, 'sublocality') || component(c, 'neighborhood'),
    lat: place.location.lat(),
    lng: place.location.lng(),
    placeId: place.id,
  };
}

/** Address for a coordinate (Geocoding API): { address, city, area }. */
export async function reverseGeocode(key, { lat, lng }) {
  const maps = await loadGoogleMaps(key);
  const { Geocoder } = await maps.importLibrary('geocoding');
  const { results } = await new Geocoder().geocode({ location: { lat, lng } });
  const best = results?.[0];
  if (!best) return { address: '', city: '', area: '' };
  const c = best.address_components.map((x) => ({ longText: x.long_name, types: x.types }));
  return {
    address: best.formatted_address,
    city: component(c, 'locality') || component(c, 'administrative_area_level_2'),
    area: component(c, 'sublocality_level_1') || component(c, 'sublocality') || component(c, 'neighborhood') || component(c, 'locality'),
  };
}

/** The device's GPS position: { lat, lng, accuracy }. Rejects with a readable code on failure. */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(Object.assign(new Error('unsupported'), { code: 'unsupported' }));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (err) => reject(Object.assign(new Error(err.message), { code: err.code === 1 ? 'denied' : 'unavailable' })),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

/** Google Maps link for a pin (opens directions / the place in the Maps app). */
export const mapsUrlFor = ({ lat, lng, placeId }) =>
  `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ''}`;

/** Great-circle distance in km. */
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
