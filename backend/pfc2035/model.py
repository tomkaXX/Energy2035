"""Gradient-boosting price model (LightGBM).

Target = Swiss price / gas-plant marginal cost (SRMC). Working in this ratio makes the fuel effect
proportional to how often gas sets the price: a +30 % gas price lifts evening peaks, but barely moves
solar-surplus hours that clear near zero. Linear leaves (linear_tree) let the model extrapolate to
2035 residual-load levels that were never observed; predictions are clipped to the observed ratio range.
"""
from __future__ import annotations

import json

import lightgbm as lgb
import numpy as np
import pandas as pd

from .config import MODELS_DIR, load_settings
from .features import FACTOR_GROUPS, FEATURES, build_features

MEAN_FILE = MODELS_DIR / "lgbm_mean.txt"
META_FILE = MODELS_DIR / "lgbm_meta.json"


def _params(ms: dict, objective="regression", alpha=None, linear=True) -> dict:
    p = {
        "objective": objective,
        "learning_rate": ms["learning_rate"],
        "num_leaves": ms["num_leaves"],
        "min_data_in_leaf": ms["min_data_in_leaf"],
        "feature_fraction": 0.9,
        "bagging_fraction": 0.9,
        "bagging_freq": 1,
        "lambda_l2": 1.0,
        "verbose": -1,
        "seed": 42,
    }
    if linear:
        p.update(linear_tree=True, linear_lambda=1.0)
    if alpha is not None:
        p["alpha"] = alpha
    return p


def _fit(X, y, params, rounds):
    return lgb.train(params, lgb.Dataset(X, y, free_raw_data=False), num_boost_round=rounds)


def metrics(y_true, y_pred) -> dict:
    y_true, y_pred = np.asarray(y_true), np.asarray(y_pred)
    err = y_pred - y_true
    neg_t, neg_p = y_true < 0, y_pred < 0
    tp = int((neg_t & neg_p).sum())
    return {
        "mae": float(np.mean(np.abs(err))),
        "rmse": float(np.sqrt(np.mean(err ** 2))),
        "bias": float(np.mean(err)),
        "r2": float(1 - np.sum(err ** 2) / np.sum((y_true - y_true.mean()) ** 2)),
        "neg_hours_true": int(neg_t.sum()),
        "neg_hours_pred": int(neg_p.sum()),
        "neg_recall": tp / max(1, int(neg_t.sum())),
        "neg_precision": tp / max(1, int(neg_p.sum())),
    }


class PriceModel:
    def __init__(self, mean: lgb.Booster, quant: dict[float, lgb.Booster], meta: dict):
        self.mean, self.quant, self.meta = mean, quant, meta

    def predict_frame(self, X: pd.DataFrame) -> pd.DataFrame:
        lo, hi = self.meta["ratio_clip"]
        srmc = X["srmc_gas"].values
        r = np.clip(self.mean.predict(X[FEATURES]), lo, hi)
        out = pd.DataFrame({"price": r * srmc}, index=X.index)
        if self.quant:
            # quantile models (no linear leaves) give the spread; centre it on the mean model
            q50 = self.quant.get("q50")
            for name, b in self.quant.items():
                if name == "q50":
                    continue
                spread = b.predict(X[FEATURES]) - (q50.predict(X[FEATURES]) if q50 else self.mean.predict(X[FEATURES]))
                out[name] = np.clip(r + spread, lo, hi) * srmc
        return out

    @classmethod
    def load(cls, with_quantiles: bool = True) -> "PriceModel":
        if not META_FILE.exists():
            raise FileNotFoundError("No trained model — run:  python -m pfc2035 train")
        meta = json.loads(META_FILE.read_text(encoding="utf-8"))
        mean = lgb.Booster(model_file=str(MEAN_FILE))
        quant = {}
        if with_quantiles:
            for name in meta["quantile_models"]:
                f = MODELS_DIR / f"lgbm_{name}.txt"
                if f.exists():
                    quant[name] = lgb.Booster(model_file=str(f))
        return cls(mean, quant, meta)


