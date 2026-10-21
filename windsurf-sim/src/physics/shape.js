// Board outline, thickness and rocker: drawn by the renderer, and used by the
// body model for the deck height under the feet and at the mast foot.
import { clamp, lerp } from './math.js';

export function boardShape(board) {
  const L = board.length, W = board.width;
  const halfWidth = (s) => {
    const sw = 0.42;
    const tail = board.tailWidth * 0.42;
    if (s <= sw) return lerp(tail, W / 2, Math.pow(Math.sin((Math.PI / 2) * (s / sw)), 0.75));
    const k = (s - sw) / (1 - sw);
    return (W / 2) * Math.sqrt(Math.max(0, 1 - Math.pow(k, 2.3)));
  };
  const thick = (s) => board.thickness * (0.38 + 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.05)), 0.6)) * (s > 0.9 ? 1 - (s - 0.9) * 4 : 1);
  const rocker = (s) => (s > 0.62 ? 0.17 * Math.pow((s - 0.62) / 0.38, 2.4) : 0) + (s < 0.05 ? (0.05 - s) * 0.1 : 0);
  return { L, halfWidth, thick, rocker, sOf: (x) => (x + L / 2) / L };
}

/** Deck height (board frame) at board x — where the sailor's feet go. */
export function deckY(board, x) {
  const sh = boardShape(board);
  const s = clamp(sh.sOf(x), 0, 1);
  return sh.rocker(s) + sh.thick(s);
}
