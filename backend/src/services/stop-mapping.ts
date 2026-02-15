import { getRouteData } from './gtfs-static';

/**
 * Maps OVapi TimingPointCodes (TPC) to GTFS stopIds using stop names as the bridge.
 *
 * The frontend sends TPC codes, but GTFS-RT trip updates reference GTFS stopIds.
 * Both systems share the same stop names, so we can build a mapping via route.json.
 */

// TPC → stop name per direction (mirrors frontend STOP_TPC_MAP but inverted: tpc → name)
// Direction 1 = Zandvoort → Amsterdam (GTFS direction 0)
// Direction 2 = Amsterdam → Zandvoort (GTFS direction 1)
const TPC_TO_NAME: Record<string, { name: string; direction: number }> = {
  // Direction 1 — Richting Amsterdam
  '55211310': { name: 'Zandvoort, Zandvoort Centrum', direction: 1 },
  '55210170': { name: 'Zandvoort, Kostverlorenstraat', direction: 1 },
  '55210050': { name: 'Zandvoort, Huis in de Duinen', direction: 1 },
  '55210070': { name: 'Zandvoort, Waterleiding/Nw. Unicum', direction: 1 },
  '55145010': { name: 'Bentveld, Westerduinweg', direction: 1 },
  '55145030': { name: 'Aerdenhout, Spechtlaan', direction: 1 },
  '55145070': { name: 'Aerdenhout, Viersprong', direction: 1 },
  '55142200': { name: 'Heemstede, Stat.Heemstede-Aerdenh.', direction: 1 },
  '55002020': { name: 'Heemstede, Leidsevaartweg', direction: 1 },
  '55002140': { name: 'Haarlem, Edisonstraat', direction: 1 },
  '55002180': { name: 'Haarlem, Schouwtjesbrug', direction: 1 },
  '55002200': { name: 'Haarlem, Emmaplein', direction: 1 },
  '55000150': { name: 'Haarlem, Centrum/Houtplein', direction: 1 },
  '55007510': { name: 'Haarlem, Rustenburgerlaan', direction: 1 },
  '55001070': { name: 'Haarlem, Schipholweg/Europaweg', direction: 1 },
  '55004160': { name: 'Haarlem, Burg. Reinaldapark', direction: 1 },
  '55007530': { name: 'Haarlem, Jac. van Looystraat', direction: 1 },
  '55007500': { name: 'Haarlem, Prins Bernhardlaan', direction: 1 },
  '55007550': { name: 'Haarlem, Station Spaarnwoude', direction: 1 },
  '55230110': { name: 'Halfweg, Station Halfweg-Zwanenbrg', direction: 1 },
  '55230050': { name: 'Halfweg, Oranje Nassaustraat', direction: 1 },
  '30003130': { name: "Amsterdam, Plein '40-45", direction: 1 },
  '30003054': { name: 'Amsterdam, Burg. Fockstraat', direction: 1 },
  '30003163': { name: 'Amsterdam, Stat. De Vlugtlaan', direction: 1 },
  '30003060': { name: 'Amsterdam, Bos en Lommerplein', direction: 1 },
  '30003037': { name: 'Amsterdam, Egidiusstraat', direction: 1 },
  '30002177': { name: 'Amsterdam, Bos en Lommerweg', direction: 1 },
  '57131530': { name: 'Amsterdam, Ch. de Bourbonstraat', direction: 1 },
  '57131550': { name: 'Amsterdam, De Rijpgracht', direction: 1 },
  '30002129': { name: 'Amsterdam, G.v. Ledenberchstraat', direction: 1 },
  '30002127': { name: 'Amsterdam, Rozengracht', direction: 1 },
  '57003574': { name: 'Amsterdam, Busstation Elandsgracht', direction: 1 },

  // Direction 2 — Richting Zandvoort
  // Note: '57003574' already mapped above (same stop both directions) — direction 2 entry
  // is handled by lookupStopId checking direction2 stops too.
  '30002128': { name: 'Amsterdam, G.v. Ledenberchstraat', direction: 2 },
  '57131540': { name: 'Amsterdam, De Rijpgracht', direction: 2 },
  '57131520': { name: 'Amsterdam, Ch. de Bourbonstraat', direction: 2 },
  '30003038': { name: 'Amsterdam, Bos en Lommerweg', direction: 2 },
  '30003036': { name: 'Amsterdam, Egidiusstraat', direction: 2 },
  '30003061': { name: 'Amsterdam, Bos en Lommerplein', direction: 2 },
  '30003162': { name: 'Amsterdam, Stat. De Vlugtlaan', direction: 2 },
  '30003055': { name: 'Amsterdam, Burg. Fockstraat', direction: 2 },
  '30003087': { name: "Amsterdam, Plein '40-45", direction: 2 },
  '55230040': { name: 'Halfweg, Oranje Nassaustraat', direction: 2 },
  '55230100': { name: 'Halfweg, Station Halfweg-Zwanenbrg', direction: 2 },
  '55000320': { name: 'Haarlem, Station Spaarnwoude', direction: 2 },
  '55007560': { name: 'Haarlem, Springerlaan [Tijdelijk]', direction: 2 },
  '55007540': { name: 'Haarlem, Burgemeester Reinaldapark', direction: 2 },
  '55001241': { name: 'Haarlem, Schipholweg/Europaweg', direction: 2 },
  '55007580': { name: 'Haarlem, Rustenburgerlaan', direction: 2 },
  '55000120': { name: 'Haarlem, Centrum/Houtplein', direction: 2 },
  '55002150': { name: 'Haarlem, Emmaplein', direction: 2 },
  '55002170': { name: 'Haarlem, Schouwtjesbrug', direction: 2 },
  '55002210': { name: 'Haarlem, Edisonstraat', direction: 2 },
  '55142010': { name: 'Heemstede, Leidsevaartweg', direction: 2 },
  '55145520': { name: 'Heemstede, Stat.Heemstede-Aerdenh.', direction: 2 },
  '55145040': { name: 'Aerdenhout, Viersprong', direction: 2 },
  '55145080': { name: 'Aerdenhout, Spechtlaan', direction: 2 },
  '55210020': { name: 'Bentveld, Westerduinweg', direction: 2 },
  '55210040': { name: 'Zandvoort, Waterleiding/Nw. Unicum', direction: 2 },
  '55210060': { name: 'Zandvoort, Huis in de Duinen', direction: 2 },
  '55210080': { name: 'Zandvoort, Kostverlorenstraat', direction: 2 },
  '55210100': { name: 'Zandvoort, Koninginneweg', direction: 2 },
};

