import { config } from './config';
import { initDb } from './db';
import { loadRouteData } from './services/gtfs-static';
import { startPolling } from './services/polling';
import { createApp } from './app';

async function main() {
  // Initialize SQLite
  initDb();

  // Load GTFS static route data (shapes, stops, route ID lookup)
  await loadRouteData();

  // Start polling OVapi + GTFS-RT
  startPolling();

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`Bus 80 backend listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
