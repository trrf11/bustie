import { useCallback } from 'react';
import { useState } from 'react';
import { BusMap } from './components/BusMap';
import { DirectionFilter, type DirectionFilterValue } from './components/DirectionFilter';
import { SavedTrips } from './components/SavedTrips';
// import { DelayLeaderboard } from './components/DelayLeaderboard';
import { InstagramFeed } from './components/InstagramFeed';
import { Accordion } from './components/Accordion';
import { BottomSheet } from './components/BottomSheet';
import { useVehicles } from './hooks/useVehicles';
import { useSavedTrips } from './hooks/useSavedTrips';
import type { StopInfo } from './types';
import './App.css';

// TPC codes per direction (GTFS stop name → OVapi TimingPointCode).
// Many stops have different TPC codes per direction (opposite platform).
// Key format: "direction:stopName" — direction matches the map direction (1 or 2).
// Direction 1 = Zandvoort → Amsterdam (GTFS direction 0)
// Direction 2 = Amsterdam → Zandvoort (GTFS direction 1)
const STOP_TPC_MAP: Record<string, string> = {
  // Direction 1 — Richting Amsterdam
  '1:Zandvoort, Zandvoort Centrum': '55211310',
  '1:Zandvoort, Kostverlorenstraat': '55210170',
  '1:Zandvoort, Huis in de Duinen': '55210050',
  '1:Zandvoort, Waterleiding/Nw. Unicum': '55210070',
  '1:Bentveld, Westerduinweg': '55145010',
  '1:Aerdenhout, Spechtlaan': '55145030',
  '1:Aerdenhout, Viersprong': '55145070',
  '1:Heemstede, Stat.Heemstede-Aerdenh.': '55142200',
  '1:Heemstede, Leidsevaartweg': '55002020',
  '1:Haarlem, Edisonstraat': '55002140',
  '1:Haarlem, Schouwtjesbrug': '55002180',
  '1:Haarlem, Emmaplein': '55002200',
  '1:Haarlem, Centrum/Houtplein': '55000150',
  '1:Haarlem, Rustenburgerlaan': '55007510',
  '1:Haarlem, Schipholweg/Europaweg': '55001070',
  '1:Haarlem, Burg. Reinaldapark': '55004160',
  '1:Haarlem, Jac. van Looystraat': '55007530',
  '1:Haarlem, Prins Bernhardlaan': '55007500',
  '1:Haarlem, Station Spaarnwoude': '55007550',
  '1:Halfweg, Station Halfweg-Zwanenbrg': '55230110',
  '1:Halfweg, Oranje Nassaustraat': '55230050',
  "1:Amsterdam, Plein '40-45": '30003130',
  '1:Amsterdam, Burg. Fockstraat': '30003054',
  '1:Amsterdam, Stat. De Vlugtlaan': '30003163',
  '1:Amsterdam, Bos en Lommerplein': '30003060',
  '1:Amsterdam, Egidiusstraat': '30003037',
  '1:Amsterdam, Bos en Lommerweg': '30002177',
  '1:Amsterdam, Ch. de Bourbonstraat': '57131530',
  '1:Amsterdam, De Rijpgracht': '57131550',
  '1:Amsterdam, G.v. Ledenberchstraat': '30002129',
  '1:Amsterdam, Rozengracht': '30002127',
  '1:Amsterdam, Busstation Elandsgracht': '57003574',

  // Direction 2 — Richting Zandvoort
  '2:Amsterdam, Busstation Elandsgracht': '57003574',
  '2:Amsterdam, G.v. Ledenberchstraat': '30002128',
  '2:Amsterdam, De Rijpgracht': '57131540',
  '2:Amsterdam, Ch. de Bourbonstraat': '57131520',
  '2:Amsterdam, Bos en Lommerweg': '30003038',
  '2:Amsterdam, Egidiusstraat': '30003036',
  '2:Amsterdam, Bos en Lommerplein': '30003061',
  '2:Amsterdam, Stat. De Vlugtlaan': '30003162',
  '2:Amsterdam, Burg. Fockstraat': '30003055',
  "2:Amsterdam, Plein '40-45": '30003087',
  '2:Halfweg, Oranje Nassaustraat': '55230040',
  '2:Halfweg, Station Halfweg-Zwanenbrg': '55230100',
  '2:Haarlem, Station Spaarnwoude': '55000320',
  '2:Haarlem, Springerlaan [Tijdelijk]': '55007560',
  '2:Haarlem, Burgemeester Reinaldapark': '55007540',
  '2:Haarlem, Schipholweg/Europaweg': '55001241',
  '2:Haarlem, Rustenburgerlaan': '55007580',
  '2:Haarlem, Centrum/Houtplein': '55000120',
  '2:Haarlem, Emmaplein': '55002150',
  '2:Haarlem, Schouwtjesbrug': '55002170',
  '2:Haarlem, Edisonstraat': '55002210',
  '2:Heemstede, Leidsevaartweg': '55142010',
  '2:Heemstede, Stat.Heemstede-Aerdenh.': '55145520',
  '2:Aerdenhout, Viersprong': '55145040',
  '2:Aerdenhout, Spechtlaan': '55145080',
  '2:Bentveld, Westerduinweg': '55210020',
  '2:Zandvoort, Waterleiding/Nw. Unicum': '55210040',
  '2:Zandvoort, Huis in de Duinen': '55210060',
  '2:Zandvoort, Kostverlorenstraat': '55210080',
  '2:Zandvoort, Koninginneweg': '55210100',
  '2:Zandvoort, Zandvoort Centrum': '55211310',
};

