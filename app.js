/* ═══════════════════════════════════════════════════════
   MOOVIT-LIKE TRANSIT APP  –  Application Logic
   ═══════════════════════════════════════════════════════ */

'use strict';

// ── Transit line color palette ──────────────────────────
const LINE_COLORS = {
  subway: { '4': '#00933C', '5': '#00933C', '6': '#00933C', 'A': '#0039A6', 'C': '#0039A6', 'E': '#0039A6', 'N': '#FCCC0A', 'Q': '#FCCC0A', 'R': '#FCCC0A', 'W': '#FCCC0A', '1': '#EE352E', '2': '#EE352E', '3': '#EE352E', 'L': '#A7A9AC', 'J': '#996633', 'Z': '#996633', '7': '#B933AD', 'B': '#FF6319', 'D': '#FF6319', 'F': '#FF6319', 'M': '#FF6319', 'G': '#6CBE45', 'default': '#0039A6' },
  bus:    { 'M15': '#EE352E', 'M31': '#EE352E', 'M101': '#0039A6', 'B41': '#FF6319', 'B63': '#FF6319', 'Q32': '#FCCC0A', 'default': '#0039A6' },
};
function lineColor(type, name) {
  return (LINE_COLORS[type]?.[name]) ?? (LINE_COLORS[type]?.default ?? '#555');
}

// ── Sample NYC route data ───────────────────────────────
const SAMPLE_ROUTES = [
  {
    id: 0, best: true,
    duration: 28, arriveIn: 28,
    fare: 2.90, fareLabel: 'OMNY/MetroCard',
    steps: [
      { type: 'walk',   icon: 'directions_walk', label: 'Walk', duration: 5,  detail: 'Head south on 7th Ave' },
      { type: 'subway', icon: 'directions_subway', name: '1',    duration: 18, detail: 'Times Sq – 42 St → Fulton St', stops: 7 },
      { type: 'walk',   icon: 'directions_walk', label: 'Walk', duration: 5,  detail: 'Walk to Brooklyn Bridge' },
    ]
  },
  {
    id: 1, best: false,
    duration: 34, arriveIn: 34,
    fare: 2.90, fareLabel: 'OMNY/MetroCard',
    steps: [
      { type: 'walk',   icon: 'directions_walk', label: 'Walk', duration: 3, detail: 'Walk to 42 St & 5th Ave' },
      { type: 'bus',    icon: 'directions_bus',   name: 'M15',  duration: 22, detail: '5th Ave → Fulton St', stops: 11 },
      { type: 'walk',   icon: 'directions_walk', label: 'Walk', duration: 9,  detail: 'Walk along Frankfort St' },
    ]
  },
  {
    id: 2, best: false,
    duration: 42, arriveIn: 42,
    fare: 2.90, fareLabel: 'OMNY/MetroCard',
    steps: [
      { type: 'walk',   icon: 'directions_walk', label: 'Walk', duration: 4, detail: 'Walk to 42 St & 8th Ave' },
      { type: 'subway', icon: 'directions_subway', name: 'A',   duration: 20, detail: 'Times Sq → Chambers St', stops: 3 },
      { type: 'walk',   icon: 'directions_walk', label: 'Walk', duration: 4, detail: 'Walk to Bridge entrance' },
    ]
  },
  {
    id: 3, best: false,
    duration: 55, arriveIn: 55,
    fare: 0, fareLabel: 'Free',
    steps: [
      { type: 'bike',   icon: 'directions_bike', label: 'Bike', duration: 55, detail: 'Citi Bike ride via Manhattan Bridge' },
    ]
  },
];

// ── Stop data for map markers ───────────────────────────
const STOPS = [
  { lat: 40.7559, lng: -73.9871, name: 'Times Sq – 42 St', lines: ['1','2','3','N','Q','R','W','A','C','E','7'] },
  { lat: 40.7484, lng: -73.9967, name: '34 St – Penn Station', lines: ['1','2','3','A','C','E'] },
  { lat: 40.7128, lng: -74.0059, name: 'Fulton St', lines: ['A','C','2','3','4','5','J','Z'] },
  { lat: 40.7282, lng: -73.9942, name: 'Canal St', lines: ['A','C','E','N','Q','R','W','6','J','Z'] },
  { lat: 40.7456, lng: -73.9771, name: 'Grand Central – 42 St', lines: ['4','5','6','7','S'] },
  { lat: 40.7614, lng: -73.9776, name: '51 St', lines: ['6'] },
];

// ── Map init ────────────────────────────────────────────
let map, fromMarker, toMarker, routePolylines = [], stopMarkers = [];

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([40.7389, -73.9968], 13);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  // Zoom control top-right
  L.control.zoom({ position: 'topright' }).addTo(map);

  addFromMarker([40.7559, -73.9871]);
  addToMarker([40.7061, -73.9969]);
  addStopMarkers();

  // Sample route polyline
  drawRouteLine([
    [40.7559, -73.9871],
    [40.7484, -73.9967],
    [40.7380, -74.0000],
    [40.7282, -73.9942],
    [40.7128, -74.0059],
  ], '#2b5ce6');
}

