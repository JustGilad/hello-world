/* ═══════════════════════════════════════════════════════
   MOOVIT-LIKE TRANSIT APP  –  Real routing via OSRM + Nominatim
   ═══════════════════════════════════════════════════════ */

'use strict';

// ── API endpoints ───────────────────────────────────────
const NOMINATIM   = 'https://nominatim.openstreetmap.org/search';
const OSRM_DRIVE  = 'https://router.project-osrm.org/route/v1/driving';
const OSRM_WALK   = 'https://routing.openstreetmap.de/routed-foot/route/v1/walking';
const OSRM_BIKE   = 'https://routing.openstreetmap.de/routed-bike/route/v1/cycling';

// ── Route mode config ────────────────────────────────────
const MODES = [
  { id: 'driving', label: 'נהיגה',    icon: 'directions_car',  color: '#2b5ce6', url: OSRM_DRIVE, dashArray: null    },
  { id: 'walking', label: 'הליכה',    icon: 'directions_walk', color: '#2f9e44', url: OSRM_WALK,  dashArray: '6,5'  },
  { id: 'cycling', label: 'אופניים',  icon: 'directions_bike', color: '#e67700', url: OSRM_BIKE,  dashArray: null    },
];

// ── State ─────────────────────────────────────────────────
let map, fromMarker, toMarker;
let fromPlace = null;   // { lat, lng, name }
let toPlace   = null;
let routePolylines = {};   // { driving: L.polyline, walking: ..., cycling: ... }
let activeMode = 'all';
let computedRoutes = [];    // results from last search

// ── Map init ──────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: false }).setView([48.8566, 2.3522], 13); // Paris default

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd', maxZoom: 19,
  }).addTo(map);

  L.control.zoom({ position: 'topright' }).addTo(map);

  // click map → show coordinates + reverse geocode
  map.on('click', onMapClick);
}

async function onMapClick(e) {
  const { lat, lng } = e.latlng;
  try {
    const res = await fetch(
      `${NOMINATIM}?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    // Use reverse endpoint
    const reverseUrl = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const r2 = await fetch(reverseUrl, { headers: { 'Accept-Language': 'en' } });
    const data = await r2.json();
    const name = data.display_name?.split(',').slice(0, 2).join(', ') ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    document.getElementById('stopName').textContent = name;
    document.getElementById('stopMeta').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    document.getElementById('stopIcon').textContent = 'place';
    document.getElementById('arrivalsList').innerHTML = `
      <div class="autocomplete-item" style="cursor:default">
        <span class="material-icons">my_location</span>
        <div class="ac-text">
          <div class="ac-name">Set as origin</div>
        </div>
      </div>
      <div class="autocomplete-item" style="cursor:default">
        <span class="material-icons">flag</span>
        <div class="ac-text">
          <div class="ac-name">Set as destination</div>
        </div>
      </div>
    `;
    // Wire up those quick-set buttons
    const items = document.querySelectorAll('#arrivalsList .autocomplete-item');
    items[0].style.cursor = 'pointer';
    items[1].style.cursor = 'pointer';
    items[0].onclick = () => { setPlace('from', { lat, lng, name }); closeStopPopup(); };
    items[1].onclick = () => { setPlace('to',   { lat, lng, name }); closeStopPopup(); };
    // update Hebrew labels
    items[0].querySelector('.ac-name').textContent = 'הגדר כנקודת מוצא';
    items[1].querySelector('.ac-name').textContent = 'הגדר כיעד';
    document.getElementById('stopPopup').classList.add('visible');
  } catch (_) { /* silent */ }
}

// ── Custom markers ────────────────────────────────────────
function makeMarkerIcon(color, iconName) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:36px;height:36px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.3)">
             <span class="material-icons" style="transform:rotate(45deg);color:white;font-size:18px">${iconName}</span>
           </div>`,
    iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38],
  });
}

