#!/usr/bin/env node
// Deterministic local rehearsal using the same maintained compiler as the hosted service. No network or keys.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..'),require=createRequire(import.meta.url),cache=new Map();
function load(name) {
  const file=path.resolve(root,name);if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const code=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',code)(id=>{
    if(!id.startsWith('.'))return require(id);
    const resolved=path.resolve(path.dirname(file),id);
    if(existsSync(resolved+'.ts'))return load(resolved+'.ts');
    return require(resolved);
  },module,module.exports);return module.exports;
}
const {hostingBriefSchema,emptyHostingBrief,HOSTING_VERSION}=load('src/lib/campaigns/hosting-contracts.ts');
const {compileHosting,hostingConventions}=load('src/lib/campaigns/hosting.ts');
const [command,input,output]=process.argv.slice(2);
if(command==='guide') {
  const schema=require('zod').toJSONSchema(hostingBriefSchema);
  schema.$comment='Structural schema only. The maintained Zod schema additionally enforces unique formats/keys, allocation totals, date order, IANA timezone, URL credentials and budget ceilings. Hosted validation is authoritative.';
  schema.properties.requiredFormats.uniqueItems=true;
  console.log(JSON.stringify({version:HOSTING_VERSION,conventions:hostingConventions,template:emptyHostingBrief(),schema},null,2));
} else if(command==='compile'&&input&&output) {
  const {campaign,preparation,library}=JSON.parse(readFileSync(input,'utf8'));
  if(!/^yc_[a-f0-9]{24}$/.test(campaign?.id)||!Number.isInteger(campaign?.revision)||campaign.revision<1||typeof campaign?.title!=='string'||!Array.isArray(library))throw new Error('Expected {campaign:{id,title,revision},preparation,library:[]}');
  const p=compileHosting(campaign,preparation,library);mkdirSync(output,{recursive:true});
  writeFileSync(path.join(output,'manifest.json'),JSON.stringify(p.manifest,null,2)+'\n');
  writeFileSync(path.join(output,'analysis.csv'),p.csv);writeFileSync(path.join(output,'handoff.md'),p.markdown);
  console.log(JSON.stringify({localRehearsal:true,notSavedToServer:true,manifestHash:p.manifest.manifestHash,status:p.manifest.status}));
} else {
  console.log('Usage: node scripts/campaign-hosting.mjs guide | compile <input.json> <output-directory>\nLocal snapshots are rehearsal evidence, not hosted Library or platform verification.');
  if(command&&command!=='--help')process.exitCode=1;
}
