// Indicative dataset of the main Swiss nuclear and hydro power plants.
// Capacities (MW, turbine/net electrical) and coordinates are approximate and meant
// for visualisation. For production use, replace hydro entries with the BFE
// "Statistik der Wasserkraftanlagen" (WASTA) dataset (geo.admin.ch layer
// ch.bfe.statistik-wasserkraftanlagen) and nuclear data with ENSI/operator figures.
//
// type: 'nuclear' | 'storage' (reservoir & pumped storage) | 'ror' (run-of-river)
// cooling (nuclear): 'river' = direct river cooling (temperature-limited), 'tower' = cooling tower

export const PLANTS = [
  // --- Nuclear -------------------------------------------------------------
  { id: 'kkb1', name: 'Beznau 1', type: 'nuclear', mw: 365, gwh: 2900, lat: 47.552, lon: 8.228, dx: -7, canton: 'AG',
    river: 'Aare', cooling: 'river', online: 1969, offline: 2033,
    note: 'River-cooled from the Aare. Output must be reduced when the Aare exceeds 25 °C (e.g. July 2025: unit 1 shut down, unit 2 at 50 %). Axpo plans final shutdown in 2033.' },
  { id: 'kkb2', name: 'Beznau 2', type: 'nuclear', mw: 365, gwh: 2900, lat: 47.552, lon: 8.228, dx: 7, canton: 'AG',
    river: 'Aare', cooling: 'river', online: 1971, offline: 2032,
    note: 'River-cooled from the Aare, same 25 °C limit as unit 1. Axpo plans final shutdown in 2032.' },
  { id: 'kkg', name: 'Gösgen', type: 'nuclear', mw: 1010, gwh: 8000, lat: 47.366, lon: 7.967, canton: 'SO',
    river: 'Aare', cooling: 'tower', online: 1979, offline: null,
    note: 'Cooling tower: far less sensitive to river temperature, but low Aare flow and heat waves still reduce efficiency slightly.' },
  { id: 'kkl', name: 'Leibstadt', type: 'nuclear', mw: 1233, gwh: 9500, lat: 47.601, lon: 8.183, canton: 'AG',
    river: 'Rhine', cooling: 'tower', online: 1984, offline: null,
    note: 'Largest Swiss unit. Cooling tower on the Rhine; small efficiency loss on hot days.' },
  { id: 'kkm', name: 'Mühleberg', type: 'nuclear', mw: 373, gwh: 0, lat: 46.969, lon: 7.268, canton: 'BE',
    river: 'Aare', cooling: 'river', online: 1972, offline: 2019,
    note: 'Shut down in December 2019, under decommissioning.' },

  // --- Storage & pumped-storage hydro --------------------------------------
  { id: 'gdx', name: 'Grande Dixence / Bieudron', type: 'storage', mw: 2000, gwh: 2000, lat: 46.18, lon: 7.28, canton: 'VS',
    note: 'Cleuson-Dixence scheme incl. Bieudron (1,269 MW). Highest gravity dam in Europe; strongly glacier-fed.' },
  { id: 'ndd', name: 'Nant de Drance', type: 'storage', pumped: true, mw: 900, gwh: 0, lat: 46.07, lon: 6.99, canton: 'VS',
    note: 'Pumped storage between Emosson and Vieux-Emosson (~20 GWh storage). Key flexibility for daily PV shape.' },
  { id: 'emo', name: 'Emosson', type: 'storage', mw: 390, gwh: 850, lat: 46.07, lon: 6.93, canton: 'VS',
    note: 'Franco-Swiss reservoir scheme (Vallorcine / La Bâtiaz).' },
  { id: 'mau', name: 'Mauvoisin', type: 'storage', mw: 360, gwh: 1000, lat: 46.0, lon: 7.34, canton: 'VS',
    note: 'Seasonal reservoir in Val de Bagnes, glacier-fed.' },
  { id: 'mat', name: 'Mattmark', type: 'storage', mw: 240, gwh: 650, lat: 46.05, lon: 7.96, canton: 'VS',
    note: 'Seasonal reservoir in the Saas valley.' },
  { id: 'hon', name: 'Hongrin-Léman (Veytaux)', type: 'storage', pumped: true, mw: 480, gwh: 600, lat: 46.42, lon: 6.93, canton: 'VD',
    note: 'Pumped storage between Lac de l’Hongrin and Lake Geneva.' },
  { id: 'kwo', name: 'Oberhasli (KWO, Grimsel)', type: 'storage', pumped: true, mw: 1350, gwh: 2300, lat: 46.57, lon: 8.33, canton: 'BE',
    note: 'Cascade of reservoirs incl. Grimsel / Oberaar pumped storage. Glacier melt contributes significantly in summer.' },
  { id: 'lim', name: 'Linth-Limmern', type: 'storage', pumped: true, mw: 1480, gwh: 450, lat: 46.85, lon: 8.99, canton: 'GL',
    note: 'Incl. 1,000 MW Limmern pumped-storage plant (Muttsee).' },
  { id: 'sar', name: 'Sarganserland (Mapragg)', type: 'storage', pumped: true, mw: 360, gwh: 450, lat: 46.95, lon: 9.43, canton: 'SG',
    note: 'Pumped storage, Gigerwald / Mapragg.' },
  { id: 'kvr', name: 'Vorderrhein', type: 'storage', mw: 270, gwh: 700, lat: 46.75, lon: 9.0, canton: 'GR',
    note: 'Reservoirs Sta. Maria / Curnera / Nalps.' },
  { id: 'zer', name: 'Zervreila', type: 'storage', mw: 220, gwh: 550, lat: 46.6, lon: 9.2, canton: 'GR',
    note: 'Seasonal reservoir in Valsertal.' },
  { id: 'ekw', name: 'Engadiner Kraftwerke', type: 'storage', mw: 400, gwh: 1400, lat: 46.8, lon: 10.3, canton: 'GR',
    note: 'Livigno reservoir (Ova Spin) and Pradella; snow-melt dominated.' },
  { id: 'ewzb', name: 'Bergell (ewz)', type: 'storage', mw: 100, gwh: 400, lat: 46.33, lon: 9.6, canton: 'GR',
    note: 'Albigna reservoir.' },
  { id: 'blen', name: 'Blenio', type: 'storage', mw: 430, gwh: 900, lat: 46.45, lon: 8.95, canton: 'TI',
    note: 'Luzzone reservoir and cascade to Biasca.' },
  { id: 'mag', name: 'Maggia', type: 'storage', mw: 620, gwh: 1300, lat: 46.35, lon: 8.6, canton: 'TI',
    note: 'Cascade with Sambuco, Naret and Robièi reservoirs; south side of the Alps, sensitive to dry spells.' },
  { id: 'ver', name: 'Verzasca', type: 'storage', mw: 105, gwh: 230, lat: 46.2, lon: 8.84, canton: 'TI',
    note: 'Contra dam.' },

  // --- Run-of-river --------------------------------------------------------
  { id: 'lau', name: 'Laufenburg', type: 'ror', mw: 106, gwh: 650, lat: 47.56, lon: 8.06, canton: 'AG', river: 'Rhine',
    note: 'High Rhine run-of-river; output follows river flow (snow melt in spring/early summer).' },
  { id: 'rhf', name: 'Rheinfelden', type: 'ror', mw: 100, gwh: 600, lat: 47.57, lon: 7.8, canton: 'AG', river: 'Rhine',
    note: 'High Rhine run-of-river.' },
  { id: 'rsw', name: 'Ryburg-Schwörstadt', type: 'ror', mw: 120, gwh: 750, lat: 47.57, lon: 7.88, canton: 'AG', river: 'Rhine',
    note: 'High Rhine run-of-river.' },
  { id: 'bir', name: 'Birsfelden', type: 'ror', mw: 100, gwh: 550, lat: 47.55, lon: 7.64, canton: 'BL', river: 'Rhine',
    note: 'Rhine run-of-river near Basel.' },
  { id: 'egl', name: 'Eglisau-Glattfelden', type: 'ror', mw: 43, gwh: 315, lat: 47.57, lon: 8.52, canton: 'ZH', river: 'Rhine',
    note: 'Rhine run-of-river.' },
  { id: 'wbr', name: 'Wildegg-Brugg', type: 'ror', mw: 50, gwh: 300, lat: 47.47, lon: 8.17, canton: 'AG', river: 'Aare',
    note: 'Aare run-of-river.' },
  { id: 'ver2', name: 'Verbois', type: 'ror', mw: 100, gwh: 470, lat: 46.2, lon: 6.04, canton: 'GE', river: 'Rhône',
    note: 'Rhône run-of-river downstream of Geneva.' },
  { id: 'cha', name: 'Chancy-Pougny', type: 'ror', mw: 54, gwh: 250, lat: 46.15, lon: 5.97, canton: 'GE', river: 'Rhône',
    note: 'Franco-Swiss Rhône run-of-river.' },
];

export const TYPE_META = {
  nuclear: { label: 'Nuclear', color: 'var(--series-2)' },
  storage: { label: 'Storage & pumped-storage hydro', color: 'var(--series-1)' },
  ror: { label: 'Run-of-river hydro', color: 'var(--series-3)' },
};

// National context (indicative, rounded)
export const NATIONAL = {
  hydroGW: 15.5, // installed hydro turbine capacity
  hydroTWh: 36, // average annual hydro generation
  nuclearGW: 2.97, // operating nuclear (Beznau 1+2, Gösgen, Leibstadt)
  nuclearTWh: 23,
  demandTWh: 62,
  pvGW2025: 8.5,
};