def train(df: pd.DataFrame, data_meta: dict) -> dict:
    ms = load_settings()["model"]
    X = build_features(df)
    srmc = X["srmc_gas"].values
    y = df["price_ch"].values / srmc
    test_start = pd.Timestamp(ms["test_start"], tz="UTC")
    tr, te = X.index < test_start, X.index >= test_start
    rounds = ms["num_boost_round"]

    # 1) back-test: fit on train, score on hold-out
    m_bt = _fit(X.loc[tr, FEATURES], y[tr], _params(ms, linear=ms["linear_tree"]), rounds)
    lo, hi = float(np.quantile(y[tr], 0.0005)), float(np.quantile(y[tr], 0.9995))
    pred_te = np.clip(m_bt.predict(X.loc[te, FEATURES]), lo, hi) * srmc[te]
    y_te = df.loc[te, "price_ch"]
    naive_week = df["price_ch"].shift(168).loc[te]
    naive_day = df["price_ch"].shift(24).loc[te]
    backtest = {
        "period": [str(X.index[te][0]), str(X.index[te][-1])],
        "lightgbm": metrics(y_te, pred_te),
        "naive_same_hour_last_week": metrics(y_te, naive_week.values),
        "naive_same_hour_yesterday": metrics(y_te, naive_day.values),
        "note": "LightGBM sees the actual fundamentals of each hour (an 'ex-post' fundamental fit, like a "
                "PFC shape model), the naive models only see past prices.",
    }

    # 2) final models on all data
    mean = _fit(X[FEATURES], y, _params(ms, linear=ms["linear_tree"]), rounds)
    quant = {}
    for a in ms.get("quantiles", []):
        quant[f"q{int(round(a * 100))}"] = _fit(X[FEATURES], y, _params(ms, "quantile", a, linear=False), rounds // 2)
    if quant:
        quant["q50"] = _fit(X[FEATURES], y, _params(ms, "quantile", 0.5, linear=False), rounds // 2)

    lo, hi = float(np.quantile(y, 0.0005)), float(np.quantile(y, 0.9995))
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    mean.save_model(str(MEAN_FILE))
    for name, b in quant.items():
        b.save_model(str(MODELS_DIR / f"lgbm_{name}.txt"))

    # 3) driver importance: permutation importance = how much the MAE (EUR/MWh) grows when a
    #    feature (or a whole Excel factor group) is shuffled. SHAP is not available for linear trees.
    model = PriceModel(mean, quant, {"ratio_clip": [lo, hi]})
    by_feature, by_group = permutation_importance(model, X, df["price_ch"])

    meta = {
        "features": FEATURES,
        "ratio_clip": [lo, hi],
        "quantile_models": list(quant),
        "trained_on": [str(X.index[0]), str(X.index[-1])],
        "data": data_meta,
        "backtest": backtest,
        "importance_by_feature": by_feature,
        "importance_by_factor": by_group,
    }
    META_FILE.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    bt = backtest["lightgbm"]
    print(f"Back-test {backtest['period'][0][:10]}..: MAE {bt['mae']:.1f} EUR/MWh, R² {bt['r2']:.2f}, "
          f"neg. hours {bt['neg_hours_pred']} predicted vs {bt['neg_hours_true']} actual "
          f"(naive last-week MAE {backtest['naive_same_hour_last_week']['mae']:.1f})")
    return meta


def permutation_importance(model: PriceModel, X: pd.DataFrame, y: pd.Series, n: int = 8000, repeats: int = 3):
    rng = np.random.default_rng(0)
    idx = rng.choice(len(X), size=min(n, len(X)), replace=False)
    Xs, ys = X.iloc[idx].copy(), y.iloc[idx].values
    base = np.mean(np.abs(model.predict_frame(Xs)["price"].values - ys))

    def score(cols):
        incs = []
        for _ in range(repeats):
            Xp = Xs.copy()
            perm = rng.permutation(len(Xp))
            for c in cols:  # shuffle the group jointly (keeps within-group correlation)
                Xp[c] = Xs[c].values[perm]
            if "srmc_gas" not in cols:
                Xp["srmc_gas"] = Xs["srmc_gas"].values  # keep the price scale
            incs.append(np.mean(np.abs(model.predict_frame(Xp)["price"].values - ys)) - base)
        return float(np.mean(incs))

    by_feature = {f: round(score([f]), 3) for f in FEATURES}
    by_feature = dict(sorted(by_feature.items(), key=lambda kv: -kv[1]))
    by_group = {g: round(score(fs), 3) for g, fs in FACTOR_GROUPS.items()}
    by_group = dict(sorted(by_group.items(), key=lambda kv: -kv[1]))
    return by_feature, by_group
