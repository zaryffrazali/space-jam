/* Space Jam — nighttime-lights explorer for Malaysia's transport corridors
   Data: NASA Black Marble NTL (1-km, quarterly). Static site, no backend. */
"use strict";

const DATA = "data/";

const state = {
  layer: "ntl", corridor: "DASH", t: 48,        // t = quarter index for NTL
  unit: "ntl",                                   // 'ntl' | 'log_sa'
  colorMode: "level",                            // 'level' | 'diff'
  showStations: true, showBuffers: false, dimOthers: true,
  tab: "explore", drill: null,                   // drill = {idx, lon, lat, series}
};

let meta, positions, pcode, distq, bcode, urb, tsNTL, stationsData,
    routesGeo, buffersGeo;
const quarterCache = new Map();   // tid -> Uint16Array
let map, overlay, playTimer = null;
let charts = {};                  // echarts instances by dom id
const corridorBounds = {};        // project -> [[w,s],[e,n]]

const FRIENDLY = {
  SenaiDesaru:"Senai–Desaru Expressway", Penang2ndBridge:"Penang Second Bridge",
  ETS:"ETS (KL–Ipoh–Padang Besar)", LRT_KJ_Ext:"LRT Kelana Jaya Ext.",
  LRT_Ampang_Ext:"LRT Ampang Ext.", MRT1_SBK:"MRT 1 (SBK)", GemasJB:"Gemas–JB Electrified Rail",
  MRT2_SSP:"MRT 2 (SSP)", ECRL:"East Coast Rail Link", PanBorneoSabah:"Pan Borneo (Sabah)",
  PanBorneoSarawak:"Pan Borneo (Sarawak)", WCE:"West Coast Expressway", RTS_Link:"JB–Singapore RTS Link",
  DASH:"DASH Highway", LRT3:"LRT 3", SPE:"SPE Highway", SUKE:"SUKE Highway",
  DUKE2:"DUKE 2", DUKE3:"DUKE 3", EKVE:"EKVE Highway",
};
const fname = p => FRIENDLY[p] || p;
const MOBILE = () => window.matchMedia("(max-width:980px)").matches;

/* Opening quarters. The 8 headline corridors carry the paper's authoritative years
   (quarter set to Q1 = "during that year"). KL expressway dates are public record
   (DASH Oct 2022, SUKE Sep 2022, DUKE2 Oct 2017, SPE/DUKE3 Oct 2023). WCE opened in
   stages and gets no single flag. */
const OPENQ = { SenaiDesaru:"2012-Q1", Penang2ndBridge:"2014-Q1", ETS:"2015-Q1",
  LRT_KJ_Ext:"2016-Q1", LRT_Ampang_Ext:"2016-Q1", MRT1_SBK:"2017-Q1", GemasJB:"2022-Q1",
  MRT2_SSP:"2023-Q1", DUKE2:"2017-Q4", SUKE:"2022-Q3", DASH:"2022-Q4", SPE:"2023-Q4", DUKE3:"2023-Q4" };
const OPEN_LABEL = p => meta.openings[p] ? String(meta.openings[p]) : (OPENQ[p] || "").replace("-", " ");
const openIdxOf = p => OPENQ[p] ? meta.quarters.indexOf(OPENQ[p]) : -1;
// completed vs under construction by the end of the NTL data (2024 Q1)
const COMPLETED_BY_DATA_END = ["SenaiDesaru","Penang2ndBridge","ETS","LRT_KJ_Ext","LRT_Ampang_Ext",
  "MRT1_SBK","GemasJB","MRT2_SSP","DUKE2","SUKE","DASH","SPE","DUKE3","WCE"];
const UC_BY_DATA_END = ["ECRL","PanBorneoSabah","PanBorneoSarawak","EKVE","LRT3","RTS_Link"];

/* loader failure UI — stops the arcade cycler and shows a real, retryable message.
   Without this, any boot error stays hidden behind the looping "INSERT COIN" text,
   so a failed load looks identical to a perpetual loading screen. */
function failLoader(title, detail) {
  clearInterval(window.__loaderCycler);
  clearTimeout(window.__bootWatchdog);
  const lt = document.getElementById("loadertext");
  if (lt) {
    lt.innerHTML = `<b style="color:#ff6b6b">${title}</b>` +
      (detail ? `<br/><span style="font-size:12px;color:#cbd5e1">${detail}</span>` : "") +
      `<br/><br/><button onclick="location.reload()" style="font:inherit;font-size:12px;padding:6px 16px;background:#ffd23f;color:#111;border:0;border-radius:4px;cursor:pointer">RETRY</button>`;
    lt.style.cssText = "max-width:460px;text-align:center;line-height:1.6;font-size:14px";
  }
  const ds = document.querySelector("#loader .ds"); if (ds) ds.style.animationPlayState = "paused";
}

