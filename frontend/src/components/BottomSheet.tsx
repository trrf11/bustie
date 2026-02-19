import { type ReactNode, forwardRef, useImperativeHandle, useState } from 'react';
import { Drawer } from 'vaul';

export interface BottomSheetHandle {
  collapse: () => void;
}

interface BottomSheetProps {
  children: ReactNode;
}

const SNAP_POINTS = [0.14, 0.52, 0.80] as const;
const DEFAULT_SNAP = SNAP_POINTS[0];

/**
 * Mobile bottom sheet using vaul (CSS transform-based).
 * Three snap points: peek (14%), mid (52%), full (80%).
 * Opens at peek. Always open, non-dismissible, non-modal so the map stays interactive.
 */
export const BottomSheet = forwardRef<BottomSheetHandle, BottomSheetProps>(
  function BottomSheet({ children }, ref) {
    const [snap, setSnap] = useState<number | string | null>(DEFAULT_SNAP);

    useImperativeHandle(ref, () => ({
      collapse() {
        setSnap(SNAP_POINTS[0]);
      },
    }));

    // Only allow scrolling when fully expanded
    const isFullyOpen = snap === SNAP_POINTS[2];

    return (
      <Drawer.Root
        open
        modal={false}
        snapPoints={SNAP_POINTS as unknown as number[]}
        activeSnapPoint={snap}
        setActiveSnapPoint={setSnap}
        dismissible={false}
      >
        <Drawer.Portal>
          <Drawer.Content className="bottom-sheet">
            <div className="bottom-sheet-handle-area">
              <div className="bottom-sheet-handle" />
            </div>
            <div
              className="bottom-sheet-body"
              style={{ overflowY: isFullyOpen ? 'auto' : 'hidden' }}
            >
              {children}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }
);
