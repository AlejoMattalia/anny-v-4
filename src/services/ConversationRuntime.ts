export type ConversationSpeech = { priority?: 'stream' | 'guidance'; onStart?: () => void };
type Narrator = (text: string, options?: ConversationSpeech) => Promise<void>;
let narrator: Narrator | null = null;
let interrupt: (() => void) | null = null;
let requested = false;
let tutorCallActive = false;
export const isTutorCallActive = () => tutorCallActive;
export function setTutorCallActive(value: boolean) {
  tutorCallActive = value;
  if (value) { waitingSpeech.clear(); interrupt?.(); }
}
const waitingSpeech = new Map<string, { text: string; options: ConversationSpeech }>();
const mutedActions = new Set<symbol>();
const listeners = new Set<() => void>();
export const conversationIsActive = () => requested || narrator !== null;
export function setConversationRequested(value: boolean) {
  requested = value;
  if (!value) waitingSpeech.clear();
  listeners.forEach(listener => listener());
}
export function setConversationNarrator(next: Narrator | null, interruptAudio?: () => void) {
  if (!next) mutedActions.clear();
  narrator = next; interrupt = next ? interruptAudio ?? null : null; listeners.forEach(listener => listener());
  if (next && requested && waitingSpeech.size) {
    const pending = [...waitingSpeech.values()]; waitingSpeech.clear();
    for (const item of pending) void next(item.text, item.options).catch(() => {});
  }
}
export function interruptConversation() { if (!interrupt) return false; interrupt(); return true; }
export function subscribeConversation(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function relayConversationSpeech(text: string, options?: ConversationSpeech) {
  if (tutorCallActive) return true;
  if (requested && !options?.priority) return true;
  if (!narrator) {
    if (!requested) return false;
    if (options?.priority) waitingSpeech.set(options.priority, { text, options });
    return true;
  }
  if (!mutedActions.size || options?.priority === 'stream') {
    if (options) await narrator(text, options); else await narrator(text);
  }
  return true;
}
export async function withoutToolNarration<T>(action: () => Promise<T>): Promise<T> {
  const owner = Symbol(); mutedActions.add(owner);
  try { return await action(); } finally { mutedActions.delete(owner); }
}
