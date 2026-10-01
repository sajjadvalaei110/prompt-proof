import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const source=fs.readFileSync(new URL('../frontend/src/features/import/importEngine.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {importEngineChoice,displayedIndexer,DEFAULT_INDEXER_BY_LANGUAGE}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

const engines=[
 {language:'java',indexer:'javaparser',label:'JavaParser',defaultIndexer:true,executesTargetBuild:false,available:true,unavailableReason:null},
 {language:'java',indexer:'scip-java',label:'scip-java',defaultIndexer:false,executesTargetBuild:true,available:true,unavailableReason:null},
];

// A fresh page: nothing selected, the picker shows the language default, and that is what is sent.
assert.equal(displayedIndexer(engines,'java','').indexer,'javaparser');
assert.deepEqual(importEngineChoice(engines,'java','',false),{indexer:'javaparser',allowBuildExecution:false});
// A stale consent flag never travels with a source-only engine.
assert.deepEqual(importEngineChoice(engines,'java','',true),{indexer:'javaparser',allowBuildExecution:false});
assert.deepEqual(importEngineChoice(engines,'java','javaparser',true),{indexer:'javaparser',allowBuildExecution:false});
console.log('PASS: an untouched picker submits the displayed source-only default explicitly');

assert.deepEqual(importEngineChoice(engines,'java','scip-java',true),{indexer:'scip-java',allowBuildExecution:true});
assert.deepEqual(importEngineChoice(engines,'java','scip-java',false),{indexer:'scip-java',allowBuildExecution:false});
console.log('PASS: a build-running engine is sent with the consent checkbox state');

// An unknown selection falls back to what the picker displays (the default), not to omission.
assert.deepEqual(importEngineChoice(engines,'java','removed-engine',true),{indexer:'javaparser',allowBuildExecution:false});
// The engine list failed to load: send the built-in default rather than omitting the engine.
assert.equal(DEFAULT_INDEXER_BY_LANGUAGE.java,'javaparser');
assert.equal(displayedIndexer([],'java','scip-java'),null);
assert.deepEqual(importEngineChoice([],'java','scip-java',true),{indexer:'javaparser',allowBuildExecution:false});
console.log('PASS: without an engine list the language default engine is still sent explicitly');
