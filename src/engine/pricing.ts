import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import bundled from './pricing-snapshot.json';
export interface PricingCatalog { fetchedAt: string; source: string; models: Record<string, Record<string, unknown>> }
export const PRICING_URL='https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export function catalogFrom(raw: Record<string, any>, now=new Date()): PricingCatalog {
  const models: PricingCatalog['models']={};
  for(const [id, value] of Object.entries(raw)) {
    if(!value || !['openai','anthropic'].includes(value.litellm_provider) || value.mode!=='chat')continue;
    if(!Number.isFinite(value.input_cost_per_token)||!Number.isFinite(value.output_cost_per_token)||value.input_cost_per_token<0||value.output_cost_per_token<0||value.input_cost_per_token+value.output_cost_per_token===0)continue;
    const rates:Record<string,unknown>={};
    for(const [key, rate] of Object.entries(value)) {
      if(/^(input_cost_per_token|output_cost_per_token|cache_read_input_token_cost|cache_creation_input_token_cost)/.test(key)&&typeof rate==='number'&&Number.isFinite(rate)&&rate>=0)rates[key]=rate;
    }
    if(value.provider_specific_entry)rates.provider_specific_entry=Object.fromEntries(Object.entries(value.provider_specific_entry).filter(([,n])=>typeof n==='number'&&Number.isFinite(n)&&n>0));
    models[id]=rates;
  }
  if(Object.keys(models).length<10)throw new Error('Pricing catalog is incomplete.');
  return {fetchedAt:now.toISOString(),source:PRICING_URL,models};
}
export class PricingStore {
  private value:PricingCatalog=bundled;
  private loaded=false;
  private pending?:Promise<PricingCatalog>;
  private attempted=0;
  constructor(private dataDir:string) {}
  get():Promise<PricingCatalog> {
    if(this.pending)return this.pending;
    this.pending=this.read().finally(()=>{this.pending=undefined;});return this.pending;
  }
  private async read() {
    const file=path.join(this.dataDir,'usage-pricing.json');
    if(!this.loaded){this.loaded=true;try{const data=JSON.parse(await readFile(file,'utf8'));if(data.source===PRICING_URL&&Number.isFinite(Date.parse(data.fetchedAt))&&Object.keys(data.models??{}).length>=10)this.value=data;}catch{}}
    if(Date.now()-Date.parse(this.value.fetchedAt)<86400000||Date.now()-this.attempted<300000)return this.value;
    this.attempted=Date.now();
    try {
      const response=await fetch(PRICING_URL,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error('Pricing request failed.');
      this.value=catalogFrom(await response.json());
      await writeFile(file+'.tmp',JSON.stringify(this.value),{mode:0o600});await rename(file+'.tmp',file);
    } catch { /* Retain the dated catalog when offline; never invent rates. */ }
    return this.value;
  }
}