/* ============================= boot ============================= */
async function boot() {
  const bootStart = Date.now();   // enforce a minimum loader time (arcade "boot" feel)
  const lt = document.getElementById("loadertext");
  if (location.protocol === "file:") {
    lt.innerHTML = "This dashboard can't run from a double-clicked file — browsers block data loading on <code>file://</code>.<br/><br/>" +
      "Serve it over HTTP instead: open Terminal in this folder and run<br/>" +
      "<code style='color:#ffd23f'>python3 -m http.server 8000</code><br/>" +
      "then visit <b>http://localhost:8000</b> — or use the live GitHub Pages link once deployed.";
    lt.style.cssText = "max-width:480px;text-align:center;line-height:1.7;font-size:13px";
    const dsEl = document.querySelector("#loader .ds"); if (dsEl) dsEl.style.display = "none";
    return;
  }
  // cycle arcade flavour text while loading
  const PHRASES = [
    "INSERT COIN", "ALIGNING ORBIT", "COUNTING PHOTONS OVER SELANGOR",
    "DEFEATING THE DARK SIDE", "WARMING UP THE SUPERLASER", "BUFFERING 186,103 PIXELS",
    "BOOTING DEATH STAR OS",
  ];
  let pi = 0;
  lt.textContent = PHRASES[0];
  const cycler = setInterval(() => { pi = (pi + 1) % PHRASES.length; lt.textContent = PHRASES[pi]; }, 640);
  window.__loaderCycler = cycler;
  // watchdog: if boot stalls (e.g. a data file held open by a corporate proxy/DLP),
  // stop the cycling loader and show an actionable message instead of spinning forever
  window.__bootStage = "starting";
  window.__bootWatchdog = setTimeout(() => failLoader("Still loading…",
    `A required file looks blocked or very slow on this network (stalled at: ${window.__bootStage}). ` +
    "This is common on work networks that inspect downloads. Try a different network, or ask IT to allow github.io."), 25000);

  window.__bootStage = "site metadata (meta.json)";
  meta = await (await fetch(DATA + "meta.json")).json();
  window.__bootStage = "cell grid (cells.bin, ~1.4 MB)";
  const cb = new Uint8Array(await (await fetch(DATA + "cells.bin")).arrayBuffer());
  const n = meta.n_cells, [w, s, e, no] = meta.bbox;
  const qlon = new Uint16Array(cb.buffer, 0, n), qlat = new Uint16Array(cb.buffer, 2 * n, n);
  pcode = new Uint8Array(cb.buffer, 4 * n, n);
  distq = new Uint8Array(cb.buffer, 5 * n, n);
  bcode = new Uint8Array(cb.buffer, 6 * n, n);
  urb   = new Uint8Array(cb.buffer, 7 * n, n);
  positions = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) {
    positions[2 * i]     = w + qlon[i] / 65535 * (e - w);
    positions[2 * i + 1] = s + qlat[i] / 65535 * (no - s);
  }

  window.__bootStage = "corridor data (ts_ntl, stations, routes, buffers)";
  [tsNTL, stationsData, routesGeo, buffersGeo] =
    await Promise.all(["ts_ntl.json","stations.json","routes.geojson","buffers.geojson"]
      .map(f => fetch(DATA + f).then(r => r.json())));

  for (const ft of buffersGeo.features) {
    const b = geoBounds(ft.geometry);
    corridorBounds[ft.properties.project] = b;
  }
  // re-bucket route status by the end of the NTL data (2024 Q1)
  for (const ft of routesGeo.features) {
    const p = ft.properties.project;
    ft.properties.status = COMPLETED_BY_DATA_END.includes(p) ? "completed"
      : UC_BY_DATA_END.includes(p) ? "under_construction" : ft.properties.status;
  }

  state.t = meta.quarters.length - 1;
  parseHash();
  // intro plays on the default view (incl. reloads where the hash still points at it);
  // a hash pointing elsewhere = a shared link, so land there directly instead
  const intro = state.layer === "ntl" && state.corridor === "DASH";
  buildLUTs();
  initHeader();
  initMap();
  buildQBlocks();
  if (intro) state.t = 0;               // intro autoplay starts from 2012 Q1
  window.__bootStage = "first nightlights quarter";
  await ensureQuarter(state.t);
  refreshAll();
  // hold the loader for at least 4.5s (every load/refresh) for the arcade boot feel
  const wait = Math.max(0, 4500 - (Date.now() - bootStart));
  await new Promise(r => setTimeout(r, wait));
  clearInterval(window.__loaderCycler);
  clearTimeout(window.__bootWatchdog);
  document.getElementById("loader").classList.add("hide");
  if (intro) introSequence();
}

/* intro: hold on the whole country, then fly into the DASH corridor, then play time.
   The corridor overview card stays hidden until the zoom has landed. */
function introSequence() {
  const b0 = corridorBounds[state.corridor];
  if (!b0) { if (!playTimer) togglePlay(); return; }
  const b = mobileTighten(b0);
  hideCorridorCard();
  const pad = MOBILE() ? 20 : 70, mz = MOBILE() ? 11.3 : 10.6;
  setTimeout(() => {
    const z0 = map.getZoom();
    map.fitBounds(b, { padding: pad, maxZoom: mz, duration: 3200, curve: 1.3, essential: true });
    // fallback if the animation never moved the camera
    setTimeout(() => { if (Math.abs(map.getZoom() - z0) < 0.02) map.fitBounds(b, { padding: pad, maxZoom: mz, duration: 0 }); }, 3500);
    setTimeout(() => { popCorridorCard(); }, 3650);
    setTimeout(() => { if (!playTimer) togglePlay(); }, 3900);
  }, 1400);                                  // a beat on the national view first
}
function hideCorridorCard() { document.getElementById("corridorcard").classList.add("hidden"); }
function popCorridorCard() {
  const el = document.getElementById("corridorcard");
  el.classList.remove("hidden", "pop"); void el.offsetWidth;
  el.classList.add("pop");
}

function geoBounds(geom) {
  let w = 999, s = 999, e = -999, n = -999;
  const walk = c => { if (typeof c[0] === "number") { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1]; } else c.forEach(walk); };
  walk(geom.coordinates);
  return [[w, s], [e, n]];
}

/* ====================== colour lookup tables ===================== */
let LUT_LEVEL, LUT_DIFF;
const LUT_N = 1024, RAD_CAP = 150, DIFF_CAP = 10;
// arcade radiance ramp — 8 hard steps, no smooth blending (CRT cabinet theme)
const ARCADE = ["#0d0726","#2b1166","#6b1d92","#c22f68","#ff6b35","#ffc53f","#fff3a3","#ffffff"];
const hex2rgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
function buildLUTs() {
  LUT_LEVEL = new Uint8Array(LUT_N * 4);
  for (let i = 0; i < LUT_N; i++) {
    const t = i / (LUT_N - 1);
    const step = Math.min(7, Math.ceil(t * 7));
    const [r, g, b] = hex2rgb(ARCADE[step]);
    LUT_LEVEL[i*4] = r; LUT_LEVEL[i*4+1] = g; LUT_LEVEL[i*4+2] = b;
    LUT_LEVEL[i*4+3] = step === 0 ? 0 : Math.min(255, 70 + step * 26);
  }
  // diverging, quantized: cyan (decline) <- transparent -> arcade yellow (growth)
  LUT_DIFF = new Uint8Array(LUT_N * 4);
  const cyan = hex2rgb("#53e8ff"), yel = hex2rgb("#ffd23f");
  for (let i = 0; i < LUT_N; i++) {
    const t = i / (LUT_N - 1) * 2 - 1; // -1..1
    const step = Math.min(4, Math.ceil(Math.abs(t) * 4));
    const c = t < 0 ? cyan : yel;
    LUT_DIFF[i*4] = c[0]; LUT_DIFF[i*4+1] = c[1]; LUT_DIFF[i*4+2] = c[2];
    LUT_DIFF[i*4+3] = step === 0 ? 0 : Math.round(step / 4 * 235);
  }
}

/* ========================= quarter loading ======================== */
async function ensureQuarter(t) {
  const tid = meta.tid_of[meta.quarters[t]];
  if (quarterCache.has(tid)) return quarterCache.get(tid);
  const buf = await (await fetch(`${DATA}ntl/q_${tid}.bin`)).arrayBuffer();
  const arr = new Uint16Array(buf);
  quarterCache.set(tid, arr);
  return arr;
}
let baselineArr = null; // mean of 2012 quarters for diff mode
async function ensureBaseline() {
  if (baselineArr) return baselineArr;
  const idxs = meta.quarters.map((q, i) => q.startsWith("2012") ? i : -1).filter(i => i >= 0);
  const arrs = await Promise.all(idxs.map(ensureQuarter));
  const n = meta.n_cells;
  baselineArr = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0, c = 0;
    for (const a of arrs) if (a[i] !== meta.sentinel) { sum += a[i] / meta.radiance_scale; c++; }
    baselineArr[i] = c ? sum / c : NaN;
  }
  return baselineArr;
}

