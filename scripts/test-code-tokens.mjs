import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/source/codeTokens.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {decodeOccurrences,occurrencesByLine,lineSegments,occurrenceAt,navigationHint}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const join=segs=>segs.map(s=>s.text).join('');

// A Go file, tokenised purely from occurrence rows (1-based, inclusive end, UTF-16 columns) as a
// future Go engine would write them. Nothing about Go syntax is known to the tokeniser: `name` in the
// comment is not clickable because no row covers it, nor is the parameter's `string`.
const go=['package greet','','// Greet says hello to name','func Greet(name string) string {','\treturn "Hello, " + name','}'];
const goPayload={status:'indexed',indexer:'fixture-go',indexerLabel:'Fixture Go',navigationIndexers:['Fixture Go'],truncated:false,total:4,
  symbols:[{definitions:1,displayName:"Greet"},{definitions:1,displayName:"name"},{definitions:0,displayName:null}],
  occurrences:[[4,6,4,10,0,1],[4,12,4,15,1,1],[5,21,5,24,1,0],[4,25,4,30,2,0],['bad'],[1,1,1,1,9,0],[0,1,0,1,0,0]]};
const goData=decodeOccurrences(goPayload);
assert.equal(goData.status,'indexed');
assert.equal(goData.occurrences.length,4,'malformed rows, out-of-table symbols and line 0 are dropped');
const goByLine=occurrencesByLine(goData.occurrences,go.map(l=>l.length));
const sig=lineSegments(go[3],goByLine.get(4));
assert.equal(join(sig),go[3],'segments reassemble the line exactly');
assert.deepEqual(sig.filter(s=>s.occurrence).map(s=>[s.text,s.occurrence.symbol,s.occurrence.definition]),[['Greet',0,true],['name',1,true],['string',2,false]]);
const ret=lineSegments(go[4],goByLine.get(5));
assert.deepEqual(ret.filter(s=>s.occurrence).map(s=>s.text),['name'],'only the covered token is clickable');
assert.equal(lineSegments(go[2],goByLine.get(3)).length,1,'comment line without rows stays one span');
assert.equal(occurrenceAt(goByLine,5,21).symbol,1);
assert.equal(occurrenceAt(goByLine,5,24),null,'end is exclusive');
console.log('PASS: a Go file is tokenised from occurrence rows alone');

// A Dart file with a multi-line occurrence and nested rows: the innermost (shortest) row wins, the
// same rule the definition endpoint applies.
const dart=['class Greeter {','  String greet(String who) => \'Hi $who\';','}','final g = Greeter()','  .greet(\'x\');'];
const dartData=decodeOccurrences({status:'indexed',symbols:[{definitions:1},{definitions:1},{definitions:1},{definitions:2}],total:5,
  occurrences:[[1,7,1,13,0,1],[2,10,2,14,1,1],[2,23,2,25,2,1],[2,36,2,38,2,0],[4,11,5,8,3,0],[5,4,5,8,1,0]]});
const dartByLine=occurrencesByLine(dartData.occurrences,dart.map(l=>l.length));
assert.deepEqual(lineSegments(dart[1],dartByLine.get(2)).filter(s=>s.occurrence).map(s=>s.text),['greet','who','who']);
const chainHead=lineSegments(dart[3],dartByLine.get(4));
assert.deepEqual(chainHead.filter(s=>s.occurrence).map(s=>[s.text,s.occurrence.symbol]),[['Greeter()',3]],'multi-line row clipped to its first line');
const chainTail=lineSegments(dart[4],dartByLine.get(5));
assert.deepEqual(chainTail.filter(s=>s.occurrence).map(s=>[s.text,s.occurrence.symbol]),[['  .',3],['greet',1]],'nested: innermost row wins on the overlap');
console.log('PASS: a Dart file: multi-line rows are clipped per line, nested rows resolve innermost');

// Stale rows (index older than the text) are clamped to the line and never add lines.
const stale=occurrencesByLine(decodeOccurrences({status:'indexed',symbols:[{definitions:1}],occurrences:[[1,3,1,99,0,0],[1,50,1,60,0,0],[9,1,9,4,0,0]]}).occurrences,[5]);
assert.deepEqual(stale.get(1).map(r=>[r.start,r.end]),[[2,5]]);
assert.equal(stale.has(9),false);
console.log('PASS: stale rows are clamped to the shown text');

// Surrogate pairs: a row that starts after an emoji uses UTF-16 offsets; a cut inside a pair moves past it.
const emoji='x := "🎉"; y := x';
const emojiRows=occurrencesByLine(decodeOccurrences({status:'indexed',symbols:[{definitions:1}],occurrences:[[1,17,1,17,0,0]]}).occurrences,[emoji.length]);
assert.deepEqual(lineSegments(emoji,emojiRows.get(1)).filter(s=>s.occurrence).map(s=>s.text),['x']);
const split=lineSegments('a🎉b',[],[{start:2,end:4,kind:'match'}]);
assert.equal(join(split),'a🎉b');
assert.ok(split.every(s=>!/[\ud800-\udbff]$/.test(s.text)),'no span ends inside a surrogate pair');
console.log('PASS: UTF-16 columns and surrogate-safe cuts');

// Find marks and the jump target layer over occurrences without breaking them.
const marked=lineSegments(go[3],goByLine.get(4),[{start:5,end:10,kind:'active'},{start:11,end:13,kind:'match'},{start:5,end:10,kind:'target'}]);
assert.equal(join(marked),go[3]);
const greet=marked.find(s=>s.text==='Greet');
assert.ok(greet.active&&greet.match&&greet.target&&greet.occurrence.symbol===0);
assert.deepEqual(marked.filter(s=>s.match&&!s.active).map(s=>[s.text,s.occurrence?.symbol]),[['na',1]]);
assert.deepEqual(lineSegments('plain'),[{text:'plain',start:0}]);
console.log('PASS: find matches and the jump target layer over occurrence spans');

// Payload status / hint come from data, naming the engine.
const notIndexed=decodeOccurrences({status:'not_indexed',indexer:'fixture',indexerLabel:'Fixture source-only',navigationIndexers:['Fixture compiler']});
assert.equal(notIndexed.status,'not_indexed');assert.deepEqual(notIndexed.occurrences,[]);
assert.equal(navigationHint(notIndexed),"This snapshot's indexer (Fixture source-only) doesn't provide go to definition; engines that do: Fixture compiler.");
assert.equal(navigationHint({indexer:'x',navigationIndexers:[]}),"This snapshot's indexer (x) doesn't provide go to definition; no engine for this language does yet.");
assert.equal(decodeOccurrences(null).status,'not_indexed');
console.log('PASS: the not-indexed hint names the engines from the payload');