function App() {
  const { data: vehiclesData, error: vehiclesError, loading: vehiclesLoading } = useVehicles();
  const [directionFilter, setDirectionFilter] = useState<DirectionFilterValue>('all');
  const { trips: savedTrips, addTrip, removeTrip, removeTripByStop, updateWalkTime, reorderTrips } = useSavedTrips();

  const handleSaveStop = useCallback((stop: StopInfo, direction: number) => {
    const tpc = STOP_TPC_MAP[`${direction}:${stop.name}`];
    if (!tpc) return;
    addTrip({
      stopName: stop.name,
      tpc,
      direction,
      directionLabel: direction === 1 ? 'Richting Amsterdam' : 'Richting Zandvoort',
      walkTimeMinutes: 0,
    });
  }, [addTrip]);

  return (
    <div className="app">
      <header className="app-header">
        <img src="/bus80-logo.png" alt="Bustie logo" className="app-logo" />
        <h1>Hey, bustie!</h1>
        {vehiclesData && (() => {
          const count = directionFilter === 'all'
            ? vehiclesData.vehicles.length
            : vehiclesData.vehicles.filter((v) => v.direction === directionFilter).length;
          return (
            <span className="vehicle-count">
              {count} bus{count !== 1 ? 'sen' : ''} actief
            </span>
          );
        })()}
      </header>

      <main className="app-main">
        <div className="map-section">
          <DirectionFilter value={directionFilter} onChange={setDirectionFilter} />
          {vehiclesError && !vehiclesData && (
            <div className="error-overlay">Kan kaartdata niet laden</div>
          )}
          {vehiclesLoading && !vehiclesData && (
            <div className="loading-overlay">Kaart laden...</div>
          )}
          <BusMap
            data={vehiclesData}
            directionFilter={directionFilter}
            savedTrips={savedTrips}
            tpcMap={STOP_TPC_MAP}
            onSaveStop={handleSaveStop}
            onRemoveStop={removeTripByStop}
          />
          {vehiclesData?.stale && (
            <div className="stale-banner">Data is mogelijk verouderd</div>
          )}
          {vehiclesData && vehiclesData.vehicles.length === 0 && (
            <div className="no-service-overlay">
              Geen bus 80 voertuigen actief.
              <br />
              Dienstregeling: 6:00 – 0:00.
            </div>
          )}
        </div>

        {/* Desktop: sidebar */}
        <div className="side-content desktop-only">
          <SavedTrips
            trips={savedTrips}
            onRemove={removeTrip}
            onUpdateWalkTime={updateWalkTime}
            onReorder={reorderTrips}
          />

          {/* Hall of Shame — temporarily hidden
          <Accordion title="Hall of Shame">
            <DelayLeaderboard />
          </Accordion>
          */}

          <Accordion title="Bus80 spotter">
            <InstagramFeed />
          </Accordion>
        </div>

        {/* Mobile: bottom sheet */}
        <BottomSheet>
          <div className="side-content">
            <SavedTrips
              trips={savedTrips}
              onRemove={removeTrip}
              onUpdateWalkTime={updateWalkTime}
              onReorder={reorderTrips}
            />

            {/* Hall of Shame — temporarily hidden
            <Accordion title="Hall of Shame">
              <DelayLeaderboard />
            </Accordion>
            */}

            <Accordion title="Bus80 spotter">
              <InstagramFeed />
            </Accordion>
          </div>
        </BottomSheet>
      </main>
    </div>
  );
}

export default App;