/* =========================== deck layers ========================== */
let lastCellArr = null;   // most recent loaded quarter, used as fallback so the map never blanks
// (unused) GridCellLayer corner-offset helper, kept harmless in case squares return
let _offsetPos = null;
function offsetPositions() {
  if (_offsetPos) return _offsetPos;
  _offsetPos = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 2) {
    _offsetPos[i] = positions[i] - 0.0045;
    _offsetPos[i+1] = positions[i+1] - 0.0045;
  }
  return _offsetPos;
}

let displayArr = null;   // forward-filled radiance: a cloudy quarter's gaps keep the last valid reading
function cellColors(arr) {
  const n = meta.n_cells, out = new Uint8Array(n * 4);
  // forward-fill data gaps: VIIRS "invalid" cells are cloud/no-composite, NOT darkness,
  // so carry each cell's most recent valid reading instead of dropping it (was → black frames)
  if (!displayArr) displayArr = new Uint16Array(n).fill(meta.sentinel);
  for (let i = 0; i < n; i++) { const v = arr[i]; if (v !== meta.sentinel) displayArr[i] = v; }
  const selIdx = state.corridor === "all" ? -1 : meta.projects.indexOf(state.corridor);
  const dim = state.dimOthers && selIdx >= 0;
  const lut = state.colorMode === "diff" ? LUT_DIFF : LUT_LEVEL;
  const logCap = Math.log1p(RAD_CAP);
  for (let i = 0; i < n; i++) {
    const v = displayArr[i];
    if (v === meta.sentinel) continue; // alpha 0 — never had a valid reading
    let li;
    if (state.colorMode === "diff") {
      const base = baselineArr[i];
      if (!isFinite(base)) continue;
      const d = v / meta.radiance_scale - base;
      li = Math.round((Math.max(-1, Math.min(1, d / DIFF_CAP)) + 1) / 2 * (LUT_N - 1));
    } else {
      const nW = v / meta.radiance_scale;
      li = Math.round(Math.min(1, Math.log1p(nW) / logCap) * (LUT_N - 1));
    }
    let r = lut[li*4], g = lut[li*4+1], b = lut[li*4+2], a = lut[li*4+3];
    if (dim && pcode[i] !== selIdx) a = Math.round(a * 0.10);
    out[i*4] = r; out[i*4+1] = g; out[i*4+2] = b; out[i*4+3] = a;
  }
  return out;
}

function buildLayers() {
  const layers = [];
  const sel = state.corridor;

  if (state.showBuffers && state.layer === "ntl") {
    const feats = sel === "all" ? buffersGeo.features : buffersGeo.features.filter(f => f.properties.project === sel);
    layers.push(new deck.GeoJsonLayer({
      id: "buffers", data: { type: "FeatureCollection", features: feats },
      stroked: true, filled: true, getFillColor: [83, 232, 255, 14],
      getLineColor: [83, 232, 255, 70], lineWidthMinPixels: 1,
    }));
  }

  if (state.layer === "ntl") {
    let arr = quarterCache.get(meta.tid_of[meta.quarters[state.t]]);
    if (arr) lastCellArr = arr; else arr = lastCellArr;   // never blank: reuse last loaded quarter
    const trig = { getFillColor: [state.t, state.corridor, state.dimOthers, state.colorMode] };
    // ScatterplotLayer everywhere — colours reliably on every GPU and animates smoothly.
    // (GridCellLayer rendered unlit/dark on some GPUs; the quantized arcade LUT already
    // makes these read as chunky pixels.)
    if (arr) {
      layers.push(new deck.ScatterplotLayer({
        id: "ntl-cells", pickable: true,
        data: { length: meta.n_cells, attributes: {
          getPosition: { value: positions, size: 2 },
          getFillColor: { value: cellColors(arr), size: 4 },
        }},
        getRadius: 650, radiusUnits: "meters", radiusMinPixels: 1.1, radiusMaxPixels: 14,
        updateTriggers: trig,
      }));
    }
  }

  // corridor routes (always on; the spatial spine)
  layers.push(new deck.GeoJsonLayer({
    id: "routes", data: routesGeo, pickable: true,
    getLineColor: f => {
      const p = f.properties;
      const seld = sel === "all" || p.project === sel;
      if (p.status === "completed") return [83, 232, 255, seld ? 230 : 90];
      if (p.status === "under_construction") return [255, 138, 61, seld ? 230 : 90];
      return [140, 135, 176, seld ? 170 : 60];
    },
    lineWidthMinPixels: 2, lineWidthMaxPixels: 5, getLineWidth: 800,
    updateTriggers: { getLineColor: [sel] },
  }));

  if (state.showStations) {
    const sts = sel === "all" ? stationsData : stationsData.filter(d => d.project === sel);
    layers.push(new deck.ScatterplotLayer({
      id: "stations", data: sts, pickable: true,
      getPosition: d => [d.lon, d.lat], getRadius: 300, radiusUnits: "meters",
      radiusMinPixels: 3, radiusMaxPixels: 9,
      getFillColor: [10, 14, 26, 235], stroked: true, lineWidthMinPixels: 1.6,
      getLineColor: d => d.context === "kl" ? [255, 95, 168, 255] : [52, 211, 153, 255],
    }));
  }
  return layers;
}

function getTooltip({ layer, object, index }) {
  if (!layer) return null;
  if (layer.id === "ntl-cells" && index >= 0) {
    const arr = quarterCache.get(meta.tid_of[meta.quarters[state.t]]);
    const v = arr && arr[index] !== meta.sentinel ? (arr[index] / meta.radiance_scale).toFixed(2) : "no data";
    const proj = pcode[index] < meta.projects.length ? meta.projects[pcode[index]] : "—";
    return { html: `<b>${qlabel(state.t)}</b> · radiance <b>${v}</b> nW/cm²/sr<br/>
      corridor: ${fname(proj)}<br/>distance: ${(distq[index]/8).toFixed(1)} km (${meta.bands[bcode[index]] || "—"})
      ${urb[index] ? " · urban" : ""}<br/><i style="color:#8c87b0">click for full 2012–2024 history</i>` };
  }
  if (layer.id === "stations" && object) {
    const kl = object.context === "kl";
    return { html: `<div class="station-card">
      <div class="sc-head ${kl ? "kl" : "ic"}">📍 ${object.station_id.replace(/_/g, " ")}</div>
      <div class="sc-body">
        <span class="k">Corridor</span><span class="v">${fname(object.project)}</span>
        <span class="k">Mode</span><span class="v">${object.mode.replace(/_/g, " ")}</span>
        <span class="k">Opened</span><span class="v">${object.opening_year}</span>
        <span class="k">Location</span><span class="v">${object.district}, ${object.state}</span>
        <span class="k">Catchment</span><span class="v">${object.inner_ring_km} km ring</span>
        <span class="k">Context</span><span class="v">${kl ? "Klang Valley" : "Intercity"}</span>
      </div></div>` };
  }
  if (layer.id === "routes" && object) {
    const p = object.properties;
    const ol = OPEN_LABEL(p.project);
    const o = ol ? `opened ${ol}` : (p.status === "under_construction" ? "under construction" : "opened in stages");
    return { html: `<div class="tt-pad"><b>${fname(p.project)}</b><br/>${p.mode} · ${o}<br/><i style="color:#8c87b0">double-click to zoom</i></div>` };
  }
  return null;
}
const fmtNum = v => v >= 1000 ? (v/1000).toFixed(1) + "k" : v.toFixed(0);
const qlabel = t => meta.quarters[t].replace("-", " ");

