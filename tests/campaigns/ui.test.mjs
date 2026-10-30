import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

const rootDir=path.resolve(import.meta.dirname,'../..'); const require=createRequire(import.meta.url);
const file=path.join(rootDir,'src/components/campaigns/CampaignView.tsx');
const code=ts.transpileModule(readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const module={exports:{}};new Function('require','module','exports',code)(require,module,module.exports);
const CampaignView=module.exports.default;
const brief=JSON.parse(readFileSync(path.join(import.meta.dirname,'brief.fixture.json')));
const props={state:{id:'yc_123456789012345678901234',title:'GTME waitlist campaign',revision:2,status:'draft',playbookVersion:'yoke-campaigns-v1',planningNotes:'Confirm agency qualification and final offer.',brief,approval:null,launch:null},
  memo:'# GTME waitlist campaign\n\nPurpose: Recruit practitioners who personally build GTM workflows.\n\nHypothesis: A concrete workflow demonstration can earn qualified waitlist signups.\n\nAudience: In-house GTME and equivalent technical practitioners.\n\nChannels: Meta and LinkedIn.\n\nBudget, timing and qualification remain campaign decisions.',fingerprint:'fixture-fingerprint',canApprove:true,pending:false,onCommand:()=>{},audit:{items:[]},performance:{state:'unavailable',rows:[],detail:[],caveats:['No live source is connected.']},closeout:{status:'not_due',unproven:['The maturity window has not ended.']},groupBy:'concept',onGroupBy:()=>{},from:'',to:'',onFrom:()=>{},onTo:()=>{}};

test('campaign screen preserves permission gates, data states, filters and exact approval target',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
  const before={window:globalThis.window,document:globalThis.document};
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const el=document.getElementById('root');const root=createRoot(el);let command=null,group=null;
  const render=async(over={})=>act(async()=>root.render(React.createElement(CampaignView,{...props,onCommand:c=>command=c,onGroupBy:g=>group=g,...over})));
  const click=async(label)=>{const button=[...el.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,`button ${label}`);await act(async()=>button.click());};
  try{
    await render();assert.match(el.textContent,/GTME waitlist/);
    await click('Approve this memo');assert.deepEqual(command,{type:'approve',fingerprint:'fixture-fingerprint'});
    await click('Performance');assert.match(el.textContent,/Missing data is not zero/);assert.equal(el.querySelectorAll('tbody tr').length,0);
    const select=el.querySelector('select');await act(async()=>{select.value='channel';select.dispatchEvent(new window.Event('change',{bubbles:true}));});assert.equal(group,'channel');
    await click('Execution');assert.match(el.textContent,/No campaign can launch/);assert.equal([...el.querySelectorAll('button')].some(b=>b.textContent==='Launch'),false);
    await click('Audit');assert.match(el.textContent,/No settings observations/);
    await click('Closeout');assert.match(el.textContent,/No scheduled worker/);assert.match(el.textContent,/maturity window/);
    await click('Memo');await render({canApprove:false});assert.equal([...el.querySelectorAll('button')].some(b=>b.textContent==='Approve this memo'),false);
    await render({state:{...props.state,status:'closed'}});assert.equal([...el.querySelectorAll('button')].some(b=>b.textContent==='Approve this memo'),false);
  }finally{await act(async()=>root.unmount());dom.window.close();globalThis.window=before.window;globalThis.document=before.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

// Optional local visual review: no public demo route, credentials or production rows.
if(process.env.CAMPAIGN_PREVIEW_HTML){
  writeFileSync(process.env.CAMPAIGN_PREVIEW_HTML,'<!doctype html><html><meta name="viewport" content="width=device-width"><title>Campaign screen · local fixture</title><style>'+readFileSync(path.join(rootDir,'src/app/globals.css'),'utf8')+'</style><body><main class="wrap"><p class="muted">LOCAL DESIGN FIXTURE · No live account data</p>'+renderToStaticMarkup(React.createElement(CampaignView,props))+'</main></body></html>');
}
