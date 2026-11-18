"""FastAPI backend for the React "Scenarios 2035" tab.

Run:  uvicorn api.main:app --reload --port 8000      (from the project root, venv active)
Docs: http://localhost:8000/docs

Environment variables (set on Render, all optional locally):
  ALLOWED_ORIGINS        comma-separated browser origins, e.g. https://tomkaxx.github.io
  PFC_API_WEATHER_YEARS  e.g. "2024" — fewer weather years = faster what-if runs on small servers
  PFC_API_QUANTILES      "0" to skip the P10/P90 models (less memory)
"""
from __future__ import annotations

import json
import os
from functools import lru_cache

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from pfc2035.config import deep_merge, load_scenarios, load_settings, resolve
from pfc2035.data.build import load as load_data
from pfc2035.export import summarize
from pfc2035.model import PriceModel
from pfc2035.scenarios import run_scenario

app = FastAPI(title="Swiss PFC 2035 API", version="0.1.0")
LOCAL_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:4173"]
EXTRA_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
WEATHER_YEARS = [int(y) for y in os.environ.get("PFC_API_WEATHER_YEARS", "").split(",") if y.strip()] or None
QUANTILES = os.environ.get("PFC_API_QUANTILES", "1") != "0"

app.add_middleware(
    CORSMiddleware,
    allow_origins=LOCAL_ORIGINS + EXTRA_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def _state():
    hist, meta = load_data()
    return hist, meta, PriceModel.load(with_quantiles=QUANTILES)


def _out_dir():
    return resolve(load_settings()["export"]["outputs_dir"])


class RunRequest(BaseModel):
    base: str = Field("bau", description="scenario id to start from: bau | transition | delayed")
    overrides: dict = Field(default_factory=dict, description='nested, e.g. {"ch": {"pv_twh": 30}}')
    weather_years: list[int] | None = None


@app.get("/api/health")
def health():
    try:
        _, meta, _ = _state()
        return {"ok": True, "data": meta, "weather_years": WEATHER_YEARS or "all", "quantiles": QUANTILES}
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/scenarios")
def scenarios():
    cfg = load_scenarios()
    return {sid: {"name": s["name"], "short": s["short"], "params": s["params"]} for sid, s in cfg["scenarios"].items()}


@app.get("/api/summary")
def summary():
    f = _out_dir() / "summary.json"
    if not f.exists():
        raise HTTPException(404, "run  python -m pfc2035 scenarios  first")
    return json.loads(f.read_text(encoding="utf-8"))


@app.get("/api/results/{sid}")
def result(sid: str):
    f = _out_dir() / f"scenario_{sid}.json"
    if not f.exists():
        raise HTTPException(404, f"no results for {sid}")
    return json.loads(f.read_text(encoding="utf-8"))


@app.post("/api/run")
def run(req: RunRequest):
    cfg = load_scenarios()["scenarios"]
    if req.base not in cfg:
        raise HTTPException(400, f"unknown scenario {req.base}")
    hist, _, model = _state()
    params = deep_merge(cfg[req.base]["params"], req.overrides)
    res = run_scenario(model, hist, params, weather_years=req.weather_years or WEATHER_YEARS)
    out = summarize(res)
    out.update({"id": "custom", "name": f"Custom (from {cfg[req.base]['short']})", "params": params})
    return out