function placeMarker(type, latlng, name) {
  if (type === 'from') {
    if (fromMarker) map.removeLayer(fromMarker);
    fromMarker = L.marker(latlng, { icon: makeMarkerIcon('#2b5ce6', 'radio_button_checked') })
      .addTo(map).bindPopup(`<b>From:</b> ${name}`);
  } else {
    if (toMarker) map.removeLayer(toMarker);
    toMarker = L.marker(latlng, { icon: makeMarkerIcon('#e03131', 'place') })
      .addTo(map).bindPopup(`<b>To:</b> ${name}`);
  }
}

function setPlace(type, place) {
  if (type === 'from') {
    fromPlace = place;
    document.getElementById('fromInput').value = place.name;
    placeMarker('from', [place.lat, place.lng], place.name);
  } else {
    toPlace = place;
    document.getElementById('toInput').value = place.name;
    placeMarker('to', [place.lat, place.lng], place.name);
  }
  if (fromPlace && toPlace) fitBothMarkers();
}

function fitBothMarkers() {
  if (!fromPlace || !toPlace) return;
  map.fitBounds([
    [fromPlace.lat, fromPlace.lng],
    [toPlace.lat, toPlace.lng],
  ], { padding: [60, 60] });
}

// ── Nominatim autocomplete ────────────────────────────────
let acTimers = {};

function setupAutocomplete(inputId, dropdownId, type) {
  const input = document.getElementById(inputId);
  const drop  = document.getElementById(dropdownId);

  input.addEventListener('input', () => {
    clearTimeout(acTimers[type]);
    const q = input.value.trim();
    if (q.length < 3) { closeDrop(drop); return; }
    drop.innerHTML = `<div class="autocomplete-loading"><span class="material-icons" style="font-size:16px;animation:spin .8s linear infinite">refresh</span> מחפש…</div>`;
    drop.classList.add('open');
    acTimers[type] = setTimeout(() => nominatimSearch(q, drop, type), 320);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDrop(drop); input.blur(); }
  });

  document.addEventListener('click', e => {
    if (!input.contains(e.target) && !drop.contains(e.target)) closeDrop(drop);
  }, true);
}

async function nominatimSearch(query, drop, type) {
  try {
    const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();

    if (!data.length) {
      drop.innerHTML = `<div class="autocomplete-loading">לא נמצאו תוצאות</div>`;
      return;
    }

    drop.innerHTML = data.map((r, i) => {
      const parts = r.display_name.split(', ');
      const name  = parts.slice(0, 2).join(', ');
      const addr  = parts.slice(2).join(', ');
      return `<div class="autocomplete-item" data-idx="${i}" role="option">
        <span class="material-icons">${getPlaceIcon(r.type, r.class)}</span>
        <div class="ac-text">
          <div class="ac-name">${name}</div>
          <div class="ac-addr">${addr}</div>
        </div>
      </div>`;
    }).join('');

    drop.querySelectorAll('.autocomplete-item').forEach((el, i) => {
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        const r    = data[i];
        const name = r.display_name.split(', ').slice(0, 2).join(', ');
        const place = { lat: parseFloat(r.lat), lng: parseFloat(r.lon), name, fullName: r.display_name };
        setPlace(type, place);
        closeDrop(drop);
      });
    });
  } catch (_) {
    drop.innerHTML = `<div class="autocomplete-loading">שגיאה – בדוק חיבור לאינטרנט</div>`;
  }
}

function closeDrop(drop) { drop.classList.remove('open'); drop.innerHTML = ''; }

function getPlaceIcon(type, cls) {
  if (cls === 'railway' || type === 'station') return 'directions_transit';
  if (cls === 'highway' || type === 'street') return 'turn_right';
  if (cls === 'amenity' && type === 'restaurant') return 'restaurant';
  if (cls === 'shop') return 'shopping_bag';
  if (cls === 'tourism') return 'photo_camera';
  if (cls === 'natural') return 'park';
  return 'place';
}

