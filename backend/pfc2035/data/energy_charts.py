"""Energy-Charts API (Fraunhofer ISE) — free, no key. https://api.energy-charts.info

Fetches month by month, caches the raw JSON under data/raw/energy_charts/ so re-runs are offline.
Power values are converted to GW, prices stay in EUR/MWh, everything is resampled to hourly (UTC).
"""
from __future__ import annotations

import json
import re
import time

import pandas as pd
import requests

from ..config import RAW_DIR

BASE = "https://api.energy-charts.info"
CACHE = RAW_DIR / "energy_charts"

PRICE_ZONES = {"price_ch": "CH", "price_de": "DE-LU", "price_fr": "FR", "price_it": "IT-North"}

# production_type name (lower-case regex) -> our column suffix
POWER_MAP = [
    (r"^load", "load"),
    (r"^solar", "solar"),
    (r"^wind", "wind"),                        # onshore + offshore are summed
    (r"^nuclear", "nuclear"),
    (r"run.of.river", "ror"),
    (r"water reservoir", "reservoir"),
    (r"pumped storage consumption", "pump"),
    (r"cross border", "net_import"),
]
COUNTRY_COLS = {
    "ch": ["load", "solar", "wind", "nuclear", "ror", "reservoir", "pump", "net_import"],
    "de": ["load", "solar", "wind"],
    "fr": ["load", "nuclear", "solar", "wind"],
    "it": ["load", "solar", "wind"],
}


def _months(start: str, end: str):
    cur = pd.Timestamp(start).to_period("M")
    last = (pd.Timestamp(end) - pd.Timedelta(seconds=1)).to_period("M")
    while cur <= last:
        yield cur
        cur += 1


def _get(endpoint: str, params: dict, cache_name: str, session: requests.Session) -> dict | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / f"{cache_name}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    for attempt in range(4):
        try:
            r = session.get(f"{BASE}/{endpoint}", params=params, timeout=60)
            if r.status_code == 200:
                data = r.json()
                f.write_text(json.dumps(data), encoding="utf-8")
                time.sleep(0.4)  # be polite
                return data
            if r.status_code in (404, 400):
                print(f"  ! {endpoint} {params}: HTTP {r.status_code} (skipped)")
                return None
        except requests.RequestException as e:  # network hiccup
            print(f"  ! {endpoint} {params}: {e}")
        time.sleep(2 * (attempt + 1))
    return None


def _to_hourly(unix_seconds, values) -> pd.Series:
    idx = pd.to_datetime(pd.Series(unix_seconds, dtype="int64"), unit="s", utc=True)
    s = pd.Series(pd.to_numeric(pd.Series(values), errors="coerce").values, index=idx)
    return s.resample("1h").mean()


def fetch_prices(start: str, end: str, session: requests.Session) -> pd.DataFrame:
    cols = {}
    for col, bzn in PRICE_ZONES.items():
        parts = []
        for m in _months(start, end):
            s0, s1 = m.start_time.strftime("%Y-%m-%d"), (m + 1).start_time.strftime("%Y-%m-%d")
            d = _get("price", {"bzn": bzn, "start": s0, "end": s1}, f"price_{bzn}_{m}", session)
            if d and d.get("unix_seconds"):
                parts.append(_to_hourly(d["unix_seconds"], d["price"]))
        if parts:
            s = pd.concat(parts)
            cols[col] = s[~s.index.duplicated()]
        print(f"  price {bzn}: {len(cols.get(col, []))} h")
    return pd.DataFrame(cols)


def fetch_power(start: str, end: str, session: requests.Session) -> pd.DataFrame:
    cols = {}
    for country, wanted in COUNTRY_COLS.items():
        acc: dict[str, list[pd.Series]] = {w: [] for w in wanted}
        for m in _months(start, end):
            s0, s1 = m.start_time.strftime("%Y-%m-%d"), (m + 1).start_time.strftime("%Y-%m-%d")
            d = _get("public_power", {"country": country, "start": s0, "end": s1}, f"power_{country}_{m}", session)
            if not d or not d.get("unix_seconds"):
                continue
            month_cols: dict[str, pd.Series] = {}
            for pt in d.get("production_types", []):
                name = pt.get("name", "").lower()
                for pat, suffix in POWER_MAP:
                    if suffix in wanted and re.search(pat, name):
                        if suffix == "load" and ("residual" in name or "share" in name):
                            continue
                        s = _to_hourly(d["unix_seconds"], pt["data"]) / 1000.0  # MW -> GW
                        month_cols[suffix] = month_cols[suffix].add(s, fill_value=0) if suffix in month_cols else s
                        break
            for k, s in month_cols.items():
                acc[k].append(s)
        for k, parts in acc.items():
            if parts:
                s = pd.concat(parts)
                s = s[~s.index.duplicated()]
                if k == "pump":
                    s = s.abs()  # consumption reported negative
                cols[f"{country}_{k}"] = s
        print(f"  power {country}: {[k for k in wanted if f'{country}_{k}' in cols]}")
    return pd.DataFrame(cols)


def fetch(start: str, end: str) -> pd.DataFrame:
    print(f"Energy-Charts: {start} -> {end} (cached in {CACHE})")
    with requests.Session() as session:
        session.headers["User-Agent"] = "pfc2035-research/0.1"
        prices = fetch_prices(start, end, session)
        power = fetch_power(start, end, session)
    df = prices.join(power, how="outer")
    return df.loc[(df.index >= pd.Timestamp(start, tz="UTC")) & (df.index < pd.Timestamp(end, tz="UTC"))]
