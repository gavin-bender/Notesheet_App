import assert from 'node:assert/strict';
import { fitColumns } from '../src/view/PageFit';

// Match browser CSSOM: scrollHeight is unzoomed, and column width grows as
// zoom decreases, allowing text to reflow onto fewer lines.
function fixture(heightAtScale, initialZoom = '1') {
  const grid = { style: { zoom: initialZoom } };
  const columns = [{ get scrollHeight() { return heightAtScale(Number(grid.style.zoom)); } }];
  return { grid, columns };
}

const overflowing = fixture(() => 1200, '0.685');
const fit = () => fitColumns(overflowing.grid, overflowing.columns, 960, true);
assert.equal(fit().scale, 0.8, 'Uses local scrollHeight without dividing by previous zoom');
for (let i = 0; i < 20; i++) {
  assert.deepEqual(fit(), { scale: 0.8, height: 960 }, 'Repeated fits are stable');
}

const reflowing = fixture(scale => scale < 0.9 ? 1000 : 1200);
const reflow = fitColumns(reflowing.grid, reflowing.columns, 960, true);
assert.equal(reflow.scale, 0.899, 'Finds the largest fit after text reflows');
assert.ok(reflow.height <= 960);
assert.ok(1200 * 0.9 > 960, 'The next scale step would overflow');

const short = fixture(() => 700, '0.65');
assert.equal(fitColumns(short.grid, short.columns, 960, true).scale, 1, 'Restores full size when content fits');
assert.equal(fitColumns(overflowing.grid, overflowing.columns, 960, false).scale, 1, 'Disabling fit restores full size');

const huge = fixture(() => 2000);
assert.deepEqual(fitColumns(huge.grid, huge.columns, 960, true), { scale: 0.65, height: 1300 }, 'Reports remaining overflow at the minimum scale');

// A later edit/render can increase height without changing the paper size.
let contentHeight = 700;
const editable = fixture(() => contentHeight);
assert.equal(fitColumns(editable.grid, editable.columns, 960, true).scale, 1);
contentHeight = 1200;
assert.equal(fitColumns(editable.grid, editable.columns, 960, true).scale, 0.8);
console.log('Page fit regression checks passed.');