/* ============================ map init =========================== */
function initMap() {
  map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json",
    center: [104.5, 4.0], zoom: 5.4, minZoom: 4, maxZoom: 14, attributionControl: { compact: true },
    doubleClickZoom: false,
  });
  map.on("error", () => {});  // offline-tolerant: deck still renders
  map.on("move", positionStoryFlags);
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  overlay = new deck.MapboxOverlay({
    interleaved: false, layers: [], getTooltip,
    onClick: info => {
      if (info.layer && info.layer.id === "ntl-cells" && info.index >= 0) openDrill(info.index);
      else if (info.layer && info.layer.id === "routes" && info.object) {
        // single click selects; double-click (below) zooms
        setCorridor(info.object.properties.project);
      }
    },
  });
  map.addControl(overlay);
  map.on("dblclick", e => {
    const picked = overlay.pickObject({ x: e.point.x, y: e.point.y, radius: 6, layerIds: ["routes"] });
    if (picked && picked.object) { setCorridor(picked.object.properties.project); zoomToCorridor(); }
  });
}

/* on phones, fit a shrunken box around the corridor core so the zoom lands closer */
function mobileTighten(b) {
  if (!MOBILE()) return b;
  const cx = (b[0][0] + b[1][0]) / 2, cy = (b[0][1] + b[1][1]) / 2, k = 0.45;
  return [[cx + (b[0][0] - cx) * k, cy + (b[0][1] - cy) * k],
          [cx + (b[1][0] - cx) * k, cy + (b[1][1] - cy) * k]];
}

function zoomToCorridor() {
  const target = state.corridor === "all" ? [[99.5, 0.8], [119.5, 7.5]] : mobileTighten(corridorBounds[state.corridor]);
  if (!target) return;
  const opts = { padding: MOBILE() ? 20 : (state.corridor === "all" ? 40 : 60),
                 duration: 1200, maxZoom: MOBILE() ? 11.3 : 10.5, essential: true };
  const z0 = map.getZoom(), c0 = map.getCenter();
  hideCorridorCard();
  map.fitBounds(target, opts);
  // fallback: if the animation never actually moved the camera, jump straight there
  setTimeout(() => {
    if (Math.abs(map.getZoom() - z0) < 0.02 &&
        Math.abs(map.getCenter().lng - c0.lng) < 0.005) map.fitBounds(target, { ...opts, duration: 0 });
    popCorridorCard();
  }, 1450);
}

/* custom arcade dropdown over the native <select> (native popups can't be themed on macOS).
   The <select> stays the source of truth; we mirror its options and fire 'change' on pick. */
function buildCorridorDropdown(sel) {
  const wrap = document.getElementById("corridorwrap");
  if (wrap.querySelector(".dd")) return;
  const dd = document.createElement("div");
  dd.className = "dd";
  dd.innerHTML = `<button class="dd-trigger" type="button" aria-haspopup="listbox" aria-expanded="false"></button>
    <div class="dd-pop" role="listbox"></div>`;
  wrap.appendChild(dd);
  const trigger = dd.querySelector(".dd-trigger"), pop = dd.querySelector(".dd-pop");

  // build options mirroring the select (incl. optgroups)
  let html = "";
  for (const node of sel.children) {
    if (node.tagName === "OPTGROUP") {
      html += `<div class="dd-group">${node.label}</div>`;
      for (const o of node.children) html += `<div class="dd-opt" data-v="${o.value}">${o.textContent}</div>`;
    } else {
      html += `<div class="dd-opt" data-v="${node.value}">${node.textContent}</div>`;
    }
  }
  pop.innerHTML = html;

  const close = () => { dd.classList.remove("open"); trigger.setAttribute("aria-expanded", "false"); };
  const open = () => {
    dd.classList.add("open"); trigger.setAttribute("aria-expanded", "true");
    const cur = pop.querySelector(".dd-opt.sel"); if (cur) cur.scrollIntoView({ block: "nearest" });
  };
  trigger.onclick = e => { e.stopPropagation(); dd.classList.contains("open") ? close() : open(); };
  pop.onclick = e => {
    const opt = e.target.closest(".dd-opt"); if (!opt) return;
    if (sel.value !== opt.dataset.v) { sel.value = opt.dataset.v; sel.dispatchEvent(new Event("change")); }
    close();
  };
  document.addEventListener("click", e => { if (!dd.contains(e.target)) close(); });
  window.__syncCorridorTrigger = () => {
    trigger.textContent = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : "—";
    pop.querySelectorAll(".dd-opt").forEach(o => o.classList.toggle("sel", o.dataset.v === sel.value));
  };
  window.__syncCorridorTrigger();
}

/* ======================== header & controls ====================== */
function initHeader() {
  // corridor select
  const sel = document.getElementById("corridorsel");
  const completed = meta.projects.filter(p => COMPLETED_BY_DATA_END.includes(p))
    .sort((a, b) => (openIdxOf(a) === -1 ? 99 : openIdxOf(a)) - (openIdxOf(b) === -1 ? 99 : openIdxOf(b)));
  const uc = meta.projects.filter(p => UC_BY_DATA_END.includes(p));
  sel.innerHTML = `<option value="all">All corridors</option>
    <optgroup label="Completed">${completed.map(p => `<option value="${p}">${fname(p)}${OPEN_LABEL(p) ? " · " + OPEN_LABEL(p) : ""}</option>`).join("")}</optgroup>
    <optgroup label="Under construction">${uc.map(p => `<option value="${p}">${fname(p)}</option>`).join("")}</optgroup>`;
  sel.value = state.corridor;
  sel.onchange = () => { setCorridor(sel.value); zoomToCorridor(); autoplayAfterZoom(); };
  buildCorridorDropdown(sel);

  // checkboxes
  const ck = (id, key) => { const el = document.getElementById(id); el.checked = state[key];
    el.onchange = () => { state[key] = el.checked; refreshMapOnly(); }; };
  ck("ck-stations", "showStations"); ck("ck-buffers", "showBuffers"); ck("ck-dim", "dimOthers");

  // slider + play
  const sl = document.getElementById("timeslider");
  sl.oninput = async () => {
    state.t = +sl.value; await ensureQuarter(state.t);
    refreshMapOnly(); updateTimeLabel(); writeHash();
  };
  document.getElementById("playbtn").onclick = togglePlay;

  // tabs
  document.querySelectorAll("#tabs button").forEach(b =>
    b.onclick = () => { state.tab = b.dataset.tab; syncTabs(); renderSide(); writeHash(); });

  // mobile bottom-sheet toggle
  const st = document.getElementById("sidetoggle");
  st.onclick = () => {
    const side = document.getElementById("side");
    const open = side.classList.toggle("open");
    st.textContent = open ? "✕" : "📊";
    if (open) renderSide();   // charts need a fresh layout once visible
  };
}

