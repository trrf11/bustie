import { useEffect, useRef } from 'react';

// Curated posts from the bus 80 Instagram community
// Update these URLs to feature different posts
const INSTAGRAM_POST_URLS: string[] = [
  'https://www.instagram.com/p/DUvBw-VCBnX/',
];

export function InstagramFeed() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load Instagram embed script
    const win = window as Window & { instgrm?: { Embeds: { process: () => void } } };
    if (INSTAGRAM_POST_URLS.length > 0 && !win.instgrm) {
      const script = document.createElement('script');
      script.src = 'https://www.instagram.com/embed.js';
      script.async = true;
      document.body.appendChild(script);
    } else if (win.instgrm) {
      win.instgrm.Embeds.process();
    }
  }, []);

  return (
    <div className="instagram-section">
      <div className="instagram-embeds" ref={containerRef}>
        {INSTAGRAM_POST_URLS.map((url) => (
          <blockquote
            key={url}
            className="instagram-media"
            data-instgrm-captioned
            data-instgrm-permalink={url}
            style={{ maxWidth: '540px', width: '100%' }}
          >
            <a href={url} target="_blank" rel="noopener noreferrer">
              View on Instagram
            </a>
          </blockquote>
        ))}
      </div>
    </div>
  );
}
