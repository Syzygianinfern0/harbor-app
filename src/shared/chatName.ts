// Chats launched before a Harbor update keep running their old bridge, which can report a name built from
// text the agent injected into the first user turn (slash-command caveats, Codex environment context).
// Keep INJECTED_TAGS in sync with src/bridge/harbor_bridge.py.
const INJECTED_TAGS = ['local-command-caveat', 'local-command-stdout', 'local-command-stderr', 'command-name', 'command-message', 'command-args', 'command-stdout', 'command-stderr', 'command-contents', 'bash-input', 'bash-stdout', 'bash-stderr', 'system-reminder', 'user-prompt-submit-hook', 'task-notification', 'environment_context', 'user_instructions', 'user_shell_command', 'turn_aborted', 'INSTRUCTIONS'];
const injected = new RegExp(`<(${INJECTED_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?(?:</\\1\\s*>|$)`, 'g');
const noise = /^(Caveat: The messages below|\[Request interrupted|This session is being continued|# AGENTS\.md instructions for)/;

/** The automatic name to show, or undefined when the reported one is only injected text or a bare slash command. */
export function cleanChatName(name: string | undefined): string | undefined {
  const text = String(name ?? '').replace(injected, ' ').replace(/\s+/g, ' ').trim();
  if (!text || noise.test(text) || /^\/[\w:.-]+$/.test(text)) return undefined;
  return text.slice(0, 100);
}

/** True when a saved automatic name was built from injected text and should be repaired. */
export function injectedChatName(name: string): boolean {
  const text = name.trim();
  return new RegExp(injected.source).test(text) || noise.test(text);
}
