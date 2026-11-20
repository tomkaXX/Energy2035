"""Paths and YAML configuration."""
from __future__ import annotations

import copy
import os
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
# data/raw, data/processed and models/ live under WORK (= project root unless PFC2035_WORKDIR is set,
# which the tests use so they never overwrite your real data)
_BUNDLE = ROOT / "bundle"  # present only in the deployed backend (python -m pfc2035 bundle)
WORK = Path(os.environ.get("PFC2035_WORKDIR") or (_BUNDLE if (_BUNDLE / "models").exists() else ROOT))
DATA_DIR = WORK / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
MODELS_DIR = WORK / "models"

HOURLY_PARQUET = PROCESSED_DIR / "hourly.parquet"
HOURLY_META = PROCESSED_DIR / "hourly_meta.json"

try:  # optional .env support (ENTSOE_API_KEY, ...)
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
except ImportError:  # pragma: no cover — minimal fallback parser for KEY=value lines
    _env = ROOT / ".env"
    if _env.exists():
        for _line in _env.read_text(encoding="utf-8").splitlines():
            if "=" in _line and not _line.lstrip().startswith("#"):
                _k, _v = _line.split("=", 1)
                os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))


def load_settings() -> dict:
    with open(CONFIG_DIR / "settings.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_scenarios() -> dict:
    with open(CONFIG_DIR / "scenarios.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    defaults = cfg.get("defaults", {})
    out = {}
    for sid, sc in cfg["scenarios"].items():
        sc = dict(sc)
        sc["params"] = deep_merge(defaults, sc.get("params", {}))
        from .data.bess import apply as _bess  # battery_gw / hours from data/csv/battery_facilities.csv
        _bess(sc["params"])
        sc["id"] = sid
        out[sid] = sc
    return {"scenarios": out, "sensitivities": cfg.get("sensitivities", []), "defaults": defaults}


def deep_merge(a: dict, b: dict) -> dict:
    out = copy.deepcopy(a)
    for k, v in (b or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def get_path(params: dict, key: str):
    cur = params
    for part in key.split("."):
        cur = cur[part]
    return cur


def set_path(params: dict, key: str, value) -> None:
    parts = key.split(".")
    cur = params
    for part in parts[:-1]:
        cur = cur.setdefault(part, {})
    cur[parts[-1]] = value


def apply_changes(params: dict, changes: list[dict]) -> dict:
    p = copy.deepcopy(params)
    for c in changes:
        old = get_path(p, c["key"])
        op = c.get("op", "set")
        if op == "mul":
            new = old * c["value"]
        elif op == "add":
            new = old + c["value"]
        else:
            new = c["value"]
        set_path(p, c["key"], new)
    return p


def resolve(path_like: str | None) -> Path | None:
    if path_like is None:
        return None
    p = Path(path_like)
    return p if p.is_absolute() else (ROOT / p).resolve()


def entsoe_key() -> str | None:
    k = os.environ.get("ENTSOE_API_KEY", "").strip()
    return k or None
