# Bus 80 Tracker

Real-time tracker for bus line 80 (Zandvoort ↔ Amsterdam), Netherlands. Shows live bus positions on an interactive map with estimated arrival times and a social check-in feature.

## How It Works

- **Frontend** — React + Leaflet map showing bus positions updated in real-time via SSE
- **Backend** — Node.js API server that polls OVapi and GTFS-RT feeds for live vehicle data
- **Check-ins** — Anonymous "bustie" check-in system: tap a bus to check in, see how many riders are on each bus. Auto-resets when a bus starts a new trip.
- **Analytics** — Self-hosted Umami instance for privacy-focused visitor analytics

## Stack

- React 19 + TypeScript + Vite
- Node.js + Express + SQLite
- Leaflet + OpenStreetMap
- Docker Compose
- Umami + PostgreSQL (analytics)

## Running Locally

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
```

The app runs on `http://localhost:3000`.

