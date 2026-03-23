/**
 * Polyline geometry utilities for frontend route-walking animation.
 * Coordinates are [lat, lng] pairs. Distances in meters.
 */

const EARTH_RADIUS = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineDistance(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinLng * sinLng;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(h));
}

/** Cumulative distance at each vertex of the polyline. First element is always 0. */
export function polylineCumulativeDistances(shape: Array<[number, number]>): number[] {
  const distances = new Array<number>(shape.length);
  distances[0] = 0;
  for (let i = 1; i < shape.length; i++) {
    distances[i] = distances[i - 1] + haversineDistance(shape[i - 1], shape[i]);
  }
  return distances;
}

/** Walk a given distance along the polyline and return the interpolated [lat, lng]. */
export function walkAlongPolyline(
  distance: number,
  shape: Array<[number, number]>,
  cumDist: number[]
): [number, number] {
  if (distance <= 0) return shape[0];

  const totalLen = cumDist[cumDist.length - 1];
  if (distance >= totalLen) return shape[shape.length - 1];

  let lo = 0;
  let hi = cumDist.length - 2;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid + 1] < distance) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const segStart = cumDist[lo];
  const segEnd = cumDist[lo + 1];
  const t = segEnd > segStart ? (distance - segStart) / (segEnd - segStart) : 0;

  return [
    shape[lo][0] + (shape[lo + 1][0] - shape[lo][0]) * t,
    shape[lo][1] + (shape[lo + 1][1] - shape[lo][1]) * t,
  ];
}
