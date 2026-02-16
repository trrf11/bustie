# Bus 80 Tracker

Real-time tracker for bus line 80 in The Hague, Netherlands. Shows live bus positions on an interactive map with estimated arrival times.

## How It Works

- **Frontend** — React + Leaflet map showing bus positions updated in real-time
- **Backend** — Node.js API server that polls OVapi and GTFS-RT feeds for live vehicle data
- **Analytics** — Self-hosted Umami instance for privacy-focused visitor analytics

## Stack

- React 19 + TypeScript + Vite
- Node.js + Express
- Leaflet + OpenStreetMap
- Docker Compose
- Umami + PostgreSQL (analytics)

## Running Locally

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

The app runs on `http://localhost:3000`.

## Deployment

Runs on a Raspberry Pi with automatic deployment — a cron job polls GitHub every 5 minutes and rebuilds on new commits.
