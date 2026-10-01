import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const ts = require('typescript');
const load = async (file) => {
  const compiled = ts.transpileModule(fs.readFileSync(new URL(`../frontend/src/features/source/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
};
const { buildUnifiedRows, toSplitRows } = await load('fileDiff.ts');
const { decodeOccurrences, occurrencesByLine, lineSegments, navigationHint, STALE_HINT } = await load('codeTokens.ts');
const { unifiedRowTarget, splitCellTarget, headLineLengths, jumpTarget, servedFromNote, DELETED_LINES_MESSAGE, DIFFERS_CHIP } = await load('diffNavigation.ts');
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS', name); };

// A modified file (Go-shaped, to keep the mapping language-free): line 2 replaced, line 4 inserted.
const oldText = 'package app\nfunc run() { old() }\nfunc keep() {}\n';
const newText = 'package app\nfunc run() { greet(name) }\nfunc keep() {}\nfunc greet(n string) {}\n';
const rows = buildUnifiedRows(oldText, newText, [{ oldStart: 2, oldCount: 1, newStart: 2, newCount: 1 }, { oldStart: 3, oldCount: 0, newStart: 4, newCount: 1 }]);

check('unified rows: context and added rows navigate by their head line, deleted rows are blocked', () => {
  assert.deepEqual(rows.map(r => r.type), ['ctx', 'del', 'add', 'ctx', 'add', 'ctx']);
  assert.deepEqual(rows.map(unifiedRowTarget), [{ line: 1 }, { blocked: 'deleted' }, { line: 2 }, { line: 3 }, { line: 4 }, { line: 5 }]);
  assert.equal(unifiedRowTarget(undefined), null);
});

check('an added file has no oldNo: every row navigates by its head line', () => {
  const added = buildUnifiedRows(null, 'a\nb', []);
  assert.ok(added.every(r => r.oldNo === undefined));
  assert.deepEqual(added.map(unifiedRowTarget), [{ line: 1 }, { line: 2 }]);
  const removed = buildUnifiedRows('a\nb', null, []);
  assert.deepEqual(removed.map(unifiedRowTarget), [{ blocked: 'deleted' }, { blocked: 'deleted' }]);
});

check('split cells: left ctx navigates by the head line, left del is blocked, right add navigates, blanks have no line', () => {
  const split = toSplitRows(rows);
  assert.deepEqual(split.map(p => splitCellTarget(p, 'l')), [{ line: 1 }, { blocked: 'deleted' }, { line: 3 }, null, { line: 5 }]);
  assert.deepEqual(split.map(p => splitCellTarget(p, 'r')), [{ line: 1 }, { line: 2 }, { line: 3 }, { line: 4 }, { line: 5 }]);
  // A left-only cell (a pure deletion) is blocked; its blank right side has nothing to click.
  const pureDelete = toSplitRows(buildUnifiedRows('x\ny\n', 'x\n', [{ oldStart: 2, oldCount: 1, newStart: 1, newCount: 0 }]));
  const leftOnly = pureDelete.find(p => p.left && !p.right);
  assert.deepEqual(splitCellTarget(leftOnly, 'l'), { blocked: 'deleted' });
  assert.equal(splitCellTarget(leftOnly, 'r'), null);
});

check('head line lengths come from the diff rows and bound the occurrence rows to the shown text', () => {
  assert.deepEqual(headLineLengths(rows), newText.split('\n').map(l => l.length));
  assert.deepEqual(headLineLengths(buildUnifiedRows(null, 'ab\n\nc', [])), [2, 0, 1]);
});

check('a diff row and its column map to (head line, column) through the occurrence rows', () => {
  // Rows the head snapshot's server answered with: `greet` on head line 2 (cols 14-18) and its definition on line 4.
  const data = decodeOccurrences({ status: 'indexed', symbols: [{ definitions: 1, displayName: 'greet' }, { definitions: 0, displayName: 'name' }],
    occurrences: [[2, 14, 2, 18, 0, 0], [2, 20, 2, 23, 1, 0], [4, 6, 4, 10, 0, 1], [9, 1, 9, 3, 0, 0]], servedFrom: { snapshotId: 'active', label: 'Current analysis · Fixture compiler' } });
  const byLine = occurrencesByLine(data.occurrences, headLineLengths(rows));
  assert.equal(byLine.has(9), false, 'a row past the shown text is dropped');
  const addedRow = rows[2], target = unifiedRowTarget(addedRow);
  const segments = lineSegments(addedRow.text, byLine.get(target.line));
  const token = segments.find(s => s.text === 'greet');
  assert.deepEqual([target.line, token.start + 1, token.occurrence.endColumn], [2, 14, 18]);
  // The same name in split's right cell is the same head position.
  const pair = toSplitRows(rows)[1];
  assert.deepEqual(splitCellTarget(pair, 'r'), target);
  assert.deepEqual(data.servedFrom, { snapshotId: 'active', label: 'Current analysis · Fixture compiler' });
  // A deleted row has no head line, so no occurrence can be drawn on it.
  assert.ok('blocked' in unifiedRowTarget(rows[1]));
});

check('jump targets stay in the change: the server-named snapshot, its diff when that file changed, the chip when it differs', () => {
  const review = { headSnapshotId: 'head', filesByPath: { 'pkg/Changed.go': { lineCountsAvailable: true }, 'bin.dat': { lineCountsAvailable: false } } };
  assert.deepEqual(jumpTarget({ path: 'pkg/Changed.go', snapshotId: 'head' }, 'head', review), { snapshot: 'head', mode: 'diff', chip: false });
  assert.deepEqual(jumpTarget({ path: 'pkg/Same.go', snapshotId: 'head' }, 'head', review), { snapshot: 'head', mode: 'plain', chip: false });
  assert.deepEqual(jumpTarget({ path: 'pkg/Changed.go', snapshotId: 'active', differsFromChange: true }, 'head', review), { snapshot: 'active', mode: 'plain', chip: true });
  assert.deepEqual(jumpTarget({ path: 'bin.dat', snapshotId: 'head' }, 'head', review), { snapshot: 'head', mode: 'plain', chip: false });
  // Outside a review (or an older server without snapshotId) a jump opens where it was asked, as plain source.
  assert.deepEqual(jumpTarget({ path: 'a.go' }, 'plain-snapshot', null), { snapshot: 'plain-snapshot', mode: 'plain', chip: false });
});

check('messages: deleted lines, the stale hint, the chip and the served-from note are data-driven', () => {
  assert.equal(DELETED_LINES_MESSAGE, "Deleted lines aren't navigable; find in file still works here.");
  assert.equal(navigationHint({ status: 'stale', indexerLabel: 'Fixture compiler' }), STALE_HINT);
  assert.equal(decodeOccurrences({ status: 'stale' }).status, 'stale');
  assert.equal(DIFFERS_CHIP, 'Current analysis — differs from this change');
  assert.equal(servedFromNote({ snapshotId: 'active', label: 'Current analysis · X' }, 'head'), 'Navigation from Current analysis · X');
  assert.equal(servedFromNote({ snapshotId: 'head', label: 'This snapshot · X' }, 'head'), null);
  assert.equal(servedFromNote(null, 'head'), null);
});

console.log(`PASS: ${count} diff navigation checks`);
