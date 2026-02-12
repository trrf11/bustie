import express from 'express';
import cors from 'cors';
import { config } from './config';
import { initDb } from './db';
import { loadRouteData } from './services/gtfs-static';
import { startPolling } from './services/polling';
import { departuresRouter } from './routes/departures';
import { vehiclesRouter } from './routes/vehicles';
import { statsRouter } from './routes/stats';

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/departures', departuresRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/stats', statsRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function main() {
  // Initialize SQLite
  initDb();

  // Load GTFS static route data (shapes, stops, route ID lookup)
  await loadRouteData();

  // Start polling OVapi + GTFS-RT
  startPolling();

  app.listen(config.port, () => {
    console.log(`Bus 80 backend listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
