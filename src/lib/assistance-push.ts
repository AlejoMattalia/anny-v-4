import type { AuthUser } from './auth';
export function subscribeAssistancePush(_listener: (data: unknown) => void): () => void { return () => {}; }
export async function identifyAssistanceUser(_user: AuthUser | null): Promise<void> {}
export async function requestAssistancePushPermission(): Promise<boolean> { return false; }
