import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { load } from './load.mjs';

const rootDir=path.resolve(import.meta.dirname,'../..');
const CampaignView=load('src/components/campaigns/CampaignView.tsx').default;
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

test('planning notes keep exact asset links, preserve failed/conflicting edits, and gate editing by role and status',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
  const before={window:globalThis.window,document:globalThis.document};
  globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const el=document.getElementById('root');const root=createRoot(el);const commands=[];
  const assetUrl='https://advertisementloop-eight.vercel.app/a/fixture_asset?v=fixture_asset_v2';
  const state={...props.state,brief:null,planningNotes:`Scope pending.\n${assetUrl}`};
  let succeeds=false;
  const render=async(over={})=>act(async()=>root.render(React.createElement(CampaignView,{...props,state,memo:null,canEdit:true,
    onCommand:async(c,revision)=>{commands.push({c,revision});return succeeds;},...over})));
  const click=async(label)=>{const button=[...el.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,label);await act(async()=>button.click());};
  try{
    await render();assert.equal(el.querySelector(`a[href="${assetUrl}"]`).getAttribute('href'),assetUrl);
    await click('Edit planning notes');assert.equal(el.querySelector('textarea').value,state.planningNotes);assert.equal(el.querySelector('textarea').maxLength,12000);
    if(process.env.CAMPAIGN_NOTES_PREVIEW_HTML) writeFileSync(process.env.CAMPAIGN_NOTES_PREVIEW_HTML,'<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Campaign notes · local fixture</title><style>'+readFileSync(path.join(rootDir,'src/app/globals.css'),'utf8')+'</style><body><main class="wrap"><p class="muted">LOCAL DESIGN FIXTURE · No live account data</p>'+el.innerHTML+'</main></body></html>');
    // A stale revision after Reload must keep the local draft and block overwrite.
    await render({state:{...state,revision:3,planningNotes:'Another teammate saved this.'}});
    assert.equal(el.querySelector('textarea').value,state.planningNotes);assert.match(el.textContent,/Your draft is preserved/);
    assert.equal([...el.querySelectorAll('button')].find(b=>b.textContent==='Save planning notes').disabled,true);
    await click('Cancel editing');await render();await click('Edit planning notes');assert.equal(el.querySelector('textarea').value,state.planningNotes);
    // Submit directly to exercise the save receipt without depending on jsdom's text-input emulation.
    await act(async()=>el.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
    assert.deepEqual(commands.at(-1),{c:{type:'save_notes',notes:state.planningNotes},revision:2});
    assert.ok(el.querySelector('textarea'));assert.doesNotMatch(el.textContent,/Planning notes saved\./);
    succeeds=true;
    await act(async()=>el.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(el.querySelector('textarea'),null);assert.match(el.textContent,/Planning notes saved\./);
    await render({canEdit:false});assert.equal([...el.querySelectorAll('button')].some(b=>b.textContent==='Edit planning notes'),false);
    await render({state:{...state,status:'closed'}});assert.equal([...el.querySelectorAll('button')].some(b=>b.textContent==='Edit planning notes'),false);
  }finally{await act(async()=>root.unmount());dom.window.close();globalThis.window=before.window;globalThis.document=before.document;delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});

// Optional local visual review: no public demo route, credentials or production rows.
if(process.env.CAMPAIGN_PREVIEW_HTML){
  writeFileSync(process.env.CAMPAIGN_PREVIEW_HTML,'<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Campaign screen · local fixture</title><style>'+readFileSync(path.join(rootDir,'src/app/globals.css'),'utf8')+'</style><body><main class="wrap"><p class="muted">LOCAL DESIGN FIXTURE · No live account data</p>'+renderToStaticMarkup(React.createElement(CampaignView,props))+'</main></body></html>');
}
