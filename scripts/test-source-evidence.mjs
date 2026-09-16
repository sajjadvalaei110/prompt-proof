import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/source/sourceEvidence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {groupSourceEvidence,kindsAtLine,highlightedLines,rangeSummary}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

// Flat per-evidence rows (single-occurrence endpoint): one DEPENDS_ON with three call sites in one file, one repeated.
const flat=[
 {path:'a/Orders.java',startLine:30,endLine:31,content:'x\n'.repeat(40),exact:true},
 {path:'a/Orders.java',startLine:12,endLine:12,content:'x\n'.repeat(40),exact:true},
 {path:'a/Orders.java',startLine:12,endLine:12,content:'x\n'.repeat(40),exact:true},
 {path:'b/Users.java',startLine:5,endLine:5,content:'y',exact:false},
];
const files=groupSourceEvidence(flat);
assert.deepEqual(files.map(f=>f.path),['a/Orders.java','b/Users.java'],'each file once, first-seen order');
assert.deepEqual(files[0].ranges,[{startLine:12,endLine:12},{startLine:30,endLine:31}],'ranges de-duplicated and sorted');
assert.equal(rangeSummary(files[0]),'12, 30–31');
assert.deepEqual(kindsAtLine(files[0],31),[]);assert.equal(kindsAtLine(files[0],13),null);
assert.equal(files[1].exact,false);
console.log('PASS: flat evidence rows collapse to one file with several highlighted ranges');

// Already-grouped batch rows: kinds merge on identical ranges, a stale row marks the file stale, missing content is filled.
const grouped=groupSourceEvidence([
 {path:'a/Orders.java',content:null,exact:true,ranges:[{startLine:12,endLine:12,kinds:['CALLS']}]},
 {path:'a/Orders.java',content:'z',exact:false,ranges:[{startLine:12,endLine:12,kinds:['DEPENDS_ON']},{startLine:8,endLine:9,kinds:['CALLS']}]},
 {path:'bad'},null,{notAPath:1},
]);
assert.equal(grouped.length,2);
assert.deepEqual(grouped[0].ranges,[{startLine:8,endLine:9,kinds:['CALLS']},{startLine:12,endLine:12,kinds:['CALLS','DEPENDS_ON']}]);
assert.equal(grouped[0].exact,false);assert.equal(grouped[0].content,'z');
assert.deepEqual(kindsAtLine(grouped[0],12),['CALLS','DEPENDS_ON']);
assert.deepEqual(grouped[1].ranges,[],'a row without line numbers adds no range');
console.log('PASS: grouped evidence merges kinds, staleness, and content across rows');

// highlightedLines is the render path's precomputed form of kindsAtLine (SourceDialog builds it once
// per file instead of scanning every range for every line). It must agree with kindsAtLine exactly,
// including the "highlighted but kinds unknown" empty array -- that empty array, not null, is what
// keeps the `highlighted` class on the row, so a refactor that collapsed it would silently unstyle
// evidence from the flat endpoint.
for (const file of [files[0], files[1], grouped[0], grouped[1]]) {
 const lineCount=200;
 const marked=highlightedLines(file,lineCount);
 for (let line=1; line<=lineCount; line++) {
  const expected=kindsAtLine(file,line);
  if (expected===null) assert.equal(marked.has(line),false,`line ${line} of ${file.path} is not highlighted`);
  else assert.deepEqual(marked.get(line),expected,`line ${line} of ${file.path} carries the same kinds as kindsAtLine`);
 }
}
assert.deepEqual(highlightedLines(files[0],200).get(31),[],'highlighted with unknown kinds stays an empty array, not null');
assert.deepEqual([...highlightedLines(files[0],200).keys()].sort((a,b)=>a-b),[12,30,31],'every line of a multi-line range is marked');

// A range from a stale index may point past the end of the content it is rendered against. The walk
// is bounded by the real line count, so a bogus endLine can never balloon the map (or hang a render).
const stale=groupSourceEvidence([{path:'s.java',content:'a\nb\nc',exact:false,ranges:[{startLine:2,endLine:9_000_000,kinds:['CALLS']}]}]);
const bounded=highlightedLines(stale[0],3);
assert.deepEqual([...bounded.keys()],[2,3],'a range past end of file is clamped to the lines that exist');
assert.equal(highlightedLines(stale[0],0).size,0,'no content lines means nothing is highlighted');
console.log('PASS: highlightedLines matches kindsAtLine and stays bounded by the real line count');
