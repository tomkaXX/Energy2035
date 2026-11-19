"""Command line:  python -m pfc2035 <command>

  check      test the ENTSO-E token (one day of Swiss prices)
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


def main() -> None:
    ap = argparse.ArgumentParser(prog="pfc2035", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["check", "fuel", "data", "train", "chronos", "scenarios", "all", "bundle"])
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
