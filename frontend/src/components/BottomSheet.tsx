import { type ReactNode, forwardRef, useImperativeHandle, useRef } from 'react';
import { BottomSheet as PureBottomSheet } from 'pure-web-bottom-sheet/react';

export interface BottomSheetHandle {
  collapse: () => void;
}

interface BottomSheetProps {
  children: ReactNode;
}

/**
 * Mobile bottom sheet using pure-web-bottom-sheet.
 * Three fixed snap points: peek (12dvh), mid (45dvh), full (85dvh).
 */
export const BottomSheet = forwardRef<BottomSheetHandle, BottomSheetProps>(
  function BottomSheet({ children }, ref) {
    const sheetRef = useRef<HTMLElement>(null);

    useImperativeHandle(ref, () => ({
      collapse() {
        // Snap to peek by scrolling the sheet to top
        const el = sheetRef.current;
        if (el) {
          el.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
    }));

    return (
      <PureBottomSheet
        ref={sheetRef as React.RefObject<never>}
        tabIndex={0}
        nested-scroll
        expand-to-scroll
        className="bottom-sheet"
      >
        <div slot="snap" style={{ '--snap': '12dvh' } as React.CSSProperties} />
        <div slot="snap" style={{ '--snap': '45dvh' } as React.CSSProperties} className="initial" />
        <div slot="snap" style={{ '--snap': '85dvh' } as React.CSSProperties} />

        {children}
      </PureBottomSheet>
    );
  }
);
