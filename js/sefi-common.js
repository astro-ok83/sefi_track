/* Shared helpers for index.html and admin.html: map icons, geo maths, place search,
   PIN crypto and GitHub saving. Everything lives under window.Sefi. */
(function () {
  const REPO = 'astro-ok83/sefi_track';
  const PBKDF2_ITER = 600000;
  const RAD = Math.PI / 180;

  // ---------------------------------------------------------------- defaults
  const POI_TYPES = {
    stop:   { label: 'Planned stop / waypoint', short: 'Stops' },
    marina: { label: 'Marina / anchorage',      short: 'Marinas' },
    note:   { label: 'Note / dropped pin',      short: 'Notes' },
    hazard: { label: 'Hazard / avoid',          short: 'Hazards' },
  };
  const DEFAULT_ICONS = {
    boat:        { kind: 'arrow',   color: '#10b981' },
    destination: { kind: 'pin',     color: '#ef4444' },
    previous:    { kind: 'anchor',  color: '#94a3b8' },
    stop:        { kind: 'flag',    color: '#f59e0b' },
    marina:      { kind: 'marina',  color: '#38bdf8' },
    note:        { kind: 'note',    color: '#facc15' },
    hazard:      { kind: 'warning', color: '#ef4444' },
  };
  const ICON_SLOTS = {
    boat: 'Boat', destination: 'Destination', previous: 'Previous moorings',
    stop: 'Planned stops', marina: 'Marinas / anchorages', note: 'Notes / pins', hazard: 'Hazards',
  };
  function emptyPlaces() { return { icons: {}, routeMode: 'via', pois: [] }; }
  function iconFor(places, slot) {
    const custom = places && places.icons && places.icons[slot];
    return Object.assign({}, DEFAULT_ICONS[slot] || DEFAULT_ICONS.note, custom || {});
  }

  // ---------------------------------------------------------------- icons
  // Each kind: svg(color) in a 32x32 box, anchor point, and whether it rotates with the course.
  const OUT = '#0f172a';
  const KINDS = {
    arrow:   { name: 'Arrow',   rotate: true,  anchor: [16, 16], svg: c => `<path d="M16 2 L28 29 L16 22 L4 29 Z" fill="${c}" stroke="${OUT}" stroke-width="2" stroke-linejoin="round"/>` },
    boat:    { name: 'Boat',    rotate: true,  anchor: [16, 16], svg: c => `<path d="M16 1.5 C22.5 8 24 17 21.5 30 H10.5 C8 17 9.5 8 16 1.5 Z" fill="${c}" stroke="${OUT}" stroke-width="1.6"/><path d="M16 8 V25" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M16 11 L21 21" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>` },
    pin:     { name: 'Pin',     rotate: false, anchor: [16, 31], svg: c => `<path d="M16 31 C16 31 4.5 19 4.5 11.5 A11.5 11.5 0 0 1 27.5 11.5 C27.5 19 16 31 16 31 Z" fill="${c}" stroke="${OUT}" stroke-width="1.6"/><circle cx="16" cy="11.5" r="4.2" fill="#fff"/>` },
    anchor:  { name: 'Anchor',  rotate: false, anchor: [16, 16], svg: c => `<circle cx="16" cy="16" r="14" fill="${OUT}" stroke="${c}" stroke-width="2"/><g fill="none" stroke="${c}" stroke-width="2.3" stroke-linecap="round"><circle cx="16" cy="8.3" r="2.3"/><path d="M16 10.6 V25.3 M11.5 14 H20.5 M8.3 19 C9.2 23.8 12.6 25.6 16 25.6 C19.4 25.6 22.8 23.8 23.7 19"/></g>` },
    flag:    { name: 'Flag',    rotate: false, anchor: [8, 30],  svg: c => `<path d="M8 30 V3" stroke="${OUT}" stroke-width="3.4" stroke-linecap="round"/><path d="M8 30 V3" stroke="#e2e8f0" stroke-width="1.6" stroke-linecap="round"/><path d="M9 4 H27 L22.5 10 L27 16 H9 Z" fill="${c}" stroke="${OUT}" stroke-width="1.3" stroke-linejoin="round"/>` },
    marina:  { name: 'Marina',  rotate: false, anchor: [16, 16], svg: c => `<circle cx="16" cy="16" r="14" fill="${c}" stroke="${OUT}" stroke-width="1.6"/><path d="M15 6.5 V20.5 H8.5 Z" fill="#fff"/><path d="M17 9.5 L22.5 20.5 H17 Z" fill="#fff"/><path d="M7.5 22.5 H24.5 L21.5 26 H10.5 Z" fill="#fff"/>` },
    star:    { name: 'Star',    rotate: false, anchor: [16, 16], svg: c => `<path d="M16 2.5 L20 11.5 L29.5 12.3 L22.3 18.6 L24.5 28 L16 23 L7.5 28 L9.7 18.6 L2.5 12.3 L12 11.5 Z" fill="${c}" stroke="${OUT}" stroke-width="1.5" stroke-linejoin="round"/>` },
    dot:     { name: 'Dot',     rotate: false, anchor: [16, 16], svg: c => `<circle cx="16" cy="16" r="9" fill="${c}" stroke="#fff" stroke-width="3"/><circle cx="16" cy="16" r="12" fill="none" stroke="${OUT}" stroke-width="1.2"/>` },
    warning: { name: 'Warning', rotate: false, anchor: [16, 18], svg: c => `<path d="M16 3 L30 28 H2 Z" fill="${c}" stroke="${OUT}" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 11 V19" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23.5" r="1.9" fill="#fff"/>` },
    note:    { name: 'Note',    rotate: false, anchor: [8, 28],  svg: c => `<path d="M4 4 H28 V21 H14 L8 27.5 V21 H4 Z" fill="${c}" stroke="${OUT}" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 10 H23 M9 15 H19" stroke="${OUT}" stroke-width="2.2" stroke-linecap="round"/>` },
  };

  // HTML for an icon config. opts: { rotate (deg), size (px) }
  function iconHtml(cfg, opts = {}) {
    cfg = cfg || DEFAULT_ICONS.note;
    const size = opts.size || 30;
    if (cfg.kind === 'emoji' && cfg.emoji) {
      return `<div style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.82)}px;line-height:${size}px;text-align:center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))">${esc(cfg.emoji)}</div>`;
    }
    const k = KINDS[cfg.kind] || KINDS.dot;
    const rot = k.rotate && isFinite(opts.rotate) ? `transform:rotate(${opts.rotate}deg);` : '';
    return `<div style="width:${size}px;height:${size}px;${rot}filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))"><svg viewBox="0 0 32 32" width="${size}" height="${size}">${k.svg(cfg.color || '#38bdf8')}</svg></div>`;
  }
  function makeIcon(cfg, opts = {}) {
    const size = opts.size || 30;
    const k = (cfg && cfg.kind !== 'emoji' && KINDS[cfg.kind]) || null;
    const anchor = k ? [k.anchor[0] * size / 32, k.anchor[1] * size / 32] : [size / 2, size / 2];
    return L.divIcon({ className: 'sefi-icon', html: iconHtml(cfg, opts), iconSize: [size, size], iconAnchor: anchor,
      tooltipAnchor: [size / 2 - anchor[0], size - anchor[1]], popupAnchor: [size / 2 - anchor[0], -anchor[1]] });
  }

  // ---------------------------------------------------------------- geo
  function haversineNm(a, b) {
    const dLat = (b[0] - a[0]) * RAD, dLon = (b[1] - a[1]) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function pathNm(pts) { let d = 0; for (let i = 1; i < pts.length; i++) d += haversineNm(pts[i - 1], pts[i]); return d; }
  function greatCircle(a, b, n = 64) {
    const toV = p => { const la = p[0] * RAD, lo = p[1] * RAD; return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]; };
    const va = toV(a), vb = toV(b);
    const d = Math.acos(Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    if (d < 1e-6) return [a, b];
    const out = [];
    for (let i = 0; i <= n; i++) {
      const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      const x = A * va[0] + B * vb[0], y = A * va[1] + B * vb[1], z = A * va[2] + B * vb[2];
      out.push([Math.atan2(z, Math.hypot(x, y)) / RAD, Math.atan2(y, x) / RAD]);
    }
    return out;
  }
  // Great-circle polyline through several points (keeps longitudes continuous for Leaflet).
  function routeLine(pts) {
    let out = [];
    for (let i = 1; i < pts.length; i++) out = out.concat(greatCircle(pts[i - 1], pts[i]).slice(i > 1 ? 1 : 0));
    for (let i = 1; i < out.length; i++) {
      while (out[i][1] - out[i - 1][1] > 180) out[i] = [out[i][0], out[i][1] - 360];
      while (out[i][1] - out[i - 1][1] < -180) out[i] = [out[i][0], out[i][1] + 360];
    }
    return out;
  }
  // Active stops (in order) that the route goes through.
  function routeStops(places, includeAdminOnly) {
    return ((places && places.pois) || []).filter(p => p.type === 'stop' && !p.done && (includeAdminOnly || !p.adminOnly));
  }
  function avgSpeed24h(track) {
    if (!Array.isArray(track)) return null;
    const pts = track.filter(p => p && isFinite(p.lat) && isFinite(p.lon) && p.t)
      .map(p => ({ ll: [p.lat, p.lon], ms: new Date(p.t).getTime() })).filter(p => isFinite(p.ms)).sort((a, b) => a.ms - b.ms);
    if (pts.length < 2) return null;
    const end = pts[pts.length - 1].ms, recent = pts.filter(p => p.ms >= end - 24 * 3.6e6);
    const hours = recent.length > 1 ? (end - recent[0].ms) / 3.6e6 : 0;
    return hours >= 1 ? pathNm(recent.map(p => p.ll)) / hours : null;
  }
  // "14.465", "-60.87", "14 27.9 N", "14°27'54\"N", "60°52.2'W"
  function parseCoord(text, isLat) {
    const s = String(text || '').trim().toUpperCase();
    if (!s) return null;
    const nums = s.match(/-?\d+(?:[.,]\d+)?/g);
    if (!nums) return null;
    const [d, m = 0, sec = 0] = nums.map(n => parseFloat(n.replace(',', '.')));
    let v = Math.abs(d) + m / 60 + sec / 3600;
    if (d < 0 || /[SW]/.test(s)) v = -v;
    if (/[NS]/.test(s) && !isLat) return null;
    if (/[EW]/.test(s) && isLat) return null;
    return Math.abs(v) <= (isLat ? 90 : 180) ? v : null;
  }
  const fmtCoord = (lat, lon, dp = 4) => `${Math.abs(lat).toFixed(dp)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(dp)}° ${lon >= 0 ? 'E' : 'W'}`;
  const fmtNm = nm => `${Math.round(nm).toLocaleString()} nm`;
  function fmtDuration(hours) { const d = Math.floor(hours / 24), h = Math.round(hours % 24); return d ? `${d} d ${h} h` : `${h} h`; }
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const shortName = n => String(n || '').split(',')[0].trim();

  // ---------------------------------------------------------------- place search
  // Three lookups in parallel (Photon general, Photon nautical/places only, Nominatim), merged,
  // de-duplicated and ranked: name match first, then marinas/harbours, then towns, then distance.
  const NAUTICAL = /marina|harbour|harbor|anchorage|mooring|port|ferry_terminal|pier|bay|beach|cove|strait|cape/;
  const PLACEISH = /^(city|town|village|hamlet|suburb|island|islet|archipelago|locality|neighbourhood|state|country|region|county|administrative)$/;
  function kindTier(kind) { return NAUTICAL.test(kind) ? 0 : PLACEISH.test(kind) ? 1 : /water|natural|peak|reef|shoal/.test(kind) ? 2 : 3; }
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function fromPhoton(f) {
    const p = f.properties || {}, [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
    const kind = (p.osm_value === 'administrative' ? 'administrative' : p.osm_value) || p.type || '';
    return { name: p.name || p.street || '', region: [p.city !== p.name && p.city, p.state, p.country].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', '),
      kind: String(kind).replace(/_/g, ' '), rawKind: `${p.osm_key}=${p.osm_value}`, lat, lon };
  }
  function fromNominatim(r) {
    const a = r.address || {};
    return { name: r.name || String(r.display_name || '').split(',')[0], region: [a.city || a.town || a.village, a.state || a.region, a.country].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(', '),
      kind: String(r.type || r.category || '').replace(/_/g, ' '), rawKind: `${r.category}=${r.type}`, lat: +r.lat, lon: +r.lon };
  }
  async function searchPlaces(q, near, signal) {
    const bias = near ? `&lat=${near[0].toFixed(2)}&lon=${near[1].toFixed(2)}&location_bias_scale=0.3` : '';
    const enc = encodeURIComponent(q);
    const tags = ['leisure:marina', 'harbour', 'seamark:harbour', 'seamark:anchorage', 'place', 'natural:bay'].map(t => `&osm_tag=${t}`).join('');
    const get = url => fetch(url, { signal }).then(r => r.ok ? r.json() : null).catch(e => { if (e.name === 'AbortError') throw e; return null; });
    const [p1, p2, n1] = await Promise.all([
      get(`https://photon.komoot.io/api/?q=${enc}&limit=12&lang=en${bias}`),
      get(`https://photon.komoot.io/api/?q=${enc}&limit=10&lang=en${bias}${tags}`),
      get(`https://nominatim.openstreetmap.org/search?q=${enc}&format=jsonv2&addressdetails=1&limit=8&accept-language=en`),
    ]);
    let all = [...((p2 && p2.features) || []), ...((p1 && p1.features) || [])].map(fromPhoton)
      .concat(((Array.isArray(n1) && n1) || []).map(fromNominatim))
      .filter(r => r.name && isFinite(r.lat) && isFinite(r.lon));
    const words = norm(q).split(/[\s,]+/).filter(w => w.length > 1);
    all.forEach(r => {
      const hay = norm(`${r.name} ${r.region}`), nm = norm(r.name);
      r.match = words.length ? words.filter(w => hay.includes(w)).length / words.length : 1;
      if (words.length && words.every(w => nm.includes(w))) r.match += 0.5;
      r.tier = kindTier(norm(r.rawKind));
      r.dist = near ? haversineNm(near, [r.lat, r.lon]) : 0;
    });
    // de-duplicate: same name within ~1.5 km → keep the better one
    all.sort((a, b) => a.tier - b.tier);
    const out = [];
    for (const r of all) {
      if (out.some(o => norm(o.name) === norm(r.name) && haversineNm([o.lat, o.lon], [r.lat, r.lon]) < 0.8)) continue;
      out.push(r);
    }
    const best = Math.max(0, ...out.map(r => r.match));
    return out.filter(r => r.match >= Math.min(best, 0.5))
      .sort((a, b) => (b.match - a.match) || (a.tier - b.tier) || (a.dist - b.dist))
      .slice(0, 10);
  }

  // ---------------------------------------------------------------- PIN crypto
  function b64(buf) { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  const unb64 = s => Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0));
  async function pinKey(pin, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptToken(token, pin) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt, PBKDF2_ITER), new TextEncoder().encode(token));
    return { v: 1, iter: PBKDF2_ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function decryptToken(blob, pin) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, await pinKey(pin, unb64(blob.salt), blob.iter), unb64(blob.ct));
    return new TextDecoder().decode(pt);
  }

  // ---------------------------------------------------------------- GitHub contents API
  const ghHeaders = token => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' });
  async function ghGetJson(token, path) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=main&t=${Date.now()}`, { headers: ghHeaders(token), cache: 'no-store' });
    if (r.status === 404) return { sha: undefined, json: null };
    if (!r.ok) throw new Error(`GitHub said ${r.status} reading ${path}`);
    const j = await r.json();
    return { sha: j.sha, json: JSON.parse(new TextDecoder().decode(unb64(j.content))) };
  }
  async function ghPutJson(token, path, obj, message) {
    const url = `https://api.github.com/repos/${REPO}/contents/${path}`;
    const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2) + '\n');
    for (let attempt = 0; attempt < 2; attempt++) {   // retry once if the bot committed in between
      const { sha } = await ghGetJson(token, path);
      const res = await fetch(url, { method: 'PUT', headers: ghHeaders(token), body: JSON.stringify({ message, content: b64(bytes), sha, branch: 'main' }) });
      if (res.ok) return;
      if (res.status === 409 && attempt === 0) continue;
      throw new Error(`GitHub said ${res.status}: ${(await res.json().catch(() => ({}))).message || ''}`);
    }
  }
  async function loadPublic(path) {
    try { const r = await fetch(`./${path}?t=${Date.now()}`, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; }
  }

  window.Sefi = { REPO, POI_TYPES, DEFAULT_ICONS, ICON_SLOTS, KINDS, emptyPlaces, iconFor, iconHtml, makeIcon,
    haversineNm, pathNm, greatCircle, routeLine, routeStops, avgSpeed24h, parseCoord, fmtCoord, fmtNm, fmtDuration, esc, shortName,
    searchPlaces, encryptToken, decryptToken, ghGetJson, ghPutJson, loadPublic };
})();