/* after picking a corridor: rewind to 2012 Q1 and play its history once the zoom lands */
function autoplayAfterZoom() {
  if (state.layer !== "ntl") return;
  if (playTimer) togglePlay();
  state.t = 0;
  document.getElementById("timeslider").value = 0;
  ensureQuarter(0).then(() => { refreshMapOnly(); updateTimeLabel(); });
  setTimeout(() => { if (!playTimer) togglePlay(); }, 1550);
}

function setCorridor(p) {
  state.corridor = p;
  document.getElementById("corridorsel").value = p;
  if (window.__syncCorridorTrigger) window.__syncCorridorTrigger();
  clearStoryFlags();
  refreshAll();
}

function togglePlay() {
  const btn = document.getElementById("playbtn");
  if (playTimer) { clearTimeout(playTimer); playTimer = null; btn.textContent = "▶"; refreshMapOnly(); return; }  // settle into crisp squares
  btn.textContent = "❚❚";
  const sl0 = document.getElementById("timeslider");
  if (+sl0.value >= +sl0.max) { sl0.value = 0; state.t = 0; }
  const step = MOBILE() ? 320 : 200;
  // self-scheduling loop: each frame WAITS for its quarter to load before drawing,
  // so the map never renders an unloaded (black) quarter; next tick is scheduled after.
  const tick = async () => {
    const sl = document.getElementById("timeslider");
    let v = +sl.value + 1;
    if (v > +sl.max) { togglePlay(); return; }
    const arr = await ensureQuarter(v);     // block until this quarter is in cache
    if (!playTimer) return;                  // paused while we awaited
    sl.value = v; state.t = v;
    for (let k = 1; k <= 5; k++) if (v + k <= +sl.max) ensureQuarter(v + k); // prefetch ahead
    maybeOpeningFlag(v); maybeStoryFlag(v);
    refreshMapOnly(); updateTimeLabel();
    playTimer = setTimeout(tick, step);
  };
  for (let k = 1; k <= 6; k++) if (state.t + k < meta.quarters.length) ensureQuarter(state.t + k);
  playTimer = setTimeout(tick, step);
}

/* Story flags for the intro autoplay — locations & radiance figures computed from the
   panel itself (3-km windows, 2012 avg vs 2023/24 avg); local context is public record. */
const STORY = {
  DASH: [
    { t: 3, lon: 101.485, lat: 3.135, ang: -150, title: "Watching from orbit", stat: "NASA Black Marble · 1-km",
      text: "Satellite imagery shows areas near a major infrastructure project <b>brightening significantly</b> over time — watch it unfold." },
    { t: 18, lon: 101.51, lat: 3.155, ang: 47, title: "Elmina / Denai Alam", stat: "≈21 → ≈36 nW · ×1.7",
      text: "Fastest-brightening spot on the corridor — Sime Darby's <b>City of Elmina</b> township." },
    { t: 30, lon: 101.565, lat: 3.175, ang: -47, title: "Kwasa Damansara / Sungai Buloh", stat: "≈29 → ≈34 nW",
      text: "<b>EPF</b> township on the <b>MRT 1 + Putrajaya Line</b> terminus." },
  ],
};
const liveFlags = [];   // {el, anchor, key, ang, dist, pos:{x,y} card top-left rel. dot}
function maybeStoryFlag(t) {
  const flags = STORY[state.corridor];
  if (!flags) return;
  const f = flags.find(x => x.t === t);
  if (!f || liveFlags.some(L => L.key === state.corridor + t)) return;
  const el = document.createElement("div");
  el.className = "sflag";
  el.innerHTML = `<div class="sf-leader"></div><div class="sf-dot"></div>
    <div class="sf-card"><h5>${f.title}</h5><span class="sf-stat">${f.stat}</span><p>${f.text}</p></div>`;
  document.getElementById("storyflags").appendChild(el);
  const L = { el, anchor: [f.lon, f.lat], key: state.corridor + t,
              ang: (f.ang ?? -47) * Math.PI / 180, dist: f.dist ?? (MOBILE() ? 80 : 95), pos: null };
  liveFlags.push(L);
  initFlagPos(L);
  positionStoryFlags();
  makeFlagDraggable(L);
}
function initFlagPos(L) {
  const card = L.el.querySelector(".sf-card");
  const w = card.offsetWidth || 250, h = card.offsetHeight || 140;
  const px = Math.cos(L.ang) * L.dist, py = Math.sin(L.ang) * L.dist;
  L.pos = { x: Math.cos(L.ang) >= 0 ? px : px - w, y: Math.sin(L.ang) >= 0 ? py : py - h };
  layoutFlag(L);
}
function layoutFlag(L) {
  const card = L.el.querySelector(".sf-card"), lead = L.el.querySelector(".sf-leader");
  const w = card.offsetWidth || 250, h = card.offsetHeight || 140;
  card.style.left = L.pos.x + "px"; card.style.top = L.pos.y + "px";
  // leader runs from the dot to the nearest point on the card
  const nx = Math.max(L.pos.x, Math.min(0, L.pos.x + w));
  const ny = Math.max(L.pos.y, Math.min(0, L.pos.y + h));
  const len = Math.hypot(nx, ny), ang = Math.atan2(ny, nx);
  lead.style.width = Math.max(0, len - 4) + "px";
  lead.style.transform = `rotate(${ang}rad)`;
}
function positionStoryFlags() {
  if (!map || !liveFlags.length) return;
  const rect = map.getContainer().getBoundingClientRect();
  for (const L of liveFlags) {
    const pt = map.project(L.anchor);
    L.el.style.left = pt.x + "px"; L.el.style.top = pt.y + "px";
    // keep the card on-screen: clamp its offset so dot+pos+card stays within the map
    const card = L.el.querySelector(".sf-card");
    const w = card.offsetWidth || 150, h = card.offsetHeight || 40, m = 6;
    if (L.pos) {
      L.pos.x = Math.max(m - pt.x, Math.min(rect.width - m - w - pt.x, L.pos.x));
      L.pos.y = Math.max(m - pt.y, Math.min(rect.height - m - h - pt.y, L.pos.y));
      layoutFlag(L);
    }
  }
}
function makeFlagDraggable(L) {
  const card = L.el.querySelector(".sf-card");
  card.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    card.setPointerCapture(e.pointerId);
    card.style.cursor = "grabbing";
    const x0 = e.clientX, y0 = e.clientY;
    const sx = e.clientX - L.pos.x, sy = e.clientY - L.pos.y;
    let moved = false;
    const move = ev => {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) moved = true;
      if (moved) { L.pos = { x: ev.clientX - sx, y: ev.clientY - sy }; layoutFlag(L); }
    };
    const up = () => { card.style.cursor = "grab";
      card.removeEventListener("pointermove", move); card.removeEventListener("pointerup", up);
      if (!moved && MOBILE()) { card.classList.toggle("expanded"); layoutFlag(L); }  // tap = expand/collapse
    };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
  });
}
function clearStoryFlags() {
  for (const L of liveFlags) L.el.remove();
  liveFlags.length = 0;
}