function makeIcon(color, iconName) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:34px;height:34px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,.3)">
             <span class="material-icons" style="transform:rotate(45deg);color:white;font-size:18px">${iconName}</span>
           </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });
}

function addFromMarker(latlng) {
  if (fromMarker) map.removeLayer(fromMarker);
  fromMarker = L.marker(latlng, { icon: makeIcon('#2b5ce6', 'radio_button_checked') })
    .addTo(map).bindPopup('<b>Start:</b> Times Square, New York');
}
function addToMarker(latlng) {
  if (toMarker) map.removeLayer(toMarker);
  toMarker = L.marker(latlng, { icon: makeIcon('#e03131', 'place') })
    .addTo(map).bindPopup('<b>Destination:</b> Brooklyn Bridge, New York');
}

function addStopMarkers() {
  STOPS.forEach(stop => {
    const m = L.circleMarker([stop.lat, stop.lng], {
      radius: 7,
      fillColor: '#2b5ce6',
      color: 'white',
      weight: 2,
      fillOpacity: 1,
    }).addTo(map);
    m.on('click', () => showStopPopup(stop));
    stopMarkers.push(m);
  });
}

function drawRouteLine(coords, color, dashed = false) {
  const line = L.polyline(coords, {
    color, weight: 5, opacity: .85,
    dashArray: dashed ? '8,6' : null,
  }).addTo(map);
  routePolylines.push(line);
}

function clearRouteLines() {
  routePolylines.forEach(l => map.removeLayer(l));
  routePolylines = [];
}

// ── Time display ────────────────────────────────────────
function updateTime() {
  const now = new Date();
  document.getElementById('currentTime').textContent =
    now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Route rendering ─────────────────────────────────────
let activeFilter = 'all';

function renderRoutes(routes) {
  const list = document.getElementById('routesList');
  list.innerHTML = '';

  const now = new Date();

  routes.forEach(route => {
    const arrive = new Date(now.getTime() + route.arriveIn * 60000);
    const arriveStr = arrive.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const stepsHtml = route.steps.map((step, i) => {
      const arr = [];
      if (i > 0) arr.push(`<span class="step-arrow">›</span>`);

      if (step.type === 'walk') {
        arr.push(`<span class="step-chip walk"><span class="material-icons">${step.icon}</span></span>`);
      } else {
        const color = lineColor(step.type, step.name);
        arr.push(`<span class="step-chip" style="background:${color}">
          <span class="material-icons">${step.icon}</span>${step.name}
        </span>`);
      }
      return arr.join('');
    }).join('');

    const fareText = route.fare > 0 ? `$${route.fare.toFixed(2)}` : 'Free';

    const card = document.createElement('div');
    card.className = `route-card${route.best ? ' best' : ''}`;
    card.innerHTML = `
      <div class="route-time-block">
        <div class="route-duration">${route.duration}<span>min</span></div>
        <div class="route-arrive">Arrive ${arriveStr}</div>
      </div>
      <div class="route-divider"></div>
      <div class="route-info">
        <div class="route-steps">${stepsHtml}</div>
        <div class="route-detail-text">
          <span class="material-icons small-icon">schedule</span>
          Depart now · ${route.steps.length} step${route.steps.length > 1 ? 's' : ''}
        </div>
      </div>
      <div class="route-fare">
        <div class="fare-amount">${fareText}</div>
        <div class="fare-label">${route.fareLabel}</div>
      </div>
    `;
    card.addEventListener('click', () => openRouteModal(route, arriveStr));
    list.appendChild(card);
  });
}

// ── Filter routes ───────────────────────────────────────
function filterRoutes(el, mode) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeFilter = mode;

  let filtered = SAMPLE_ROUTES;
  if (mode !== 'all') {
    filtered = SAMPLE_ROUTES.filter(r => r.steps.some(s => s.type === mode));
  }
  renderRoutes(filtered);
}

// ── Search & swap ───────────────────────────────────────
function searchRoutes() {
  clearRouteLines();

  // Animate: redraw sample route
  drawRouteLine([
    [40.7559, -73.9871],
    [40.7484, -73.9967],
    [40.7380, -74.0000],
    [40.7282, -73.9942],
    [40.7128, -74.0059],
  ], '#2b5ce6');

  // Expand results panel
  document.getElementById('resultsPanel').classList.remove('collapsed');
  document.getElementById('panelArrow').textContent = 'expand_more';

  renderRoutes(SAMPLE_ROUTES);
  map.flyTo([40.7350, -73.9970], 13, { duration: 1.2 });
}

