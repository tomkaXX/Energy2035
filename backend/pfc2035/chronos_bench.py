"""Chronos (Amazon time-series foundation model) — zero-shot benchmark.

Chronos-Bolt is pre-trained on ~100 billion time-series observations and forecasts a series from its
own history only (no fundamentals). We use it as a benchmark: rolling 24 h day-ahead forecasts over
the hold-out period, compared with LightGBM and naive baselines -> how much do fundamentals add over
pure pattern learning? It cannot answer "what if PV doubles" — that is what the LightGBM scenario model is for.

Install (optional, ~1 GB with PyTorch):  pip install -r requirements-chronos.txt
The model weights (~200 MB for bolt-small) download from Hugging Face on first use.
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from .config import MODELS_DIR, load_settings
from .model import metrics

RESULT_FILE = MODELS_DIR / "chronos_backtest.json"


def load_pipeline(model_id: str):
    import torch
    from chronos import BaseChronosPipeline

    return BaseChronosPipeline.from_pretrained(model_id, device_map="cpu", torch_dtype=torch.float32)


def backtest(df: pd.DataFrame, pipeline=None) -> dict:
    cs = load_settings()["chronos"]
    ms = load_settings()["model"]
    if pipeline is None:
        pipeline = load_pipeline(cs["model_id"])
    import torch

    y = df["price_ch"].astype("float32")
    test_start = pd.Timestamp(ms["test_start"], tz="UTC")
    # forecast origins: midnight (local) of each of the last `backtest_days` days of the hold-out
    loc = y.index.tz_convert("Europe/Zurich")
    origins = np.where((y.index >= test_start) & (loc.hour == 0))[0]
    origins = origins[origins + cs["horizon_hours"] <= len(y)][-cs["backtest_days"]:]
    if len(origins) == 0:
        raise ValueError("no forecast origins in the hold-out period")
    ctx = [torch.tensor(y.values[max(0, o - cs["context_hours"]): o]) for o in origins]
    preds, q10s, q90s = [], [], []
    for i in range(0, len(ctx), 16):  # batches
        q, mean = pipeline.predict_quantiles(ctx[i:i + 16], prediction_length=cs["horizon_hours"],
                                             quantile_levels=[0.1, 0.5, 0.9])
        preds.append(mean.numpy())
        q10s.append(q[..., 0].numpy())
        q90s.append(q[..., 2].numpy())
    pred = np.concatenate(preds).ravel()
    q10, q90 = np.concatenate(q10s).ravel(), np.concatenate(q90s).ravel()
    pos = np.concatenate([np.arange(o, o + cs["horizon_hours"]) for o in origins])
    truth = y.values[pos]
    naive = df["price_ch"].shift(168).values[pos]
    res = {
        "model_id": cs["model_id"],
        "days": int(len(origins)),
        "period": [str(y.index[pos[0]]), str(y.index[pos[-1]])],
        "chronos": metrics(truth, pred),
        "chronos_coverage_p10_p90": float(np.mean((truth >= q10) & (truth <= q90))),
        "naive_same_hour_last_week": metrics(truth, naive),
        "sample": {  # last 7 days for plotting
            "t": [str(t) for t in y.index[pos[-168:]]],
            "actual": np.round(truth[-168:], 2).tolist(),
            "chronos": np.round(pred[-168:], 2).tolist(),
            "p10": np.round(q10[-168:], 2).tolist(),
            "p90": np.round(q90[-168:], 2).tolist(),
        },
    }
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    RESULT_FILE.write_text(json.dumps(res, indent=2), encoding="utf-8")
    c = res["chronos"]
    print(f"Chronos {cs['model_id']}: {res['days']} rolling days, MAE {c['mae']:.1f} EUR/MWh, "
          f"P10–P90 coverage {res['chronos_coverage_p10_p90']:.0%}")
    return res


def run(df: pd.DataFrame) -> dict | None:
    cs = load_settings()["chronos"]
    if not cs.get("enabled", True):
        print("Chronos disabled in settings.yaml")
        return None
    try:
        return backtest(df)
    except ImportError:
        print("Chronos not installed — skipping benchmark (pip install -r requirements-chronos.txt)")
    except Exception as e:  # noqa: BLE001 — e.g. no internet for the weights
        print(f"Chronos benchmark skipped: {type(e).__name__}: {e}")
    return None


def load_result() -> dict | None:
    return json.loads(RESULT_FILE.read_text(encoding="utf-8")) if RESULT_FILE.exists() else None
