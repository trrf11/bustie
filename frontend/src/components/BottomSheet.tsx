import { useState, useCallback, type ReactNode } from 'react';
import { Drawer } from 'vaul';

interface BottomSheetProps {
  children: ReactNode;
}

const SNAP_POINTS = [0.12, 0.45, 0.8];
const DEFAULT_SNAP = 0.45;

/**
 * Mobile bottom sheet using vaul's Drawer.
 *
 * Always open (non-dismissible) — the user drags between snap points
 * to reveal more or less content. The map stays fully visible behind it.
 *
 * Snap points:
 *   - 0.12  → collapsed: just the drag handle + peek at first card
 *   - 0.45  → half: ~2 saved trips visible, map still dominant
 *   - 0.80  → expanded: full content scrollable, header + map peek visible
 */
export function BottomSheet({ children }: BottomSheetProps) {
  const [snap, setSnap] = useState<number | string | null>(DEFAULT_SNAP);

  // Prevent closing — always keep open
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) return;
  }, []);

  return (
    <Drawer.Root
      open
      onOpenChange={handleOpenChange}
      modal={false}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      dismissible={false}
      noBodyStyles
    >
      <Drawer.Portal>
        <Drawer.Content className="bottom-sheet" aria-describedby={undefined}>
          <Drawer.Handle className="bottom-sheet-handle" />
          <div className="bottom-sheet-body">
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
