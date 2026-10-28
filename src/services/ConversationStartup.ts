export class ConversationStartupTimeout extends Error {}

// Native modules and storage can leave promises pending without rejecting.
// Abort the wait independently of the module's own cancellation support.
export function conversationDeadline<T>(work: Promise<T>, milliseconds: number, message: string, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown, value?: T) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value as T);
    };
    const abort = () => finish(new Error('Conversación cancelada.'));
    const timer = setTimeout(() => finish(new ConversationStartupTimeout(message)), milliseconds);
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    Promise.resolve(work).then(value => finish(undefined, value), error => finish(error));
  });
}

export async function releasePreviousVoice(stop: () => Promise<unknown>, signal: AbortSignal) {
  try { await conversationDeadline(stop(), 2000, 'La voz anterior no respondió.', signal); }
  catch (error) {
    if (signal.aborted) throw error;
    // Stopping old TTS is best effort; it must not prevent the voice call starting.
  }
}
