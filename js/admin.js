/* Admin page: edit destination + destinations list, points of interest, icons, settings.
   Saves go to the GitHub repo through the API with the PIN-decrypted token (kept in memory only). */
(function () {
  const S = window.Sefi, esc = S.esc, $ = id => document.getElementById(id);

  // ------------------------------------------------------------ state
  let token = null;                 // decrypted GitHub token, memory only
  let authBlob = null, liveFix = null, track = [];
  let dests = { current: null, history: [] };
  let places = S.emptyPlaces();
  let draftList = null;             // editable copy of dests for the list editor
  let draftIcons = null;            // editable copy of places.icons for the icon editor
  let map, baseLayer, previewLayer, resultsLayer;
  let activePicker = null;

  const clone = o => JSON.parse(JSON.stringify(o));
  const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const boatLL = () => liveFix ? [liveFix.lat, liveFix.lon] : null;
  const speed = () => S.avgSpeed24h(track) || (liveFix && Number(liveFix.speedKts)) || 5;

  function toast(text, ok = true) {
    const t = $('toast');
    t.className = `text-center text-xs py-1.5 ${ok ? 'bg-emerald-900/70 text-emerald-200' : 'bg-red-900/70 text-red-200'}`;
    t.textContent = text;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), ok ? 4000 : 8000);
  }

  // ------------------------------------------------------------ lock / save
  function setLocked(locked) {
    $('lock-state').textContent = locked ? '🔒 Locked' : '🔓 Unlocked';
    $('lock-state').className = locked ? 'text-amber-300 font-semibold' : 'text-emerald-300 font-semibold';
    $('pin').classList.toggle('hidden', !locked);
    $('btn-unlock').classList.toggle('hidden', !locked);
    $('btn-lock').classList.toggle('hidden', locked);
  }
  async function unlock() {
    if (!authBlob) return toast('Editing is not set up yet: Settings → Set up / change PIN.', false);
    $('btn-unlock').disabled = true; $('btn-unlock').textContent = 'Checking…';
    try {
      token = await S.decryptToken(authBlob, $('pin').value);
      $('pin').value = '';
      setLocked(false);
      // Refresh from the repo itself (the public site can lag ~1 min behind).
      const [d, p] = await Promise.all([S.ghGetJson(token, 'data/destinations.json'), S.ghGetJson(token, 'data/places.json')]);
      if (d.json) dests = d.json;
      if (p.json) places = Object.assign(S.emptyPlaces(), p.json);
      draftList = null; draftIcons = null;
      renderAll();
      toast('Unlocked. Changes save straight to GitHub; the site updates about a minute later.');
    } catch (e) {
      toast(e && e.name === 'OperationError' ? 'Wrong PIN.' : `Could not unlock: ${e.message || e}`, false);
    }
    $('btn-unlock').disabled = false; $('btn-unlock').textContent = 'Unlock';
  }
  async function save(path, obj, message) {
    if (!token) { toast('Unlock with your PIN first (top right).', false); $('pin').focus(); return false; }
    try {
      toast('Saving to GitHub…');
      await S.ghPutJson(token, path, obj, message);
      toast('Saved ✓ The public site updates in about a minute.');
      return true;
    } catch (e) { toast(String(e.message || e), false); return false; }
  }
  const saveDests = (next, msg) => save('data/destinations.json', next, msg).then(ok => { if (ok) { dests = next; draftList = null; renderAll(); } return ok; });
  const savePlaces = (next, msg) => save('data/places.json', next, msg).then(ok => { if (ok) { places = next; renderAll(); } return ok; });

  // ------------------------------------------------------------ map
  function initMap() {
    map = L.map('admin-map', { worldCopyJump: true, maxZoom: 18 }).setView([20, -40], 3);
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    const labels = L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 13, maxZoom: 18 });
    const ocean = L.layerGroup([L.tileLayer(esri + 'Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 10, maxZoom: 18 }), labels]).addTo(map);
    const sat = L.layerGroup([L.tileLayer(esri + 'World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 18, maxZoom: 18 }), L.tileLayer(esri + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 13, maxZoom: 18 })]);
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap contributors' });
    L.control.layers({ Ocean: ocean, Satellite: sat, Streets: streets }, null, { position: 'topright' }).addTo(map);
    baseLayer = L.layerGroup().addTo(map);
    previewLayer = L.layerGroup().addTo(map);
    resultsLayer = L.layerGroup().addTo(map);
    map.on('click', e => { if (activePicker) { const ll = e.latlng.wrap(); activePicker.set(ll.lat, ll.lng, null, false); } });
  }
  const icons = () => draftIcons || Object.assign({}, places.icons);
  const iconOf = slot => Object.assign({}, S.DEFAULT_ICONS[slot], icons()[slot] || {});

  function drawBase() {
    baseLayer.clearLayers();
    const boat = boatLL();
    if (Array.isArray(track) && track.length > 1) L.polyline(track.map(p => [p.lat, p.lon]), { color: '#38bdf8', weight: 2, opacity: 0.6 }).addTo(baseLayer);
    (dests.history || []).forEach(h => L.marker([h.lat, h.lon], { icon: S.makeIcon(iconOf('previous'), { size: 22 }) }).addTo(baseLayer).bindTooltip(esc(h.name)));
    if (boat && dests.current) {
      const pts = [boat, ...(places.routeMode === 'direct' ? [] : S.routeStops(places, true).map(s => [s.lat, s.lon])), [dests.current.lat, dests.current.lon]];
      L.polyline(S.routeLine(pts), { color: '#fbbf24', weight: 2, opacity: 0.7, dashArray: '8, 8' }).addTo(baseLayer);
    }
    (places.pois || []).forEach(p => {
      L.marker([p.lat, p.lon], { icon: S.makeIcon(p.icon || iconOf(p.type), { size: 24 }), opacity: p.adminOnly || p.done ? 0.55 : 1 })
        .addTo(baseLayer)
        .bindTooltip(esc(p.name), { direction: 'bottom', className: 'poi-label' })
        .on('click', () => { if (!activePicker) { showTab('points'); openPoiForm(p); } });
    });
    if (dests.current) L.marker([dests.current.lat, dests.current.lon], { icon: S.makeIcon(iconOf('destination'), { size: 32 }), zIndexOffset: 400 })
      .addTo(baseLayer).bindTooltip(esc(dests.current.name), { direction: 'top', offset: [0, -30] });
    if (boat) {
      const heading = liveFix.courseDeg != null && isFinite(liveFix.courseDeg) ? Number(liveFix.courseDeg) : 0;
      L.marker(boat, { icon: S.makeIcon(iconOf('boat'), { size: 32, rotate: heading }), zIndexOffset: 1000 }).addTo(baseLayer).bindTooltip('S/V Sefi');
    }
  }

  // ------------------------------------------------------------ location picker
  // One picker at a time, mounted into a form. Search → numbered pins on the map + list;
  // tap a pin/row or the map to set the location; drag the red pin to fine-tune.
  function Picker(container, opts) {
    const self = this;
    this.lat = opts.lat ?? null; this.lon = opts.lon ?? null;
    this.results = []; this.sel = -1; this.ctl = null;
    container.innerHTML = `
      <div class="flex gap-2">
        <input class="inp pk-q" placeholder="Search a place, marina or bay…" autocomplete="off">
        <button class="btn pk-go">Search</button>
      </div>
      <div class="pk-status text-[11px] text-slate-500 mt-1">Searches near the map view. Or tap the map to drop the pin.</div>
      <div class="pk-results mt-1 max-h-64 overflow-y-auto"></div>
      <div class="grid grid-cols-2 gap-2 mt-2">
        <label class="block"><span class="lbl">Latitude</span><input class="inp pk-lat font-mono-num" placeholder="14.465 or 14°27.9'N"></label>
        <label class="block"><span class="lbl">Longitude</span><input class="inp pk-lon font-mono-num" placeholder="-60.87 or 60°52.2'W"></label>
      </div>`;
    const q = container.querySelector('.pk-q'), status = container.querySelector('.pk-status'), list = container.querySelector('.pk-results');
    const latIn = container.querySelector('.pk-lat'), lonIn = container.querySelector('.pk-lon');
    let marker = null;

    this.set = (lat, lon, name, fly, fromTyping) => {
      self.lat = lat; self.lon = lon;
      if (!fromTyping) { latIn.value = lat.toFixed(5); lonIn.value = lon.toFixed(5); }
      if (!marker) marker = L.marker([lat, lon], { draggable: true, zIndexOffset: 2000, icon: S.makeIcon({ kind: 'pin', color: '#ef4444' }, { size: 36 }) })
        .addTo(previewLayer).on('dragend', e => { const ll = e.target.getLatLng().wrap(); self.set(ll.lat, ll.lng, null, false); });
      else marker.setLatLng([lat, lon]);
      if (fly) map.setView([lat, lon], Math.max(map.getZoom(), 11));
      opts.onChange && opts.onChange(lat, lon, name);
    };
    function drawResults() {
      resultsLayer.clearLayers();
      self.results.forEach((r, i) => L.marker([r.lat, r.lon], { zIndexOffset: 1500, icon: L.divIcon({ className: 'sefi-icon', iconSize: [24, 24], iconAnchor: [12, 12], html: `<div class="result-num ${i === self.sel ? 'sel' : ''}">${i + 1}</div>` }) })
        .addTo(resultsLayer).bindTooltip(`${esc(r.name)}<br><span style="color:#94a3b8">${esc(r.region)}</span>`, { className: 'poi-label', direction: 'top', offset: [0, -10] })
        .on('click', ev => { L.DomEvent.stopPropagation(ev); choose(i); }));
      const boat = boatLL();
      list.innerHTML = self.results.map((r, i) => `
        <div class="res-row ${i === self.sel ? 'sel' : ''}" data-i="${i}">
          <div class="result-num shrink-0 ${i === self.sel ? 'sel' : ''}" style="width:20px;height:20px;font-size:11px;line-height:16px">${i + 1}</div>
          <div class="min-w-0">
            <div class="text-white text-[13px] font-semibold">${esc(r.name)}</div>
            <div class="text-[11px] text-slate-400">${esc(r.region || '—')} · <span class="text-sky-300">${esc(r.kind)}</span>${boat ? ` · <span class="font-mono-num">${S.fmtNm(S.haversineNm(boat, [r.lat, r.lon]))} from Sefi</span>` : ''}</div>
          </div>
        </div>`).join('');
    }
    function choose(i) {
      const r = self.results[i]; if (!r) return;
      self.sel = i; drawResults();
      self.set(r.lat, r.lon, [r.name, r.region].filter(Boolean).join(', '), true);
    }
    async function run() {
      const text = q.value.trim();
      if (text.length < 2) return;
      if (self.ctl) self.ctl.abort();
      self.ctl = new AbortController();
      status.textContent = 'Searching…';
      try {
        const c = map.getCenter().wrap();
        self.results = await S.searchPlaces(text, [c.lat, c.lng], self.ctl.signal);
        self.sel = -1;
        status.textContent = self.results.length ? `${self.results.length} results · marinas & harbours first, then nearest to the map view. Tap one, or tap the map.` : 'Nothing found. Try another spelling, zoom the map to the area, or tap the map.';
        drawResults();
        if (self.results.length) map.fitBounds(L.latLngBounds(self.results.map(r => [r.lat, r.lon])).pad(0.3), { maxZoom: 11 });
      } catch (e) { if (e.name !== 'AbortError') status.textContent = 'Search failed. Check the connection and try again.'; }
    }
    container.querySelector('.pk-go').addEventListener('click', run);
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
    list.addEventListener('click', e => { const row = e.target.closest('[data-i]'); if (row) choose(+row.dataset.i); });
    const typed = () => {
      const lat = S.parseCoord(latIn.value, true), lon = S.parseCoord(lonIn.value, false);
      if (lat != null && lon != null) { self.set(lat, lon, null, false, true); map.panTo([lat, lon]); }
    };
    latIn.addEventListener('input', typed); lonIn.addEventListener('input', typed);
    this.close = () => { if (self.ctl) self.ctl.abort(); resultsLayer.clearLayers(); previewLayer.clearLayers(); $('map-hint').classList.add('hidden'); if (activePicker === self) activePicker = null; };

    if (activePicker) activePicker.close();
    activePicker = this;
    previewLayer.clearLayers(); resultsLayer.clearLayers();
    $('map-hint').classList.remove('hidden');
    if (this.lat != null) this.set(this.lat, this.lon, null, true);
    if (opts.query) { q.value = opts.query; }
    setTimeout(() => q.focus(), 50);
  }
  function closePicker() { if (activePicker) activePicker.close(); }

  // Draws a candidate route on the preview layer and returns { nm, hours }.
  function previewRoute(endLL, extraStop) {
    const boat = boatLL();
    if (!boat || !endLL) return null;
    let stops = places.routeMode === 'direct' ? [] : S.routeStops(places, true).map(s => [s.lat, s.lon]);
    if (extraStop) stops = extraStop(stops);
    const pts = [boat, ...stops, endLL];
    previewLayer.eachLayer(l => { if (l._isRoutePreview) previewLayer.removeLayer(l); });
    const line = L.polyline(S.routeLine(pts), { color: '#a78bfa', weight: 3, opacity: 0.95, dashArray: '10, 7' });
    line._isRoutePreview = true;
    line.addTo(previewLayer);
    const nm = S.pathNm(pts);
    return { nm, hours: nm / speed(), stops: stops.length };
  }
  const etaText = hours => liveFix ? new Date(new Date(liveFix.timestamp).getTime() + hours * 3.6e6).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

  // ------------------------------------------------------------ tabs
  function showTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== name));
  }

  // ------------------------------------------------------------ destination tab
  let ndPicker = null, ndChoice = null;
  function renderCurrentDest() {
    const c = dests.current;
    $('cur-dest').innerHTML = c ? `
      <div class="flex items-center gap-2"><span>${S.iconHtml(iconOf('destination'), { size: 22 })}</span>
        <div><div class="font-semibold text-white">${esc(c.name)}</div>
        <div class="text-[11px] text-slate-400 font-mono-num">${S.fmtCoord(c.lat, c.lon)} · set ${c.setAt ? new Date(c.setAt).toLocaleDateString() : '—'}${boatLL() ? ` · ${S.fmtNm(S.haversineNm(boatLL(), [c.lat, c.lon]))} from Sefi` : ''}</div></div></div>` : '<span class="text-slate-500">None set</span>';
    $('nd-current').textContent = c ? S.shortName(c.name) : 'none';
  }
  function openNewDest() {
    $('new-dest-form').classList.remove('hidden');
    $('nd-name').value = ''; ndChoice = null;
    $('btn-nd-accept').disabled = true;
    $('nd-reached').checked = !!(dests.current && boatLL() && S.haversineNm(boatLL(), [dests.current.lat, dests.current.lon]) < 10);
    $('nd-preview').textContent = 'Pick a place to preview the route.';
    ndPicker = new Picker($('nd-picker'), {
      onChange: (lat, lon, name) => {
        ndChoice = [lat, lon];
        if (name) $('nd-name').value = name;
        const r = previewRoute(ndChoice);
        $('nd-preview').innerHTML = r ? `<div class="text-violet-300 font-semibold mb-0.5">Route preview (purple line)</div>
          <span class="font-mono-num text-white">${S.fmtNm(r.nm)}</span>${r.stops ? ` via ${r.stops} stop${r.stops > 1 ? 's' : ''}` : ' direct'} ·
          ~<span class="font-mono-num text-white">${S.fmtDuration(r.hours)}</span> at ${speed().toFixed(1)} kts · ETA <span class="text-emerald-300">${etaText(r.hours)}</span>` +
          (dests.current ? `<div class="text-slate-500 mt-0.5">Current: ${esc(S.shortName(dests.current.name))}, ${S.fmtNm(S.haversineNm(boatLL(), [dests.current.lat, dests.current.lon]))}</div>` : '') : 'No boat position yet.';
        $('btn-nd-accept').disabled = false;
      }
    });
  }
  function closeNewDest() { $('new-dest-form').classList.add('hidden'); closePicker(); ndPicker = null; }
  async function acceptNewDest() {
    const name = $('nd-name').value.trim();
    if (!ndChoice) return toast('Pick a location first.', false);
    if (!name) return toast('Enter a name.', false);
    const base = draftList ? clone(draftList) : clone(dests);
    const now = nowIso();
    const next = { current: { name, lat: +ndChoice[0].toFixed(5), lon: +ndChoice[1].toFixed(5), setAt: now }, history: base.history || [] };
    if (base.current) {
      const reached = $('nd-reached').checked;
      next.history.push({ name: base.current.name, lat: base.current.lat, lon: base.current.lon, arrivedAt: reached ? now : null, leftAt: now, reached });
    }
    if (await saveDests(next, `Set destination: ${name}`)) closeNewDest();
  }

  // Destinations list editor (current + history)
  const toLocalInput = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
  const fromLocalInput = v => v ? new Date(v).toISOString().replace(/\.\d+Z$/, 'Z') : null;
  function listDirty() { return draftList && JSON.stringify(draftList) !== JSON.stringify(dests); }
  function renderList() {
    const d = draftList || dests;
    const rows = [];
    if (d.current) rows.push(`
      <div class="rounded-lg border border-red-900/60 bg-slate-950 p-2 space-y-1.5" data-row="current">
        <div class="flex items-center gap-2">${S.iconHtml(iconOf('destination'), { size: 18 })}<span class="text-[11px] uppercase tracking-wider text-red-300 font-semibold">Current</span></div>
        <input class="inp" data-f="name" value="${esc(d.current.name)}">
        <div class="flex items-center justify-between gap-2 text-[11px] text-slate-400 font-mono-num"><span>${S.fmtCoord(d.current.lat, d.current.lon, 3)}</span>
          <button class="btn btn-icon" data-act="move" title="Change location">📍 Move</button></div>
        <div class="dl-picker"></div>
      </div>`);
    (d.history || []).forEach((h, i) => rows.push(`
      <div class="rounded-lg border border-slate-800 bg-slate-950 p-2 space-y-1.5" data-row="${i}">
        <div class="flex items-center gap-2">
          ${S.iconHtml(iconOf('previous'), { size: 18 })}
          <input class="inp" data-f="name" value="${esc(h.name)}">
          <button class="btn btn-icon" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn btn-icon" data-act="down" title="Move down" ${i === d.history.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn btn-icon" data-act="del" title="Delete">🗑</button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label><span class="lbl">Arrived</span><input type="datetime-local" class="inp" data-f="arrivedAt" value="${toLocalInput(h.arrivedAt)}"></label>
          <label><span class="lbl">Left / changed</span><input type="datetime-local" class="inp" data-f="leftAt" value="${toLocalInput(h.leftAt)}"></label>
        </div>
        <div class="flex items-center justify-between gap-2 text-[11px] text-slate-400">
          <label class="flex items-center gap-1.5"><input type="checkbox" data-f="reached" class="accent-emerald-500" ${h.reached !== false ? 'checked' : ''}> Reached</label>
          <span class="font-mono-num">${S.fmtCoord(h.lat, h.lon, 3)}</span>
          <button class="btn btn-icon" data-act="move" title="Change location">📍 Move</button>
        </div>
        <div class="dl-picker"></div>
      </div>`));
    $('dest-list').innerHTML = rows.join('') || '<p class="text-slate-500 text-xs">No destinations yet.</p>';
    const dirty = listDirty();
    $('dl-dirty').classList.toggle('hidden', !dirty);
    $('btn-dl-save').disabled = !dirty; $('btn-dl-revert').disabled = !dirty;
  }
  function listRowObj(d, key) { return key === 'current' ? d.current : d.history[+key]; }
  function onListInput(e) {
    const rowEl = e.target.closest('[data-row]'), f = e.target.dataset.f;
    if (!rowEl || !f) return;
    if (!draftList) draftList = clone(dests);
    const o = listRowObj(draftList, rowEl.dataset.row);
    if (f === 'name') o.name = e.target.value;
    else if (f === 'reached') o.reached = e.target.checked;
    else o[f] = fromLocalInput(e.target.value);
    const dirty = listDirty();
    $('dl-dirty').classList.toggle('hidden', !dirty);
    $('btn-dl-save').disabled = !dirty; $('btn-dl-revert').disabled = !dirty;
  }
  function onListClick(e) {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const rowEl = btn.closest('[data-row]'), key = rowEl.dataset.row;
    if (!draftList) draftList = clone(dests);
    const h = draftList.history, i = +key;
    if (btn.dataset.act === 'up') [h[i - 1], h[i]] = [h[i], h[i - 1]];
    else if (btn.dataset.act === 'down') [h[i + 1], h[i]] = [h[i], h[i + 1]];
    else if (btn.dataset.act === 'del') { if (!confirm(`Delete "${h[i].name}" from the list?`)) return; h.splice(i, 1); }
    else if (btn.dataset.act === 'move') {
      const o = listRowObj(draftList, key);
      renderList();
      const box = document.querySelector(`[data-row="${key}"] .dl-picker`);
      box.innerHTML = '<div class="pk"></div><div class="flex justify-end mt-1.5"><button class="btn" data-act="move-done">Done</button></div>';
      new Picker(box.querySelector('.pk'), { lat: o.lat, lon: o.lon, onChange: (lat, lon) => { o.lat = +lat.toFixed(5); o.lon = +lon.toFixed(5); } });
      box.querySelector('[data-act="move-done"]').addEventListener('click', ev => { ev.stopPropagation(); closePicker(); renderList(); drawDraftList(); });
      return;
    }
    renderList(); drawDraftList();
  }
  function drawDraftList() { if (draftList) { const saved = dests; dests = draftList; drawBase(); dests = saved; } else drawBase(); }

  // ------------------------------------------------------------ points tab
  let poiDraft = null, poiPicker = null;
  function renderPoiList() {
    const pois = places.pois || [];
    const boat = boatLL();
    $('poi-list').innerHTML = Object.keys(S.POI_TYPES).map(type => {
      const items = pois.filter(p => p.type === type);
      if (!items.length) return '';
      return `<div class="card space-y-1"><div class="flex items-center gap-2 font-semibold">${S.iconHtml(iconOf(type), { size: 18 })}${esc(S.POI_TYPES[type].label)} <span class="text-slate-500 font-normal">(${items.length})</span></div>
        ${items.map((p, idx) => `<div class="flex items-center gap-2 py-1 border-b border-slate-800/70 last:border-0">
          ${type === 'stop' ? `<span class="text-amber-300 font-mono-num text-xs w-4">${idx + 1}</span>` : ''}
          <span>${S.iconHtml(p.icon || iconOf(type), { size: 18 })}</span>
          <div class="min-w-0 flex-1"><div class="truncate ${p.done ? 'line-through text-slate-500' : 'text-white'}">${esc(p.name)}</div>
            <div class="text-[11px] text-slate-500">${boat ? S.fmtNm(S.haversineNm(boat, [p.lat, p.lon])) + ' from Sefi' : ''}${p.adminOnly ? ' · admin only' : ''}${p.done ? ' · done' : ''}</div></div>
          ${type === 'stop' ? `<button class="btn btn-icon" data-poi-act="up" data-id="${p.id}" ${idx === 0 ? 'disabled' : ''}>↑</button><button class="btn btn-icon" data-poi-act="down" data-id="${p.id}" ${idx === items.length - 1 ? 'disabled' : ''}>↓</button>` : ''}
          <button class="btn btn-icon" data-poi-act="edit" data-id="${p.id}">Edit</button>
          <button class="btn btn-icon" data-poi-act="del" data-id="${p.id}">🗑</button>
        </div>`).join('')}</div>`;
    }).join('') || '<p class="text-xs text-slate-500">No points yet. Use “+ Add point” or “📍 Drop pin”.</p>';
  }
  function openPoiForm(existing, presetType) {
    poiDraft = existing ? clone(existing) : { id: newId(), type: presetType || 'stop', name: '', note: '', lat: null, lon: null, adminOnly: false, done: false };
    const isNew = !existing;
    const f = $('poi-form');
    f.classList.remove('hidden');
    f.innerHTML = `
      <div class="font-semibold">${isNew ? 'New point' : 'Edit point'}</div>
      <div class="grid grid-cols-2 gap-2">
        <label class="block"><span class="lbl">Type</span><select class="inp" id="pf-type">${Object.entries(S.POI_TYPES).map(([k, v]) => `<option value="${k}" ${k === poiDraft.type ? 'selected' : ''}>${v.label}</option>`).join('')}</select></label>
        <label class="block" id="pf-order-wrap"><span class="lbl">Order on route</span><select class="inp" id="pf-order"></select></label>
      </div>
      <label class="block"><span class="lbl">Name</span><input class="inp" id="pf-name" value="${esc(poiDraft.name)}" placeholder="e.g. Rodney Bay Marina"></label>
      <label class="block"><span class="lbl">Note (optional)</span><textarea class="inp" id="pf-note" rows="2" placeholder="VHF 9 · depth 4 m · fuel dock…">${esc(poiDraft.note || '')}</textarea></label>
      <div id="pf-picker"></div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
        <label class="flex items-center gap-1.5"><input type="checkbox" id="pf-admin" class="accent-emerald-500" ${poiDraft.adminOnly ? 'checked' : ''}> Only visible here (not on the public map)</label>
        <label class="flex items-center gap-1.5" id="pf-done-wrap"><input type="checkbox" id="pf-done" class="accent-emerald-500" ${poiDraft.done ? 'checked' : ''}> Done / passed (left out of the route)</label>
      </div>
      <div class="space-y-1.5">
        <label class="flex items-center gap-1.5 text-xs text-slate-300"><input type="checkbox" id="pf-custom-icon" class="accent-emerald-500" ${poiDraft.icon ? 'checked' : ''}> Custom icon for this point</label>
        <div id="pf-icon" class="${poiDraft.icon ? '' : 'hidden'}"></div>
      </div>
      <div id="pf-preview" class="rounded-lg bg-slate-950 border border-violet-700/60 p-2.5 text-xs text-slate-300">Pick a location.</div>
      <div class="flex justify-end gap-2"><button class="btn" id="pf-cancel">Cancel</button><button class="btn btn-primary" id="pf-save">Save point</button></div>`;
    const stops = () => (places.pois || []).filter(p => p.type === 'stop' && p.id !== poiDraft.id);
    function syncTypeUi() {
      const isStop = poiDraft.type === 'stop';
      $('pf-order-wrap').classList.toggle('invisible', !isStop);
      $('pf-done-wrap').classList.toggle('hidden', !isStop);
      const n = stops().length + 1;
      const curIdx = (places.pois || []).filter(p => p.type === 'stop').findIndex(p => p.id === poiDraft.id);
      $('pf-order').innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i}" ${i === (curIdx >= 0 ? curIdx : n - 1) ? 'selected' : ''}>${i + 1}${i === n - 1 ? ' (last before destination)' : ''}</option>`).join('');
    }
    function updatePreview() {
      if (poiDraft.lat == null) { $('pf-preview').textContent = 'Pick a location.'; return; }
      const ll = [poiDraft.lat, poiDraft.lon], boat = boatLL();
      let html = `<span class="font-mono-num">${S.fmtCoord(ll[0], ll[1], 4)}</span>${boat ? ` · <span class="font-mono-num text-white">${S.fmtNm(S.haversineNm(boat, ll))}</span> from Sefi (direct)` : ''}`;
      if (poiDraft.type === 'stop' && !poiDraft.done && dests.current && places.routeMode !== 'direct') {
        const order = +$('pf-order').value;
        const r = previewRoute([dests.current.lat, dests.current.lon], () => {
          const others = S.routeStops(places, true).filter(s => s.id !== poiDraft.id).map(s => [s.lat, s.lon]);
          others.splice(Math.min(order, others.length), 0, ll);
          return others;
        });
        if (r) html += `<div class="mt-0.5"><span class="text-violet-300 font-semibold">Route with this stop:</span> <span class="font-mono-num text-white">${S.fmtNm(r.nm)}</span> to ${esc(S.shortName(dests.current.name))} · ~${S.fmtDuration(r.hours)} · ETA ${etaText(r.hours)}</div>`;
      } else previewLayer.eachLayer(l => { if (l._isRoutePreview) previewLayer.removeLayer(l); });
      $('pf-preview').innerHTML = html;
    }
    syncTypeUi();
    poiPicker = new Picker($('pf-picker'), {
      lat: poiDraft.lat, lon: poiDraft.lon,
      onChange: (lat, lon, name) => {
        poiDraft.lat = +lat.toFixed(5); poiDraft.lon = +lon.toFixed(5);
        if (name && !$('pf-name').value.trim()) $('pf-name').value = name.split(',').slice(0, 2).join(',');
        updatePreview();
      }
    });
    const iconBox = $('pf-icon');
    const renderIconChooser = () => iconChooser(iconBox, poiDraft.icon || iconOf(poiDraft.type), cfg => { poiDraft.icon = cfg; });
    if (poiDraft.icon) renderIconChooser();
    $('pf-custom-icon').addEventListener('change', e => {
      iconBox.classList.toggle('hidden', !e.target.checked);
      if (e.target.checked) { poiDraft.icon = poiDraft.icon || iconOf(poiDraft.type); renderIconChooser(); } else delete poiDraft.icon;
    });
    $('pf-type').addEventListener('change', e => { poiDraft.type = e.target.value; syncTypeUi(); updatePreview(); });
    $('pf-order').addEventListener('change', updatePreview);
    $('pf-done').addEventListener('change', e => { poiDraft.done = e.target.checked; updatePreview(); });
    $('pf-cancel').addEventListener('click', closePoiForm);
    $('pf-save').addEventListener('click', async () => {
      poiDraft.name = $('pf-name').value.trim();
      poiDraft.note = $('pf-note').value.trim();
      poiDraft.adminOnly = $('pf-admin').checked;
      poiDraft.done = poiDraft.type === 'stop' && $('pf-done').checked;
      if (!poiDraft.note) delete poiDraft.note;
      if (!poiDraft.name) return toast('Enter a name.', false);
      if (poiDraft.lat == null) return toast('Pick a location (search, or tap the map).', false);
      const next = clone(places);
      next.pois = (next.pois || []).filter(p => p.id !== poiDraft.id);
      if (poiDraft.type === 'stop') {
        const order = +$('pf-order').value;
        const stopIdx = next.pois.map((p, i) => p.type === 'stop' ? i : -1).filter(i => i >= 0);
        const at = order < stopIdx.length ? stopIdx[order] : next.pois.length;
        next.pois.splice(at, 0, poiDraft);
      } else next.pois.push(poiDraft);
      if (await savePlaces(next, `${isNew ? 'Add' : 'Update'} point: ${poiDraft.name}`)) closePoiForm();
    });
    updatePreview();
    f.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function closePoiForm() { $('poi-form').classList.add('hidden'); $('poi-form').innerHTML = ''; closePicker(); poiDraft = null; }
  async function onPoiListClick(e) {
    const b = e.target.closest('[data-poi-act]'); if (!b) return;
    const id = b.dataset.id, p = (places.pois || []).find(x => x.id === id); if (!p) return;
    const act = b.dataset.poiAct;
    if (act === 'edit') return openPoiForm(p);
    const next = clone(places);
    if (act === 'del') {
      if (!confirm(`Delete "${p.name}"?`)) return;
      next.pois = next.pois.filter(x => x.id !== id);
      return savePlaces(next, `Delete point: ${p.name}`);
    }
    // reorder stops: swap with the previous/next stop in the array
    const idx = next.pois.findIndex(x => x.id === id);
    const stopIdx = next.pois.map((x, i) => x.type === 'stop' ? i : -1).filter(i => i >= 0);
    const k = stopIdx.indexOf(idx), j = act === 'up' ? stopIdx[k - 1] : stopIdx[k + 1];
    if (j == null) return;
    [next.pois[idx], next.pois[j]] = [next.pois[j], next.pois[idx]];
    savePlaces(next, `Reorder stops`);
  }

  // ------------------------------------------------------------ icons
  function iconChooser(box, cfg, onChange) {
    cfg = clone(cfg);
    const render = () => {
      box.innerHTML = `
        <div class="flex flex-wrap gap-1.5">${Object.entries(S.KINDS).map(([k, v]) => `<button type="button" class="kind-btn ${cfg.kind === k ? 'active' : ''}" data-kind="${k}" title="${v.name}">${S.iconHtml({ kind: k, color: cfg.color }, { size: 24 })}</button>`).join('')}</div>
        <div class="flex items-center gap-2 mt-1.5">
          <label class="text-[11px] text-slate-400 flex items-center gap-1.5">Colour <input type="color" class="ic-color" value="${cfg.color || '#38bdf8'}" style="width:34px;height:26px;background:none;border:none"></label>
          <label class="text-[11px] text-slate-400 flex items-center gap-1.5">or emoji <input class="inp ic-emoji" style="width:70px" maxlength="8" value="${cfg.kind === 'emoji' ? esc(cfg.emoji || '') : ''}" placeholder="⛵"></label>
        </div>`;
      box.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { cfg.kind = b.dataset.kind; delete cfg.emoji; onChange(clone(cfg)); render(); }));
      box.querySelector('.ic-color').addEventListener('input', e => { cfg.color = e.target.value; if (cfg.kind === 'emoji') { cfg.kind = 'dot'; delete cfg.emoji; } onChange(clone(cfg)); render(); });
      box.querySelector('.ic-emoji').addEventListener('change', e => {
        const v = e.target.value.trim();
        if (v) { cfg.kind = 'emoji'; cfg.emoji = v; } else if (cfg.kind === 'emoji') { cfg.kind = 'dot'; delete cfg.emoji; }
        onChange(clone(cfg)); render();
      });
    };
    render();
  }
  function renderIconEditors() {
    const box = $('icon-editors');
    box.innerHTML = Object.entries(S.ICON_SLOTS).map(([slot, label]) => `
      <details class="card" data-slot="${slot}">
        <summary class="cursor-pointer flex items-center gap-2 select-none"><span class="ic-prev">${S.iconHtml(iconOf(slot), { size: 24, rotate: slot === 'boat' ? 45 : undefined })}</span><span class="font-semibold">${label}</span></summary>
        <div class="ic-box mt-2"></div>
      </details>`).join('');
    box.querySelectorAll('[data-slot]').forEach(el => {
      const slot = el.dataset.slot;
      el.addEventListener('toggle', () => {
        if (!el.open || el.dataset.ready) return;
        el.dataset.ready = '1';
        iconChooser(el.querySelector('.ic-box'), iconOf(slot), cfg => {
          draftIcons = draftIcons || Object.assign({}, places.icons);
          draftIcons[slot] = cfg;
          el.querySelector('.ic-prev').innerHTML = S.iconHtml(cfg, { size: 24, rotate: slot === 'boat' ? 45 : undefined });
          drawBase();
        });
      });
    });
  }

  // ------------------------------------------------------------ render everything
  function renderAll() {
    drawBase();
    renderCurrentDest();
    renderList();
    renderPoiList();
    renderIconEditors();
    document.querySelectorAll('input[name="rmode"]').forEach(r => { r.checked = r.value === (places.routeMode === 'direct' ? 'direct' : 'via'); });
  }

  async function load() {
    const [pos, tr, d, pl, auth] = await Promise.all(['data/position.json', 'data/track.json', 'data/destinations.json', 'data/places.json', 'data/auth.json'].map(S.loadPublic));
    liveFix = pos; track = Array.isArray(tr) ? tr : [];
    if (d) dests = d;
    if (pl) places = Object.assign(S.emptyPlaces(), pl);
    authBlob = auth && auth.ct ? auth : null;
    renderAll();
    const pts = [boatLL(), dests.current && [dests.current.lat, dests.current.lon]].filter(Boolean);
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 8 });
    if (!authBlob) toast('Editing is not set up yet: open Settings → Set up / change PIN.', false);
  }

  // ------------------------------------------------------------ wire up
  window.addEventListener('DOMContentLoaded', () => {
    initMap();
    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));
    $('btn-unlock').addEventListener('click', unlock);
    $('pin').addEventListener('keydown', e => { if (e.key === 'Enter') unlock(); });
    $('btn-lock').addEventListener('click', () => { token = null; setLocked(true); toast('Locked.'); });
    $('btn-new-dest').addEventListener('click', openNewDest);
    $('btn-nd-cancel').addEventListener('click', closeNewDest);
    $('btn-nd-accept').addEventListener('click', acceptNewDest);
    $('dest-list').addEventListener('input', onListInput);
    $('dest-list').addEventListener('change', onListInput);
    $('dest-list').addEventListener('click', onListClick);
    $('btn-dl-revert').addEventListener('click', () => { draftList = null; closePicker(); renderList(); drawBase(); });
    $('btn-dl-save').addEventListener('click', () => { if (draftList) saveDests(clone(draftList), 'Edit destinations list'); });
    $('btn-add-poi').addEventListener('click', () => openPoiForm(null, 'stop'));
    $('btn-drop-pin').addEventListener('click', () => { openPoiForm(null, 'note'); toast('Tap the map where the pin should go.'); });
    $('poi-list').addEventListener('click', onPoiListClick);
    $('btn-icons-save').addEventListener('click', () => { const next = clone(places); next.icons = Object.assign({}, places.icons, draftIcons || {}); savePlaces(next, 'Update map icons').then(ok => { if (ok) draftIcons = null; }); });
    $('btn-icons-reset').addEventListener('click', () => { draftIcons = clone(S.DEFAULT_ICONS); renderIconEditors(); drawBase(); toast('Defaults loaded. Press “Save icons” to keep them.'); });
    $('btn-mode-save').addEventListener('click', () => {
      const v = (document.querySelector('input[name="rmode"]:checked') || {}).value || 'via';
      const next = clone(places); next.routeMode = v;
      savePlaces(next, `Route line: ${v}`);
    });
    $('btn-su-save').addEventListener('click', async () => {
      const tk = $('su-token').value.trim(), pin = $('su-pin').value, pin2 = $('su-pin2').value;
      if (!tk) return toast('Paste the GitHub token.', false);
      if (pin.length < 6) return toast('PIN must be at least 6 characters (12+ recommended).', false);
      if (pin !== pin2) return toast('PINs do not match.', false);
      try {
        toast('Encrypting and saving…');
        const blob = await S.encryptToken(tk, pin);
        await S.ghPutJson(tk, 'data/auth.json', blob, 'Set up PIN-protected editing');
        authBlob = blob; token = tk; setLocked(false);
        $('su-token').value = $('su-pin').value = $('su-pin2').value = '';
        toast('PIN saved ✓ You are unlocked.');
      } catch (e) { toast(String(e.message || e), false); }
    });
    load();
  });
})();