let flagTimeout = null;
function maybeOpeningFlag(t) { /* opening banner removed — the slider's magenta notch marks the opening */ }

function placeSliderFlag() {
  // .slider-flag is hidden by the CRT CSS; the blocky track's magenta notch marks the opening
  updateQBlocks();
}
function curTimeState() {   // {idx, max, openIdx} for the NTL timeline
  return { idx: state.t, max: meta.quarters.length - 1,
           openIdx: state.corridor !== "all" ? openIdxOf(state.corridor) : -1 };
}
let _qblockN = -1;
function buildQBlocks() {
  const w = document.getElementById("qblocks"); if (!w) return;
  const n = curTimeState().max + 1;
  if (n === _qblockN) return;            // already the right count
  _qblockN = n;
  w.innerHTML = Array.from({ length: n }, () => "<i></i>").join("");
}
function updateQBlocks() {
  buildQBlocks();                         // rebuild if the layer's range changed
  const blocks = document.querySelectorAll("#qblocks i");
  if (!blocks.length) return;
  document.getElementById("qblocks").style.display = "";
  const { idx, openIdx } = curTimeState();
  blocks.forEach((b, i) => {
    b.className = i < idx ? "on" : i === idx ? "head" : "";
    if (i === openIdx) b.classList.add("open-q");
  });
}

function syncLayerUI() {
  document.getElementById("ntlopts").style.display = "";
  const tb = document.getElementById("timebar"), sl = document.getElementById("timeslider"),
        tm = document.getElementById("timemode");
  if (playTimer) togglePlay();
  tb.style.display = ""; sl.max = meta.quarters.length - 1; sl.value = state.t;
  tm.textContent = "quarterly · 2012 Q1 – 2024 Q1";
  document.getElementById("layertitle").textContent = "🛰️ NASA Black Marble nighttime radiance — 1-km cells";
  updateTimeLabel();
  placeSliderFlag();
  renderCorridorCard();
  renderLegend();
}

function updateTimeLabel() {
  const cr = document.getElementById("credit");
  if (cr) { cr.style.display = ""; cr.textContent = `CREDIT ${state.t + 1}/${meta.quarters.length} QTRS`; }
  document.getElementById("timelabel").textContent = qlabel(state.t);
  updateQBlocks();
}

function syncTabs() {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
}

/* ==================== corridor overview card ===================== */
const CORRIDOR_BLURBS = {
  DASH: "≈20-km elevated highway from Puncak Perdana to Penchala (opened Oct 2022), cutting across the Guthrie Corridor's fastest-growing townships — Elmina, Kwasa Damansara, Setia Alam.",
};
let cellCounts = null;
function renderCorridorCard() {
  const el = document.getElementById("corridorcard");
  const p = state.corridor;
  if (p === "all") {
    el.innerHTML = `<h4>All corridors</h4><div class="cc-sub">national overview</div>
      <div class="cc-row"><span class="k">Corridors</span><span class="v">${meta.projects.length}</span></div>
      <div class="cc-row"><span class="k">1-km cells</span><span class="v">${meta.n_cells.toLocaleString()}</span></div>
      <div class="cc-row"><span class="k">Coverage</span><span class="v">2012 Q1 – 2024 Q1</span></div>`;
    return;
  }
  if (!cellCounts) {
    cellCounts = {};
    for (let i = 0; i < meta.n_cells; i++) {
      const pr = meta.projects[pcode[i]];
      if (pr) cellCounts[pr] = (cellCounts[pr] || 0) + 1;
    }
  }
  const s = tsNTL.series[p];
  let radRow = "";
  if (s && s.near && s.near.ntl) {
    const v = s.near.ntl;
    const avg = a => { const x = a.filter(Number.isFinite); return x.length ? x.reduce((u, w) => u + w, 0) / x.length : null; };
    const b0 = avg(v.slice(0, 4)), b1 = avg(v.slice(-4));
    if (b0 != null && b1 != null)
      radRow = `<div class="cc-row"><span class="k">Near-ring radiance</span>
        <span class="v">${b0.toFixed(1)} → ${b1.toFixed(1)} nW <span style="color:${b1 >= b0 ? "#34d399" : "#f87171"}">(${b1 >= b0 ? "+" : ""}${(100 * (b1 - b0) / b0).toFixed(0)}%)</span></span></div>`;
  }
  const rt = routesGeo.features.find(f => f.properties.project === p);
  const nSt = stationsData.filter(d => d.project === p).length;
  const status = UC_BY_DATA_END.includes(p) ? "Under construction"
    : OPEN_LABEL(p) ? "Opened " + OPEN_LABEL(p) : "Opened in stages";
  el.innerHTML = `<h4>${fname(p)}</h4><div class="cc-sub">${status}${meta.openings[p] ? " · headline corridor" : ""}</div>
    ${rt ? `<div class="cc-row"><span class="k">Mode</span><span class="v">${rt.properties.mode}</span></div>` : ""}
    <div class="cc-row"><span class="k">Assigned cells</span><span class="v">${(cellCounts[p] || 0).toLocaleString()}</span></div>
    ${nSt ? `<div class="cc-row"><span class="k">Stations / interchanges</span><span class="v">${nSt}</span></div>` : ""}
    ${radRow}
    ${CORRIDOR_BLURBS[p] ? `<div class="cc-blurb">${CORRIDOR_BLURBS[p]}</div>` : ""}`;
}

