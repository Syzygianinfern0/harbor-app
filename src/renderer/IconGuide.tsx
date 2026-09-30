import { activityLabel, type ChatStatus } from '../shared/chatStatus';
import { StatusIcon } from './ChatStatusIcon';

const descriptions: Record<ChatStatus, string> = {
  starting: 'The agent is starting up or loading its conversation.',
  working: 'The agent is processing your request or running tools.',
  attention: 'The agent needs an answer, permission, or another action from you.',
  background: 'The turn ended while background work keeps running — shell jobs, monitors, or background agents. Claude resumes by itself when they report back; Codex does not, so for Codex this means its turn finished with processes still running. Artifact watches, which only wait for comments or edits, do not count.',
  completed: 'The last turn ended and the agent is waiting for your next prompt. This does not verify that the task succeeded.',
  idle: 'The agent is available, with no work currently in progress.',
  error: 'The agent reported a problem. Open the chat to see what happened.',
  closed: 'No icon. The process has stopped; the saved conversation is still available.',
  unknown: 'Harbor cannot currently read the agent’s status, for example while reconnecting.',
  external: 'The conversation is active outside Harbor. Close it there before resuming it here.'
};

export function IconGuide() {
  return <div className="icon-guide">
    <h3>Chat status icons</h3>
    <p>These icons appear next to chats in the sidebar and tabs; closed chats show none. Hover over one for its status and any available details.</p>
    <dl className="icon-guide-list">{(Object.keys(activityLabel) as ChatStatus[]).map(activity => <div className="icon-guide-row" key={activity}>
      <dt><StatusIcon activity={activity}/><span>{activityLabel[activity]}</span></dt>
      <dd>{descriptions[activity]}</dd>
    </div>)}</dl>
    <p className="preferences-note">Live activity is available for agents launched or resumed in Harbor. A terminal connection alone does not tell Harbor whether an agent is working.</p>
  </div>;
}
