// The prize wheel must keep spinning on phones that have "reduce motion" / "remove animations" switched on.
// A blanket "transition: none" rule for those phones once made the wheel jump straight to the prize.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('no reduced-motion rule switches off transitions on the wheel', () => {
  const rules = html.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\{[^}]*\}\s*\}/g) || [];
  const blanket = rules.filter((r) => /transition:\s*none/.test(r));
  assert.ok(blanket.length > 0, 'expected the reduced-motion rules to still exist');
  for (const r of blanket) assert.match(r, /\*:not\(#wl\)/, `this rule would freeze the wheel: ${r}`);
});

test('the spin always ends on a whole number of turns, with a gentler version for reduced motion', () => {
  assert.match(app, /prefers-reduced-motion:reduce\)'\)\.matches, secs = calm \? 2 : 4, turns = calm \? 1080 : 1800/);
  assert.equal(1080 % 360, 0);
  assert.equal(1800 % 360, 0); // same final angle as the redrawn wheel, so nothing jumps afterwards
  // the result screen waits for the spin to finish, whichever length it has
  assert.match(app, /\}, secs \* 1000 \+ 200\);/);
});

test('app.js is valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(app.replace(/^#!.*/, '')));
});