/* ============================= legend ============================ */
function renderLegend() {
  const lg = document.getElementById("legend");
  const grad = "linear-gradient(90deg,#0d0726 0 14%,#2b1166 14% 28%,#6b1d92 28% 42%,#c22f68 42% 56%,#ff6b35 56% 70%,#ffc53f 70% 84%,#fff3a3 84% 100%)";
  lg.innerHTML = `<b style="color:#e7ecf5">Radiance (nW/cm²/sr)</b>
    <div class="bar" style="background:${grad}"></div>
    <div class="ticks"><span>0</span><span>1</span><span>5</span><span>20</span><span>75</span><span>150+</span></div>
    <div class="swatches">
      <div class="sw"><i style="background:#53e8ff"></i>completed corridor</div>
      <div class="sw"><i style="background:#ff8a3d"></i>under construction</div>
      <div class="sw"><i class="dot" style="border:2px solid #34d399"></i>station (intercity)</div>
      <div class="sw"><i class="dot" style="border:2px solid #ff5fa8"></i>station (Klang Valley)</div>
    </div>
    <div class="note">Log-scaled levels. Shown as levels (nW), not %, because percentage changes off near-dark rural cells are misleading.</div>`;
}

/* ====================== refresh orchestration ===================== */
function refreshMapOnly() { overlay.setProps({ layers: buildLayers() }); }
function refreshAll() { syncLayerUI(); refreshMapOnly(); renderSide(); writeHash(); }

/* =========================== side panel ========================== */
function renderSide() {
  syncTabs();
  const el = document.getElementById("sidebody");
  Object.values(charts).forEach(c => c.dispose());
  charts = {};
  if (state.tab === "explore") renderExplore(el);
  else if (state.tab === "guide") renderGuide(el);
  else renderAbout(el);
}

function mkChart(id, opt) {
  const dom = document.getElementById(id);
  if (!dom) return;
  const c = echarts.init(dom, null, { renderer: "canvas" });
  c.setOption(Object.assign({
    backgroundColor: "transparent",
    textStyle: { fontFamily: "'IBM Plex Mono',ui-monospace,monospace" },
    animationDuration: 350,
  }, opt));
  charts[id] = c;
}
const AXIS = c => ({ axisLine: { lineStyle: { color: "#2e2752" } }, axisLabel: { color: "#8c87b0", fontSize: 9.5 },
                     splitLine: { lineStyle: { color: "#1c1833" } }, nameTextStyle: { color: "#8c87b0", fontSize: 9.5 }, ...c });
const TIP = { trigger: "axis", backgroundColor: "#110f1d", borderColor: "#2e2752",
              textStyle: { color: "#e7ecf5", fontSize: 11 } };

