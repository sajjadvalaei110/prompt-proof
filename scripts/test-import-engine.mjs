import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(new URL('../frontend/package.json',import.meta.url));
const ts=require('typescript');
const source=fs.readFileSync(new URL('../frontend/src/features/import/importEngine.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText;
const {importEngineChoice,displayedIndexer,DEFAULT_INDEXER_BY_LANGUAGE,workspaceRequestBody}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));

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

// ADR 0015: the import form always sends the repository root (empty = auto-detect), so it replaces the stored one.
assert.deepEqual(importEngineChoice(engines,'java','scip-java',true,'  /repo  '),{indexer:'scip-java',allowBuildExecution:true,repositoryRoot:'/repo'});
assert.deepEqual(importEngineChoice(engines,'java','',false,''),{indexer:'javaparser',allowBuildExecution:false,repositoryRoot:''});
assert.deepEqual(workspaceRequestBody('/repo/app','java',importEngineChoice(engines,'java','',false,'')),{path:'/repo/app',language:'java',indexer:'javaparser',allowBuildExecution:false,repositoryRoot:''});
assert.deepEqual(workspaceRequestBody('/repo/app','java',{indexer:'scip-java',allowBuildExecution:true,repositoryRoot:'/repo'}),{path:'/repo/app',language:'java',indexer:'scip-java',allowBuildExecution:true,repositoryRoot:'/repo'});
console.log('PASS: the import form always sends the repository root, empty meaning auto-detect');
// Re-analyze source and Recent projects omit both the engine and the root, which keeps the stored ones.
assert.deepEqual(workspaceRequestBody('/repo/app','java',{}),{path:'/repo/app',language:'java'});
assert.deepEqual(workspaceRequestBody('/repo/app','java'),{path:'/repo/app',language:'java'});
// The autoPath link names the default engine but not a root.
assert.equal('repositoryRoot' in workspaceRequestBody('/x','java',{indexer:'javaparser',allowBuildExecution:false}),false);
console.log('PASS: re-analysis omits the root and keeps the stored one');
