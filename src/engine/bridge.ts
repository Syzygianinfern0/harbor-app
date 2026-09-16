import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Connection, Conversation, Session } from '../shared/types';
import { Transport, quote } from './transport';

export interface AgentMetadata { attentionAt?: number; completedAt?: number; generation?: string; conversationId?: string; name?: string; activity?: Session['activity']; reason?: string; updatedAt?: number; resumable?: boolean }
export class AgentBridge {
  private installed = new Map<string, Promise<string>>();
  constructor(private transport: Transport) {}
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
  async history(connection: Connection, cwd: string): Promise<{conversations: Conversation[]; errors:string[]}> {
    const bridge = await this.ensure(connection);
    const result = await this.transport.run(connection, this.transport.setup()+`python3 ${bridge} history ${quote(cwd)}`, { retry:true, timeout:30000 });
    return JSON.parse(result);
  }
}
