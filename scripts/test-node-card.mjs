import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const compiled=ts.transpileModule(fs.readFileSync(new URL('../frontend/src/features/explorer/nodeCard.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {wrapText,fitText,nodeCard}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

// Card name metrics used by nodeCard(): 30px font, 250px card minus 32px padding.
const SIZE=30, INNER=218;

// camelCase wrapping (the documented example) stays as it was.
assert.deepEqual(wrapText('EventNotFoundException',SIZE,INNER,2),['EventNot','FoundExcept…']);
assert.deepEqual(wrapText('Event',SIZE,INNER,2),['Event']);

// A leading separator is not a useful break: never leave a one-character first line.
const leading=wrapText('_verylongprivatemethodname',SIZE,INNER,2);
assert.ok(leading[0].length>1,`leading separator cut: ${JSON.stringify(leading)}`);
assert.ok(leading[0].startsWith('_verylong'),JSON.stringify(leading));

// Unicode identifiers wrap at their camelCase boundaries, not mid-word.
assert.deepEqual(wrapText('КонтроллерСобытийОбработчик',SIZE,INNER,2)[0],'Контроллер');
assert.deepEqual(wrapText('DéjàVuÉvénementController',SIZE,INNER,2)[0],'DéjàVu');

// Full-width glyphs render ~1em wide: an estimated fit must not let them overflow the card.
const cjk=fitText('事件通知服务控制器管理类实现',SIZE,INNER);
assert.ok([...cjk.replace('…','')].length*SIZE+(cjk.endsWith('…')?.7*SIZE:0)<=INNER,`CJK overflow: ${cjk}`);
for(const line of wrapText('事件通知服务控制器管理类实现工厂',SIZE,INNER,2))
  assert.ok([...line.replace('…','')].length*SIZE<=INNER,`CJK line overflow: ${line}`);

// The card still renders for such names.
assert.match(nodeCard({id:'x',kind:'CLASS',simpleName:'事件通知服务控制器'}).image,/^data:image\/svg\+xml/);
console.log('nodeCard tests: PASS');
