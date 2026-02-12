import { useState, useCallback } from 'react';
import type { SavedTrip } from '../types';

const STORAGE_KEY = 'bus80_saved_trips';

function loadTrips(): SavedTrip[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SavedTrip[];
  } catch {
    return [];
  }
}

function persistTrips(trips: SavedTrip[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}

export function useSavedTrips() {
  const [trips, setTrips] = useState<SavedTrip[]>(loadTrips);

  const addTrip = useCallback((trip: Omit<SavedTrip, 'id'>) => {
    setTrips((prev) => {
      // Don't add duplicates (same stop + direction)
      const exists = prev.some((t) => t.tpc === trip.tpc && t.direction === trip.direction);
      if (exists) return prev;

      const newTrip: SavedTrip = { ...trip, id: `${trip.tpc}-${trip.direction}-${Date.now()}` };
      const updated = [...prev, newTrip];
      persistTrips(updated);
      return updated;
    });
  }, []);

  const removeTrip = useCallback((id: string) => {
    setTrips((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      persistTrips(updated);
      return updated;
    });
  }, []);

  const updateWalkTime = useCallback((id: string, walkTimeMinutes: number) => {
    setTrips((prev) => {
      const updated = prev.map((t) => (t.id === id ? { ...t, walkTimeMinutes } : t));
      persistTrips(updated);
      return updated;
    });
  }, []);

  const reorderTrips = useCallback((fromIndex: number, toIndex: number) => {
    setTrips((prev) => {
      if (fromIndex === toIndex) return prev;
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);
      persistTrips(updated);
      return updated;
    });
  }, []);

  return { trips, addTrip, removeTrip, updateWalkTime, reorderTrips };
}
