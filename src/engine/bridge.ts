import type { PricingCatalog } from './pricing';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentPlan, ChatBilling, Connection, Conversation, Session, ChatPreview, ChatUsage, AgentUsage, DirectoryListing, LimitSnapshot } from '../shared/types';
import { cleanPlans } from '../shared/usagePlans';
import { Transport, quote } from './transport';

export interface AgentMetadata { hasMessages?: boolean; attentionAt?: number; completedAt?: number; generation?: string; conversationId?: string; name?: string; activity?: Session['activity']; reason?: string; updatedAt?: number; resumable?: boolean; billing?: ChatBilling; limits?: LimitSnapshot }
export class AgentBridge {
  private installed = new Map<string, Promise<string>>();
  constructor(private transport: Transport) {}
  async listDirectories(connection: Connection, input: string, showHidden: boolean): Promise<DirectoryListing> {
    const bridge = await this.ensure(connection);
    const result = JSON.parse(await this.transport.run(connection, this.transport.setup()+`python3 ${bridge} directories ${showHidden ? '--hidden ' : ''}-- ${quote(input)}`, {timeout:15000}));
    if (result.error) throw new Error(result.error);
    return result;
  }
  async ensure(connection: Connection) {
    const key = JSON.stringify(connection); let task = this.installed.get(key);
    if (!task) { task = this.install(connection); this.installed.set(key, task); task.catch(() => this.installed.delete(key)); }
    return task;
  }
  private async install(connection: Connection) {
    const file = typeof __dirname === 'string' ? path.join(__dirname, '../bridge/harbor_bridge.py') : path.resolve('src/bridge/harbor_bridge.py');
    const source = await readFile(file).catch(() => readFile(path.resolve('src/bridge/harbor_bridge.py')));
    const digest = createHash('sha256').update(source).digest('hex').slice(0,16);
    const target = `"$HOME/.local/share/harbor/bridge-${digest}.py"`;
    await this.transport.run(connection, this.transport.setup() + `set -e\ncommand -v python3 >/dev/null || { echo 'Python 3 is required for agent integration on this host.' >&2; exit 1; }\numask 077\nmkdir -p "$HOME/.local/share/harbor"\npython3 -c ${quote('import base64,pathlib,os; p=pathlib.Path.home()/".local/share/harbor/bridge-'+digest+'.py"; p.write_bytes(base64.b64decode("'+source.toString('base64')+'")); os.chmod(p,0o600)')}\n`);
    return target;
  }
  async metadata(connection: Connection, ids: string[]): Promise<Record<string,AgentMetadata>> {
    if (!ids.length) return {};
    const bridge = await this.ensure(connection);
    const result = await this.transport.run(connection, this.transport.setup()+`python3 ${bridge} metadata ${ids.map(quote).join(' ')}`, { retry:true });
    return JSON.parse(result);
  }
  async identify(connection:Connection, agent:string, pid:number):Promise<string|undefined> {
    const bridge=await this.ensure(connection);
    const output=await this.transport.run(connection,this.transport.setup()+`python3 ${bridge} identify ${quote(agent)} ${pid}`,{retry:true});
    return JSON.parse(output).conversationId??undefined;
  }
  async available(connection:Connection, agent:string, identity:string):Promise<boolean> {
    const bridge=await this.ensure(connection);
    const output=await this.transport.run(connection,this.transport.setup()+`python3 ${bridge} available ${quote(agent)} ${quote(identity)}`,{retry:true});
    return !JSON.parse(output).busy;
  }
  private prices = new Map<string, Promise<string>>();
  private ensurePrices(connection: Connection, catalog: PricingCatalog): Promise<string> {
    const data=Buffer.from(JSON.stringify(catalog));const digest=createHash('sha256').update(data).digest('hex').slice(0,16);
    const key=JSON.stringify(connection)+digest;const existing=this.prices.get(key);if(existing)return existing;
    const filename='prices-'+digest+'.json';
    const task=this.transport.run(connection,this.transport.setup()+`python3 -c ${quote('import pathlib,base64,os; p=pathlib.Path.home()/".local/share/harbor"/'+JSON.stringify(filename)+'; p.write_bytes(base64.b64decode("'+data.toString('base64')+'")); os.chmod(p,0o600)')}`).then(()=>`"$HOME/.local/share/harbor/${filename}"`);
    this.prices.set(key,task);task.catch(()=>this.prices.delete(key));return task;
  }
  async usage(connection: Connection, catalog?: PricingCatalog): Promise<{agents: AgentUsage[]}> {
    const bridge = await this.ensure(connection);
    return JSON.parse(await this.transport.run(connection, this.transport.setup()+`python3 ${bridge} usage${catalog?` --prices ${await this.ensurePrices(connection,catalog)}`:''}`, {timeout:120000}));
  }
  async limits(connection: Connection): Promise<{agents: AgentPlan[]}> {
    const bridge = await this.ensure(connection);
    return {agents: cleanPlans(JSON.parse(await this.transport.run(connection, this.transport.setup()+`python3 ${bridge} limits`, {retry:true, timeout:20000})))};
  }
  async chatUsage(connection: Connection, agent: string, cwd: string, identity: string, catalog?: PricingCatalog): Promise<ChatUsage> {
    const bridge = await this.ensure(connection);
    return JSON.parse(await this.transport.run(connection, this.transport.setup()+`python3 ${bridge} chat-usage ${quote(agent)} ${quote(cwd)} ${quote(identity)}${catalog?` --prices ${await this.ensurePrices(connection,catalog)}`:''}`, {timeout:30000}));
  }
  async preview(connection:Connection, agent:string, cwd:string, identity:string):Promise<ChatPreview> {
    const bridge=await this.ensure(connection);
    return JSON.parse(await this.transport.run(connection,this.transport.setup()+`python3 ${bridge} preview ${quote(agent)} ${quote(cwd)} ${quote(identity)}`,{retry:true,timeout:30000}));
  }
  async history(connection: Connection, cwd: string): Promise<{conversations: Conversation[]; errors:string[]}> {
    const bridge = await this.ensure(connection);
    const result = await this.transport.run(connection, this.transport.setup()+`python3 ${bridge} history ${quote(cwd)}`, { retry:true, timeout:30000 });
    return JSON.parse(result);
  }
}
