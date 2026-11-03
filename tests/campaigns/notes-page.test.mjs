import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const file = path.resolve(import.meta.dirname, '../../src/app/campaigns/[id]/page.tsx');
let viewProps;
const module = {exports:{}};
const code = ts.transpileModule(readFileSync(file,'utf8'), {fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new Function('require','module','exports',code)(id => {
  if (id === 'react') return {...React,use:() => ({id:'yc_123456789012345678901234'})};
  if (id === 'next/link') return {default:({children,...p}) => React.createElement('a',p,children)};
  if (id === '@/components/Shell') return {useApp:() => ({member:{role:'creator'}})};
  if (id === '@/components/campaigns/CampaignView') return {default:p => {viewProps=p;return React.createElement('p',null,p.state.planningNotes);}};
  return require(id);
},module,module.exports);
const Campaign = module.exports.default;

test('browser notes save uses the editing revision, preserves unknown request identity, and reads back shared state', async () => {
  const dom = new JSDOM('<div id="root"></div>',{url:'http://localhost'});
  const before = {window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  let record={state:{id:'yc_123456789012345678901234',revision:4,planningNotes:'Original draft'},memo:null,fingerprint:'fixture'};
  const requests=[];let loseResponse=true,failRefresh=false;
  const ok = d => ({ok:true,json:async()=>structuredClone(d)});
  globalThis.fetch=async(url,options={}) => {
    if (options.method==='POST') {
      const body=JSON.parse(options.body);requests.push(body);
      if (requests.length===1) {
        record={...record,state:{...record.state,revision:5,planningNotes:body.command.notes}};
        if (loseResponse) throw new Error('Connection lost after save');
      }
      return ok(record);
    }
    if (url.endsWith('/observations')) return ok({items:[]});
    if (url.endsWith('/closeout')) return ok({});
    if (url.includes('/report?')) return ok({rows:[]});
    if (failRefresh) throw new Error('Refresh unavailable');
    return ok(record);
  };
  const root=createRoot(document.getElementById('root'));
  try {
    await act(async()=>root.render(React.createElement(Campaign,{params:Promise.resolve({})})));
    assert.equal(viewProps.canEdit,true);
    const command={type:'save_notes',notes:'Prepared campaign with exact asset version'};
    let result;
    await act(async()=>{result=await viewProps.onCommand(command,4);});
    assert.equal(result,false);assert.match(document.body.textContent,/Connection lost/);
    assert.ok([...document.querySelectorAll('button')].find(b=>b.textContent==='Retry previous command'));
    await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Reload').click());
    assert.ok([...document.querySelectorAll('button')].find(b=>b.textContent==='Retry previous command'),'reload must retain recovery for the unknown save');
    await act(async()=>{result=await viewProps.onCommand({...command,notes:'Different unsaved edit'},4);});
    assert.equal(result,false);assert.equal(requests.length,1);
    await act(async()=>{result=await viewProps.onCommand(command,4);});
    assert.equal(result,true);assert.deepEqual(requests[1],requests[0]);assert.equal(requests[0].expectedRevision,4);
    assert.ok(requests[0].requestKey.length>=8);assert.equal(viewProps.state.revision,5);assert.equal(viewProps.state.planningNotes,command.notes);
    // A successful command remains saved even if a subsequent refresh fails.
    failRefresh=true;loseResponse=false;
    await act(async()=>{result=await viewProps.onCommand(command,5);});
    assert.equal(result,true);assert.notEqual(requests[2].requestKey,requests[0].requestKey);
    assert.match(document.body.textContent,/Saved, but/);
  } finally {
    await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,before);delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
