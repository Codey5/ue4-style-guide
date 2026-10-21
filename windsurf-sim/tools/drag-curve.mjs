// Prints the hull resistance curve (the planing hump) for a board.
import { planingSolve, frictionCoefficient } from '../src/physics/hull.js';
import { findBoard } from '../src/physics/gear.js';
import { DEG, MS_TO_KN } from '../src/physics/math.js';
const board = findBoard(process.argv[2] ?? 'free135');
const W = +(process.argv[3] ?? 900);
for (const [label, x] of [['weight forward (by mast)', board.mastFootX - 0.35], ['feet in straps', (board.frontStrapX + board.backStrapX) / 2]]) {
  console.log(`${board.name}, W=${W} N, ${label} (x=${x.toFixed(2)})`);
  for (const v of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14]) {
    const r = planingSolve(v, W, x, board, 0.2);
    console.log(`  ${(v * MS_TO_KN).toFixed(1).padStart(5)} kn  drag ${r.drag.toFixed(0).padStart(4)} N  p ${r.planing.toFixed(2)} trim ${(r.trim / DEG).toFixed(1)}° wet ${r.wetArea.toFixed(2)} m² λ ${r.lambda.toFixed(2)} | trim ${r.dTrim.toFixed(0)} wave ${r.dWave.toFixed(0)} fric ${r.dFric.toFixed(0)} tail ${r.dTail.toFixed(0)} nose ${r.dNose.toFixed(0)} chop ${r.dChop.toFixed(0)}`);
  }
}
