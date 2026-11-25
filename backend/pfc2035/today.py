"""Today's hourly Swiss price: model vs. actual day-ahead price.

    python -m pfc2035 today                 # today (Swiss time)
    python -m pfc2035 today --date 2026-11-25

Model inputs for the day
  * ENTSO-E day-ahead forecasts (load CH/DE/FR/IT, wind & solar CH/DE/FR/IT) when the API token works;
    nuclear and run-of-river are taken from the last 2 days of actual generation (they change slowly).
  * Fallback without ENTSO-E: the fundamentals of the latest same weekday in the hourly dataset
    ("analog day"), with today's calendar, gas/CO₂ and reservoir filling.
Actual price
  * ENTSO-E day-ahead price for CH (the source behind euenergy.live), averaged to hours;
  * or data/csv/actual_prices/ch_dayahead_<date>.csv (columns hour, eur_mwh or chf_mwh) saved by hand.
CHF conversion: export.today_fx_eur_chf in settings.yaml (or --fx). Prices exclude grid fees, levies and VAT.
Writes outputs/today.json and copies it to the React app (public/pfc2035/today.json).
"""
from __future__ import annotations

import json
import shutil

import numpy as np
import pandas as pd

from .config import HOURLY_PARQUET, ROOT, WORK, entsoe_key, load_settings, resolve
from .features import build_features
from .model import PriceModel

TZ = "Europe/Zurich"
ACTUAL_DIR = ROOT / "data" / "csv" / "actual_prices"


def _day_index(day: pd.Timestamp) -> pd.DatetimeIndex:
    s0 = pd.Timestamp(day.date(), tz=TZ)
    return pd.date_range(s0, s0 + pd.Timedelta(days=1), freq="1h", inclusive="left").tz_convert("UTC")


def _hourly(x: pd.Series, idx: pd.DatetimeIndex) -> pd.Series:
    x = x.tz_convert("UTC").resample("1h").mean()
    return x.reindex(idx)


def _entsoe_frame(day: pd.Timestamp, idx: pd.DatetimeIndex) -> tuple[pd.DataFrame, pd.Series | None]:
    from entsoe import EntsoePandasClient

    c = EntsoePandasClient(api_key=entsoe_key())
    s0, s1 = pd.Timestamp(day.date(), tz=TZ), pd.Timestamp(day.date(), tz=TZ) + pd.Timedelta(days=1)
    f = pd.DataFrame(index=idx)
    for k, area in {"ch": "CH", "de": "DE_LU", "fr": "FR", "it": "IT"}.items():
        lf = c.query_load_forecast(area, start=s0, end=s1)
        f[f"{k}_load"] = _hourly(lf.iloc[:, 0] if isinstance(lf, pd.DataFrame) else lf, idx).values / 1000.0
        ws = c.query_wind_and_solar_forecast(area, start=s0, end=s1, psr_type=None)
        f[f"{k}_solar"] = _hourly(ws["Solar"], idx).values / 1000.0 if "Solar" in ws else 0.0
        wind = sum(ws[col] for col in ws.columns if str(col).startswith("Wind")) if any(str(x).startswith("Wind") for x in ws.columns) else None
        f[f"{k}_wind"] = _hourly(wind, idx).values / 1000.0 if wind is not None else 0.0
    # slow-moving plants: mean of the last 2 days of actual generation
    for k, area, cols in [("ch", "CH", {"Nuclear": "ch_nuclear", "Hydro Run-of-river and poundage": "ch_ror"}),
                          ("fr", "FR", {"Nuclear": "fr_nuclear"})]:
        g = c.query_generation(area, start=s0 - pd.Timedelta(days=2), end=s0, psr_type=None)
        if isinstance(g.columns, pd.MultiIndex):
            g.columns = [" | ".join(map(str, x)) for x in g.columns]
        for name, col in cols.items():
            m = [x for x in g.columns if str(x).startswith(name) and "Consumption" not in str(x)]
            f[col] = float(g[m].sum(axis=1).mean()) / 1000.0 if m else np.nan
    try:
        p = c.query_day_ahead_prices("CH", start=s0, end=s1)
        actual = _hourly(p, idx)
    except Exception:  # noqa: BLE001
        actual = None
    return f, actual


def _analog_frame(hist: pd.DataFrame, day: pd.Timestamp, idx: pd.DatetimeIndex) -> tuple[pd.DataFrame, str]:
    """Fundamentals of the latest same weekday in the dataset, moved to `day`."""
    loc = hist.index.tz_convert(TZ)
    cand = sorted({d for d in loc.date if pd.Timestamp(d).dayofweek == day.dayofweek and pd.Timestamp(d) < pd.Timestamp(day.date())})
    for d in reversed(cand):
        part = hist[loc.date == d]
        if len(part) >= 23:
            break
    part = part.copy()
    part = part.iloc[: len(idx)]
    part.index = idx[: len(part)]
    return part.reindex(idx).ffill().bfill(), str(d)


def _actual_from_csv(day: pd.Timestamp, idx: pd.DatetimeIndex, fx: float) -> pd.Series | None:
    f = ACTUAL_DIR / f"ch_dayahead_{day:%Y-%m-%d}.csv"
    if not f.exists():
        return None
    d = pd.read_csv(f)
    eur = d["eur_mwh"] if "eur_mwh" in d else d["chf_mwh"] / fx
    return pd.Series(eur.values[: len(idx)], index=idx[: len(eur)]).reindex(idx)


