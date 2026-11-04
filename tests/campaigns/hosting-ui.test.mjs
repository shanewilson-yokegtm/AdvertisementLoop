import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {load} from './load.mjs';
const HostingPanel=load('src/components/campaigns/HostingPanel.tsx').default;
const {emptyHostingBrief}=load('src/lib/campaigns/hosting-contracts.ts');
const {compileHosting}=load('src/lib/campaigns/hosting.ts');
test('hosting screen saves an honest memo, preserves failed/stale edits and exports the checked packet',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
  const before={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const root=createRoot(document.getElementById('root'));let command,result=false;
  const state={id:'yc_123456789012345678901234',title:'Workflow upkeep vs cost',revision:1,status:'draft',planningNotes:'Test upkeep versus cost messaging for GTM engineers. Budget TBD.'};
  const render=async(over={})=>act(async()=>root.render(React.createElement(HostingPanel,{state,canEdit:true,pending:false,onCommand:async(c,r)=>{command={c,r};return result;},...over})));
  const click=async(label)=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(b,label);await act(async()=>b.click());};
  try {
    await render();await click('Add market-test memo');assert.equal(document.querySelector('textarea').value,state.planningNotes);
    await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
    assert.equal(command.c.type,'save_preparation');assert.equal(command.r,1);assert.equal(command.c.preparation.budget,null);assert.equal(command.c.preparation.decisionsCurrent,false);
    assert.ok(document.querySelector('textarea'),'failed save retains memo');
    await render({state:{...state,revision:2}});assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Save market-test memo').disabled,true);
    await click('Cancel memo edit');
    const prep={...emptyHostingBrief(state.planningNotes),initiativeKey:'gtme_learning',campaignKey:'upkeep_vs_cost',productKey:'yoke',hypothesis:'Upkeep messaging resonates with workflow builders.',
      audienceKey:'gtme_builders',audienceDefinition:'Practitioners who build GTM workflows',offer:'Preview relevant accounts and messages',primaryOutcome:'qualified_signup',countries:['US'],destination:'https://example.test/preview',
      requiredFormats:['feed45'],decisionsCurrent:true,ads:[{key:'upkeep_static',conceptKey:'workflow_upkeep',variantKey:'original',kind:'static',disposition:'included',
        primaryText:'The workflow shipped. The upkeep stayed.',headline:'For GTM engineers',cta:'Learn more',renditions:[{format:'feed45',assetId:'fixture_asset',versionId:'fixture_asset_v1'}]}]};
    const library=[{assetId:'fixture_asset',versionId:'fixture_asset_v1',archived:false,kind:'static',fileReady:true,width:1080,height:1350,approved:true,qaFailed:false,contentType:'image/png'}];
    const packet={...compileHosting(state,prep,library),libraryCheckedAt:'2026-11-04T16:00:00Z'};
    globalThis.fetch=async()=>({ok:true,json:async()=>packet});
    await render({state:{...state,preparation:prep,revision:2},canEdit:false});
    assert.match(document.body.textContent,/Needs decisions or assets/);assert.match(document.body.textContent,/budget and currency/);
    assert.match(document.body.textContent,/1 ads · 1 renditions/);assert.match(document.body.textContent,/No platform upload/);
    assert.ok([...document.querySelectorAll('button')].find(b=>b.textContent==='Download analysis CSV'));
    assert.equal([...document.querySelectorAll('button')].some(b=>b.textContent==='Edit market-test memo'),false);
    assert.equal(document.querySelector('a[href^="/a/"]').getAttribute('href'),'/a/fixture_asset?v=fixture_asset_v1');
    if(process.env.HOSTING_PREVIEW_HTML)writeFileSync(process.env.HOSTING_PREVIEW_HTML,'<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Yoke hosting · local review fixture</title><style>'+readFileSync(path.resolve(import.meta.dirname,'../../src/app/globals.css'),'utf8')+'</style><body><main class="wrap"><p class="muted">LOCAL REVIEW FIXTURE · No live campaign</p>'+document.getElementById('root').innerHTML+'</main></body></html>');
    if(process.env.HOSTING_FIXTURE_JSON)writeFileSync(process.env.HOSTING_FIXTURE_JSON,JSON.stringify({campaign:state,preparation:prep,library},null,2));
  } finally {await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,before);delete globalThis.IS_REACT_ACT_ENVIRONMENT;}
});
