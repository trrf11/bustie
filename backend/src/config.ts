export const config = {
  port: parseInt(process.env.PORT || '3001', 10),

  // OVapi REST API
  ovpiBaseUrl: 'http://v0.ovapi.nl',

  // GTFS-RT feeds
  gtfsRtVehiclePositionsUrl: 'https://gtfs.ovapi.nl/nl/vehiclePositions.pb',
  gtfsRtTripUpdatesUrl: 'https://gtfs.ovapi.nl/nl/tripUpdates.pb',
  gtfsStaticUrl: 'http://gtfs.ovapi.nl/nl/gtfs-nl.zip',

  // Bus 80 identifiers (used for OVapi REST filtering)
  operatorCode: 'CXX',
  linePublicNumber: '80',
  linePlanningNumber: 'N080',

  // Default stop: Halfweg, Station Halfweg-Zwanenburg (direction → Amsterdam)
  defaultTpc: '55230110',
  defaultDirection: 1,

  // Polling intervals (ms)
  vehiclePollInterval: 30_000,
  departurePollInterval: 30_000,
  gtfsUpdateCheckInterval: 24 * 60 * 60 * 1000, // 24 hours
  stalenessThreshold: 5, // consecutive zero-vehicle polls before triggering GTFS refresh

  // Data paths
  routeDataPath: './data/route.json',
  dbPath: process.env.DB_PATH || './data/bus80.db',

  // User-Agent for API requests
  userAgent: 'Bus80Tracker/1.0 (community project)',
} as const;
