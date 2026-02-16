import { useEffect } from 'react';
import { InstagramFeed } from './InstagramFeed';

interface CommunityOverlayProps {
  onClose: () => void;
}

export function CommunityOverlay({ onClose }: CommunityOverlayProps) {
  // Prevent body scroll while overlay is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  return (
    <div className="community-overlay">
      <div className="community-overlay-header">
        <button className="community-overlay-back" onClick={onClose} aria-label="Terug">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className="community-overlay-title">Community</span>
      </div>
      <div className="community-overlay-body">
        <InstagramFeed />
      </div>
    </div>
  );
}
