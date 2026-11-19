"""Run all scenarios + sensitivities and write JSON/CSV/XLSX for the React app and the report."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from . import chronos_bench
from .config import apply_changes, load_scenarios, load_settings, resolve
from .kpis import KPI_LABELS, combine, kpis, month_hour_grid
from .model import META_FILE, PriceModel
from .scenarios import run_scenario

R = lambda a, n=1: np.round(np.asarray(a, dtype=float), n).tolist()  # noqa: E731


def summarize(result: dict) -> dict:
    """Condense one scenario run (several weather years) into JSON-friendly numbers."""
    idx = result["index"]
    runs = result["runs"]
    price = np.mean([r["price"] for r in runs], axis=0)  # the PFC = expected price per hour
    per_year = [kpis(r["price"], idx, r["frame"]["ch_solar"].values) for r in runs]
    frames = [r["frame"] for r in runs]
    mean_col = lambda c: np.mean([f[c].values for f in frames], axis=0)  # noqa: E731
    loc = idx.tz_convert("Europe/Zurich")
    q = {k: np.mean([r[k] for r in runs], axis=0) for k in runs[0] if k.startswith("q")}
    # weather-year envelope (min/max of the hourly price across weather years, smoothed daily)
    stack = np.vstack([r["price"] for r in runs])
    mix = {
        "demand_twh": float(mean_col("ch_load").sum() / 1000),
        "pv_twh": float(mean_col("ch_solar").sum() / 1000),
        "wind_twh": float(mean_col("ch_wind").sum() / 1000),
        "nuclear_twh": float(mean_col("ch_nuclear").sum() / 1000),
        "run_of_river_twh": float(mean_col("ch_ror").sum() / 1000),
        "residual_twh": float(mean_col("ch_residual_flex").sum() / 1000),
        "demand_breakdown_twh": frames[0].attrs.get("demand_twh", {}),
    }
    dur = np.sort(price)[::-1]
    return {
        "kpis": combine(per_year),
        "kpis_by_weather_year": {str(r["weather_year"]): k for r, k in zip(runs, per_year)},
        "weather_years": [r["weather_year"] for r in runs],
        "monthly_avg": R(pd.Series(price).groupby(loc.month.values).mean().values, 2),
        "heatmap": month_hour_grid(price, idx),
        "profile_winter": R(pd.Series(price[np.isin(loc.month, [10, 11, 12, 1, 2, 3])])
                            .groupby(loc.hour.values[np.isin(loc.month, [10, 11, 12, 1, 2, 3])]).mean().values, 2),
        "profile_summer": R(pd.Series(price[~np.isin(loc.month, [10, 11, 12, 1, 2, 3])])
                            .groupby(loc.hour.values[~np.isin(loc.month, [10, 11, 12, 1, 2, 3])]).mean().values, 2),
        "duration_curve": R(dur[np.linspace(0, len(dur) - 1, 200).astype(int)], 1),
        "mix": mix,
        "hourly": {
            "start_utc": str(idx[0]),
            "price": R(price),
            **{k: R(v) for k, v in q.items()},
            "weather_min": R(stack.min(0)),
            "weather_max": R(stack.max(0)),
            "pv_gw": R(mean_col("ch_solar"), 2),
            "load_gw": R(mean_col("ch_load"), 2),
            "residual_gw": R(mean_col("ch_residual_flex"), 2),
        },
    }


def historical_baseline(hist: pd.DataFrame) -> dict:
    out = {}
    loc_year = hist.index.tz_convert("Europe/Zurich").year
    for y in sorted(set(loc_year)):
        h = hist[loc_year == y]
        if len(h) < 8000:
            continue
        k = kpis(h["price_ch"].values, h.index, h["ch_solar"].values)
        k["monthly_avg"] = R(h["price_ch"].groupby(h.index.tz_convert("Europe/Zurich").month).mean().values, 2)
        k["heatmap"] = month_hour_grid(h["price_ch"].values, h.index)
        out[str(y)] = k
    return out


def factor1_analysis(hist: pd.DataFrame) -> dict:
    """Excel Factor 1: neighbour prices, net imports and negative-price hours."""
    p = hist["price_ch"]
    res = {"corr_price": {}, "neg_hours": {}}
    for c, label in [("price_de", "DE"), ("price_fr", "FR"), ("price_it", "IT-North")]:
        if hist[c].notna().sum() > 1000:
            res["corr_price"][label] = round(float(p.corr(hist[c])), 3)
            res.setdefault("mean_spread_vs_ch", {})[label] = round(float((hist[c] - p).mean()), 2)
    if hist["ch_net_import"].notna().sum() > 1000:
        ni = hist["ch_net_import"]
        res["corr_price_net_import"] = round(float(p.corr(ni)), 3)
        neg = p < 0
        res["neg_hours"]["total"] = int(neg.sum())
        res["neg_hours"]["share_while_exporting"] = round(float((ni[neg] < 0).mean()), 3) if neg.any() else None
        hi_pv = hist["ch_solar"] > hist["ch_solar"].quantile(0.9)
        res["export_share_top10pct_pv_hours"] = round(float((ni[hi_pv] < 0).mean()), 3)
    res["corr_price_ch_residual"] = round(float(p.corr(
        hist["ch_load"] - hist["ch_solar"] - hist["ch_wind"].fillna(0) - hist["ch_nuclear"] - hist["ch_ror"])), 3)
    return res


def _reservoir_chart(hist: pd.DataFrame, settings: dict) -> dict:
    """Reservoir chart: every year in the BFE CSV (incl. the current year); else what is in the dataset."""
    from .data import reservoir

    weekly, last = reservoir.weekly_from_csv(resolve(settings["data"].get("reservoir_csv")))
    if weekly:
        return {"reservoir_weekly_twh": weekly, "reservoir_last_date": last,
                "reservoir_source": "BFE weekly bulletin (Speicherinhalt)"}
    return {"reservoir_weekly_twh": reservoir.weekly_by_year(hist), "reservoir_last_date": None,
            "reservoir_source": "ENTSO-E A72"}


def fuel_summary(scenarios: dict, hist: pd.DataFrame) -> dict:
    """Gas & CO₂: monthly history (actual years) and the 2035 monthly path of each scenario."""
    from .data import fuel

    st = load_settings()["scenario_run"]
    yrs = sorted({int(y) for y in hist.index.tz_convert("Europe/Zurich").year})
    hist_m = fuel.monthly([y for y in yrs if y < 2026] + [st.get("fuel_profile_year_gas", 2024)])
    idx = pd.date_range("2035-01-01", "2036-01-01", freq="D", inclusive="left")
    doy = np.minimum(idx.dayofyear.values, 366) - 1
    g_shape = fuel.profile(st.get("fuel_profile_year_gas", 2024), "gas_eur_mwh")[doy]
    c_shape = fuel.profile(st.get("fuel_profile_year_co2", 2024), "co2_eur_t")[doy]
    sc_m = {}
    for sid, sc in scenarios.items():
        mk = sc["params"]["market"]
        g = pd.Series(mk["gas_eur_mwh"] * g_shape, index=idx).groupby(idx.month).mean()
        c = pd.Series(mk["co2_eur_t"] * c_shape, index=idx).groupby(idx.month).mean()
        sc_m[sid] = {"gas": R(g.values, 2), "co2": R(c.values, 2)}
    return {
        "source": "TTF day-ahead (EEX) and EU ETS EUA, data/csv",
        "profile_year_gas": st.get("fuel_profile_year_gas", 2024),
        "profile_year_co2": st.get("fuel_profile_year_co2", 2024),
        "historical_monthly": hist_m,
        "historical_yearly": fuel.yearly_stats(),
        "scenarios_monthly": sc_m,
    }


def sensitivity(model: PriceModel, hist: pd.DataFrame, scenarios: dict, sens: list[dict]) -> dict:
    out = {}
    for sid, sc in scenarios.items():
        base = summarize(run_scenario(model, hist, sc["params"]))["kpis"]
        rows = []
        for s in sens:
            p = apply_changes(sc["params"], s["changes"])
            k = summarize(run_scenario(model, hist, p))["kpis"]
            rows.append({
                "id": s["id"], "label": s["label"],
                **{f"d_{m}": round(k[m]["mean"] - base[m]["mean"], 2)
                   for m in ["annual_avg", "winter_avg", "summer_avg", "neg_hours", "daily_spread", "solar_capture"]},
            })
        rows.sort(key=lambda r: -abs(r["d_annual_avg"]))
        out[sid] = {"base": {m: round(v["mean"], 2) for m, v in base.items()}, "rows": rows}
        print(f"  sensitivity {sid}: top driver {rows[0]['label']} ({rows[0]['d_annual_avg']:+.1f} €/MWh)")
    return out


def run_all(hist: pd.DataFrame, data_meta: dict, with_sensitivity: bool = True) -> dict:
    settings = load_settings()
    sc_cfg = load_scenarios()
    model = PriceModel.load()
    meta = json.loads(META_FILE.read_text(encoding="utf-8"))
    out_dir = resolve(settings["export"]["outputs_dir"])
    out_dir.mkdir(parents=True, exist_ok=True)

    scen_summ = {}
    for sid, sc in sc_cfg["scenarios"].items():
        res = run_scenario(model, hist, sc["params"])
        s = summarize(res)
        k = s["kpis"]
        print(f"{sc['short']:>10}: avg {k['annual_avg']['mean']:.1f} €/MWh | winter {k['winter_avg']['mean']:.1f} | "
              f"summer {k['summer_avg']['mean']:.1f} | neg {k['neg_hours']['mean']:.0f} h | >100 {k['hours_above_100']['mean']:.0f} h")
        doc = {"id": sid, "name": sc["name"], "short": sc["short"], "color": sc.get("color"),
               "narrative": sc["narrative"].strip(), "params": sc["params"], **s}
        (out_dir / f"scenario_{sid}.json").write_text(json.dumps(doc), encoding="utf-8")
        scen_summ[sid] = {k2: doc[k2] for k2 in ["id", "name", "short", "color", "narrative", "params", "kpis",
                                                 "monthly_avg", "profile_winter", "profile_summer",
                                                 "duration_curve", "mix", "weather_years"]}
        # hourly CSV (the PFC deliverable)
        idx = res["index"]
        pd.DataFrame({"datetime_utc": idx.strftime("%Y-%m-%d %H:%M"),
                      "datetime_local": idx.tz_convert("Europe/Zurich").strftime("%Y-%m-%d %H:%M"),
                      "pfc_eur_mwh": s["hourly"]["price"],
                      **{f"{k2}_eur_mwh": v for k2, v in s["hourly"].items() if k2.startswith("q")},
                      "pv_gw": s["hourly"]["pv_gw"], "load_gw": s["hourly"]["load_gw"],
                      "residual_after_flex_gw": s["hourly"]["residual_gw"]}
                     ).to_csv(out_dir / f"pfc_2035_{sid}.csv", index=False)

    sens = sensitivity(model, hist, sc_cfg["scenarios"], sc_cfg["sensitivities"]) if with_sensitivity else {}
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data": data_meta,
        "kpi_labels": {k: {"label": v[0], "unit": v[1]} for k, v in KPI_LABELS.items()},
        "scenarios": scen_summ,
        "historical": historical_baseline(hist),
        "analysis_factor1": factor1_analysis(hist),
        "importance_by_factor": meta["importance_by_factor"],
        "importance_by_feature": meta["importance_by_feature"],
        "backtest": meta["backtest"],
        "chronos": chronos_bench.load_result(),
        "fuel": fuel_summary(sc_cfg["scenarios"], hist),
        **_reservoir_chart(hist, settings),
        "sensitivity": sens,
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, allow_nan=False), encoding="utf-8")
    from .data import pv as pvmod
    pvmap = pvmod.map_json()
    if pvmap:
        (out_dir / "pv_map.json").write_text(json.dumps(pvmap, ensure_ascii=False), encoding="utf-8")
    write_results_table(summary, out_dir)

    react_dir = resolve(settings["export"].get("react_public_dir"))
    if react_dir is not None:
        if react_dir.parent.exists():
            react_dir.mkdir(parents=True, exist_ok=True)
            for f in out_dir.glob("*.json"):
                shutil.copy2(f, react_dir / f.name)
            print(f"Copied JSON to React app: {react_dir}")
        else:
            print(f"(React folder {react_dir.parent} not found — JSON only in {out_dir})")
    print(f"Outputs in {out_dir}")
    return summary


def write_results_table(summary: dict, out_dir) -> None:
    """The Excel 'Results' table, filled in (+ historical years for comparison)."""
    rows = []
    for key in ["annual_avg", "winter_avg", "summer_avg", "neg_hours", "neg_freq", "hours_above_100",
                "p10", "p90", "max", "peak_avg", "solar_capture", "daily_spread"]:
        label, unit = KPI_LABELS[key]
        row = {"Output": label, "Unit": unit}
        for y, k in summary["historical"].items():
            row[f"Actual {y}"] = round(k.get(key, float("nan")), 1)
        for sid, sc in summary["scenarios"].items():
            v = sc["kpis"].get(key)
            row[sc["short"] + " 2035"] = round(v["mean"], 1) if v else None
            row[sc["short"] + " range"] = f"{v['min']:.0f}–{v['max']:.0f}" if v else None
        rows.append(row)
    df = pd.DataFrame(rows)
    df.to_csv(out_dir / "results_2035.csv", index=False)
    try:
        with pd.ExcelWriter(out_dir / "results_2035.xlsx") as xw:
            df.to_excel(xw, sheet_name="Results", index=False)
            for sid, s in summary.get("sensitivity", {}).items():
                pd.DataFrame(s["rows"]).to_excel(xw, sheet_name=f"Sensitivity {sid}"[:31], index=False)
            pd.Series(summary["importance_by_factor"], name="MAE increase €/MWh").to_frame() \
                .to_excel(xw, sheet_name="Driver importance")
    except ImportError:
        pass
