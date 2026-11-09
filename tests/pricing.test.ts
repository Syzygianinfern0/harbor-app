import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogFrom,PricingStore,PRICING_OVERRIDES,PRICING_URL,withOverrides} from '../src/engine/pricing';
import bundled from '../src/engine/pricing-snapshot.json';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('pricing catalog keeps direct model rates and rejects invalid values',()=>{
 const raw=Object.fromEntries(Array.from({length:10},(_,i)=>[`model-${i}`,{mode:'chat',litellm_provider:'openai',input_cost_per_token:.00001,output_cost_per_token:.00005,cache_read_input_token_cost:Infinity,input_cost_per_token_priority:.00002,description:'discard'}]));
 const catalog=catalogFrom({...raw,invalid:{...raw['model-0'],input_cost_per_token:-1},proxy:{...raw['model-0'],litellm_provider:'azure'}});
 assert.equal(Object.keys(catalog.models).length,10+Object.keys(PRICING_OVERRIDES).length);assert.equal(catalog.models['model-0'].input_cost_per_token_priority,.00002);assert.equal(catalog.models['model-0'].cache_read_input_token_cost,undefined);assert.equal(catalog.models['model-0'].description,undefined);
 assert.throws(()=>catalogFrom({}),/incomplete/);
});
test('offline pricing retains a dated bundled catalog and coalesces callers',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-pricing-'));const store=new PricingStore(dir);
 (store as any).value={...(store as any).value,fetchedAt:'2000-01-01T00:00:00Z'};
 const fetch=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('offline');};
 try{const first=store.get();assert.equal(store.get(),first);const catalog=await first;assert.ok(catalog.models['gpt-6-astra']);assert.equal(catalog.fetchedAt,'2000-01-01T00:00:00Z');await store.get();assert.equal(calls,1);}finally{globalThis.fetch=fetch;}
});
test('pricing overrides fill models LiteLLM lacks without replacing its rates',()=>{
 const raw=Object.fromEntries(Array.from({length:10},(_,i)=>[`model-${i}`,{mode:'chat',litellm_provider:'anthropic',input_cost_per_token:.00001,output_cost_per_token:.00005}]));
 const filled=catalogFrom(raw);
 assert.equal(filled.models['claude-fable-5-2'].input_cost_per_token,8e-6);assert.equal(filled.models['claude-fable-5-2'].output_cost_per_token,4e-5);assert.equal(filled.models['claude-fable-5-2'].cache_read_input_token_cost,2e-7);
 const live=catalogFrom({...raw,'claude-fable-5-2':{mode:'chat',litellm_provider:'anthropic',input_cost_per_token:.000009,output_cost_per_token:.00004}});
 assert.equal(live.models['claude-fable-5-2'].input_cost_per_token,.000009);assert.equal(live.models['claude-fable-5-2'].cache_read_input_token_cost,undefined);
 assert.equal(withOverrides(live),live);
 assert.deepEqual(PRICING_OVERRIDES['claude-fable-5-2'],(bundled as any).models['claude-fable-5-2']);
});
test('cached catalogs saved before an override existed still price the overridden model',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'harbor-pricing-'));
 const models=Object.fromEntries(Array.from({length:10},(_,i)=>[`model-${i}`,{input_cost_per_token:1e-6,output_cost_per_token:1e-6}]));
 await writeFile(path.join(dir,'usage-pricing.json'),JSON.stringify({fetchedAt:new Date().toISOString(),source:PRICING_URL,models}));
 const catalog=await new PricingStore(dir).get();
 assert.equal(catalog.models['claude-fable-5-2'].input_cost_per_token,8e-6);assert.ok(catalog.models['model-0']);
});