/* ---- Explore tab ---- */
function renderExplore(el) {
  const p = state.corridor;
  const isAll = p === "all";
  const opening = OPEN_LABEL(p);
  const headline = !!meta.openings[p];
  const uc = UC_BY_DATA_END.includes(p);
  el.innerHTML = `
    <div class="panel-h">${isAll ? "Pick a corridor to explore" : fname(p)} <span class="badge desc">DESCRIPTIVE</span></div>
    <div class="panel-sub">${isAll ? "Select a corridor above (or click a route on the map) to see its near-vs-far radiance trend — the raw double-difference behind the design."
      : opening ? `Opened <b style="color:#e7ecf5">${opening}</b>. Mean radiance of cells <b style="color:#7dd3fc">≤ 5 km</b> from the route vs the <b style="color:#94a3b8">20–30 km</b> outer ring${headline ? " (the design's control)" : ""}.${headline ? "" : " Not part of the headline estimates."}`
      : uc ? "Under construction — no opening yet; treat any divergence as anticipatory/descriptive only."
      : "Opened in stages. Not part of the headline estimates."}</div>
    ${isAll ? "" : `
    <div class="controls-row">
      <div class="seg" id="unitseg">
        <button data-u="ntl" class="${state.unit === "ntl" ? "active" : ""}">levels (nW)</button>
        <button data-u="log_sa" class="${state.unit === "log_sa" ? "active" : ""}">log, deseasonalised</button>
      </div>
    </div>
    <div id="ch-nearfar" class="chart tall"></div>
    <div class="note-box"><b>How to read:</b> the cyan line is mean radiance of cells within 5 km of the route; the darker line is the 20–30 km outer ring. If the near line pulls away from the outer ring after the opening (dashed line), that is the corridor's nighttime-light footprint emerging. Descriptive only.</div>`}
    ${state.drill ? `<hr class="sep"/><div class="panel-h">Cell history <span class="badge desc">DESCRIPTIVE</span></div>
      <div class="panel-sub">Cell at ${state.drill.lon.toFixed(3)}, ${state.drill.lat.toFixed(3)} · ${fname(meta.projects[pcode[state.drill.idx]] || "—")} · ${(distq[state.drill.idx]/8).toFixed(1)} km from route</div>
      <div id="ch-drill" class="chart short"></div>` : `<hr class="sep"/><div class="muted-s">💡 Click any lit cell on the map to pull its full 2012–2024 quarterly radiance history.</div>`}`;

  if (!isAll) {
    document.querySelectorAll("#unitseg button").forEach(b =>
      b.onclick = () => { state.unit = b.dataset.u; renderSide(); });
    const s = tsNTL.series[p];
    if (s && s.near) {
      const u = state.unit;
      const openIdx = openIdxOf(p);
      // comparison series: true far ring if it exists; otherwise the outermost available band
      let cmp = s.far, cmpLabel = "far (20–30 km)";
      if (!cmp) {
        const have = meta.bands.filter(b => s.bands[b]).reverse();
        const ob = have.find(b => b !== "0-5km");
        if (ob) { cmp = s.bands[ob]; cmpLabel = `outer ring (${ob})`;
          const sub = el.querySelector(".panel-sub");
          if (sub) sub.innerHTML += ` <span style="color:#6f6a92">The 20–30 km control ring overlaps neighbouring corridors here, so the comparison uses the outermost available ring (${ob}).</span>`;
        }
      }
      mkChart("ch-nearfar", {
        tooltip: TIP,
        legend: { textStyle: { color: "#8c87b0", fontSize: 10 }, top: 0 },
        grid: { left: 44, right: 14, top: 28, bottom: 24 },
        xAxis: AXIS({ type: "category", data: tsNTL.quarters.map(q => q.replace("-", " ")) }),
        yAxis: AXIS({ type: "value", name: u === "ntl" ? "nW/cm²/sr" : "log radiance (s.a.)", scale: true }),
        series: [
          { name: "near (≤5 km)", type: "line", data: s.near[u], showSymbol: false, lineStyle: { width: 2.2, color: "#53e8ff" }, itemStyle: { color: "#53e8ff" },
            markLine: openIdx >= 0 ? { symbol: "none", label: { formatter: "opening", color: "#ffd23f", fontSize: 9 },
              lineStyle: { color: "#ffd23f", type: "dashed" }, data: [{ xAxis: openIdx }] } : undefined },
          ...(cmp ? [{ name: cmpLabel, type: "line", data: cmp[u], showSymbol: false, lineStyle: { width: 2.2, color: "#5d5784" }, itemStyle: { color: "#5d5784" } }] : []),
        ],
      });
    }
  }
  if (state.drill) renderDrillChart();
}

async function openDrill(idx) {
  state.drill = { idx, lon: positions[2*idx], lat: positions[2*idx+1], series: null };
  if (state.tab !== "explore") { state.tab = "explore"; }
  renderSide();
  const series = [];
  for (let t = 0; t < meta.quarters.length; t++) {
    const tid = meta.tid_of[meta.quarters[t]];
    let arr = quarterCache.get(tid);
    if (!arr) {
      try {
        const r = await fetch(`${DATA}ntl/q_${tid}.bin`, { headers: { Range: `bytes=${idx*2}-${idx*2+1}` } });
        if (r.status === 206) {
          const b = new Uint8Array(await r.arrayBuffer());
          series.push(decodeVal(b[0] | (b[1] << 8)));
          continue;
        } else { arr = new Uint16Array(await r.arrayBuffer()); quarterCache.set(tid, arr); }
      } catch (err) { series.push(null); continue; }
    }
    series.push(decodeVal(arr[idx]));
  }
  if (state.drill && state.drill.idx === idx) { state.drill.series = series; renderSide(); }
}
const decodeVal = v => v === meta.sentinel ? null : +(v / meta.radiance_scale).toFixed(3);

function renderDrillChart() {
  const d = state.drill;
  if (!d) return;
  if (!d.series) { const dom = document.getElementById("ch-drill"); if (dom) dom.innerHTML = "<div class='muted-s' style='padding:20px'>loading cell history…</div>"; return; }
  const proj = meta.projects[pcode[d.idx]];
  const openIdx = openIdxOf(proj);
  mkChart("ch-drill", {
    tooltip: TIP, grid: { left: 44, right: 14, top: 12, bottom: 24 },
    xAxis: AXIS({ type: "category", data: meta.quarters.map(q => q.replace("-", " ")) }),
    yAxis: AXIS({ type: "value", name: "nW/cm²/sr", scale: true }),
    series: [{ type: "line", data: d.series, showSymbol: false, connectNulls: true,
      lineStyle: { width: 2, color: "#ffd23f" }, itemStyle: { color: "#ffd23f" },
      areaStyle: { color: "rgba(251,191,36,.08)" },
      markLine: openIdx >= 0 ? { symbol: "none", label: { formatter: "opening", color: "#ffd23f", fontSize: 9 },
        lineStyle: { color: "#ffd23f", type: "dashed" }, data: [{ xAxis: openIdx }] } : undefined }],
  });
}

/* ---- Guide tab ---- */
function renderGuide(el) {
  const steps = [
    ["The question",
     "Malaysia spent billions on rail lines, bridges and expressways. Did the places they touch visibly light up at night — a proxy for local economic activity?",
     null],
    ["The measurement",
     "We use <b>satellite nightlights</b> — NASA's Black Marble radiance — as the spatial footprint of activity. Brighter ≠ richer in ringgit, but more light tracks more buildings, traffic and commerce.",
     null],
    ["The grid",
     "The country is cut into <b>186,103 one-km cells</b>, each measured every quarter from 2012 to 2024. Every cell is tagged with its nearest corridor and its distance to the route.",
     "Try: hover any lit cell on the map"],
    ["Near vs far",
     "Cells <b>≤ 5 km</b> from a corridor are 'near'; the <b>20–30 km</b> ring is 'far'. Watching the near line against the outer ring around each opening shows, descriptively, whether brightness pulled away after the corridor arrived.",
     "Try: press ▶ and watch the opening line"],
    ["Drive it yourself",
     "Pick a corridor from the amber dropdown · scrub or play the quarter slider · double-click a route to zoom · click any cell for its full 2012–2024 radiance history · hover stations for details.",
     null],
  ];
  el.innerHTML = `
    <div class="panel-h">What is this dashboard doing?</div>
    <div class="panel-sub">A guided tour of the nightlights view.</div>
    ${steps.map(([h, p, t], i) => `
      <div class="gstep"><div class="gnum">${i + 1}</div>
        <div><h4>${h}</h4><p>${p}</p>${t ? `<span class="try">💡 ${t}</span>` : ""}</div>
      </div>`).join("")}
    <div class="note-box"><b>Read it as description, not proof:</b> the maps and time series visualise nighttime radiance around the corridors. They show patterns, not causal effects.</div>`;
}

/* ---- About tab ---- */
function renderAbout(el) {
  el.innerHTML = `<div class="about">
    <div class="panel-h">About this dashboard</div>
    <p>A nighttime-lights explorer for Malaysia's transport corridors — visualising how satellite radiance
    around rail lines, bridges and expressways evolved over 2012–2024, quarter by quarter.</p>
    <h3>How cells are organised</h3>
    <p>The country is split into 186,103 one-km cells. Each is assigned to its nearest corridor and tagged with
    its distance to the route, so you can compare <b>near</b> cells (≤ 5 km) against the <b>20–30 km</b> outer ring
    around each opening. These comparisons are descriptive context, not causal estimates.</p>
    <h3>Reading the lights</h3>
    <ul>
      <li>Radiance is shown in <b>levels</b> (nW/cm²/sr) — % changes off dark rural baselines mislead.</li>
      <li>Nightlights are the <b>spatial footprint</b> of activity, not a ringgit value; brighter ≠ richer.</li>
      <li>Maps and time series here are <b>descriptive</b> visualisations, not effect sizes.</li>
    </ul>
    <h3>Data &amp; credits</h3>
    <ul>
      <li><b>Nightlights:</b> NASA Black Marble (VNP46A3), 1-km, calendar-quarter aggregates, 2012Q1–2024Q1, 186,103 cells.</li>
      <li><b>Basemap:</b> © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.</li>
    </ul>
    <p class="muted-s">Static site — all data precomputed; no tracking, no backend. Map cells are loaded one quarter at a time (~370 KB each).</p>
  </div>`;
}

/* ============================ url hash =========================== */
function writeHash() {
  const h = `c=${state.corridor}&t=${state.t}&tab=${state.tab}`;
  history.replaceState(null, "", "#" + h);
}
function parseHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("c") && (h.get("c") === "all" || meta.projects.includes(h.get("c")))) state.corridor = h.get("c");
  if (h.get("t") != null) { const t = +h.get("t"); if (t >= 0 && t < meta.quarters.length) state.t = t; }
  if (h.get("tab") && ["explore","guide","about"].includes(h.get("tab"))) state.tab = h.get("tab");
}

boot().catch(err => {
  console.error(err);
  failLoader("Couldn't load the dashboard",
    `${err && err.message ? err.message : err} (stage: ${window.__bootStage || "startup"}). ` +
    "If you're on a work network this is likely a proxy blocking a data file. Try a hard refresh (Ctrl/Cmd+Shift+R) or a different network.");
});
