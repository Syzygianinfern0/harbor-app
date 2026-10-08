import type { Session } from './types';
import { chatActivity } from './chatStatus';

// `reveal` names a project whose closed chats show even while "Hide all closed chats" is on: the project
// the user opened by clicking its name. Other filters (notes only, empty chats) still apply.
// Terminals are listed only while they are open: running, or open as a tab (`open`). A closed terminal keeps nothing to go back to.
export type ChatFilter = { hideClosed: boolean; notesOnly: boolean; reveal?: string; fresh?: ReadonlySet<string>; open?: ReadonlySet<string> };
export const chatVisible = (session: Session, { hideClosed, notesOnly, reveal, fresh, open }: ChatFilter) =>
  (!hideClosed || chatActivity(session) !== 'closed' || (!!reveal && session.projectId === reveal)) && (!notesOnly || !!session.note) &&
  (session.launcher !== 'shell' || chatActivity(session) !== 'closed' || !!open?.has(session.id)) && (session.hasMessages !== false || !!fresh?.has(session.id));
// Clicking a project name reveals its closed chats; clicking it again while its overview is already showing
// hands the project back to the toggle.
export const nextReveal = (reveal: string | undefined, id: string, viewing: boolean) => reveal === id && viewing ? undefined : id;
