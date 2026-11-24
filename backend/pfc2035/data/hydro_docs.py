"""BFE hydropower publications -> data/csv/hydro_docs/*.csv -> public/pfc2035/hydro_docs.json (Data tab).

Figures were extracted by hand from the BFE reports listed in sources.csv (PDFs in data/pdf/hydro).
Edit the CSVs and re-run `python -m pfc2035 hydro` (or `scenarios`) to refresh the website data.
"""
from __future__ import annotations

import json

import pandas as pd

from ..config import ROOT

DIR = ROOT / "data" / "csv" / "hydro_docs"


def build() -> dict:
    out = {}
    for f in sorted(DIR.glob("*.csv")):
        df = pd.read_csv(f)
        out[f.stem] = json.loads(df.to_json(orient="records", force_ascii=False))
    return out


def export(target_dirs) -> None:
    if not DIR.exists():
        return
    data = build()
    for d in target_dirs:
        if d is None:
            continue
        d.mkdir(parents=True, exist_ok=True)
        (d / "hydro_docs.json").write_text(json.dumps(data, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    print(f"hydro_docs.json: {len(data)} tables from {DIR}")
