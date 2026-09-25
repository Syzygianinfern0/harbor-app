import type { Session } from './types';
import { chatActivity } from './chatStatus';

// `reveal` names a project whose closed chats show even while "Hide all closed chats" is on: the project
// the user opened by clicking its name. Other filters (notes only, shell rows, empty chats) still apply.
export type ChatFilter = { hideClosed: boolean; notesOnly: boolean; reveal?: string; fresh?: ReadonlySet<string> };
export const chatVisible = (session: Session, { hideClosed, notesOnly, reveal, fresh }: ChatFilter) =>
  (!hideClosed || chatActivity(session) !== 'closed' || (!!reveal && session.projectId === reveal)) && (!notesOnly || !!session.note) &&
  session.launcher !== 'shell' && (session.hasMessages !== false || !!fresh?.has(session.id));
// Clicking a project name reveals its closed chats; clicking it again while its overview is already showing
// hands the project back to the toggle.
export const nextReveal = (reveal: string | undefined, id: string, viewing: boolean) => reveal === id && viewing ? undefined : id;
