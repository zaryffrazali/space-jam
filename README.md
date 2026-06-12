# Three Lenses, One Corridor — Interactive Dashboard

Companion explorer for the study *"Three Lenses, One Corridor"*: how Malaysia's transport
corridors changed local economic activity, measured with a staggered difference-in-differences
design over 2012–2024.

**Live site:** https://zaryffrazali.github.io/space-jam/

## What's inside

- **🛰️ Nightlights** — NASA Black Marble radiance, 186,103 one-km cells, quarterly 2012Q1–2024Q1.
  Quarter slider with playback, corridor zoom, station markers, near/far time series, per-cell
  drill-down (HTTP range requests against per-quarter binaries).
- **🏭 District GDP** — OpenDOSM real GDP by district (2015–2020), choropleth. *Context layer only;
  the study deliberately estimates no NTL→GDP elasticity.*
- **💰 Investment** — MIDA approved capital investment by state (CEIC), 2000–2025. Labelled
  **not identifiable** — the corridor effect fails pre-trends; levels only.
- **🏠 House prices** — NAPIC MHPI, 27 regions, annual, with corridor mapping.
- **Results** — the 3×2 outcome × estimator matrix with honest verdicts and TWFE bias directions.

## Architecture

Fully static — no backend, no build step. Open `index.html` over any static server.

```
index.html / style.css / app.js   the app (vanilla JS)
lib/                              vendored MapLibre GL 5.24, deck.gl 9.3, ECharts 6.1
data/meta.json                    bbox, quarter list, corridors, opening years
data/cells.bin                    per-cell quantized lon/lat + corridor/distance/band/urban
data/ntl/q_<t>.bin                uint16 radiance×64 per quarter (~370 KB each, lazy-loaded)
data/ts_ntl.json                  corridor × distance-band × quarter aggregates
data/{gdp,mhpi,mida,stations,results}.json
data/{routes,buffers}.geojson
```

District/state boundary polygons are fetched at runtime from
[DOSM's open geodata](https://github.com/dosm-malaysia/data-open) (CORS-open).

## Honesty rules (enforced in the UI)

Maps and time series are descriptive; causal estimates appear only in Results. NTL ≠ GDP.
Radiance shown in levels (nW/cm²/sr), not %, because dark rural baselines mislead.
NTL significance stated at the 10% level; the Callaway–Sant'Anna +2.42 nW figure is the
49-station estimate. MIDA is reported as a non-result.

## Credits

NASA Black Marble (VNP46A3) · NAPIC · OpenDOSM/DOSM · MIDA via CEIC ·
Basemap © CARTO, © OpenStreetMap contributors.
