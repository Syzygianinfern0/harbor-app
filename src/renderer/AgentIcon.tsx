import { Terminal } from 'lucide-react';
import type { Launcher } from '../shared/types';
import codex from './icons/openai.svg?raw';
import claude from './icons/claude.svg?raw';
// Brand silhouettes from Simple Icons, rendered in the surrounding theme color.
export function AgentIcon({launcher,size=16}:{launcher:Launcher;size?:number}) {
  if(launcher!=='codex'&&launcher!=='claude')return <Terminal size={size}/>;
  const svg=(launcher==='codex'?codex:claude).replace('<svg ','<svg fill="currentColor" ').replace(/<title>.*?<\/title>/,'');
  return <span className="agent-logo" aria-hidden="true" style={{width:size,height:size}} dangerouslySetInnerHTML={{__html:svg}}/>;
}
