import { isVoiceCommandAllowed, parseVoiceCommand } from './VoiceCommands';
import { validateAppAction } from './AppControl';

export type ConversationPlan = { type: 'native'; name: 'get_app_context' | 'get_current_location' | 'execute_anny_command' | 'run_app_action'; arguments: { text?: string; action?: string; command?: string; parameters?: Record<string, unknown> } };
export function validateConversationPlan(input: unknown, roles: string[]): ConversationPlan {
  if (!input || typeof input !== 'object') throw new Error('Acción no válida.');
  const plan = input as ConversationPlan;
  if (plan.type !== 'native' || !plan.arguments || typeof plan.arguments !== 'object') throw new Error('Acción no válida.');
  if (plan.name === 'get_app_context' || plan.name === 'get_current_location') return { type: 'native', name: plan.name, arguments: {} };
  if (plan.name === 'run_app_action') { validateAppAction(plan.arguments.action, plan.arguments.parameters, roles); return plan; }
  if (plan.name !== 'execute_anny_command' || typeof plan.arguments.text !== 'string' || plan.arguments.text.length > 350) throw new Error('Comando no válido.');
  const parsed = parseVoiceCommand(plan.arguments.text);
  if (!parsed || parsed.command.name !== plan.arguments.command || parsed.command.action !== plan.arguments.action || !isVoiceCommandAllowed(parsed.command, roles)) throw new Error('Esta acción no está permitida para tu cuenta.');
  if (parsed.command.scope || ['cancel_trip', 'pause_guidance', 'resume_guidance', 'stop_detection', 'conversation'].includes(parsed.command.action)) throw new Error('Esta acción requiere otra pantalla activa.');
  return plan;
}
export const conversationNeedsConfirmation = (action?: string) => ['help', 'exit', 'wifi', 'hotspot'].includes(action ?? '');