// ── Routing ────────────────────────────────────────────────
async function fetchRoute(mode) {
  const { url } = mode;
  const coords = `${fromPlace.lng},${fromPlace.lat};${toPlace.lng},${toPlace.lat}`;
  // Request up to 3 alternative routes
  const endpoint = `${url}/${coords}?overview=full&geometries=geojson&alternatives=3&steps=true`;
  const res  = await fetch(endpoint);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route');

  // Return all alternatives, not just the first
  return data.routes.map((r, i) => ({
    id:          i === 0 ? mode.id : `${mode.id}_alt${i}`,
    label:       i === 0 ? mode.label : `${mode.label} (${i + 1})`,
    icon:        mode.icon,
    color:       i === 0 ? mode.color : shadeColor(mode.color, i * 40),
    dashArray:   i === 0 ? mode.dashArray : '8,5',
    duration:    r.duration,
    distance:    r.distance,
    geometry:    r.legs[0]?.steps ?? null,
    geojson:     r.geometry,
  }));
}

// Lighten a hex color by amount
function shadeColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, (num >> 16) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

async function searchRoutes() {
  if (!fromPlace || !toPlace) {
    showToast('יש לבחור נקודת מוצא ויעד.');
    return;
  }
  if (fromPlace.lat === toPlace.lat && fromPlace.lng === toPlace.lng) {
    showToast('נקודת המוצא והיעד זהות.');
    return;
  }

  const btn = document.getElementById('searchBtn');
  btn.classList.add('loading');
  btn.querySelector('span').textContent = 'sync';

  clearRouteLines();
  computedRoutes = [];

  // Parallel requests for all 3 modes, each may return multiple alternatives
  const results = await Promise.allSettled(MODES.map(fetchRoute));

  computedRoutes = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);   // flatten alternatives into one list

  btn.classList.remove('loading');
  btn.querySelector('span').textContent = 'search';

  if (!computedRoutes.length) {
    showToast('לא נמצאו מסלולים. נסה מיקומים אחרים.');
    return;
  }

  // Draw all polylines (dimmed), highlight first
  computedRoutes.forEach((route, i) => drawRouteLine(route, i === 0));
  renderRouteCards(computedRoutes);
  fitBothMarkers();

  // Update departure label
  const depTime = getDepartureTime();
  const depStr = depTime.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('departLabel').textContent =
    departureMode === 'now' ? 'יציאה עכשיו' : `יציאה ב-${depStr}`;

  // Expand results panel
  const panel = document.getElementById('resultsPanel');
  panel.classList.remove('collapsed');
  document.getElementById('panelArrow').textContent = 'expand_more';
}

// ── Polylines ──────────────────────────────────────────────
function drawRouteLine(route, active = false) {
  const coords = route.geojson.coordinates.map(([lng, lat]) => [lat, lng]);
  const line = L.polyline(coords, {
    color:     active ? route.color : '#aaa',
    weight:    active ? 5 : 3,
    opacity:   active ? .9 : .45,
    dashArray: route.dashArray,
  }).addTo(map);
  routePolylines[route.id] = line;
}

function highlightRoute(id) {
  computedRoutes.forEach(r => {
    const line = routePolylines[r.id];
    if (!line) return;
    if (r.id === id) {
      line.setStyle({ color: r.color, weight: 5, opacity: .9, dashArray: r.dashArray });
      line.bringToFront();
    } else {
      line.setStyle({ color: '#aaa', weight: 3, opacity: .45 });
    }
  });
}

function clearRouteLines() {
  Object.values(routePolylines).forEach(l => map.removeLayer(l));
  routePolylines = {};
}

