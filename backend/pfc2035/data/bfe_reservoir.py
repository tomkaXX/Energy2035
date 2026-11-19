"""Swiss reservoir filling from the BFE weekly bulletin PDFs ("Montagswerte", Speicherinhalt).

    python -m pfc2035 reservoir-pdf      data/pdf/*.pdf  ->  data/csv/ch_reservoir_weekly.csv

Columns: date, total_gwh, total_pct (%), total_capacity_gwh, then GWh and % per region (Valais,
Grisons, Ticino, rest of CH) and the Rhine flow at Rheinfelden (m³/s and % of long-term mean).
Each PDF holds one year of Monday 00:00 values: stored energy (GWh) and filling (%) for Valais,
Grisons, Ticino, rest of Switzerland and the Swiss total, plus Rhine flow at Rheinfelden.
The CSV is the reusable source for the model (pfc2035/data/reservoir.py); re-run only when a new
PDF is added. Text extraction uses `pdftotext` (poppler) if installed, otherwise `pypdf`.
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pandas as pd

from ..config import ROOT

PDF_DIR = ROOT / "data" / "pdf"
CSV_OUT = ROOT / "data" / "csv" / "ch_reservoir_weekly.csv"

COLS = ["valais_gwh", "valais_pct", "grisons_gwh", "grisons_pct", "ticino_gwh", "ticino_pct",
        "rest_gwh", "rest_pct", "total_gwh", "total_pct",
        "rhine_longterm_m3s", "rhine_actual_m3s", "rhine_pct"]
DATE = re.compile(r"^\s*(\d{2}\.\d{2}\.\d{4})\b(.*)$")
NUM = re.compile(r"-?\d[\d']*(?:\.\d+)?%?")


def _text(pdf: Path) -> str:
    if shutil.which("pdftotext"):
        return subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    from pypdf import PdfReader  # pip install pypdf

    return "\n".join((p.extract_text(extraction_mode="layout") or "") for p in PdfReader(str(pdf)).pages)


def _num(tok: str) -> float:
    return float(tok.replace("'", "").rstrip("%"))


def parse_pdf(pdf: Path) -> tuple[pd.DataFrame, dict]:
    rows, capacity = [], {}
    for line in _text(pdf).splitlines():
        if not capacity and "m³/s" in line:  # header with capacities (GWh) of the 4 regions + total
            nums = [_num(t) for t in NUM.findall(line) if "%" not in t][:5]
            if len(nums) == 5:
                capacity = dict(zip(["valais", "grisons", "ticino", "rest", "total"], nums))
        m = DATE.match(line)
        if not m:
            continue
        toks = NUM.findall(m.group(2))
        if len(toks) < 10:  # date only (future week / chart axis label)
            continue
        vals = [_num(t) for t in toks[:13]]
        row = dict(zip(COLS, vals + [None] * (13 - len(vals))))
        # *_pct columns stay in percent, exactly as printed in the bulletin (42.7 = 42.7 %)
        row["date"] = pd.to_datetime(m.group(1), format="%d.%m.%Y")
        rows.append(row)
    df = pd.DataFrame(rows).drop_duplicates("date")
    if len(df):
        df["total_capacity_gwh"] = capacity.get("total")
        df["source_file"] = pdf.name
        # sanity: regions add up to the total
        diff = (df[["valais_gwh", "grisons_gwh", "ticino_gwh", "rest_gwh"]].sum(axis=1) - df["total_gwh"]).abs()
        bad = df[diff > 5]
        if len(bad):
            print(f"  ! {pdf.name}: {len(bad)} rows where regions don't add up to the total: {list(bad['date'].dt.date)[:3]}")
    return df, capacity


def extract(pdf_dir: Path = PDF_DIR, out: Path = CSV_OUT) -> pd.DataFrame:
    pdfs = sorted(Path(pdf_dir).glob("*.pdf"))
    if not pdfs:
        raise SystemExit(f"no PDFs in {pdf_dir}")
    frames = []
    for f in pdfs:
        df, cap = parse_pdf(f)
        print(f"  {f.name}: {len(df)} weeks, {df['date'].min():%Y-%m-%d} .. {df['date'].max():%Y-%m-%d}, capacity {cap.get('total')} GWh")
        frames.append(df)
    all_ = pd.concat(frames).sort_values("date")
    # a week can appear in two files (year boundary): keep the value from the newer bulletin
    all_ = all_.drop_duplicates("date", keep="last").reset_index(drop=True)
    # Swiss total first (what the model uses), then the regions and the Rhine flow
    first = ["date", "total_gwh", "total_pct", "total_capacity_gwh"]
    all_ = all_[first + [c for c in COLS if c not in first] + ["source_file"]]
    out.parent.mkdir(parents=True, exist_ok=True)
    all_.to_csv(out, index=False, date_format="%Y-%m-%d")
    print(f"Saved {len(all_)} weekly rows -> {out}")
    return all_