// Lazily built lookup: "direction:stopName" → GTFS stopId
let stopIdCache: Map<string, string> | null = null;

function buildStopIdCache(): Map<string, string> {
  const cache = new Map<string, string>();
  const routeData = getRouteData();
  if (!routeData) return cache;

  const stops = routeData.stops?.route;
  if (!stops) return cache;

  for (const stop of stops.direction1 || []) {
    cache.set(`1:${stop.name}`, stop.stopId);
  }
  for (const stop of stops.direction2 || []) {
    cache.set(`2:${stop.name}`, stop.stopId);
  }

  return cache;
}

/**
 * Look up the GTFS stopId for a given TPC code and direction.
 * Returns null if no mapping exists.
 */
export function lookupStopId(tpc: string, direction: number): string | null {
  if (!stopIdCache) {
    stopIdCache = buildStopIdCache();
  }

  const entry = TPC_TO_NAME[tpc];
  if (!entry) return null;

  const key = `${direction}:${entry.name}`;
  return stopIdCache.get(key) || null;
}

/**
 * Get all GTFS stopIds for a given direction.
 */
export function getStopIdsForDirection(direction: number): string[] {
  if (!stopIdCache) {
    stopIdCache = buildStopIdCache();
  }

  const prefix = `${direction}:`;
  const stopIds: string[] = [];
  for (const [key, stopId] of stopIdCache) {
    if (key.startsWith(prefix)) {
      stopIds.push(stopId);
    }
  }
  return stopIds;
}

/**
 * Invalidate the cache (call after route data reload).
 */
export function invalidateStopIdCache(): void {
  stopIdCache = null;
}
