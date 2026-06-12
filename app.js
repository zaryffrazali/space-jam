/* Three Lenses, One Corridor — interactive explorer
   Data: NASA Black Marble NTL (1-km, quarterly), OpenDOSM district GDP,
   NAPIC MHPI, MIDA/CEIC approved investment. Static site, no backend. */
"use strict";

const DATA = "data/";
const DOSM_DISTRICTS = "https://raw.githubusercontent.com/dosm-malaysia/data-open/main/datasets/geodata/administrative_2_district.geojson";
const DOSM_STATES    = "https://raw.githubusercontent.com/dosm-malaysia/data-open/main/datasets/geodata/administrative_1_state.geojson";

const state = {
  layer: "ntl", corridor: "DASH", t: 48,        // t = quarter index for NTL
  gdpYearIdx: 0, midaYearIdx: 0, mhpiYearIdx: 0, gdpSector: "p0",
  unit: "ntl",                                   // 'ntl' | 'log_sa'
  colorMode: "level",                            // 'level' | 'diff'
  showStations: true, showBuffers: false, dimOthers: true,
  tab: "explore", drill: null,                   // drill = {idx, lon, lat, series}
};

let meta, positions, pcode, distq, bcode, urb, tsNTL, results, stationsData,
    routesGeo, buffersGeo, gdpData, mhpiData, midaData;
let districtGeo = null, stateGeo = null, districtGeoFailed = false, stateGeoFailed = false;
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

/* NAPIC MHPI regions → administrative districts (approximate; only non-trivial
   mappings listed — all other regions share their district's exact name). */
const MHPI_REGION_DISTRICTS = {
  "Kota Tinggi/ Pontian": ["Kota Tinggi","Pontian"],
  "Tampin & Others": ["Tampin","Jempol","Kuala Pilah","Rembau","Jelebu"],
  "Jerantut-Lipis-Raub": ["Jerantut","Lipis","Raub"],
  "Kinta/ Ipoh": ["Kinta"],
  "Larut Matang": ["Larut Dan Matang"],
  "Pulau Pinang (Island)": ["Timur Laut","Barat Daya"],
  "Seberang Perai": ["Seberang Perai Utara","Seberang Perai Tengah","Seberang Perai Selatan"],
  "Kota Kinabalu-Penampang": ["Kota Kinabalu","Penampang"],
  "Hulu Langat": ["Ulu Langat"],
  "Kuala Lumpur Central": ["Kuala Lumpur"],
  "Kuala Lumpur North": ["Kuala Lumpur"],
  "Kuala Lumpur South": ["Kuala Lumpur"],
};
const normDistrict = s => s.toLowerCase().replace(/^w\.?p\.?\s*/,"").replace(/[^a-z]/g,"");
let mhpiDistrictMap = null;   // normalized district -> [region keys]
function buildMhpiDistrictMap() {
  if (mhpiDistrictMap) return mhpiDistrictMap;
  mhpiDistrictMap = {};
  for (const key of Object.keys(mhpiData.regions)) {
    const reg = key.split("|")[1];
    const dists = MHPI_REGION_DISTRICTS[reg] || [reg];
    for (const d of dists) (mhpiDistrictMap[normDistrict(d)] = mhpiDistrictMap[normDistrict(d)] || []).push(key);
  }
  return mhpiDistrictMap;
}

