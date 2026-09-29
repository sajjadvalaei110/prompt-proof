import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/source/fileDiff.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { buildUnifiedRows, toSplitRows } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS', name); };
const ctx = (o, n, text) => ({ type: 'ctx', oldNo: o, newNo: n, text });
const add = (n, text) => ({ type: 'add', newNo: n, text });
const del = (o, text) => ({ type: 'del', oldNo: o, text });

check('a pure insertion (oldCount:0) inserts new lines without deleting the surrounding context', () => {
  const oldText = 'a\nb\nc\n';
  const newText = 'a\nb\nX\nY\nc\n';
  // git: @@ -2,0 +3,2 @@ (insert after old line 2 / before old line 3, at new lines 3-4)
  const rows = buildUnifiedRows(oldText, newText, [{ oldStart: 2, oldCount: 0, newStart: 3, newCount: 2 }]);
  assert.deepEqual(rows, [
    ctx(1, 1, 'a'), ctx(2, 2, 'b'),
    add(3, 'X'), add(4, 'Y'),
    ctx(3, 5, 'c'), ctx(4, 6, ''),
  ]);
});

check('a pure deletion (newCount:0) removes old lines without consuming any new line', () => {
  const oldText = 'a\nb\nX\nY\nc\n';
  const newText = 'a\nb\nc\n';
  // git: @@ -3,2 +2,0 @@ (old lines 3-4 removed after new line 2)
  const rows = buildUnifiedRows(oldText, newText, [{ oldStart: 3, oldCount: 2, newStart: 2, newCount: 0 }]);
  assert.deepEqual(rows, [
    ctx(1, 1, 'a'), ctx(2, 2, 'b'),
    del(3, 'X'), del(4, 'Y'),
    ctx(5, 3, 'c'), ctx(6, 4, ''),
  ]);
});

check('a modification replaces old lines with new lines at the same point', () => {
  const oldText = 'a\nb\nc\n';
  const newText = 'a\nZ\nc\n';
  const rows = buildUnifiedRows(oldText, newText, [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 }]);
  assert.deepEqual(rows, [ctx(1, 1, 'a'), del(2, 'b'), add(2, 'Z'), ctx(3, 3, 'c'), ctx(4, 4, '')]);
});

check('two hunks separated by context each apply at their own offset', () => {
  const oldText = 'a\nb\nc\nd\ne\n';
  const newText = 'A\nb\nc\nD\ne\n';
  const rows = buildUnifiedRows(oldText, newText, [
    { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 },
    { oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 },
  ]);
  assert.deepEqual(rows, [
    del(1, 'a'), add(1, 'A'),
    ctx(2, 2, 'b'), ctx(3, 3, 'c'),
    del(4, 'd'), add(4, 'D'),
    ctx(5, 5, 'e'), ctx(6, 6, ''),
  ]);
});

check('hunks are applied in newStart order regardless of input order', () => {
  const oldText = 'a\nb\nc\nd\ne\n';
  const newText = 'A\nb\nc\nD\ne\n';
  const rows = buildUnifiedRows(oldText, newText, [
    { oldStart: 4, oldCount: 1, newStart: 4, newCount: 1 },
    { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1 },
  ]);
  assert.equal(rows[0].text, 'a'); assert.equal(rows[0].type, 'del');
  assert.equal(rows[4].text, 'd'); assert.equal(rows[4].type, 'del');
});

check('a null old side (added file) renders every new line as added, ignoring hunks', () => {
  const rows = buildUnifiedRows(null, 'x\ny\n', [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2 }]);
  assert.deepEqual(rows, [add(1, 'x'), add(2, 'y'), add(3, '')]);
});

check('a null new side (deleted file) renders every old line as removed', () => {
  const rows = buildUnifiedRows('x\ny\n', null, []);
  assert.deepEqual(rows, [del(1, 'x'), del(2, 'y'), del(3, '')]);
});

check('a trailing deletion hunk at end of file has no following context', () => {
  const oldText = 'a\nb\nc\n';
  const newText = 'a\nb\n';
  const rows = buildUnifiedRows(oldText, newText, [{ oldStart: 3, oldCount: 1, newStart: 2, newCount: 0 }]);
  // Both files still end with '\n', so both have one more trailing (empty) line shared as context.
  assert.deepEqual(rows, [ctx(1, 1, 'a'), ctx(2, 2, 'b'), del(3, 'c'), ctx(4, 3, '')]);
});

check('toSplitRows pairs each hunk\'s removed and added lines side by side, padding the shorter side', () => {
  const rows = [ctx(1, 1, 'a'), del(2, 'b1'), del(3, 'b2'), add(2, 'B'), ctx(4, 3, 'c')];
  const split = toSplitRows(rows);
  assert.equal(split.length, 4);
  assert.deepEqual(split[0], { left: ctx(1, 1, 'a'), right: ctx(1, 1, 'a') });
  assert.deepEqual(split[1], { left: del(2, 'b1'), right: add(2, 'B') });
  assert.deepEqual(split[2], { left: del(3, 'b2'), right: undefined });
  assert.deepEqual(split[3], { left: ctx(4, 3, 'c'), right: ctx(4, 3, 'c') });
});

check('toSplitRows pads a pure-insertion run on the left and a pure-deletion run on the right', () => {
  const inserted = toSplitRows([add(1, 'x'), add(2, 'y')]);
  assert.deepEqual(inserted, [{ left: undefined, right: add(1, 'x') }, { left: undefined, right: add(2, 'y') }]);
  const deleted = toSplitRows([del(1, 'x'), del(2, 'y')]);
  assert.deepEqual(deleted, [{ left: del(1, 'x'), right: undefined }, { left: del(2, 'y'), right: undefined }]);
});

check('a file emptied to \'\' deletes all old lines and yields no phantom trailing context row', () => {
  const oldText = 'a\nb\n';
  const newText = '';
  // git: @@ -1,2 +0,0 @@ (old file had 2 lines per git's count; new side is truly empty, 0 lines)
  const rows = buildUnifiedRows(oldText, newText, [{ oldStart: 1, oldCount: 2, newStart: 0, newCount: 0 }]);
  assert.deepEqual(rows, [del(1, 'a'), del(2, 'b')]);
});

check('content added to a previously-empty (\'\') old file has no old side to pair its trailing line with, so the whole new file is added', () => {
  const oldText = '';
  const newText = 'x\n';
  // git: @@ -0,0 +1,1 @@ (old side had 0 lines; new side's convention-trailing blank has nothing old to pair with)
  const rows = buildUnifiedRows(oldText, newText, [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 }]);
  assert.deepEqual(rows, [add(1, 'x'), add(2, '')]);
});

check('both sides empty (\'\') with no hunks yields no rows at all', () => {
  const rows = buildUnifiedRows('', '', []);
  assert.deepEqual(rows, []);
});

console.log(`${count} file-diff checks passed`);
