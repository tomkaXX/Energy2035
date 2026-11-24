"""BFE hydropower publications -> data/csv/hydro_docs/*.csv -> public/pfc2035/hydro_docs.json (Data tab).

Figures were extracted by hand from the BFE reports listed in sources.csv (PDFs in data/pdf/hydro).
Edit the CSVs and re-run `python -m pfc2035 hydro` (or `scenarios`) to refresh the website data.
"""
from __future__ import annotations

import json

import pandas as pd

from ..config import ROOT

DIR = ROOT / "data" / "csv" / "hydro_docs"
# BFE Gesamtenergiestatistik (data/pdf/energy_stats) -> data/csv/energy_stats -> energy_stats.json
STATS_DIR = ROOT / "data" / "csv" / "energy_stats"


def build(folder=DIR) -> dict:
    out = {}
    for f in sorted(folder.glob("*.csv")):
        df = pd.read_csv(f)
        out[f.stem] = json.loads(df.to_json(orient="records", force_ascii=False))
    return out


def export(target_dirs) -> None:
    for folder, name in [(DIR, "hydro_docs.json"), (STATS_DIR, "energy_stats.json")]:
        if not folder.exists():
            continue
        data = build(folder)
        txt = json.dumps(data, ensure_ascii=False, allow_nan=False).replace("NaN", "null")
        for d in target_dirs:
            if d is None:
                continue
            d.mkdir(parents=True, exist_ok=True)
            (d / name).write_text(txt, encoding="utf-8")
        print(f"{name}: {len(data)} tables from {folder}")
