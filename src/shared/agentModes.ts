import type { Launcher, PermissionMode } from './types';
export const agentModes: Record<'codex'|'claude', {value:PermissionMode;label:string;description:string}[]> = {
  codex: [
    {value:'standard',label:'Workspace · ask when needed',description:'Work in the project sandbox and ask before actions that need broader access.'},
    {value:'read-only',label:'Read only',description:'Inspect files in a read-only sandbox; ask before broader access.'},
    {value:'full-access',label:'Full access · no approvals',description:'Run commands without sandbox restrictions or approval prompts.'}
  ],
  claude: [
    {value:'standard',label:'Standard approvals',description:'Use Claude’s normal permission prompts and configured permission rules.'},
    {value:'accept-edits',label:'Accept edits',description:'Automatically approve file edits; other tools follow Claude’s permission rules.'},
    {value:'plan',label:'Plan',description:'Start in planning mode before making changes.'},
    {value:'full-access',label:'Full access · skip permissions',description:'Skip Claude’s permission prompts for tools and commands.'}
  ]
};
export function validateMode(launcher:Launcher, mode:unknown):PermissionMode {
  if((launcher!=='codex'&&launcher!=='claude')||!agentModes[launcher].some(option=>option.value===mode)) throw new Error('Invalid agent permission mode.');
  return mode as PermissionMode;
}
