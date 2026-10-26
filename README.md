# Energy2035 · Swiss Price Forward Curve explorer

A light React app (Vite) that shows how nuclear, hydro, solar PV, decentralised flexibility and a changing climate shape the **hourly** Swiss spot price curve and the resulting **Price Forward Curve (PFC)**.

Live: https://tomkaXX.github.io/Energy2035

## What's inside

- **Generation map**: a Switzerland map (cantons and lakes, swisstopo/FSO geodata via [`swiss-maps`](https://github.com/interactivethings/swiss-maps)) with the main nuclear and hydro plants. Circle area shows capacity, and a ring shows climate stress for the selected year and scenario.
- **Weather and climate drivers**: days with the Aare above 25 °C (Beznau curtailment), hot days, summer dry spells, summer precipitation, winter runoff, glacier volume and heating degree days. Each driver has two climate scenarios and three time horizons.
- **Hourly PFC model**: residual load (demand − nuclear − run-of-river − PV), blended with a stylised EU signal, flattened by pumped storage and decentralised flexibility, then mapped through a convex merit order. The result is calibrated so the annual average equals the base forward level.
- **Outputs**: KPIs (base, peak, solar hours, PV capture rate, daily spread, negative hours), a month × hour heatmap, a weekday profile compared with 2026, a one-week hourly view, and a CSV download of all 8,760 hours.

> The plant and climate figures are rounded and only indicative. For real analysis, replace them with BFE WASTA (hydro plants), ENSI/operator data (nuclear) and MeteoSwiss CH2025 scenario data. The model is for learning, not a forecast.

## Structure

```
public/ch.json            Simplified TopoJSON (country, cantons, lakes)
src/data/plants.js        Nuclear & hydro plants (edit here)
src/data/climate.js       Climate indicators per scenario/horizon (edit here)
src/model/pfc.js          Hourly PFC shape model
src/components/SwissMap.jsx
src/components/Charts.jsx Line chart, heatmap, mini bars (plain SVG)
src/App.jsx               Layout, controls, KPIs
```

## Run locally

```bash
npm install
npm run dev
```

## Deploy to GitHub Pages

**Automatic (recommended):** `.github/workflows/deploy.yml` builds and publishes the site on every push to `main` (it can also be started by hand from the Actions tab → *Deploy to GitHub Pages* → *Run workflow*).
One-time setup: **GitHub → Settings → Pages → Build and deployment → Source: GitHub Actions**.

**Manual alternative** (as in [gitname/react-gh-pages](https://github.com/gitname/react-gh-pages), with Vite instead of create-react-app): `npm run deploy` pushes `dist/` to the `gh-pages` branch; then set Pages source to *Deploy from a branch* → `gh-pages` / `(root)`.

`vite.config.js` sets `base: '/Energy2035/'` so asset paths work on the project site https://tomkaXX.github.io/Energy2035/.
