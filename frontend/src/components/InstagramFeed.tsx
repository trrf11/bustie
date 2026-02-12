import { useEffect, useRef } from 'react';

// Curated posts from the bus 80 Instagram community
// Update these URLs to feature different posts
const INSTAGRAM_POST_URLS: string[] = [
  // Placeholder - replace with actual bus 80 community Instagram post URLs
  // 'https://www.instagram.com/p/XXXX/',
];

const INSTAGRAM_PAGE_URL = 'https://www.instagram.com/'; // Replace with actual bus 80 Instagram page

export function InstagramFeed() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load Instagram embed script
    if (INSTAGRAM_POST_URLS.length > 0 && !(window as any).instgrm) {
      const script = document.createElement('script');
      script.src = 'https://www.instagram.com/embed.js';
      script.async = true;
      document.body.appendChild(script);
    } else if ((window as any).instgrm) {
      (window as any).instgrm.Embeds.process();
    }
  }, []);

  return (
    <div className="instagram-section">
      <div className="instagram-header">
        <h3>Bus 80 Community</h3>
        <a
          href={INSTAGRAM_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="instagram-link"
        >
          Follow on Instagram
        </a>
      </div>

      {INSTAGRAM_POST_URLS.length === 0 ? (
        <div className="instagram-placeholder">
          <p>
            Bus 80 has a viral Instagram community! Posts will be featured here soon.
          </p>
          <a
            href={INSTAGRAM_PAGE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="instagram-cta"
          >
            Check out the Instagram page →
          </a>
        </div>
      ) : (
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
      )}
    </div>
  );
}
