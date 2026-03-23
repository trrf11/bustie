import { DbVehicle } from '../db';
import { walkAlongPolyline } from '../utils/geo';

const MAX_PROJECTION = 500; // meters

export interface ProjectedVehicle {
  latitude: number;
  longitude: number;
  distanceAlongRoute: number;
}

/**
 * Project a vehicle forward along its route based on elapsed time and speed.
 * Returns projected lat/lng and distance, or raw position if projection is skipped.
 */
export function projectVehicle(
  vehicle: DbVehicle,
  shape: Array<[number, number]>,
  cumDist: number[]
): ProjectedVehicle {
  // Don't project stopped vehicles or those with no speed
  if (vehicle.current_status === 'STOPPED_AT' || vehicle.speed <= 0) {
    return {
      latitude: vehicle.latitude,
      longitude: vehicle.longitude,
      distanceAlongRoute: vehicle.distance_along_route,
    };
  }

  const elapsed = (Date.now() - Date.parse(vehicle.updated_at)) / 1000;
  if (elapsed <= 0) {
    return {
      latitude: vehicle.latitude,
      longitude: vehicle.longitude,
      distanceAlongRoute: vehicle.distance_along_route,
    };
  }

  const extraDistance = Math.min(vehicle.speed * elapsed, MAX_PROJECTION);
  const totalLength = cumDist[cumDist.length - 1];
  const projectedDist = Math.min(vehicle.distance_along_route + extraDistance, totalLength);

  const [lat, lng] = walkAlongPolyline(projectedDist, shape, cumDist);

  return {
    latitude: lat,
    longitude: lng,
    distanceAlongRoute: projectedDist,
  };
}
