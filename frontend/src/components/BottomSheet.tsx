import { useState, useCallback, type ReactNode } from 'react';
import { Drawer } from 'vaul';

interface BottomSheetProps {
  children: ReactNode;
}

const SNAP_POINTS = [0.12, 0.45, 0.8] as const;
const DEFAULT_SNAP = 0.45;

/**
 * Mobile bottom sheet using vaul's Drawer.
 *
 * Vaul handles all drag/scroll logic natively via its shouldDrag function:
 *   - If a scrollable element has scrollTop > 0 → scroll, don't drag
 *   - If scrollTop === 0 → drag the drawer
 *
 * The body element has a max-height matching the visible drawer area
 * so content overflows and vaul can detect the scrollable container.
 */
export function BottomSheet({ children }: BottomSheetProps) {
  const [snap, setSnap] = useState<number | string | null>(DEFAULT_SNAP);

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) return;
  }, []);

  // Calculate visible height based on current snap so the body
  // element overflows and vaul's shouldDrag can detect it as scrollable.
  const snapFraction = typeof snap === 'number' ? snap : DEFAULT_SNAP;
  const bodyMaxHeight = `calc(${snapFraction * 100}dvh - 28px)`;

  return (
    <Drawer.Root
      open
      onOpenChange={handleOpenChange}
      modal={false}
      snapPoints={SNAP_POINTS as unknown as number[]}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      dismissible={false}
      noBodyStyles
    >
      <Drawer.Portal>
        <Drawer.Content className="bottom-sheet" aria-describedby={undefined}>
          <Drawer.Handle className="bottom-sheet-handle" />
          <div className="bottom-sheet-body" style={{ maxHeight: bodyMaxHeight }}>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
