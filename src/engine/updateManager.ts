import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentUpdate, AgentUpdateState } from '../shared/types';

export const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_INTERVAL = 60 * 60 * 1000;
const keyFor = (host: string, agent: string) => `${host}:${agent}`;

/** Owns checks and installs independently of the Preferences dialog's lifetime. */
export class UpdateManager {
  private state: AgentUpdateState = {updates: [], checking: false, updatingAll: false, results: {}};
  private checkedTargets = '';
  private pending?: Promise<AgentUpdate[]>;
  private job?: Promise<unknown>;
  private writes = Promise.resolve();
  constructor(private directory: string, private targets: () => string,
    private checkVersions: () => Promise<AgentUpdate[]>,
    private installVersion: (host: string, agent: AgentUpdate['agent']) => Promise<{update: AgentUpdate; output: string}>,
    private changed: () => void, private now = Date.now) {}
  snapshot() { return structuredClone(this.state); }
  async load() {
    try {
      const cached = JSON.parse(await readFile(path.join(this.directory, 'agent-updates.json'), 'utf8'));
      if (Array.isArray(cached.updates) && typeof cached.checkedAt === 'number' && typeof cached.targets === 'string') {
        this.state.updates = cached.updates; this.state.checkedAt = cached.checkedAt; this.checkedTargets = cached.targets;
      }
    } catch { /* A missing/corrupt cache should simply cause a fresh check. */ }
  }
  private persist() {
    const data = JSON.stringify({updates: this.state.updates, checkedAt: this.state.checkedAt, targets: this.checkedTargets});
    const file = path.join(this.directory, 'agent-updates.json');
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(this.directory, {recursive: true});
      await writeFile(file + '.tmp', data, {mode: 0o600}); await rename(file + '.tmp', file);
    });
    return this.writes;
  }
  async check(force = true): Promise<AgentUpdate[]> {
    if (this.pending) return this.pending;
    if (this.state.running || this.state.updatingAll) return this.snapshot().updates;
    const targets = this.targets();
    const age = this.now() - (this.state.checkedAt ?? 0);
    const retry = this.state.error || this.state.updates.some(row => row.status === 'unknown') ? FAILURE_RETRY_INTERVAL : UPDATE_CHECK_INTERVAL;
    if (!force && this.state.checkedAt !== undefined && age >= 0 && age < retry && targets === this.checkedTargets) return this.snapshot().updates;
    this.state.checking = true; this.state.error = undefined; this.changed();
    this.pending = (async () => {
      try {
        this.state.updates = await this.checkVersions();
        this.state.checkedAt = this.now(); this.checkedTargets = targets;
        await this.persist();
        return this.snapshot().updates;
      } catch (error) {
        this.state.error = (error as Error).message; this.state.checkedAt = this.now(); this.checkedTargets = targets;
        throw error;
      } finally { this.state.checking = false; this.pending = undefined; this.changed(); }
    })();
    return this.pending;
  }
  private async installOne(host: string, agent: AgentUpdate['agent']) {
    const key = keyFor(host, agent);
    this.state.running = key;
    this.state.results[key] = {message: 'Updating… This may take a few minutes.'}; this.changed();
    try {
      const result = await this.installVersion(host, agent);
      this.state.updates = this.state.updates.map(row => row.hostId === host && row.agent === agent ? result.update : row);
      this.state.results[key] = {message: result.update.status === 'current'
        ? `Verified: ${result.update.installed} is up to date.`
        : `Update finished, but the latest version was not verified. Active version: ${result.update.installed || 'unknown'}. ${result.update.error || 'Check the output and installation channel.'}`, output: result.output};
      await this.persist(); return result;
    } catch (error) {
      this.state.results[key] = {message: `Update failed or could not be confirmed: ${(error as Error).message}. Check versions before retrying.`};
      throw error;
    } finally { this.state.running = undefined; this.changed(); }
  }
  install(host: string, agent: AgentUpdate['agent']) {
    if (this.job || this.pending) return Promise.reject(new Error('An update or check is already running.'));
    const job = this.installOne(host, agent); this.job = job;
    return job.finally(() => {this.job = undefined;});
  }
  updateAll(): Promise<void> {
    if (this.job) return Promise.reject(new Error('An update is already running.'));
    const job = (async () => {
      // Refresh the plan before changing anything; never install missing/unknown agents.
      const rows = await this.check(true);
      const available = rows.filter(row => row.status === 'available');
      this.state.updatingAll = true; this.state.completed = 0; this.state.total = available.length; this.changed();
      try {
        for (const row of available) {
          try {await this.installOne(row.hostId, row.agent);} catch { /* Keep going on the other hosts. */ }
          this.state.completed!++; this.changed();
        }
      } finally {this.state.updatingAll = false; this.changed();}
    })();
    this.job = job;
    return job.finally(() => {this.job = undefined;});
  }
  async flush() {await Promise.allSettled([this.job]); await this.writes.catch(() => {});}
}
