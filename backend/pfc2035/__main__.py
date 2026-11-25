"""Command line:  python -m pfc2035 <command>

  check      test the ENTSO-E token (one day of Swiss prices)
  reservoir-pdf  extract BFE reservoir PDFs (data/pdf) to data/csv/ch_reservoir_weekly.csv and attach
  reservoir  attach Swiss reservoir filling (BFE CSV, else ENTSO-E) to the dataset, no full re-download
  pv         rescale Swiss solar to official installed capacity (data/csv/pv_national.csv)
  hydro      hydro stations (data/csv/hydro_plants.csv) + BFE report data -> hydro_docs.json
  today      today's hourly price: model vs. actual day-ahead (CHF/kWh) -> today.json
  validate   compare model inputs with BFE monthly electricity statistics (data/csv/bfe_elstat)
  bess       battery list -> scenario BESS GW/GWh, writes outputs/bess_list.csv
  fuel       re-attach daily gas/CO₂ prices (data/csv) to the dataset, no download
  data       download/build the hourly dataset      [--source energy-charts|entsoe|both|synthetic]
  train      train LightGBM (+ back-test, driver importance)
  chronos    Chronos foundation-model benchmark (optional install)
  scenarios  run the 3 scenarios + sensitivities and export JSON/CSV/XLSX
  all        data -> train -> chronos -> scenarios
  bundle     package API + model + data into ../Repo/Energy2035/backend for Render
"""
from __future__ import annotations

import argparse
import time

from .config import load_settings, resolve


def _venv_hint() -> None:
    """If the project's .venv exists but another Python is running (e.g. `py -m pfc2035`), re-run the
    same command with the venv's Python, so the installed packages (lightgbm, ...) are always found."""
    import os
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[1]
    venv = root / ".venv"
    if not venv.exists() or Path(sys.prefix).resolve() == venv.resolve() or os.environ.get("PFC2035_NO_REEXEC"):
        return
    exe = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not exe.exists():
        print(f"! Running with {sys.executable}, not the project venv (no {exe}).\n"
              f"  Create it with .\\setup.ps1, or install requirements.txt into this Python.\n")
        return
    print(f"-> switching to the project venv: {exe}")
    env = dict(os.environ, PFC2035_NO_REEXEC="1")
    r = subprocess.run([str(exe), "-m", "pfc2035", *sys.argv[1:]], cwd=str(root), env=env)
    raise SystemExit(r.returncode)


def main() -> None:
    _venv_hint()
    ap = argparse.ArgumentParser(prog="pfc2035", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["check", "reservoir-pdf", "reservoir", "pv", "bess", "hydro", "validate", "today", "fuel", "data", "train", "chronos", "scenarios", "all", "bundle"])
    ap.add_argument("--source", choices=["energy-charts", "entsoe", "both", "synthetic"], default=None,
                    help="override data.source in config/settings.yaml")
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--no-sensitivity", action="store_true", help="skip the sensitivity runs (faster)")
    ap.add_argument("--no-chronos", action="store_true")
    ap.add_argument("--date", default=None, help="today: day to price (YYYY-MM-DD), default = today")
    ap.add_argument("--fx", type=float, default=None, help="today: EUR->CHF rate (default export.today_fx_eur_chf)")
    a = ap.parse_args()
    t0 = time.time()

    if a.command == "check":
        from .data.entsoe_source import check
        check()
        return

    if a.command == "reservoir-pdf":
        from .data.bfe_reservoir import extract
        from .data.build import refresh_reservoir
        extract()
        refresh_reservoir()
        return

    if a.command == "reservoir":
        from .data.build import refresh_reservoir
        refresh_reservoir()
        return

    if a.command == "pv":
        from .data.build import refresh_pv
        refresh_pv()
        return

    if a.command == "bess":
        from .data.bess import export
        export()
        return

    if a.command == "hydro":
        from .config import WORK
        from .data import hydro_docs
        from .data.hydro_plants import report
        report()
        st = load_settings()
        hydro_docs.export([WORK / "outputs", resolve(st["export"].get("react_public_dir"))])
        return

    if a.command == "today":
        from .today import run as today_run
        today_run(a.date, a.fx)
        return

    if a.command == "validate":
        from .config import WORK
        from .data import bfe_elstat, hydro_docs
        print(bfe_elstat.tidy_year().to_string(index=False))
        mix = bfe_elstat.energy_mix()
        print(f"energy mix per month: {len(mix)} rows -> data/csv/bfe_elstat/energy_mix_*.csv")
        bfe_elstat.check_xlsx()
        bfe_elstat.validate()
        hydro_docs.export([WORK / "outputs", resolve(load_settings()["export"].get("react_public_dir"))])
        return

    if a.command == "fuel":
        from .data.build import refresh_fuel
        refresh_fuel()
        return

    if a.command == "bundle":
        from .bundle import bundle
        bundle()
        return

    from .data.build import build, load

    if a.command in ("data", "all"):
        build(a.source, a.start, a.end)
    if a.command in ("train", "all"):
        from .model import train
        df, meta = load()
        train(df, meta)
    if a.command == "chronos" or (a.command == "all" and not a.no_chronos):
        from . import chronos_bench
        df, _ = load()
        chronos_bench.run(df)
    if a.command in ("scenarios", "all"):
        from .export import run_all
        df, meta = load()
        run_all(df, meta, with_sensitivity=not a.no_sensitivity)
    print(f"done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
