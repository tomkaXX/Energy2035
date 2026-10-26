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

This follows [gitname/react-gh-pages](https://github.com/gitname/react-gh-pages), with Vite instead of the deprecated create-react-app:

- `package.json` has `"homepage": "https://tomkaXX.github.io/Energy2035"` and the `predeploy`/`deploy` scripts (`gh-pages -d dist`, because Vite builds to `dist/` rather than `build/`).
- `vite.config.js` sets `base: '/Energy2035/'` so asset paths work on the project site.

```bash
npm run deploy
```

Then, in **GitHub → Settings → Pages**, set the source to **Deploy from a branch** with branch `gh-pages` and folder `/ (root)`.
