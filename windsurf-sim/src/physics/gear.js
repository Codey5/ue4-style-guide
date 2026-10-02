// Board, sail and sailor definitions. Dimensions follow typical current
// production gear. Board-frame x is measured from the middle of the board
// (positive toward the nose); "fromTail" values are converted below.

const board = (def) => {
  const half = def.length / 2;
  return {
    ...def,
    mastFootX: def.mastTrackFromTail - half,
    frontStrapX: def.frontStrapFromTail - half,
    backStrapX: def.backStrapFromTail - half,
    finX: -half + 0.17,
    transomX: -half,
    thickness: def.thickness ?? 0.11,
  };
};

export const BOARDS = [
  board({
    id: 'begin210', name: 'Beginner 210 L', type: 'Beginner board with daggerboard',
    length: 2.6, width: 0.9, tailWidth: 0.62, volume: 210, mass: 15,
    finArea: 0.022, finDepth: 0.28,
    dagger: { area: 0.12, depth: 0.52, x: 0.08 },
    mastTrackFromTail: 1.48, frontStrapFromTail: 0.88, backStrapFromTail: 0.42,
    maxTrim: 6, thickness: 0.17, color: 0x2a9df4,
    blurb: 'Wide, stable and forgiving. The daggerboard lets you sail upwind slowly — perfect for learning to uphaul, tack and gybe.',
  }),
  board({
    id: 'free155', name: 'Freeride 155 L', type: 'Wide freeride',
    length: 2.5, width: 0.85, tailWidth: 0.55, volume: 155, mass: 9.6,
    finArea: 0.05, finDepth: 0.5,
    mastTrackFromTail: 1.39, frontStrapFromTail: 0.8, backStrapFromTail: 0.34,
    maxTrim: 6.5, thickness: 0.14, color: 0xf2a33a,
    blurb: 'Early planing and still uphaulable. The step from learning to blasting.',
  }),
  board({
    id: 'free135', name: 'Freeride 135 L', type: 'Freeride',
    length: 2.45, width: 0.78, tailWidth: 0.5, volume: 135, mass: 8.4,
    finArea: 0.042, finDepth: 0.44,
    mastTrackFromTail: 1.35, frontStrapFromTail: 0.77, backStrapFromTail: 0.32,
    maxTrim: 6.5, thickness: 0.13, color: 0xe8e8e8,
    blurb: 'The all-rounder. Planes early with a 7 m² sail and carves a smooth gybe.',
  }),
  board({
    id: 'free115', name: 'Freeride 115 L', type: 'Freeride',
    length: 2.38, width: 0.7, tailWidth: 0.44, volume: 115, mass: 7.4,
    finArea: 0.034, finDepth: 0.38,
    mastTrackFromTail: 1.31, frontStrapFromTail: 0.74, backStrapFromTail: 0.3,
    maxTrim: 6.5, thickness: 0.12, color: 0xd94a4a,
    blurb: 'Faster and looser. Needs more wind, rewards good stance and trim.',
  }),
  board({
    id: 'move95', name: 'Freemove 95 L', type: 'Freemove',
    length: 2.3, width: 0.62, tailWidth: 0.39, volume: 95, mass: 6.5,
    finArea: 0.026, finDepth: 0.32,
    mastTrackFromTail: 1.27, frontStrapFromTail: 0.71, backStrapFromTail: 0.28,
    maxTrim: 6.5, thickness: 0.11, color: 0x37c28a,
    blurb: 'Close to a sinker for most sailors — waterstart only. Lively in strong wind.',
  }),
];

// Luff and boom lengths from typical freeride sail charts.
const SAIL_TABLE = [
  [3.7, 3.88, 1.5], [4.2, 4.08, 1.6], [4.7, 4.3, 1.7], [5.3, 4.45, 1.79],
  [5.8, 4.55, 1.86], [6.3, 4.66, 1.94], [7.0, 4.85, 2.05], [7.8, 4.98, 2.15],
  [8.6, 5.12, 2.27], [9.5, 5.3, 2.38],
];

export const SAILS = SAIL_TABLE.map(([area, luff, boom]) => ({
  id: `sail${area}`,
  name: `${area.toFixed(1)} m²`,
  area,
  luff,
  boom,
  // sail + mast + boom + extension + base
  rigMass: 2.4 + 0.88 * area,
  clMax: 1.55,
}));

export const DEFAULT_SAILOR = { mass: 75, height: 1.8 };

export const findBoard = (id) => BOARDS.find((b) => b.id === id) ?? BOARDS[2];
export const findSail = (area) =>
  SAILS.reduce((best, s) => (Math.abs(s.area - area) < Math.abs(best.area - area) ? s : best), SAILS[0]);
