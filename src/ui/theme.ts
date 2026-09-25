/** Colours and sizes. No image paths here: those live in the content JSON. */

// Sized so a 9x9 arena fits a 900px-tall window next to the panels; the board still
// shrinks by CSS below that, see .board canvas.
export const HEX_SIZE = 40;

export const COLORS = {
  background: 0x14161c,
  panel: '#1c1f28',
  panelBorder: '#2b3040',
  text: '#e6e8ef',
  textDim: '#8b91a5',
  textSoft: 0xc9cddb,

  hexFill: 0x252a36,
  hexFillAlt: 0x2a2f3d,
  hexLine: 0x3a4152,
  hexHover: 0xd8dcea,

  /** Where a selected ability may be aimed: the answer to "what is its range". */
  reach: 0x30536e,
  reachEdge: 0x4d7a9c,
  range: 0x3f86c0,
  rangeEdge: 0x9fd8ff,
  reachable: 0x2f6f4f,
  path: 0x4bbd7f,
  abilityZone: 0xd05a4a,
  abilityZoneAlly: 0x4a9fd0,
  provoke: 0xe0902a,
  illegal: 0x7a2b2b,

  rockFill: 0x6a7085,
  rockEdge: 0x30343f,
  thicketFill: 0x2e6b40,
  thicketEdge: 0x1b4027,
  columnFill: 0xc9c2ae,
  columnEdge: 0x6f6856,
  collapseFill: 0x2a0f0f,
  collapseEdge: 0xb0412e,
  highFill: 0x8a6d3b,
  highEdge: 0xd9b25f,
  pitFill: 0x05070a,
  pitEdge: 0x3a4152,
  iceFill: 0xbfe6f5,
  iceEdge: 0x5aa9cf,
  smoke: 0x9aa0ab,
  trap: 0xb8a27a,
  pending: 0xff8a3d,
  /** The dashed ring that means "this hex stops line of sight". */
  sightBlocked: 0xf0c04a,

  /** The player's team is always blue and the opponent always red, whichever letter. */
  ours: 0x5aa9f0,
  theirs: 0xf0705a,
  active: 0xf0c04a,

  hpGood: 0x4bbd7f,
  hpLow: 0xd4674a,

  float: {
    damage: 0xffd7cf,
    crit: 0xffc24a,
    heal: 0x7ff0ae,
    block: 0x9fd0ff,
    status: 0xd7b8ff,
  },
} as const;

/** Colour per class. Heroes are drawn as class silhouettes; see ui/board/render.ts. */
export const CLASS_COLORS: Record<string, number> = {
  warrior: 0xe05a4a,
  paladin: 0xf0c53a,
  hunter: 0x54c96a,
  mage: 0x4aa3f0,
  priest: 0xf2f5fa,
  warlock: 0xb46ae0,
  rogue: 0x8fa3b5,
  monk: 0xe67e22,
  imp: 0xd9483b,
};

export function classColor(id: string): number {
  return CLASS_COLORS[id] ?? 0x888888;
}

/**
 * A side's colour as the player sees it. The player can draft as either A or B, so
 * the colour follows whose team it is rather than the letter.
 */
export function sideColor(side: 'A' | 'B', playerSide: 'A' | 'B'): number {
  return side === playerSide ? COLORS.ours : COLORS.theirs;
}

export function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}
