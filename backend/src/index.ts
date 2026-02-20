import { config } from './config';
import { initDb } from './db';
import { loadRouteData, getRouteData } from './services/gtfs-static';
import { refreshGtfsData } from './services/gtfs-extract';
import { startCollector } from './services/collector';
import { startDeparturePolling } from './services/polling';
import { createApp } from './app';

async function main() {
  // Initialize SQLite (creates tables if needed)
  initDb();

  // Load GTFS static route data (shapes, stops, route ID lookup)
  await loadRouteData();

  // Cold-start safety net: if route.json is missing, attempt an initial GTFS extract
  if (!getRouteData()) {
    console.log('No route data found — attempting initial GTFS extract...');
    try {
      await refreshGtfsData();
    } catch (err) {
      console.warn('Initial GTFS extract failed:', (err as Error).message);
      console.warn('The backend will operate without route data until the next refresh attempt.');
    }
  }

  // Start data collector (vehicles + trip updates → SQLite)
  startCollector();

  // Start departure polling (OVapi REST → in-memory cache)
  startDeparturePolling();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Bus 80 backend listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
