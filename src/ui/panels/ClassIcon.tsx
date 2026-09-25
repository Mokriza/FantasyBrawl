/**
 * The same silhouettes the board draws, as inline SVG, so a hero looks the same in
 * the roster, in the turn queue and on the field. Shapes, not assets: see ASSETS.md.
 */

import type { CSSProperties } from 'react';
import { classFigure, figureBackgroundStyle } from '../assets/sprites.js';
import { classColor, toCss } from '../theme.js';

const PATHS: Record<string, JSX.Element> = {
  // Sword
  warrior: (
    <g>
      <path d="M12 3 L14.5 7 L14.5 15 L9.5 15 L9.5 7 Z" />
      <rect x="5" y="15" width="14" height="2.6" rx="1.2" />
      <rect x="10.8" y="17.6" width="2.4" height="4" rx="1" />
    </g>
  ),
  // War hammer
  paladin: (
    <g>
      <rect x="10.8" y="6" width="2.4" height="15" rx="1" />
      <rect x="5" y="3" width="14" height="6.4" rx="1.6" />
    </g>
  ),
  // Bow with a nocked arrow
  hunter: (
    <g fill="none" strokeLinecap="round">
      <path d="M15 4 A 9 9 0 0 1 15 20" strokeWidth="2.4" />
      <path d="M8 4 L8 20" strokeWidth="1.6" />
      <path d="M8 12 L19 12" strokeWidth="2" />
    </g>
  ),
  // Staff with an orb
  mage: (
    <g>
      <rect x="10.8" y="9" width="2.4" height="12" rx="1" />
      <circle cx="12" cy="7" r="4.6" />
      <circle cx="12" cy="7" r="2" fill="#14161c" />
    </g>
  ),
  // Healer's cross
  priest: (
    <g>
      <rect x="10" y="3" width="4" height="18" rx="1.6" />
      <rect x="5" y="9" width="14" height="4" rx="1.6" />
    </g>
  ),
  // Skull
  warlock: (
    <g>
      <circle cx="12" cy="10" r="7" />
      <rect x="8" y="15" width="8" height="5" rx="1.6" />
      <circle cx="9.5" cy="9.5" r="2.1" fill="#14161c" />
      <circle cx="14.5" cy="9.5" r="2.1" fill="#14161c" />
    </g>
  ),
  // Dagger
  rogue: (
    <g>
      <path d="M12 3 L14 6 L14 14 L10 14 L10 6 Z" />
      <rect x="7" y="14" width="10" height="2.2" rx="1" />
      <rect x="11" y="16.2" width="2" height="4.8" rx="1" />
    </g>
  ),
  // Fist
  monk: (
    <g>
      <rect x="6" y="8" width="12" height="9" rx="3" />
      <rect x="8" y="17" width="8" height="4" rx="1.2" />
    </g>
  ),
};

interface Props {
  readonly classId: string;
  readonly size?: number;
}

/**
 * The hero sprite from the sheet, so the roster and the queue show the same figure
 * the board does. Falls back to the vector shape above when no sprite is configured,
 * because a missing asset must never break the screen.
 */
export function ClassIcon({ classId, size = 24 }: Props): JSX.Element {
  const figure = classFigure(classId);
  if (figure !== null) {
    // The class colour rings the sprite here the same way it rings it on the board.
    return (
      <span
        className={`class-icon class-sprite${figure.tint === null ? '' : ' class-tinted'}`}
        aria-hidden="true"
        style={
          {
            ...figureBackgroundStyle(figure, size),
            borderColor: toCss(classColor(classId)),
            // Multiplying an overlay is what Pixi's tint does, so the figure looks
            // the same in the panels as it does on the board.
            ...(figure.tint === null ? {} : { ['--tint']: figure.tint }),
          } as CSSProperties
        }
      />
    );
  }

  const color = toCss(classColor(classId));
  return (
    <svg
      className="class-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={color}
      stroke={color}
    >
      {PATHS[classId] ?? <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}
