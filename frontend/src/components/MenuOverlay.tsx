import { useEffect, useState } from 'react';

interface MenuOverlayProps {
  onClose: () => void;
}

export function MenuOverlay({ onClose }: MenuOverlayProps) {
  const [showAbout, setShowAbout] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleClose = () => {
    setClosing(true);
  };

  return (
    <div
      className={`menu-overlay${closing ? ' menu-overlay--closing' : ''}`}
      onAnimationEnd={() => { if (closing) onClose(); }}
    >
      <div className="menu-overlay-header">
        <button
          className="menu-overlay-back"
          onClick={showAbout ? () => setShowAbout(false) : handleClose}
          aria-label="Terug"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="menu-overlay-title">
          {showAbout ? 'Over busties.nl' : 'Menu'}
        </span>
      </div>

      {showAbout ? (
        <div className="menu-overlay-body">
          <div className="menu-about">
            <div className="menu-about-section">
              <h2>Hey, bustie!</h2>
              <p>
                busties.nl is een leuk projectje dat lijn 80 volgt tussen Amsterdam en Zandvoort.
                Op de kaart zie je ongeveer waar de bussen rijden en wanneer ze bij jouw halte aankomen.
              </p>
            </div>

            <div className="menu-about-section">
              <h3>Hoe werkt het?</h3>
              <p>
                busties.nl gebruikt open data om de posities en vertrektijden van bus 80 te laten zien.
                We halen elke 60 seconden nieuwe data op en proberen zo dicht mogelijk bij realtime te komen met wat er beschikbaar is.
                Sla je favoriete haltes op en je ziet in één oogopslag wanneer je de deur uit moet.
              </p>
            </div>

            <div className="menu-about-section menu-about-credit">
              <p>
                Data via{' '}
                <a href="https://ovapi.nl" target="_blank" rel="noopener noreferrer">
                  OVapi
                </a>{' '}
                — de open OV-databron van Nederland.
              </p>
            </div>

            <div className="menu-about-section">
              <p>
                Feedback? Stuur een berichtje!{' '}
                <a href="https://www.instagram.com/fokkertimothy/" target="_blank" rel="noopener noreferrer">
                  @fokkertimothy
                </a>
              </p>
            </div>

            <div className="menu-about-version">
              v{__APP_VERSION__}
            </div>
          </div>
        </div>
      ) : (
        <div className="menu-overlay-body">
          <div className="menu-list">
            <a
              className="menu-item"
              href="https://www.instagram.com/bus80spotter"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="menu-item-label">Bus80spotter on IG</span>
              <svg className="menu-item-chevron" width="16" height="16" viewBox="0 0 20 20" fill="none">
                <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </a>
            <button
              className="menu-item"
              onClick={() => setShowAbout(true)}
            >
              <span className="menu-item-label">Over busties.nl</span>
              <svg className="menu-item-chevron" width="16" height="16" viewBox="0 0 20 20" fill="none">
                <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