def run(date: str | None = None, fx: float | None = None) -> dict:
    st = load_settings()
    fx = float(fx or st.get("export", {}).get("today_fx_eur_chf", 0.9223))
    day = pd.Timestamp(date) if date else pd.Timestamp.now(tz=TZ).tz_localize(None).normalize()
    idx = _day_index(day)
    hist = pd.read_parquet(HOURLY_PARQUET)

    actual, source, note = None, "", ""
    frame = None
    if entsoe_key():
        try:
            frame, actual = _entsoe_frame(day, idx)
            source = "ENTSO-E day-ahead forecasts (load, wind, solar) + last 2 days of nuclear/run-of-river"
        except Exception as e:  # noqa: BLE001
            note = f"ENTSO-E not reachable ({type(e).__name__}); using analog day. "
            frame = None
    if frame is None:
        frame, d = _analog_frame(hist, day, idx)
        source = f"analog day {d} from the hourly dataset (no forecasts available)"
        frame = frame.drop(columns=["price_ch"], errors="ignore")

    # PV: same official-level correction as in training
    if "ch_solar_entsoe" in hist and frame is not None and "ch_solar" in frame and source.startswith("ENTSO-E"):
        from .data import pv
        fac = pv.correction_factors(hist)["factors"]
        frame["ch_solar"] = frame["ch_solar"] * fac.get(day.year, fac[max(fac)])
    # fuel and reservoir for the day
    from .data import fuel, reservoir
    fh = fuel.hourly(idx)
    if fh is not None:
        frame["gas_eur_mwh"], frame["co2_eur_t"] = fh["gas_eur_mwh"].values, fh["co2_eur_t"].values
    if reservoir.COL in hist:
        from .data.build import _reservoir_weekly
        weekly, _ = _reservoir_weekly(str(day.date()), str((day + pd.Timedelta(days=1)).date()))
        if weekly is not None:
            frame[reservoir.COL] = reservoir.to_hourly(weekly, idx).values
            frame = reservoir.add_anomaly(frame, reservoir.climatology(hist))

    X = build_features(frame)
    model = PriceModel.load(with_quantiles=True)
    pred = model.predict_frame(X)

    if actual is None or actual.isna().all():
        actual = _actual_from_csv(day, idx, fx)
        if actual is not None:
            note += f"Actual prices from {ACTUAL_DIR.name}/ch_dayahead_{day:%Y-%m-%d}.csv. "

    rows = []
    for i, t in enumerate(idx):
        m = float(pred["price"].iloc[i])
        a = None if actual is None or pd.isna(actual.iloc[i]) else float(actual.iloc[i])
        rows.append({
            "hour": t.tz_convert(TZ).strftime("%H:%M"),
            "model_eur_mwh": round(m, 2), "actual_eur_mwh": None if a is None else round(a, 2),
            "model_chf_kwh": round(m * fx / 1000, 4), "actual_chf_kwh": None if a is None else round(a * fx / 1000, 4),
            "p10_chf_kwh": round(float(pred["q10"].iloc[i]) * fx / 1000, 4) if "q10" in pred else None,
            "p90_chf_kwh": round(float(pred["q90"].iloc[i]) * fx / 1000, 4) if "q90" in pred else None,
            "error_pct": None if not a else round((m / a - 1) * 100, 1),
        })
    ok = [r for r in rows if r["actual_eur_mwh"] is not None]
    summ = {}
    if ok:
        e = np.array([r["model_eur_mwh"] - r["actual_eur_mwh"] for r in ok])
        summ = {"mae_eur_mwh": round(float(np.abs(e).mean()), 1),
                "mape_pct": round(float(np.mean([abs(r["error_pct"]) for r in ok if r["error_pct"] is not None])), 1),
                "avg_model_chf_kwh": round(float(np.mean([r["model_chf_kwh"] for r in ok])), 4),
                "avg_actual_chf_kwh": round(float(np.mean([r["actual_chf_kwh"] for r in ok])), 4)}
    out = {"date": str(day.date()), "fx_eur_chf": fx, "model_inputs": source, "note": note.strip(),
           "actual_source": "ENTSO-E day-ahead CH (as on euenergy.live), excluding grid fees, levies and VAT",
           "gas_eur_mwh": round(float(frame["gas_eur_mwh"].mean()), 2), "co2_eur_t": round(float(frame["co2_eur_t"].mean()), 2),
           "summary": summ, "hours": rows,
           "generated_at": pd.Timestamp.now(tz=TZ).strftime("%Y-%m-%d %H:%M")}
    p = WORK / "outputs" / "today.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    react = resolve(st.get("export", {}).get("react_public_dir"))
    if react is not None and react.parent.exists():
        react.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, react / "today.json")
    print(f"{out['date']}: model inputs = {source}")
    for r in rows:
        act = "   –  " if r["actual_chf_kwh"] is None else f"{r['actual_chf_kwh']:.3f}"
        err = "" if r["error_pct"] is None else f"  {r['error_pct']:+.1f} %"
        print(f"  {r['hour']}  model {r['model_chf_kwh']:.3f}  actual {act} CHF/kWh{err}")
    if summ:
        print(f"MAE {summ['mae_eur_mwh']} EUR/MWh, mean |error| {summ['mape_pct']} %")
    print(f"wrote {p}")
    return out