// ── Route cards ────────────────────────────────────────────
function renderRouteCards(routes) {
  const list = document.getElementById('routesList');
  list.innerHTML = '';
  const now  = getDepartureTime();

  routes.forEach((route, i) => {
    const mins    = Math.round(route.duration / 60);
    const km      = (route.distance / 1000).toFixed(1);
    const arrive  = new Date(now.getTime() + route.duration * 1000);
    const arrStr  = arrive.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const card = document.createElement('div');
    card.className = `route-card${i === 0 ? ' active' : ''}`;
    card.dataset.id = route.id;
    if (i === 0) card.classList.add('best');

    card.innerHTML = `
      <div class="mode-icon-large" style="background:${route.color}18">
        <span class="material-icons" style="color:${route.color}">${route.icon}</span>
      </div>
      <div class="route-time-block">
        <div class="route-duration">${mins}<span>min</span></div>
        <div class="route-arrive">Arrive ${arrStr}</div>
      </div>
      <div class="route-divider"></div>
      <div class="route-info">
        <div class="route-steps">
          <span class="step-chip" style="background:${route.color}">
            <span class="material-icons">${route.icon}</span>${route.label}
          </span>
        </div>
        <div class="route-detail-text">
          <span class="material-icons small-icon">straighten</span>
          ${km} ק"מ
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      document.querySelectorAll('.route-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      highlightRoute(route.id);
      openRouteModal(route, arrStr, mins, km);
    });

    list.appendChild(card);
  });
}

// ── Filter (show/hide cards by mode) ──────────────────────
function filterMode(el, mode) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeMode = mode;

  document.querySelectorAll('.route-card').forEach(card => {
    card.style.display = (mode === 'all' || card.dataset.id === mode) ? '' : 'none';
  });

  // Also highlight the visible route on the map
  if (mode !== 'all') highlightRoute(mode);
  else if (computedRoutes.length) highlightRoute(computedRoutes[0].id);
}

// ── Route detail modal ──────────────────────────────────────
function openRouteModal(route, arrStr, mins, km) {
  document.getElementById('modalTitle').textContent =
    `${route.label}  ·  ${mins} דק'  ·  ${km} ק"מ`;

  const steps = route.geometry ?? [];
  let timelineHtml = '';

  if (steps.length) {
    const now = getDepartureTime();
    let elapsed = 0;
    timelineHtml = steps
      .filter(s => s.maneuver?.type !== 'depart' || s.name)
      .slice(0, 18)
      .map(step => {
        const t = new Date(now.getTime() + elapsed * 1000);
        elapsed += step.duration;
        const tStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const stepKm = (step.distance / 1000).toFixed(2);
        const stepMin = Math.round(step.duration / 60);
        const name = step.name || humanizeManeuver(step.maneuver?.type);
        return `
          <div class="timeline-step">
            <div class="timeline-dot" style="color:${route.color}"></div>
            <div class="timeline-step-header">
              <span class="timeline-step-badge" style="background:${route.color}">${humanizeManeuver(step.maneuver?.type)}</span>
              <span class="timeline-step-label">${name}</span>
              <span class="timeline-step-time">${tStr}</span>
            </div>
            <div class="timeline-step-sub">${stepKm} ק"מ · ~${stepMin} דק'</div>
          </div>`;
      }).join('');
  } else {
    timelineHtml = `<div class="empty-state"><span class="material-icons">route</span><p>פרטי שלב-אחר-שלב<br>לא זמינים למסלול זה.</p></div>`;
  }

  document.getElementById('modalBody').innerHTML =
    `<div class="timeline">${timelineHtml}</div>`;
  document.getElementById('routeModal').classList.add('open');
}

function humanizeManeuver(type) {
  const map = { 'turn': 'Turn', 'new name': 'Continue', 'depart': 'Start', 'arrive': 'Arrive',
    'merge': 'Merge', 'on ramp': 'On-Ramp', 'off ramp': 'Off-Ramp', 'fork': 'Fork',
    'end of road': 'End', 'roundabout': 'Roundabout', 'rotary': 'Rotary',
    'roundabout turn': 'Exit', 'notification': 'Note', 'use lane': 'Use Lane' };
  return map[type] ?? (type ?? '–');
}

// ── Swap locations ─────────────────────────────────────────
function swapLocations() {
  [fromPlace, toPlace] = [toPlace, fromPlace];
  document.getElementById('fromInput').value = fromPlace?.name ?? '';
  document.getElementById('toInput').value   = toPlace?.name  ?? '';
  if (fromPlace) placeMarker('from', [fromPlace.lat, fromPlace.lng], fromPlace.name);
  if (toPlace)   placeMarker('to',   [toPlace.lat,   toPlace.lng],   toPlace.name);
  if (fromPlace && toPlace) fitBothMarkers();
}

function clearDestination() {
  toPlace = null;
  document.getElementById('toInput').value = '';
  if (toMarker) { map.removeLayer(toMarker); toMarker = null; }
  clearRouteLines();
  document.getElementById('routesList').innerHTML =
    `<div class="empty-state"><span class="material-icons">directions</span><p>הזן יעד כדי לראות מסלולים.</p></div>`;
}

// ── Locate me ──────────────────────────────────────────────
function locateMe() {
  if (!navigator.geolocation) { showToast('מיקום גיאוגרפי אינו נתמך.'); return; }
  showToast('מאתר את מיקומך…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    try {
      const r   = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, { headers: { 'Accept-Language': 'en' } });
      const d   = await r.json();
      const name = d.display_name?.split(', ').slice(0, 2).join(', ') ?? 'My Location';
      setPlace('from', { lat, lng, name });
    } catch (_) {
      setPlace('from', { lat, lng, name: 'My Location' });
    }
    map.setView([lat, lng], 15);
  }, () => showToast('הגישה למיקום נדחתה.'));
}

