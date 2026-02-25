import express from 'express';
import cors from 'cors';
import { departuresRouter } from './routes/departures';
import { vehiclesRouter } from './routes/vehicles';
import { sseRouter } from './routes/sse';
import { statsRouter } from './routes/stats';

/**
 * Create and configure the Express app.
 * Separated from index.ts so tests can import the app without
 * triggering database init, GTFS loading, or polling.
 */
export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/departures', departuresRouter);
  app.use('/api/vehicles/stream', sseRouter);
  app.use('/api/vehicles', vehiclesRouter);
  app.use('/api/stats', statsRouter);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}