function swapLocations() {
  const from = document.getElementById('fromInput');
  const to   = document.getElementById('toInput');
  [from.value, to.value] = [to.value, from.value];

  // Swap markers
  const tmp = fromMarker.getLatLng();
  fromMarker.setLatLng(toMarker.getLatLng());
  toMarker.setLatLng(tmp);
  addFromMarker(fromMarker.getLatLng());
  addToMarker(toMarker.getLatLng());
}

function clearDestination() {
  document.getElementById('toInput').value = '';
}

function locateMe() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const latlng = [pos.coords.latitude, pos.coords.longitude];
    addFromMarker(latlng);
    map.setView(latlng, 15);
    document.getElementById('fromInput').value = 'My Location';
  });
}

// ── Results panel toggle ────────────────────────────────
let panelExpanded = true;
function toggleResults() {
  panelExpanded = !panelExpanded;
  const panel = document.getElementById('resultsPanel');
  const arrow = document.getElementById('panelArrow');
  panel.classList.toggle('collapsed', !panelExpanded);
  arrow.textContent = panelExpanded ? 'expand_more' : 'expand_less';
}

// ── Route detail modal ──────────────────────────────────
function openRouteModal(route, arriveStr) {
  const now = new Date();

  const timelineHtml = route.steps.map((step, i) => {
    const color  = step.type === 'walk' ? '#64748b' : lineColor(step.type, step.name || step.label);
    const label  = step.type === 'walk' ? `Walk ${step.duration} min` : `${step.name} · ${step.duration} min`;
    const badgeTxt = step.type === 'walk' ? 'WALK' : step.name;
    const stops  = step.stops ? `${step.stops} stops` : '';

    const t = new Date(now.getTime() + route.steps.slice(0, i).reduce((s, x) => s + x.duration, 0) * 60000);
    const timeStr = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="timeline-step">
        <div class="timeline-dot" style="color:${color};"></div>
        <div class="timeline-step-header">
          <span class="timeline-step-badge" style="background:${color}">${badgeTxt}</span>
          <span class="timeline-step-label">${label}</span>
          <span class="timeline-step-time">${timeStr}</span>
        </div>
        <div class="timeline-step-sub">${step.detail}${stops ? ' · ' + stops : ''}</div>
      </div>`;
  }).join('');

  document.getElementById('modalTitle').textContent =
    `${route.duration} min · Arrive ${arriveStr}`;
  document.getElementById('modalBody').innerHTML =
    `<div class="timeline">${timelineHtml}</div>`;

  document.getElementById('routeModal').classList.add('open');
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('routeModal')) {
    document.getElementById('routeModal').classList.remove('open');
  }
}

function startNavigation() {
  closeModal();
  // Brief feedback
  const btn = document.querySelector('.go-btn');
  if (btn) { btn.textContent = 'Navigation started!'; setTimeout(() => {
    btn.innerHTML = '<span class="material-icons">navigation</span> Start Navigation';
  }, 2000); }
}

// ── Stop popup ──────────────────────────────────────────
function showStopPopup(stop) {
  document.getElementById('stopName').textContent = stop.name;

  const arrivals = stop.lines.slice(0, 4).map(line => {
    const mins = Math.floor(Math.random() * 12) + 1;
    const color = lineColor('subway', line);
    const soon  = mins <= 3 ? ' soon' : '';
    return `
      <div class="arrival-row">
        <span class="arrival-badge" style="background:${color}">${line}</span>
        <span class="arrival-dest">${randomDest()}</span>
        <span class="arrival-time${soon}">${mins} min</span>
      </div>`;
  }).join('');

  document.getElementById('arrivalsList').innerHTML = arrivals;
  document.getElementById('stopPopup').classList.add('visible');
}

function closeStopPopup() {
  document.getElementById('stopPopup').classList.remove('visible');
}

function randomDest() {
  const dests = ['Uptown & The Bronx', 'Downtown & Brooklyn', 'Queens', 'Staten Island Ferry', 'Flushing Main St', 'Far Rockaway'];
  return dests[Math.floor(Math.random() * dests.length)];
}

// ── Bottom nav ──────────────────────────────────────────
function setNav(el, section) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
  if (section === 'map') return;
  // Placeholder feedback for other tabs
  showToast(section.charAt(0).toUpperCase() + section.slice(1) + ' coming soon!');
}

// ── Toast ───────────────────────────────────────────────
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '80px', left: '50%', transform: 'translateX(-50%)',
      background: '#1e293b', color: 'white', padding: '8px 18px',
      borderRadius: '20px', fontSize: '13px', fontWeight: '500',
      zIndex: '9999', transition: 'opacity .3s',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
}

// ── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  updateTime();
  setInterval(updateTime, 30000);
  renderRoutes(SAMPLE_ROUTES);
});
