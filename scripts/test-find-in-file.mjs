import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const load=async file=>{const compiled=ts.transpileModule(fs.readFileSync(new URL(`../frontend/src/features/source/${file}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;return import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));};
const {findMatches,findPattern,stepMatch,findCounter,MAX_FIND_MATCHES}=await load('findInFile.ts');
const loose={matchCase:false,wholeWord:false};

// Literal, per line, every non-overlapping match in reading order; columns are UTF-16 offsets.
const lines=['func Greet(name string) string {','\treturn "Hello, " + name // greet','}'];
let r=findMatches(lines,'greet',loose);
assert.deepEqual(r.matches,[{line:0,start:5,end:10},{line:1,start:28,end:33}]);
assert.equal(r.capped,false);
assert.deepEqual(findMatches(lines,'greet',{matchCase:true,wholeWord:false}).matches,[{line:1,start:28,end:33}],'match case');
assert.deepEqual(findMatches(['aaaa'],'aa',loose).matches,[{line:0,start:0,end:2},{line:0,start:2,end:4}],'non-overlapping');
console.log('PASS: literal matches per line, case-insensitive by default, match case honoured');

// The query is never a regex: syntax characters match themselves.
assert.deepEqual(findMatches(['a.b axb (x) [y] {z} a|b $^ \\ /'],'a.b',loose).matches.length,1);
for(const q of ['(x)','[y]','{z}','a|b','$^','\\','/','.*','?','+']) assert.ok(findMatches(['a.b axb (x) [y] {z} a|b $^ \\ / .* ? +'],q,loose).matches.length>=1,`literal ${q}`);
assert.equal(findPattern('',loose),null);
assert.deepEqual(findMatches(lines,'',loose),{matches:[],capped:false},'empty query finds nothing');
console.log('PASS: regex syntax in the query is literal; empty query finds nothing');

// Whole word uses Unicode word boundaries, not any language's identifier rules.
const words=['name names rename name_x _name', 'café cafés écafé', '日本 日本語', 'x-name name.y'];
assert.deepEqual(findMatches(words,'name',{matchCase:false,wholeWord:true}).matches,[{line:0,start:0,end:4},{line:3,start:2,end:6},{line:3,start:7,end:11}],'underscore joins words; - and . separate them');
assert.deepEqual(findMatches(words,'café',{matchCase:false,wholeWord:true}).matches,[{line:1,start:0,end:4}],'accented letters are word characters');
assert.deepEqual(findMatches(words,'日本',{matchCase:false,wholeWord:true}).matches,[{line:2,start:0,end:2}],'CJK letters are word characters');
assert.deepEqual(findMatches(['ÉCOLE école'],'école',loose).matches.length,2,'Unicode case folding');
console.log('PASS: whole word uses Unicode letter/mark/number/connector boundaries');

// Surrogate pairs: columns stay UTF-16 offsets after an emoji.
assert.deepEqual(findMatches(['// 🎉 party'],'party',loose).matches,[{line:0,start:6,end:11}]);
console.log('PASS: offsets are UTF-16 code units (emoji before a match)');

// Cap: collecting stops at the cap and says so.
r=findMatches(Array(30).fill('x x x x'),'x',loose,100);
assert.equal(r.matches.length,100);assert.equal(r.capped,true);
assert.equal(findCounter(0,r,'x'),'1 of 100+');
assert.equal(MAX_FIND_MATCHES,10000);
assert.equal(findCounter(0,{matches:Array(10000).fill({line:0,start:0,end:1}),capped:true},'x'),'1 of 10,000+');
console.log('PASS: matches are capped and the counter shows the cap');

// Stepping wraps both ways; counter text.
assert.equal(stepMatch(0,3,1),1);assert.equal(stepMatch(2,3,1),0);assert.equal(stepMatch(0,3,-1),2);
assert.equal(stepMatch(-1,3,1),0);assert.equal(stepMatch(-1,3,-1),2);assert.equal(stepMatch(0,0,1),-1);
assert.equal(findCounter(1,{matches:[1,2,3],capped:false},'q'),'2 of 3');
assert.equal(findCounter(-1,{matches:[],capped:false},'q'),'No results');
assert.equal(findCounter(-1,{matches:[],capped:false},''),'');
console.log('PASS: Enter/Shift+Enter stepping wraps; counter reads "N of M"');
