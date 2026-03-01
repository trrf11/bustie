const STORAGE_KEY = 'bus80-client-id';

let cachedId: string | null = null;

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch {
      // Falls through — randomUUID requires secure context
    }
  }
  // Fallback for HTTP on LAN (e.g. 192.168.x.x:3000)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function useClientId(): string {
  if (cachedId) return cachedId;

  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = generateId();
    localStorage.setItem(STORAGE_KEY, id);
  }
  cachedId = id;
  return id;
}
