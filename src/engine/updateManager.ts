import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentUpdate, AgentUpdateState } from '../shared/types';

export const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_INTERVAL = 60 * 60 * 1000;
/** Machines updated at the same time by Update all. */
export const PARALLEL_HOSTS = 4;
const keyFor = (host: string, agent: string) => `${host}:${agent}`;

/** Owns checks and installs independently of the Preferences dialog's lifetime. */
export class UpdateManager {
  private state: AgentUpdateState = {updates: [], checking: false, updatingAll: false, installing: [], queued: [], results: {}};
  private checkedTargets = '';
  private pending?: Promise<AgentUpdate[]>;
  private jobs = new Set<Promise<unknown>>();
  private busyHosts = new Set<string>();
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
    if (this.state.installing.length || this.state.updatingAll) return this.snapshot().updates;
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
  private setKey(list: 'installing' | 'queued', key: string, on: boolean) {
    const rest = this.state[list].filter(item => item !== key);
    this.state[list] = on ? [...rest, key] : rest;
  }
  private async installOne(host: string, agent: AgentUpdate['agent']) {
    const key = keyFor(host, agent);
    this.setKey('queued', key, false); this.setKey('installing', key, true);
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
    } finally { this.setKey('installing', key, false); this.changed(); }
  }
  private track<T>(job: Promise<T>): Promise<T> {
    const tracked = job.finally(() => {this.jobs.delete(tracked);});
    this.jobs.add(tracked);
    return tracked;
  }
  /** Installs one row. Other machines may be updating meanwhile; only one install runs per machine. */
  install(host: string, agent: AgentUpdate['agent']) {
    if (this.pending) return Promise.reject(new Error('A check is already running.'));
    if (this.busyHosts.has(host)) return Promise.reject(new Error('An update is already running on this machine.'));
    this.busyHosts.add(host);
    return this.track(this.installOne(host, agent).finally(() => {this.busyHosts.delete(host);}));
  }
  updateAll(): Promise<void> {
    if (this.jobs.size) return Promise.reject(new Error('An update is already running.'));
    const job = (async () => {
      // Refresh the plan before changing anything; never install missing/unknown agents.
      const rows = await this.check(true);
      const available = rows.filter(row => row.status === 'available');
      const lanes = [...new Set(available.map(row => row.hostId))].map(host => available.filter(row => row.hostId === host));
      this.state.updatingAll = true; this.state.completed = 0; this.state.total = available.length;
      this.state.queued = available.map(row => keyFor(row.hostId, row.agent));
      for (const key of this.state.queued) this.state.results[key] = {message: 'Waiting to update…'};
      this.changed();
      // Machines update in parallel (a few at a time); agents on one machine update one by one,
      // because global npm/Homebrew installs on the same machine conflict.
      // Every machine in the plan is held from the start, so a single-row install can't slip in before its turn.
      for (const lane of lanes) this.busyHosts.add(lane[0].hostId);
      const runLane = async (lane: AgentUpdate[]) => {
        try {
          for (const row of lane) {
            try {await this.installOne(row.hostId, row.agent);} catch { /* Keep going with the rest. */ }
            this.state.completed!++; this.changed();
          }
        } finally {this.busyHosts.delete(lane[0].hostId);}
      };
      try {
        let next = 0;
        await Promise.allSettled(Array.from({length: Math.min(PARALLEL_HOSTS, lanes.length)}, async () => {
          while (next < lanes.length) await runLane(lanes[next++]);
        }));
      } finally {this.state.updatingAll = false; this.state.queued = []; this.changed();}
    })();
    return this.track(job);
  }
  async flush() {await Promise.allSettled([...this.jobs]); await this.writes.catch(() => {});}
}
