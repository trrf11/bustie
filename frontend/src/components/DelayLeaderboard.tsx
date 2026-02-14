import { useState, useEffect } from 'react';
import type { DelayStatsResponse } from '../types';

type Period = 'today' | 'week' | 'month';

export function DelayLeaderboard() {
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<DelayStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/stats/delays?period=${period}`)
      .then((res) => res.json())
      .then((json: DelayStatsResponse) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [period]);

  function formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  return (
    <div className="leaderboard">
      <div className="leaderboard-header">
        <h3>Hall of Shame</h3>
        <div className="period-tabs">
          {(['today', 'week', 'month'] as Period[]).map((p) => (
            <button
              key={p}
              className={`period-tab ${period === p ? 'active' : ''}`}
              onClick={() => { setLoading(true); setPeriod(p); }}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'This Week' : 'This Month'}
            </button>
          ))}
        </div>
      </div>

      {data && data.totalTripsTracked > 0 && (
        <div className="leaderboard-stats">
          <div className="stat">
            <span className="stat-value">{data.averageDelayMinutes}</span>
            <span className="stat-label">avg delay (min)</span>
          </div>
          <div className="stat">
            <span className="stat-value">{data.totalTripsTracked}</span>
            <span className="stat-label">trips tracked</span>
          </div>
        </div>
      )}

      {loading ? (
        <p className="loading-text">Loading...</p>
      ) : !data || data.worstDelays.length === 0 ? (
        <p className="no-data-text">No delay data recorded yet. Check back later.</p>
      ) : (
        <ul className="delay-list">
          {data.worstDelays.map((delay, i) => (
            <li key={`${delay.journeyNumber}-${delay.scheduledTime}`} className="delay-item">
              <span className="delay-rank">#{i + 1}</span>
              <div className="delay-details">
                <span className="delay-stop">{delay.stop}</span>
                <span className="delay-meta">
                  {formatDate(delay.date)} at {formatTime(delay.scheduledTime)}
                </span>
              </div>
              <span className="delay-amount">+{delay.delayMinutes} min</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
