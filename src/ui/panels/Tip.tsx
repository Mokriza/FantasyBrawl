/**
 * A hover card that shows at once, next to the cursor, and never runs off the window.
 * The browser's own title tooltip is slow and plain text; ability texts need more.
 */

import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** How far from the point the card sits, and how wide it may grow, in pixels. */
const OFFSET = 14;
const MAX_WIDTH = 340;
const MARGIN = 4;

export interface TipPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The card itself, at a point on the page; also used by the board, which has no DOM per
 * hex. It is measured first and then placed right of and below the point, or flipped
 * to the other side where the window ends.
 */
export function TipCard({ at, children }: { at: TipPoint; children: ReactNode }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const { width, height } = node.getBoundingClientRect();
    const right = at.x + OFFSET;
    const left = right + width + MARGIN > window.innerWidth ? Math.max(MARGIN, at.x - OFFSET - width) : right;
    const below = at.y + OFFSET;
    const top = below + height + MARGIN > window.innerHeight ? Math.max(MARGIN, at.y - OFFSET - height) : below;
    setPlace({ left, top });
  }, [at.x, at.y, children]);

  return createPortal(
    <div
      ref={ref}
      className="tip-card"
      style={{
        left: place?.left ?? at.x + OFFSET,
        top: place?.top ?? at.y + OFFSET,
        maxWidth: MAX_WIDTH,
        visibility: place === null ? 'hidden' : 'visible',
      }}
      role="tooltip"
    >
      {children}
    </div>,
    document.body,
  );
}

/** Wraps something hoverable: while the pointer is on it, the card follows the pointer. */
export function Tip({ tip, children, className }: { tip: ReactNode; children: ReactNode; className?: string }): JSX.Element {
  const [at, setAt] = useState<TipPoint | null>(null);
  const follow = (event: React.MouseEvent): void => setAt({ x: event.clientX, y: event.clientY });
  return (
    <span
      className={['tip-anchor', className].filter(Boolean).join(' ')}
      onMouseEnter={follow}
      onMouseMove={follow}
      onMouseLeave={() => setAt(null)}
    >
      {children}
      {at === null ? null : <TipCard at={at}>{tip}</TipCard>}
    </span>
  );
}
