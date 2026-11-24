"""Command line:  python -m pfc2035 <command>

  check      test the ENTSO-E token (one day of Swiss prices)
  reservoir-pdf  extract BFE reservoir PDFs (data/pdf) to data/csv/ch_reservoir_weekly.csv and attach
  reservoir  attach Swiss reservoir filling (BFE CSV, else ENTSO-E) to the dataset, no full re-download
  pv         rescale Swiss solar to official installed capacity (data/csv/pv_national.csv)
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


def _venv_hint() -> None:
    """Warn when the project's .venv exists but another Python is running (missing packages)."""
    import sys
    from pathlib import Path

    venv = Path(__file__).resolve().parents[1] / ".venv"
    if venv.exists() and Path(sys.prefix).resolve() != venv.resolve():
        print(f"! Running with {sys.executable}, not the project venv.\n"
              f"  Use:  .\\.venv\\Scripts\\Activate.ps1   then   python -m pfc2035 ...\n"
              f"  or:   .\\.venv\\Scripts\\python.exe -m pfc2035 ...\n")


def main() -> None:
    _venv_hint()
    ap = argparse.ArgumentParser(prog="pfc2035", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["check", "reservoir-pdf", "reservoir", "pv", "bess", "hydro", "fuel", "data", "train", "chronos", "scenarios", "all", "bundle"])
    ap.add_argument("--source", choices=["energy-charts", "entsoe", "both", "synthetic"], default=None,
                    help="override data.source in config/settings.yaml")
    ap.add_argument("--start", default=None)
    ap.add_argument("--end", default=None)
    ap.add_argument("--no-sensitivity", action="store_true", help="skip the sensitivity runs (faster)")
    ap.add_argument("--no-chronos", action="store_true")
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
        from .data.hydro_plants import report
        report()
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
