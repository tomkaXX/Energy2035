"""Swiss hourly Price Forward Curve 2035 — E-CUBE challenge.

Pipeline: data -> features -> LightGBM (+ Chronos benchmark) -> 2035 scenarios -> JSON for the React app.
"""

COLUMNS_PRICE = ["price_ch", "price_de", "price_fr", "price_it"]
COLUMNS_FUND = [
    "ch_load", "ch_solar", "ch_wind", "ch_ror", "ch_reservoir", "ch_pump", "ch_nuclear", "ch_net_import",
    "de_load", "de_solar", "de_wind",
    "fr_load", "fr_nuclear", "fr_solar", "fr_wind",
    "it_load", "it_solar", "it_wind",
]
# columns that must exist for training (the rest are optional / analysis only)
REQUIRED = ["price_ch", "ch_load", "ch_solar", "ch_nuclear", "ch_ror",
            "de_load", "de_solar", "de_wind", "fr_load", "fr_nuclear", "it_load", "it_solar"]