// ── Results panel toggle ───────────────────────────────────
let panelExpanded = true;
function toggleResults() {
  panelExpanded = !panelExpanded;
  document.getElementById('resultsPanel').classList.toggle('collapsed', !panelExpanded);
  document.getElementById('panelArrow').textContent = panelExpanded ? 'expand_more' : 'expand_less';
}

// ── Modal ──────────────────────────────────────────────────
function closeModal(e) {
  if (!e || e.target === document.getElementById('routeModal')) {
    document.getElementById('routeModal').classList.remove('open');
  }
}

function startNavigation() {
  closeModal();
  showToast('הניווט החל!');
}

// ── Stop popup ─────────────────────────────────────────────
function closeStopPopup() {
  document.getElementById('stopPopup').classList.remove('visible');
}

// ── Bottom nav ─────────────────────────────────────────────
function setNav(el, section) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
  const tabNames = { lines: 'קווים', favorites: 'מועדפים', alerts: 'התראות', more: 'עוד' };
  if (section !== 'map') showToast(`${tabNames[section] ?? section} – בקרוב!`);
}

// ── Toast ──────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    Object.assign(t.style, {
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      background: '#1e293b', color: 'white', padding: '8px 18px',
      borderRadius: '20px', fontSize: '13px', fontWeight: '500',
      zIndex: '9999', transition: 'opacity .3s', whiteSpace: 'nowrap',
    });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2400);
}

// ── Clock ──────────────────────────────────────────────────
function updateTime() {
  const el = document.getElementById('currentTime');
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Departure time ──────────────────────────────────────
let departureMode = 'now'; // 'now' | 'later'

function setDepart(el, mode) {
  document.querySelectorAll('.depart-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  departureMode = mode;
  const ti = document.getElementById('departTime');
  if (mode === 'later') {
    ti.style.display = 'block';
    // Default to 30 min from now
    const d = new Date(Date.now() + 30 * 60000);
    ti.value = d.toISOString().slice(0, 16);
  } else {
    ti.style.display = 'none';
  }
}

function getDepartureTime() {
  if (departureMode === 'now') return new Date();
  const v = document.getElementById('departTime').value;
  return v ? new Date(v) : new Date();
}

// ── Bootstrap ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupAutocomplete('fromInput', 'fromDropdown', 'from');
  setupAutocomplete('toInput',   'toDropdown',   'to');
  updateTime();
  setInterval(updateTime, 30000);

  // Initial empty state
  document.getElementById('routesList').innerHTML =
    `<div class="empty-state"><span class="material-icons">search</span><p>הזן שני מיקומים למעלה ולחץ<br><b>חפש מסלול</b> לצפייה במסלולים אמיתיים.</p></div>`;
});
