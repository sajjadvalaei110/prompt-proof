import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const palette=fs.readFileSync(new URL('../frontend/src/features/review/reviewPalette.ts',import.meta.url),'utf8');
const card=fs.readFileSync(new URL('../frontend/src/features/explorer/nodeCard.ts',import.meta.url),'utf8').replace("import { REVIEW_CHANGE_PALETTE } from '../review/reviewPalette';",'');
const compiled=ts.transpileModule(`${palette}\n${card}`,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
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
for (const [change, fill, stroke] of [
  ['ADDED','#d7f3e3','#168a58'], ['REMOVED','#fbdada','#c74545'], ['MODIFIED','#fff0b0','#ba862d']
]) {
  const image=decodeURIComponent(nodeCard({id:'review',kind:'CLASS',simpleName:'Review',reviewChange:change}).image);
  assert.ok(image.includes(`fill="${fill}" stroke="${stroke}"`),`${change} badge uses its own change color`);
}
console.log('nodeCard tests: PASS');

// Resizing: the default size is unchanged output; a taller package shows more member rows; a short one drops lower lines.
{
  const {defaultCardSize,cornerButtons,hasDetailsButton}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
  const pkg={id:'p',kind:'PACKAGE',simpleName:'com.acme.orders',qualifiedName:'com.acme.orders',memberCount:5,memberNames:['A','B','C','D','E']};
  assert.equal(nodeCard(pkg).image,nodeCard(pkg,defaultCardSize(pkg)).image);
  const rows=img=>(decodeURIComponent(img).match(/<rect x="16" y="\d+" width/g)||[]).length;
  assert.equal(rows(nodeCard(pkg).image),2);
  assert.equal(rows(nodeCard(pkg,{width:280,height:400}).image),5);
  assert.ok(!decodeURIComponent(nodeCard(pkg,{width:280,height:140}).image).includes('com.acme.orders</text>'),'qualified name line dropped when it no longer fits');
  // Corner buttons: a class gets code then details; a method only code; a package only details; an empty type none.
  assert.deepEqual(cornerButtons({kind:'CLASS',detailCount:2}).map(b=>[b.action,b.right]),[['code',12],['details',60]]);
  assert.deepEqual(cornerButtons({kind:'METHOD'}).map(b=>b.action),['code']);
  assert.deepEqual(cornerButtons({kind:'PACKAGE',detailCount:1}).map(b=>[b.action,b.right]),[['details',12]]);
  assert.equal(hasDetailsButton({kind:'CLASS',memberCount:1,detailCount:0}),false,'a class holding only a nested type has nothing to expand into');
  console.log('nodeCard resize/corner tests: PASS');
}

// Step 14 (ADR 0011): a method card names its owning class before the package, so a method freed
// from an ungrouped class still says where it lives. Long lines lose the package end first.
{
  const text=img=>decodeURIComponent(img).replaceAll('&apos;',"'");
  const method=text(nodeCard({id:'m',kind:'METHOD',simpleName:'place',ownerName:'OrderService',packageName:'com.shop.order.service'}).image);
  assert.ok(method.includes('>OrderService · order.service<'),'class, then the last two package segments');
  const long=text(nodeCard({id:'m2',kind:'METHOD',simpleName:'place',ownerName:'OrderFulfilmentCoordinator',packageName:'com.shop.fulfilment.orchestration'}).image);
  assert.match(long,/>OrderFulfilmentCoordinator · [^<]*…</,'the class name survives the ellipsis');
  const cls=text(nodeCard({id:'c',kind:'CLASS',simpleName:'OrderService',ownerName:'ignored',packageName:'com.shop.order.service'}).image);
  assert.ok(cls.includes('>order.service<'),'a class card keeps its package line');
  console.log('nodeCard method owner line: PASS');
}

// Step 13: the top-left badge names the kind -- a folder for packages, a distinct letter otherwise.
{
  const {kindIcon}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
  const letters={CLASS:'C',INTERFACE:'I',ENUM:'E',RECORD:'R',ANNOTATION:'@',METHOD:'m',CONSTRUCTOR:'c',FIELD:'f'};
  assert.equal(new Set(Object.values(letters)).size,Object.keys(letters).length,'kind letters are distinct');
  assert.deepEqual(kindIcon('PACKAGE'),{folder:true});
  for(const [kind,letter] of Object.entries(letters)){
    assert.deepEqual(kindIcon(kind),{folder:false,letter},kind);
    const svg=decodeURIComponent(nodeCard({id:kind,kind,simpleName:'Thing'}).image);
    assert.ok(svg.includes(`font-weight="700" fill="#398bb3">${letter==='@'?'@':letter}</text>`),`${kind} card draws its letter`);
    assert.ok(!svg.includes('M8 7l7-4 7 4'),`${kind} card no longer draws the cube`);
  }
  const pkg=decodeURIComponent(nodeCard({id:'p',kind:'PACKAGE',simpleName:'com.acme'}).image);
  assert.ok(pkg.includes('M1.8 4.3')&&!pkg.includes('M8 7l7-4 7 4'),'package card draws the folder');
  // The role tint survives: a service keeps its teal badge whatever its kind letter.
  const svc=decodeURIComponent(nodeCard({id:'s',kind:'INTERFACE',simpleName:'Svc',roles:['SERVICE']}).image);
  assert.ok(svc.includes('fill="#16888a">I</text>'),'service interface: teal I');
}
console.log('node card: kind icons ok');
// ADR 0016: an imported reference to code this project lacks looks like the original card (no design badge,
// an "imported" note); a planned card keeps its PLANNED badge.
{
  const svgOf=n=>decodeURIComponent(nodeCard(n).image.split(',')[1]);
  const base={id:'design:a.B',kind:'CLASS',simpleName:'B',qualifiedName:'a.B'};
  const imported=svgOf({...base,design:{key:'a.B',origin:'CODE',status:'MISSING',explanation:''}});
  assert.ok(!imported.includes('NOT IN CODE')&&imported.includes('· imported'),'an imported card has no design badge');
  const planned=svgOf({...base,design:{key:'a.B',origin:'AUTHORED',status:'PLANNED',explanation:''}});
  assert.ok(planned.includes('PLANNED')&&!planned.includes('imported'),'a planned card keeps its badge');
}
console.log('node card: imported cards ok');
// Cytoscape element data has no `design` record: `noSource` keeps the code button off design-only cards.
{
  const {cornerButtons}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
  assert.deepEqual(cornerButtons({id:'x',kind:'CLASS',simpleName:'X',noSource:true}).map(b=>b.action),[]);
  assert.deepEqual(cornerButtons({id:'x',kind:'CLASS',simpleName:'X'}).map(b=>b.action),['code']);
}
console.log('node card: no source button without source ok');
