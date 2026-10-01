import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/source/navigationStack.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {initialNavStack,currentView,canGoBack,canGoForward,pushView,stepView,sameView,MAX_NAV_ENTRIES}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const file=(path,line,col=1)=>({kind:'file',path,line,startColumn:col,endLine:line,endColumn:col+3});

// Opening view is the subject's evidence; nothing to go back or forward to.
let s=initialNavStack();
assert.deepEqual(currentView(s),{kind:'evidence'});
assert.equal(canGoBack(s),false);assert.equal(canGoForward(s),false);
console.log('PASS: the dialog opens on its evidence view with an empty history');

// Jumps push views and remember where the previous view was scrolled.
s=pushView(s,file('lib.go',4),120);
s=pushView(s,file('main.dart',9,5),300);
assert.deepEqual(currentView(s),file('main.dart',9,5));
assert.equal(s.entries[0].scrollTop,120);assert.equal(s.entries[1].scrollTop,300);
assert.equal(canGoBack(s),true);assert.equal(canGoForward(s),false);
console.log('PASS: go to definition pushes views and records scroll offsets');

// Back restores the earlier view and its scroll; forward returns; both stop at the ends.
s=stepView(s,-1,50);
assert.deepEqual(currentView(s),file('lib.go',4));assert.equal(s.entries[s.index].scrollTop,300);assert.equal(s.entries[2].scrollTop,50);
s=stepView(s,-1,300);assert.deepEqual(currentView(s),{kind:'evidence'});assert.equal(s.entries[0].scrollTop,120);
assert.equal(stepView(s,-1,0),s,'back at the start is a no-op');
s=stepView(s,1,120);s=stepView(s,1,300);
assert.deepEqual(currentView(s),file('main.dart',9,5));
assert.equal(stepView(s,1,0),s,'forward at the end is a no-op');
console.log('PASS: back/forward restore views and scroll; ends are no-ops');

// A view left at the very top remembers 0, which is a real offset (Back restores it), while a view not yet
// left remembers nothing (null), so the dialog centres a fresh jump's target instead.
{
  let t=initialNavStack();
  assert.equal(t.entries[0].scrollTop,null,'the opening view has no remembered offset');
  t=pushView(t,file('lib.go',4),0);
  assert.equal(t.entries[0].scrollTop,0);assert.equal(t.entries[1].scrollTop,null,'a fresh jump has no remembered offset');
  t=stepView(t,-1,1778);
  assert.deepEqual(currentView(t),{kind:'evidence'});assert.equal(t.entries[t.index].scrollTop,0,'back restores the top, not the later offset');
  assert.equal(t.entries[1].scrollTop,1778);
  t=stepView(t,1,0);assert.equal(t.entries[t.index].scrollTop,1778);assert.equal(t.entries[0].scrollTop,0);
}
console.log('PASS: an offset of 0 is remembered and restored; fresh entries remember none');

// A new jump after going back discards the forward branch, as a browser does.
s=stepView(s,-1,0);
s=pushView(s,file('other.ts',2),10);
assert.equal(s.entries.length,3);assert.deepEqual(currentView(s),file('other.ts',2));assert.equal(canGoForward(s),false);
console.log('PASS: jumping after back discards forward entries');

// Jumping to the view already shown adds nothing.
assert.equal(pushView(s,file('other.ts',2),99),s);
assert.equal(sameView({kind:'evidence'},{kind:'evidence'}),true);
assert.equal(sameView(file('a',1),file('a',1,2)),false);
console.log('PASS: re-jumping to the current view is a no-op');

// Bounded: oldest entries drop, the current one stays last.
let big=initialNavStack();
for(let i=0;i<MAX_NAV_ENTRIES+20;i++)big=pushView(big,file('f',i+1),i);
assert.equal(big.entries.length,MAX_NAV_ENTRIES);assert.equal(big.index,MAX_NAV_ENTRIES-1);
assert.deepEqual(currentView(big),file('f',MAX_NAV_ENTRIES+20));
console.log('PASS: history is bounded to the most recent entries');
