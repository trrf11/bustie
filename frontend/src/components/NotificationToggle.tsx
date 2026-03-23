import type { PushState } from '../hooks/usePushNotifications';

interface NotificationToggleProps {
  state: PushState;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
  sendTest: () => Promise<void>;
  testSending: boolean;
}

export function NotificationToggle({ state, subscribe, unsubscribe, sendTest, testSending }: NotificationToggleProps) {

  if (state === 'loading') {
    return (
      <div className="menu-about">
        <div className="menu-about-section">
          <p>Laden...</p>
        </div>
      </div>
    );
  }

  if (state === 'unsupported') {
    return (
      <div className="menu-about">
        <div className="menu-about-section">
          <h2>Niet beschikbaar</h2>
          <p>
            Je browser ondersteunt geen push notificaties.
            Probeer Chrome, Firefox of Safari op een recente versie.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'ios-use-safari') {
    return (
      <div className="menu-about">
        <div className="menu-about-section">
          <h2>Gebruik Safari</h2>
          <p>
            Op iOS werken notificaties alleen via Safari.
            Open busties.nl in Safari en voeg de app toe aan je beginscherm.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'ios-old-version') {
    return (
      <div className="menu-about">
        <div className="menu-about-section">
          <h2>Update vereist</h2>
          <p>
            Update je iPhone naar iOS 16.4 of nieuwer om notificaties te ontvangen.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'ios-not-installed') {
    return (
      <div className="menu-about">
        <div className="menu-about-section">
          <h2>Voeg toe aan beginscherm</h2>
          <p>
            Op iOS werken notificaties alleen als de app is toegevoegd aan je beginscherm.
          </p>
        </div>
        <div className="ios-install-steps">
          <div className="ios-install-step">
            <svg className="ios-install-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v10M8 9l4-4 4 4" />
              <rect x="4" y="14" width="16" height="6" rx="2" />
            </svg>
            <span>Tik op het deel-icoon onderaan</span>
          </div>
          <div className="ios-install-step">
            <svg className="ios-install-icon" viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" />
              <path d="M12 8v8M8 12h8" />
            </svg>
            <span>Kies 'Zet op beginscherm'</span>
          </div>
          <div className="ios-install-step">
            <img className="ios-install-app-icon" src="/icons/icon-192.png" alt="busties" width="28" height="28" />
            <span>Open busties vanaf je beginscherm</span>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="menu-about">
        <div className="menu-about-section">
          <h2>Notificaties geblokkeerd</h2>
          <p>
            Je hebt notificaties geblokkeerd voor deze site.
            Om ze weer in te schakelen, ga naar je browser- of systeeminstellingen
            en sta notificaties toe voor busties.nl.
          </p>
        </div>
      </div>
    );
  }

  if (state === 'prompt') {
    return (
      <div className="menu-about">
        <div className="menu-about-section">
          <h2>Notificaties</h2>
          <p>
            Ontvang een melding als je bus bijna bij je halte is.
            Zo hoef je niet steeds de app te checken.
          </p>
        </div>
        <div className="menu-about-section">
          <button className="notification-btn" onClick={subscribe}>
            Inschakelen
          </button>
        </div>
      </div>
    );
  }

  // state === 'subscribed'
  return (
    <div className="menu-about">
      <div className="menu-about-section">
        <h2>Notificaties</h2>
        <div className="notification-status">
          <span className="notification-status-dot" />
          <span>Ingeschakeld</span>
        </div>
      </div>

      <div className="menu-about-section">
        <button
          className="notification-btn"
          onClick={sendTest}
          disabled={testSending}
        >
          {testSending ? 'Verzenden...' : 'Test notificatie'}
        </button>
      </div>

      <div className="menu-about-section">
        <button
          className="notification-btn notification-btn--secondary"
          onClick={unsubscribe}
        >
          Uitschakelen
        </button>
      </div>
    </div>
  );
}