/* ============================= boot ============================= */
async function boot() {
  const lt = document.getElementById("loadertext");
  if (location.protocol === "file:") {
    lt.innerHTML = "This dashboard can't run from a double-clicked file — browsers block data loading on <code>file://</code>.<br/><br/>" +
      "Serve it over HTTP instead: open Terminal in this folder and run<br/>" +
      "<code style='color:#fbbf24'>python3 -m http.server 8000</code><br/>" +
      "then visit <b>http://localhost:8000</b> — or use the live GitHub Pages link once deployed.";
    lt.style.cssText = "max-width:480px;text-align:center;line-height:1.7;font-size:13px";
    const dsEl = document.querySelector("#loader .ds"); if (dsEl) dsEl.style.display = "none";
    return;
  }
  lt.textContent = "Loading metadata…";
  meta = await (await fetch(DATA + "meta.json")).json();

  lt.textContent = "Loading 186,103 grid cells…";
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

  lt.textContent = "Loading time series & results…";
  [tsNTL, results, stationsData, routesGeo, buffersGeo, gdpData, mhpiData, midaData] =
    await Promise.all(["ts_ntl.json","results.json","stations.json","routes.geojson",
                       "buffers.geojson","gdp.json","mhpi.json","mida.json"]
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
  state.mhpiYearIdx = mhpiData.years.length - 1;
  state.midaYearIdx = midaData.years.length - 1;
  parseHash();
  // intro plays on the default view (incl. reloads where the hash still points at it);
  // a hash pointing elsewhere = a shared link, so land there directly instead
  const intro = state.layer === "ntl" && state.corridor === "DASH";
  buildLUTs();
  initHeader();
  initMap();
  lt.textContent = "Loading latest quarter…";
  if (intro) state.t = 0;               // intro autoplay starts from 2012 Q1
  await ensureQuarter(state.t);
  refreshAll();
  document.getElementById("loader").classList.add("hide");
  // background fetch of remote boundaries (non-blocking)
  fetchBoundaries();
  if (intro) introSequence();
}

/* intro: hold on the whole country, then fly into the DASH corridor, then play time.
   The corridor overview card stays hidden until the zoom has landed. */
function introSequence() {
  const b = corridorBounds[state.corridor];
  if (!b) { if (!playTimer) togglePlay(); return; }
  hideCorridorCard();
  setTimeout(() => {
    const z0 = map.getZoom();
    map.fitBounds(b, { padding: 70, maxZoom: 10.6, duration: 3200, curve: 1.3, essential: true });
    // fallback if the animation never moved the camera
    setTimeout(() => { if (Math.abs(map.getZoom() - z0) < 0.02) map.fitBounds(b, { padding: 70, maxZoom: 10.6, duration: 0 }); }, 3500);
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

async function fetchBoundaries() {
  try { districtGeo = await (await fetch(DOSM_DISTRICTS)).json(); }
  catch (err) { districtGeoFailed = true; }
  try { stateGeo = await (await fetch(DOSM_STATES)).json(); }
  catch (err) { stateGeoFailed = true; }
  if (state.layer === "gdp" || state.layer === "mida") refreshAll();
}

/* ====================== colour lookup tables ===================== */
let LUT_LEVEL, LUT_DIFF;
const LUT_N = 1024, RAD_CAP = 150, DIFF_CAP = 10;
function buildLUTs() {
  const stops = [
    [0.00,   8,  6, 30,   0], [0.10,  40, 11, 84,  70], [0.30, 120, 28,109, 140],
    [0.50, 217, 72, 67, 190], [0.70, 251,155, 53, 228], [0.85, 247,222,107, 246],
    [1.00, 255,255,234, 255]];
  LUT_LEVEL = new Uint8Array(LUT_N * 4);
  for (let i = 0; i < LUT_N; i++) {
    const t = i / (LUT_N - 1);
    let a = stops[0], b = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) if (t >= stops[k][0] && t <= stops[k+1][0]) { a = stops[k]; b = stops[k+1]; break; }
    const f = (t - a[0]) / Math.max(1e-9, b[0] - a[0]);
    for (let c = 0; c < 4; c++) LUT_LEVEL[i*4+c] = Math.round(a[c+1] + f * (b[c+1] - a[c+1]));
  }
  // diverging: blue (decline) -> transparent -> amber (growth)
  LUT_DIFF = new Uint8Array(LUT_N * 4);
  for (let i = 0; i < LUT_N; i++) {
    const t = i / (LUT_N - 1) * 2 - 1; // -1..1
    const m = Math.abs(t);
    const al = Math.round(Math.min(1, m * 1.6) * 235);
    if (t < 0) { LUT_DIFF[i*4] = 56;  LUT_DIFF[i*4+1] = 140 + Math.round(49*m); LUT_DIFF[i*4+2] = 248; }
    else       { LUT_DIFF[i*4] = 251; LUT_DIFF[i*4+1] = 191; LUT_DIFF[i*4+2] = 36; }
    LUT_DIFF[i*4+3] = al;
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
function cellColors(arr) {
  const n = meta.n_cells, out = new Uint8Array(n * 4);
  const selIdx = state.corridor === "all" ? -1 : meta.projects.indexOf(state.corridor);
  const dim = state.dimOthers && selIdx >= 0;
  const lut = state.colorMode === "diff" ? LUT_DIFF : LUT_LEVEL;
  const logCap = Math.log1p(RAD_CAP);
  for (let i = 0; i < n; i++) {
    const v = arr[i];
    if (v === meta.sentinel) continue; // alpha 0
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

  if (state.layer === "gdp" && districtGeo) {
    const year = gdpData.years[state.gdpYearIdx];
    const vals = {};
    const sorted = [];
    for (const [k, sec] of Object.entries(gdpData.data)) {
      const v = sec[state.gdpSector] ? sec[state.gdpSector][year] : undefined;
      if (v != null) { vals[normKey(k)] = v; sorted.push(v); }
    }
    sorted.sort((a, b) => a - b);
    // quantile rank → wide green ramp (dark forest → emerald → lime) for visible contrast
    const rankT = v => {
      let lo = 0, hi = sorted.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
      return sorted.length > 1 ? lo / (sorted.length - 1) : 0;
    };
    const ramp = t => t < 0.5
      ? [Math.round(5 + (16 - 5) * t * 2), Math.round(48 + (165 - 48) * t * 2), Math.round(34 + (108 - 34) * t * 2)]
      : [Math.round(16 + (190 - 16) * (t - 0.5) * 2), Math.round(165 + (242 - 165) * (t - 0.5) * 2), Math.round(108 + (90 - 108) * (t - 0.5) * 2)];
    layers.push(new deck.GeoJsonLayer({
      id: "gdp-choro", data: districtGeo, pickable: true, stroked: true, filled: true,
      getLineColor: [13, 20, 36, 200], lineWidthMinPixels: 0.6,
      getFillColor: f => {
        const v = vals[normKey(f.properties.state + "|" + f.properties.district)];
        if (v == null) return [40, 50, 70, 60];
        return [...ramp(rankT(v)), 215];
      },
      updateTriggers: { getFillColor: [year, state.gdpSector] },
    }));
  }

  if (state.layer === "mhpi" && districtGeo) {
    const yi = state.mhpiYearIdx;
    const dmap = buildMhpiDistrictMap();
    const cellVals = [];
    const valFor = nd => {
      const regs = dmap[nd]; if (!regs) return null;
      const vs = regs.map(k => mhpiData.regions[k].mhpi[yi]).filter(v => v != null);
      return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
    };
    for (const nd of Object.keys(dmap)) { const v = valFor(nd); if (v != null) cellVals.push(v); }
    const vmin = Math.min(...cellVals), vmax = Math.max(...cellVals);
    layers.push(new deck.GeoJsonLayer({
      id: "mhpi-choro", data: districtGeo, pickable: true, stroked: true, filled: true,
      getLineColor: [13, 20, 36, 200], lineWidthMinPixels: 0.6,
      getFillColor: f => {
        const v = valFor(normDistrict(f.properties.district));
        if (v == null) return [40, 50, 70, 50];
        const t = vmax > vmin ? (v - vmin) / (vmax - vmin) : 0.5;
        return [Math.round(70 + 174 * t), Math.round(28 + 86 * t), Math.round(112 + 70 * t), 215];
      },
      updateTriggers: { getFillColor: [yi] },
    }));
  }

  if (state.layer === "mida" && stateGeo) {
    const year = midaData.years[state.midaYearIdx];
    const yi = midaData.years.indexOf(year);
    const vals = {}; let vmax = 0;
    for (const [stn, series] of Object.entries(midaData.states)) {
      const v = series[yi];
      if (v != null) { vals[normState(stn)] = v; if (v > vmax) vmax = v; }
    }
    const lmax = Math.log1p(vmax || 1);
    layers.push(new deck.GeoJsonLayer({
      id: "mida-choro", data: stateGeo, pickable: true, stroked: true, filled: true,
      getLineColor: [13, 20, 36, 220], lineWidthMinPixels: 1,
      getFillColor: f => {
        const v = vals[normState(f.properties.state)];
        if (v == null) return [40, 50, 70, 60];
        const t = Math.log1p(v) / lmax;
        return [Math.round(120+131*t), Math.round(60+131*t), Math.round(15+21*t), 205];
      },
      updateTriggers: { getFillColor: [year] },
    }));
  }

  if (state.showBuffers && state.layer === "ntl") {
    const feats = sel === "all" ? buffersGeo.features : buffersGeo.features.filter(f => f.properties.project === sel);
    layers.push(new deck.GeoJsonLayer({
      id: "buffers", data: { type: "FeatureCollection", features: feats },
      stroked: true, filled: true, getFillColor: [56, 189, 248, 14],
      getLineColor: [56, 189, 248, 70], lineWidthMinPixels: 1,
    }));
  }

  if (state.layer === "ntl") {
    const arr = quarterCache.get(meta.tid_of[meta.quarters[state.t]]);
    if (arr) layers.push(new deck.ScatterplotLayer({
      id: "ntl-cells", pickable: true,
      data: { length: meta.n_cells, attributes: {
        getPosition: { value: positions, size: 2 },
        getFillColor: { value: cellColors(arr), size: 4 },
      }},
      getRadius: 650, radiusUnits: "meters", radiusMinPixels: 1.1, radiusMaxPixels: 14,
      updateTriggers: { getFillColor: [state.t, state.corridor, state.dimOthers, state.colorMode] },
    }));
  }

  // corridor routes (always on; the spatial spine)
  layers.push(new deck.GeoJsonLayer({
    id: "routes", data: routesGeo, pickable: true,
    getLineColor: f => {
      const p = f.properties;
      const seld = sel === "all" || p.project === sel;
      if (p.status === "completed") return [56, 189, 248, seld ? 230 : 90];
      if (p.status === "under_construction") return [251, 146, 60, seld ? 230 : 90];
      return [148, 163, 184, seld ? 170 : 60];
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
      getLineColor: d => d.context === "kl" ? [232, 121, 249, 255] : [52, 211, 153, 255],
    }));
  }
  return layers;
}

function normKey(k) { return k.toLowerCase().replace(/[^a-z0-9|]+/g, ""); }
function normState(s) { return s.toLowerCase().replace(/^w\.?p\.?\s*/i, "").replace(/[^a-z]+/g, ""); }

function getTooltip({ layer, object, index }) {
  if (!layer) return null;
  if (layer.id === "ntl-cells" && index >= 0) {
    const arr = quarterCache.get(meta.tid_of[meta.quarters[state.t]]);
    const v = arr && arr[index] !== meta.sentinel ? (arr[index] / meta.radiance_scale).toFixed(2) : "no data";
    const proj = pcode[index] < meta.projects.length ? meta.projects[pcode[index]] : "—";
    return { html: `<b>${qlabel(state.t)}</b> · radiance <b>${v}</b> nW/cm²/sr<br/>
      corridor: ${fname(proj)}<br/>distance: ${(distq[index]/8).toFixed(1)} km (${meta.bands[bcode[index]] || "—"})
      ${urb[index] ? " · urban" : ""}<br/><i style="color:#8b97ad">click for full 2012–2024 history</i>` };
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
    return { html: `<div class="tt-pad"><b>${fname(p.project)}</b><br/>${p.mode} · ${o}<br/><i style="color:#8b97ad">double-click to zoom</i></div>` };
  }
  if (layer.id === "gdp-choro" && object) {
    const pr = object.properties, year = gdpData.years[state.gdpYearIdx];
    const key = Object.keys(gdpData.data).find(k => normKey(k) === normKey(pr.state + "|" + pr.district));
    const v = key ? gdpData.data[key][state.gdpSector]?.[year] : null;
    return { html: `<b>${pr.district}</b>, ${pr.state}<br/>${gdpData.sectors[state.gdpSector]} ${year}:
      <b>${v != null ? "RM " + fmtNum(v) + " mn" : "n/a"}</b><br/><i style="color:#8b97ad">real 2015 prices · OpenDOSM</i>` };
  }
  if (layer.id === "mhpi-choro" && object) {
    const pr = object.properties, year = mhpiData.years[state.mhpiYearIdx];
    const regs = buildMhpiDistrictMap()[normDistrict(pr.district)];
    if (!regs) return { html: `<div class="tt-pad"><b>${pr.district}</b>, ${pr.state}<br/>not covered by a NAPIC MHPI region</div>` };
    const rows = regs.map(k => { const v = mhpiData.regions[k].mhpi[state.mhpiYearIdx];
      return `${k.split("|")[1]}: <b>${v != null ? v : "n/a"}</b>`; }).join("<br/>");
    return { html: `<div class="tt-pad"><b>${pr.district}</b>, ${pr.state} · ${year}<br/>${rows}
      <br/><i style="color:#8b97ad">MHPI, 2010=100 · NAPIC region(s), approximate boundaries</i></div>` };
  }
  if (layer.id === "mida-choro" && object) {
    const pr = object.properties, year = midaData.years[state.midaYearIdx];
    const key = Object.keys(midaData.states).find(k => normState(k) === normState(pr.state));
    const v = key ? midaData.states[key][state.midaYearIdx] : null;
    const asg = key ? (midaData.assignments[key] || "—") : "—";
    return { html: `<b>${pr.state}</b><br/>Approved investment ${year}: <b>${v != null ? "RM " + fmtNum(v) + " mn" : "n/a"}</b>
      <br/>corridor assignment: ${asg}<br/><i style="color:#8b97ad">MIDA via CEIC · descriptive only</i>` };
  }
  return null;
}
const fmtNum = v => v >= 1000 ? (v/1000).toFixed(1) + "k" : v.toFixed(0);
const qlabel = t => meta.quarters[t].replace("-", " ");

/* ============================ map init =========================== */
function initMap() {
  map = new maplibregl.Map({
    container: "map",
    style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
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

function zoomToCorridor() {
  const target = state.corridor === "all" ? [[99.5, 0.8], [119.5, 7.5]] : corridorBounds[state.corridor];
  if (!target) return;
  const opts = { padding: state.corridor === "all" ? 40 : 60, duration: 1200, maxZoom: 10.5, essential: true };
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
  sel.onchange = () => { setCorridor(sel.value); zoomToCorridor(); };

  // layer segmented control
  document.querySelectorAll("#layerseg button").forEach(b =>
    b.onclick = () => { state.layer = b.dataset.layer; clearStoryFlags(); syncLayerUI(); refreshAll(); });

  // sector select
  const ss = document.getElementById("sectorsel");
  // populated after gdpData loads in refresh (boot order safe: initHeader after data load)
  ss.innerHTML = Object.entries(gdpData.sectors).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  ss.value = state.gdpSector;
  ss.onchange = () => { state.gdpSector = ss.value; refreshMapOnly(); };

  // checkboxes
  const ck = (id, key) => { const el = document.getElementById(id); el.checked = state[key];
    el.onchange = () => { state[key] = el.checked; refreshMapOnly(); }; };
  ck("ck-stations", "showStations"); ck("ck-buffers", "showBuffers"); ck("ck-dim", "dimOthers");

  // slider + play
  const sl = document.getElementById("timeslider");
  sl.oninput = async () => {
    if (state.layer === "ntl") { state.t = +sl.value; await ensureQuarter(state.t); }
    else if (state.layer === "gdp") state.gdpYearIdx = +sl.value;
    else if (state.layer === "mida") state.midaYearIdx = +sl.value;
    else if (state.layer === "mhpi") state.mhpiYearIdx = +sl.value;
    refreshMapOnly(); updateTimeLabel(); writeHash();
  };
  document.getElementById("playbtn").onclick = togglePlay;

  // tabs
  document.querySelectorAll("#tabs button").forEach(b =>
    b.onclick = () => { state.tab = b.dataset.tab; syncTabs(); renderSide(); writeHash(); });
}

function setCorridor(p) {
  state.corridor = p;
  document.getElementById("corridorsel").value = p;
  clearStoryFlags();
  refreshAll();
}

function togglePlay() {
  const btn = document.getElementById("playbtn");
  if (playTimer) { clearInterval(playTimer); playTimer = null; btn.textContent = "▶"; return; }
  btn.textContent = "❚❚";
  const sl0 = document.getElementById("timeslider");
  if (+sl0.value >= +sl0.max) { sl0.value = 0; if (state.layer === "ntl") state.t = 0; }
  if (state.layer === "ntl") for (let k = 1; k <= 5; k++) if (state.t + k < meta.quarters.length) ensureQuarter(state.t + k);
  playTimer = setInterval(async () => {
    const sl = document.getElementById("timeslider");
    let v = +sl.value + 1;
    if (v > +sl.max) { togglePlay(); return; }   // stop at the end instead of looping
    sl.value = v;
    if (state.layer === "ntl") {
      state.t = v; await ensureQuarter(v);
      for (let k = 1; k <= 4; k++) if (v + k <= +sl.max) ensureQuarter(v + k); // prefetch ahead
      maybeOpeningFlag(v);
      maybeStoryFlag(v);
    }
    else if (state.layer === "gdp") state.gdpYearIdx = v;
    else if (state.layer === "mida") state.midaYearIdx = v;
    else if (state.layer === "mhpi") state.mhpiYearIdx = v;
    refreshMapOnly(); updateTimeLabel();
  }, 200);
}

/* Story flags for the intro autoplay — locations & radiance figures computed from the
   panel itself (3-km windows, 2012 avg vs 2023/24 avg); local context is public record. */
const STORY = {
  DASH: [
    { t: 18, lon: 101.51, lat: 3.155, ang: -133, title: "Elmina / Denai Alam", stat: "≈21 → ≈36 nW · ×1.7 brighter",
      text: "Oil-palm edge turning township: Sime Darby's <b>City of Elmina</b> build-out — wave after wave of new housing precincts, a 300-acre central park, and the <b>Elmina Lakeside Mall</b> (2023). The fastest-brightening spot on this corridor." },
    { t: 30, lon: 101.565, lat: 3.175, ang: -47, title: "Kwasa Damansara / Sungai Buloh", stat: "≈29 → ≈34 nW since 2012",
      text: "EPF's new township rising on former rubber-research land. <b>MRT 1's western terminus</b> opened here Dec 2016, joined by the Putrajaya Line in 2022 — a twin-line gateway pulling homes and shops around the depot." },
    { t: 41, lon: 101.47, lat: 3.10, ang: 47, title: "Puncak Perdana / Setia Alam", stat: "+12 nW since 2012",
      text: "DASH's western gateway: rapid U10/Setia Alam residential build-out anchored by <b>Setia City Mall</b> and its convention centre. Contrast: mature Kota Damansara to the east stays <b>flat</b> — new light tracks new development, not old money." },
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
              ang: (f.ang ?? -47) * Math.PI / 180, dist: f.dist ?? 150, pos: null };
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
  for (const L of liveFlags) {
    const pt = map.project(L.anchor);
    L.el.style.left = pt.x + "px"; L.el.style.top = pt.y + "px";
  }
}
function makeFlagDraggable(L) {
  const card = L.el.querySelector(".sf-card");
  card.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    card.setPointerCapture(e.pointerId);
    card.style.cursor = "grabbing";
    const sx = e.clientX - L.pos.x, sy = e.clientY - L.pos.y;
    const move = ev => { L.pos = { x: ev.clientX - sx, y: ev.clientY - sy }; layoutFlag(L); };
    const up = () => { card.style.cursor = "grab";
      card.removeEventListener("pointermove", move); card.removeEventListener("pointerup", up); };
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerup", up);
  });
}
function clearStoryFlags() {
  for (const L of liveFlags) L.el.remove();
  liveFlags.length = 0;
}

let flagTimeout = null;
function maybeOpeningFlag(t) {
  const opened = state.corridor === "all"
    ? meta.projects.filter(p => openIdxOf(p) === t)
    : (openIdxOf(state.corridor) === t ? [state.corridor] : []);
  if (!opened.length) return;
  const el = document.getElementById("openflag");
  el.innerHTML = `<span class="of-chip">OPENED</span><span>${opened.map(fname).join(" · ")} — ${qlabel(t)}</span>`;
  el.classList.remove("show"); void el.offsetWidth;  // restart animation
  el.classList.add("show");
  clearTimeout(flagTimeout);
  flagTimeout = setTimeout(() => el.classList.remove("show"), 2200);
}

function placeSliderFlag() {
  const f = document.getElementById("sliderflag");
  const oi = state.layer === "ntl" && state.corridor !== "all" ? openIdxOf(state.corridor) : -1;
  if (oi < 0) { f.style.display = "none"; return; }
  f.style.display = "";
  f.style.left = (oi / (meta.quarters.length - 1) * 100) + "%";
  f.title = fname(state.corridor) + " opens " + OPEN_LABEL(state.corridor);
}

function syncLayerUI() {
  document.querySelectorAll("#layerseg button").forEach(b => b.classList.toggle("active", b.dataset.layer === state.layer));
  document.getElementById("ntlopts").style.display = state.layer === "ntl" ? "" : "none";
  document.getElementById("gdpopts").style.display = state.layer === "gdp" ? "" : "none";
  document.getElementById("midabadge").style.display = state.layer === "mida" ? "" : "none";
  const tb = document.getElementById("timebar"), sl = document.getElementById("timeslider"),
        tm = document.getElementById("timemode");
  if (playTimer) togglePlay();
  if (state.layer === "ntl") { tb.style.display = ""; sl.max = meta.quarters.length - 1; sl.value = state.t; tm.textContent = "quarterly · 2012 Q1 – 2024 Q1"; }
  else if (state.layer === "gdp") { tb.style.display = ""; sl.max = gdpData.years.length - 1; sl.value = state.gdpYearIdx; tm.textContent = "annual · " + gdpData.years[0] + "–" + gdpData.years[gdpData.years.length-1]; }
  else if (state.layer === "mida") { tb.style.display = ""; sl.max = midaData.years.length - 1; sl.value = state.midaYearIdx; tm.textContent = "annual · " + midaData.years[0] + "–" + midaData.years[midaData.years.length-1]; }
  else if (state.layer === "mhpi") { tb.style.display = ""; sl.max = mhpiData.years.length - 1; sl.value = state.mhpiYearIdx; tm.textContent = "annual · " + mhpiData.years[0] + "–" + mhpiData.years[mhpiData.years.length-1]; }
  else tb.style.display = "none";
  const titles = { ntl: "🛰️ NASA Black Marble nighttime radiance — 1-km cells",
                   gdp: "🏭 District GDP, real (2015 prices) — OpenDOSM",
                   mida: "💰 Approved capital investment by state — MIDA / CEIC",
                   mhpi: "🏠 House price index (MHPI) — NAPIC, regions mapped to districts" };
  document.getElementById("layertitle").textContent = titles[state.layer];
  updateTimeLabel();
  placeSliderFlag();
  renderCorridorCard();
  renderLegend();
}

function updateTimeLabel() {
  const el = document.getElementById("timelabel");
  if (state.layer === "ntl") el.textContent = qlabel(state.t);
  else if (state.layer === "gdp") el.textContent = gdpData.years[state.gdpYearIdx];
  else if (state.layer === "mida") el.textContent = midaData.years[state.midaYearIdx];
  else if (state.layer === "mhpi") el.textContent = mhpiData.years[state.mhpiYearIdx];
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
  if (state.layer !== "ntl") { el.innerHTML = ""; return; }
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
  if (state.layer === "ntl") {
    const grad = "linear-gradient(90deg,#08061e,#280b54,#781c6d,#d94843,#fb9b35,#f7de6b,#ffffea)";
    lg.innerHTML = `<b style="color:#e7ecf5">Radiance (nW/cm²/sr)</b>
      <div class="bar" style="background:${grad}"></div>
      <div class="ticks"><span>0</span><span>1</span><span>5</span><span>20</span><span>75</span><span>150+</span></div>
      <div class="swatches">
        <div class="sw"><i style="background:#38bdf8"></i>completed corridor</div>
        <div class="sw"><i style="background:#fb923c"></i>under construction</div>
        <div class="sw"><i class="dot" style="border:2px solid #34d399"></i>station (intercity)</div>
        <div class="sw"><i class="dot" style="border:2px solid #e879f9"></i>station (Klang Valley)</div>
      </div>
      <div class="note">Log-scaled levels. Shown as levels (nW), not %, because percentage changes off near-dark rural cells are misleading.</div>`;
  } else if (state.layer === "gdp") {
    lg.innerHTML = `<b style="color:#e7ecf5">District GDP (RM mn, real)</b>
      <div class="bar" style="background:linear-gradient(90deg,#053022,#10a56c,#bef25a)"></div>
      <div class="ticks"><span>lowest</span><span>quantile rank</span><span>highest</span></div>
      <div class="note">OpenDOSM, supply side, 2015 prices, ${gdpData.years[0]}–${gdpData.years[gdpData.years.length-1]}. Colour = rank among districts that year, so contrasts stay visible. Descriptive — this study draws <b>no</b> NTL→GDP link.</div>
      ${districtGeo ? "" : `<div class="note" style="color:#fca5a5">${districtGeoFailed ? "Could not fetch DOSM boundaries (offline?)." : "Fetching district boundaries…"}</div>`}`;
  } else if (state.layer === "mida") {
    lg.innerHTML = `<b style="color:#e7ecf5">Approved investment (RM mn)</b>
      <div class="bar" style="background:linear-gradient(90deg,#78350f,#d97706,#fbbf24)"></div>
      <div class="ticks"><span>low</span><span>high (log scale)</span></div>
      <div class="note">MIDA approvals via CEIC. Lumpy and volatile; the corridor <b>effect is not identifiable</b> in this lens — levels only.</div>
      ${stateGeo ? "" : `<div class="note" style="color:#fca5a5">${stateGeoFailed ? "Could not fetch DOSM boundaries (offline?)." : "Fetching state boundaries…"}</div>`}`;
  } else {
    lg.innerHTML = `<b style="color:#e7ecf5">House prices (NAPIC MHPI, 2010=100)</b>
      <div class="bar" style="background:linear-gradient(90deg,#461c70,#a855f7,#f472b6)"></div>
      <div class="ticks"><span>${"low"}</span><span>index level</span><span>high</span></div>
      <div class="note"><b>Approximate boundaries:</b> NAPIC publishes MHPI by valuation region, not district. Regions are matched to districts by name (multi-district regions share one value; KL's three sub-areas are averaged over one polygon). Grey = no NAPIC coverage.</div>
      ${districtGeo ? "" : `<div class="note" style="color:#fca5a5">${districtGeoFailed ? "Could not fetch DOSM boundaries (offline?)." : "Fetching district boundaries…"}</div>`}`;
  }
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
  else if (state.tab === "results") renderResults(el);
  else if (state.tab === "construction") renderConstruction(el);
  else if (state.tab === "threelens") renderThreeLens(el);
  else renderAbout(el);
}

function mkChart(id, opt) {
  const dom = document.getElementById(id);
  if (!dom) return;
  const c = echarts.init(dom, null, { renderer: "canvas" });
  c.setOption(Object.assign({
    backgroundColor: "transparent",
    textStyle: { fontFamily: "system-ui,-apple-system,sans-serif" },
    animationDuration: 350,
  }, opt));
  charts[id] = c;
}
const AXIS = c => ({ axisLine: { lineStyle: { color: "#273248" } }, axisLabel: { color: "#8b97ad", fontSize: 9.5 },
                     splitLine: { lineStyle: { color: "#1a2338" } }, nameTextStyle: { color: "#8b97ad", fontSize: 9.5 }, ...c });
const TIP = { trigger: "axis", backgroundColor: "#0d1424", borderColor: "#273248",
              textStyle: { color: "#e7ecf5", fontSize: 11 } };

/* ---- Explore tab ---- */
function renderExplore(el) {
  if (state.layer === "mhpi") { renderMHPIPanel(el); return; }
  if (state.layer === "gdp") { renderGDPPanel(el); return; }
  if (state.layer === "mida") { renderMIDAPanel(el); return; }

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
    <div class="note-box"><b>How to read:</b> if the gap between near and far widens after the opening line, that is the raw pattern the DiD formalises. The causal estimates live in the <b>Results</b> tab — this chart alone is not an effect size.</div>`}
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
          if (sub) sub.innerHTML += ` <span style="color:#6b7a94">The 20–30 km control ring overlaps neighbouring corridors here, so the comparison uses the outermost available ring (${ob}).</span>`;
        }
      }
      mkChart("ch-nearfar", {
        tooltip: TIP,
        legend: { textStyle: { color: "#8b97ad", fontSize: 10 }, top: 0 },
        grid: { left: 44, right: 14, top: 28, bottom: 24 },
        xAxis: AXIS({ type: "category", data: tsNTL.quarters.map(q => q.replace("-", " ")) }),
        yAxis: AXIS({ type: "value", name: u === "ntl" ? "nW/cm²/sr" : "log radiance (s.a.)", scale: true }),
        series: [
          { name: "near (≤5 km)", type: "line", data: s.near[u], showSymbol: false, lineStyle: { width: 2.2, color: "#38bdf8" }, itemStyle: { color: "#38bdf8" },
            markLine: openIdx >= 0 ? { symbol: "none", label: { formatter: "opening", color: "#fbbf24", fontSize: 9 },
              lineStyle: { color: "#fbbf24", type: "dashed" }, data: [{ xAxis: openIdx }] } : undefined },
          ...(cmp ? [{ name: cmpLabel, type: "line", data: cmp[u], showSymbol: false, lineStyle: { width: 2.2, color: "#64748b" }, itemStyle: { color: "#64748b" } }] : []),
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
      lineStyle: { width: 2, color: "#fbbf24" }, itemStyle: { color: "#fbbf24" },
      areaStyle: { color: "rgba(251,191,36,.08)" },
      markLine: openIdx >= 0 ? { symbol: "none", label: { formatter: "opening", color: "#fbbf24", fontSize: 9 },
        lineStyle: { color: "#fbbf24", type: "dashed" }, data: [{ xAxis: openIdx }] } : undefined }],
  });
}

/* ---- GDP / MIDA / MHPI explore panels ---- */
function renderGDPPanel(el) {
  const year = gdpData.years[state.gdpYearIdx];
  el.innerHTML = `
    <div class="panel-h">District GDP — ${gdpData.sectors[state.gdpSector]} <span class="badge desc">DESCRIPTIVE</span></div>
    <div class="panel-sub">OpenDOSM, real (2015 prices), supply side, ${gdpData.years[0]}–${gdpData.years[gdpData.years.length-1]}. Hover districts on the map; use the slider for years.</div>
    <div class="note-box"><b>Honesty rule:</b> this study deliberately does <b>not</b> estimate an NTL→GDP elasticity — a district-GDP test was cut as unreliable. This layer is context, not an outcome lens of the corridor design. Nightlights measure the <b>spatial footprint</b> of activity, not output value.</div>
    <div class="panel-h" style="margin-top:8px">Top 12 districts · ${year}</div>
    <div id="ch-gdp" class="chart tall"></div>`;
  const rows = Object.entries(gdpData.data)
    .map(([k, sec]) => [k.split("|")[1] + " (" + k.split("|")[0] + ")", sec[state.gdpSector]?.[year]])
    .filter(r => r[1] != null).sort((a, b) => b[1] - a[1]).slice(0, 12).reverse();
  mkChart("ch-gdp", {
    tooltip: { ...TIP, trigger: "item", formatter: d => `${d.name}<br/>RM ${fmtNum(d.value)} mn` },
    grid: { left: 4, right: 40, top: 6, bottom: 22, containLabel: true },
    xAxis: AXIS({ type: "value", name: "RM mn" }),
    yAxis: AXIS({ type: "category", data: rows.map(r => r[0]), axisLabel: { color: "#8b97ad", fontSize: 9 } }),
    series: [{ type: "bar", data: rows.map(r => r[1]), itemStyle: { color: "#2a9d8f", borderRadius: [0, 3, 3, 0] } }],
  });
}

function renderMIDAPanel(el) {
  const sel = state.corridor;
  el.innerHTML = `
    <div class="panel-h">Approved investment by state <span class="badge warn">NOT IDENTIFIABLE</span></div>
    <div class="panel-sub">MIDA approvals (CEIC), RM mn, annual ${midaData.years[0]}–${midaData.years[midaData.years.length-1]}. The sharpest methodological lesson of the study lives here.</div>
    <div id="ch-mida" class="chart tall"></div>
    <div class="note-box"><b>Why “not identifiable”:</b> naïve TWFE says +66% (p=0.003) — but pre-trends fail and Callaway–Sant'Anna is null (+15.5%, p=0.67). The estimator choice decides the answer, so the honest verdict is a <b>non-result</b>. This layer shows levels only.</div>`;
  const years = midaData.years;
  const series = Object.entries(midaData.states)
    .filter(([s]) => s !== "Other")
    .map(([s, v]) => ({ name: s, type: "line", data: v, showSymbol: false,
      lineStyle: { width: 1.4 }, emphasis: { focus: "series" } }));
  mkChart("ch-mida", {
    tooltip: { ...TIP, confine: true, formatter: pts => `<b>${pts[0].axisValue}</b><br/>` +
      pts.sort((a,b) => (b.value??0)-(a.value??0)).slice(0, 8).map(p => `${p.marker}${p.seriesName}: RM ${p.value != null ? fmtNum(p.value) : "–"} mn`).join("<br/>") },
    legend: { type: "scroll", textStyle: { color: "#8b97ad", fontSize: 9 }, top: 0 },
    grid: { left: 46, right: 14, top: 44, bottom: 24 },
    xAxis: AXIS({ type: "category", data: years }),
    yAxis: AXIS({ type: "value", name: "RM mn" }),
    series,
  });
}

function renderMHPIPanel(el) {
  const years = mhpiData.years;
  const regions = Object.entries(mhpiData.regions);
  const sel = state.corridor;
  const matches = regions.filter(([, r]) => r.project && r.project !== "none" &&
    (sel === "all" || projectMatch(r.project, sel)));
  const show = matches.length ? matches : regions.filter(([, r]) => r.treated).slice(0, 6);
  el.innerHTML = `
    <div class="panel-h">House prices — NAPIC MHPI <span class="badge desc">DESCRIPTIVE</span></div>
    <div class="panel-sub">Index (2010=100), annual, 27 regions. ${sel === "all" ? "Showing all treated regions" : "Regions mapped to " + fname(sel)}${matches.length ? "" : " (none mapped — showing treated regions)"}. The causal MHPI estimate (~+10% build-up) is in <b>Results</b>.</div>
    <div id="ch-mhpi" class="chart tall"></div>
    <div class="note-box">House prices are the lens that carries the <b>magnitude</b> in this study: capitalisation of access into property values, building to ≈ +10% (robust across estimators). NTL carries the <b>geography</b>.</div>
    <table class="mhpi-regions">${show.slice(0, 10).map(([k, r]) =>
      `<tr><td>${k.split("|")[1]}</td><td>${k.split("|")[0]}</td><td>${r.project !== "none" ? r.project : ""}</td><td>${r.operational ? "op. " + r.operational : ""}</td></tr>`).join("")}</table>`;
  const palette = ["#38bdf8","#fbbf24","#34d399","#e879f9","#f87171","#a3e635","#fb923c","#818cf8","#2dd4bf","#f472b6"];
  const series = show.slice(0, 10).map(([k, r], i) => ({
    name: k.split("|")[1], type: "line", data: r.mhpi, showSymbol: false,
    lineStyle: { width: 1.8, color: palette[i % palette.length] }, itemStyle: { color: palette[i % palette.length] },
    markLine: r.operational ? { symbol: "none", label: { show: false }, lineStyle: { color: palette[i % palette.length], type: "dotted", opacity: .5 },
      data: [{ xAxis: years.indexOf(r.operational) }] } : undefined,
  }));
  mkChart("ch-mhpi", {
    tooltip: { ...TIP, confine: true },
    legend: { type: "scroll", textStyle: { color: "#8b97ad", fontSize: 9 }, top: 0 },
    grid: { left: 40, right: 14, top: 44, bottom: 24 },
    xAxis: AXIS({ type: "category", data: years }),
    yAxis: AXIS({ type: "value", name: "MHPI", scale: true }),
    series,
  });
}
function projectMatch(mhpiProj, corridor) {
  const a = String(mhpiProj).toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = corridor.toLowerCase().replace(/[^a-z0-9]/g, "");
  return a.includes(b) || b.includes(a);
}

/* ---- Results tab ---- */
function renderResults(el) {
  const m = results.matrix;
  const groups = { NTL: [], MHPI: [], MIDA: [] };
  for (const r of m) {
    const key = r.outcome.toUpperCase().includes("NTL") ? "NTL" : r.outcome.toUpperCase().includes("MHPI") || r.outcome.toUpperCase().includes("HOUSE") ? "MHPI" : "MIDA";
    groups[key].push(r);
  }
  const head = { NTL: ["🛰️ Nightlights (1-km cells)", "robust", "ROBUST (10% level)"],
                 MHPI: ["🏠 House prices (MHPI)", "robust", "ROBUST (~+10%)"],
                 MIDA: ["💰 Investment (MIDA)", "notid", "NOT IDENTIFIABLE"] };
  el.innerHTML = `
    <div class="panel-h">The 3×2 matrix <span class="badge causal">CAUSAL ESTIMATES</span></div>
    <div class="panel-sub">Three outcome lenses × modern DiD estimators. Staggered openings, 2012–2024; controls are 20–30 km rings and not-yet-treated corridors. Numbers are final (see paper).</div>
    ${Object.entries(groups).map(([k, rows]) => `
      <div class="card">
        <h3>${head[k][0]} <span class="vchip ${head[k][1]}">${head[k][2]}</span></h3>
        ${rows.map(r => `<div class="row">
          <span class="k">${r.estimator}${r.unit_n ? ` <span style="opacity:.55">· ${r.unit_n}</span>` : ""}</span>
          <span class="v">${fmtEst(r)} <span style="color:#8b97ad;font-weight:400">${fmtP(r.p_value)}</span></span>
        </div>`).join("")}
      </div>`).join("")}
    <div class="panel-h" style="margin-top:4px">Which way does naïve TWFE lie?</div>
    <div class="card">${results.bias.map(b => `<div class="row">
        <span class="k">${b.outcome}</span><span class="v" style="color:${/down/i.test(b.twfe_bias) ? "#7dd3fc" : /up/i.test(b.twfe_bias) ? "#fca5a5" : "#e7ecf5"}">${b.twfe_bias}</span>
      </div>`).join("")}
      <div class="muted-s" style="margin-top:7px">Same data, three different bias directions — the study's core methodological point: estimator choice is not a technicality.</div>
    </div>
    <div class="note-box"><b>Honest caveats:</b> NTL is significant at the <b>10%</b> level (C–S p=0.095 at the 49-station level; cell-level TWFE +0.92 nW p=0.002; imputation band +1.6–2.7 nW). At corridor-level clustering (4 clusters) it is underpowered (p≈0.27). The NTL effect <b>strengthens</b> when the Klang Valley is dropped (intercity-only +4.1%, p=0.043). MHPI builds gradually to ≈+10%. MIDA's TWFE +66% fails pre-trends — reported as a non-result.</div>`;
}
const fmtP = p => {
  if (p == null || p === "") return "";
  const n = parseFloat(p);
  if (!isNaN(n) && n === 0) return "p<0.001";
  return "p=" + p;
};
const fmtEst = r => {
  if (r.estimate == null) return r.note || "—";
  const sign = r.estimate > 0 ? "+" : "";
  return `${sign}${r.estimate}${r.estimate_unit === "pct" || r.estimate_unit === "%" ? "%" : " " + (r.estimate_unit || "")}`;
};

/* ---- Construction tab ---- */
function renderConstruction(el) {
  el.innerHTML = `
    <div class="panel-h">Construction tracker <span class="badge desc">DESCRIPTIVE</span></div>
    <div class="panel-sub">Indexed corridor radiance (2013 = 100) for the three corridors still under construction, against a completed reference. Predictions, not estimates.</div>
    <div id="ch-cons" class="chart tall"></div>
    <div class="note-box"><b>The construction signal:</b> low-baseline corridors under construction are flat-to-declining (Pan Borneo Sabah most visibly) — corridors through dark terrain do not light up by anticipation. The paper's readiness argument: complementary investment matters before rail arrives.</div>`;
  const byC = {};
  for (const r of results.construction) (byC[r.corridor] = byC[r.corridor] || { status: r.status, pts: [] }).pts.push([r.year, r.ntl_index_2013_eq_100]);
  const colors = { ECRL: "#fb923c", PanBorneoSabah: "#f87171", PanBorneoSarawak: "#e879f9" };
  const series = Object.entries(byC).map(([c, o]) => ({
    name: fname(c) + (o.status && /complete/i.test(o.status) ? " (completed ref.)" : ""),
    type: "line", data: o.pts.sort((a, b) => a[0] - b[0]).map(p => p[1]), showSymbol: false,
    lineStyle: { width: 2, color: colors[c] || "#34d399", type: /complete/i.test(o.status || "") ? "dashed" : "solid" },
    itemStyle: { color: colors[c] || "#34d399" },
  }));
  const years = [...new Set(results.construction.map(r => r.year))].sort();
  mkChart("ch-cons", {
    tooltip: TIP, legend: { textStyle: { color: "#8b97ad", fontSize: 9.5 }, top: 0 },
    grid: { left: 40, right: 14, top: 46, bottom: 24 },
    xAxis: AXIS({ type: "category", data: years }),
    yAxis: AXIS({ type: "value", name: "index (2013=100)", scale: true }),
    series,
  });
}

/* ---- Three lenses tab ---- */
function renderThreeLens(el) {
  const tl = results.three_lens_timeline;
  const projs = [...new Set(tl.map(r => r.project))];
  const cur = projs.includes(state.corridor) ? state.corridor : projs[0];
  el.innerHTML = `
    <div class="panel-h">Three lenses, one corridor <span class="badge desc">DESCRIPTIVE</span></div>
    <div class="panel-sub">Investment approvals → lights → house prices around the opening (dashed line) for one corridor at a time.</div>
    <div class="controls-row"><select id="tlsel">${projs.map(p => `<option value="${p}" ${p === cur ? "selected" : ""}>${fname(p)}</option>`).join("")}</select></div>
    <div id="tl-charts"></div>
    <div class="note-box">Investment is approved <b>before</b> openings (and is lumpy), lights respond <b>at</b> opening, prices build <b>after</b> — three clocks, one corridor. Magnitudes here are raw series, not effects.</div>`;
  document.getElementById("tlsel").onchange = e => { state.corridor = e.target.value;
    document.getElementById("corridorsel").value = state.corridor; renderSide(); refreshMapOnly(); };
  drawThreeLens(cur);
}
function drawThreeLens(proj) {
  const tl = results.three_lens_timeline.filter(r => r.project === proj);
  const measures = [...new Set(tl.map(r => r.measure))];
  const wrap = document.getElementById("tl-charts");
  wrap.innerHTML = measures.map((m, i) => `<div class="muted-s" style="margin:2px 0 1px">${m}</div><div id="tlc${i}" class="chart short"></div>`).join("");
  const colors = ["#fbbf24", "#38bdf8", "#34d399"];
  measures.forEach((m, i) => {
    const rows = tl.filter(r => r.measure === m).sort((a, b) => a.year - b.year);
    const open = rows.find(r => r.opening != null && r.opening !== 0);
    const openYear = open ? (open.opening === 1 ? open.year : open.opening) : meta.openings[proj];
    const years = rows.map(r => r.year);
    mkChart(`tlc${i}`, {
      tooltip: TIP, grid: { left: 44, right: 12, top: 8, bottom: 20 },
      xAxis: AXIS({ type: "category", data: years }),
      yAxis: AXIS({ type: "value", scale: true }),
      series: [{ type: "line", data: rows.map(r => r.value), showSymbol: false,
        lineStyle: { width: 2, color: colors[i % 3] }, itemStyle: { color: colors[i % 3] },
        areaStyle: { color: colors[i % 3] + "14" },
        markLine: openYear && years.includes(openYear) ? { symbol: "none", label: { show: false },
          lineStyle: { color: "#fbbf24", type: "dashed" }, data: [{ xAxis: years.indexOf(openYear) }] } : undefined }],
    });
  });
}

/* ---- Guide tab ---- */
function renderGuide(el) {
  const steps = [
    ["The question",
     "Malaysia spent billions on rail lines, bridges and expressways. Did the places they touch actually become more economically active — or would they have grown anyway?",
     null],
    ["The measurement problem",
     "GDP doesn't exist at the level of a town or a 1-km square. So we use <b>satellite nightlights</b> — NASA's Black Marble radiance — as the spatial footprint of economic activity. Brighter ≠ richer in ringgit, but more light tracks more buildings, traffic and commerce.",
     null],
    ["The grid",
     "We cut the country into <b>186,103 one-km cells</b> and measure each one's brightness every quarter from 2012 to 2024. Every cell is tagged with its nearest corridor and its distance to the route.",
     "Try: hover any lit cell on the map"],
    ["The comparison",
     "Cells <b>≤ 5 km</b> from a corridor are 'near'; the <b>20–30 km</b> ring is 'far'. If the corridor matters, near should pull away from far <b>after</b> the opening — and not before. That before/after, near/far contrast is a <b>difference-in-differences</b>. Corridors opened in different years, which breaks naïve regressions, so we use modern estimators (Callaway–Sant'Anna, imputation) alongside the classic TWFE.",
     "Try: press ▶ and watch the 🚩 opening flag"],
    ["Three lenses",
     "Lights are one lens. We repeat the same design on <b>house prices</b> (NAPIC's index — where benefits get capitalised) and <b>approved investment</b> (MIDA — where money is committed). Three datasets, one identification strategy.",
     "Try: the toggle buttons in the top bar"],
    ["The verdict",
     "Lights: a real, persistent effect (+0.9–2.7 nW, 10% significance). Prices: builds to ≈ +10%, robust. Investment: the estimators disagree so sharply the only honest answer is 'not identifiable'. That disagreement is itself the methodological headline.",
     "Try: the Results tab"],
    ["Drive it yourself",
     "Pick a corridor from the amber dropdown · scrub or play the quarter slider · double-click a route to zoom · click any cell for its 12-year history · hover stations for details · switch layers for GDP, investment and prices.",
     null],
  ];
  el.innerHTML = `
    <div class="panel-h">What is this dashboard doing?</div>
    <div class="panel-sub">Seven steps from question to verdict.</div>
    ${steps.map(([h, p, t], i) => `
      <div class="gstep"><div class="gnum">${i + 1}</div>
        <div><h4>${h}</h4><p>${p}</p>${t ? `<span class="try">💡 ${t}</span>` : ""}</div>
      </div>`).join("")}
    <div class="note-box"><b>One rule everywhere:</b> maps and time series are descriptive. The causal numbers — and their caveats — live in the Results tab only.</div>`;
}

/* ---- About tab ---- */
function renderAbout(el) {
  el.innerHTML = `<div class="about">
    <div class="panel-h">About this dashboard</div>
    <p>Companion explorer for <i>“Three Lenses, One Corridor”</i> — a study measuring how Malaysia's
    transport corridors changed local economic activity, using a staggered difference-in-differences design
    over 2012–2024 with three outcome lenses: satellite nightlights, house prices and approved investment.</p>
    <h3>Design in one paragraph</h3>
    <p>Each 1-km cell is assigned to its nearest corridor. <b>Treated</b> cells sit within the mode's catchment
    (500 m urban rail / 3 km urban highway / 5 km intercity); <b>controls</b> are the 20–30 km outer ring and
    not-yet-opened corridors. Estimators: TWFE, Callaway–Sant'Anna, and DiD imputation. Identification leans
    on the spatially clean intercity corridors; Klang Valley urban corridors carry contamination caveats.</p>
    <h3>Honesty rules baked into this UI</h3>
    <ul>
      <li>Maps and time series are <b>descriptive</b>; causal numbers live only in Results.</li>
      <li>NTL ≠ GDP: lights are the <b>spatial footprint</b> of activity, never given a ringgit value, and no NTL→GDP elasticity is shown anywhere.</li>
      <li>Radiance is displayed in <b>levels</b> (nW/cm²/sr) — % changes off dark rural baselines mislead.</li>
      <li>NTL significance is stated at the <b>10% level</b>; the C–S +2.42 nW figure is the 49-station estimate, not cell-level.</li>
      <li>MIDA is labelled <b>not identifiable</b> — its TWFE +66% fails pre-trends and is reported as a non-result.</li>
    </ul>
    <h3>Data &amp; credits</h3>
    <ul>
      <li><b>Nightlights:</b> NASA Black Marble (VNP46A3), 1-km, calendar-quarter aggregates, 2012Q1–2024Q1, 186,103 cells.</li>
      <li><b>House prices:</b> NAPIC Malaysian House Price Index, 27 regions, annual.</li>
      <li><b>District GDP:</b> OpenDOSM (real, 2015 prices, supply side), 2015–2020. Boundaries: DOSM geodata.</li>
      <li><b>Investment:</b> MIDA approved capital investment via CEIC, by state, annual.</li>
      <li><b>Basemap:</b> © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.</li>
    </ul>
    <p class="muted-s">Static site — all analysis precomputed; no tracking, no backend. Map cells are loaded one quarter at a time (~370 KB each).</p>
  </div>`;
}

/* ============================ url hash =========================== */
function writeHash() {
  const h = `l=${state.layer}&c=${state.corridor}&t=${state.t}&tab=${state.tab}`;
  history.replaceState(null, "", "#" + h);
}
function parseHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("l") && ["ntl","gdp","mida","mhpi"].includes(h.get("l"))) state.layer = h.get("l");
  if (h.get("c") && (h.get("c") === "all" || meta.projects.includes(h.get("c")))) state.corridor = h.get("c");
  if (h.get("t") != null) { const t = +h.get("t"); if (t >= 0 && t < meta.quarters.length) state.t = t; }
  if (h.get("tab")) state.tab = h.get("tab");
}

boot().catch(err => {
  document.getElementById("loadertext").textContent = "Failed to load: " + err.message;
  console.error(err);
});
