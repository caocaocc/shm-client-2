// A whitelist is a set: formatting, duplicates and order alone do not change it.
export function routingDraftChanged(outbound: string, rules: string[], savedRules: string[], savedOutbound = ''): boolean {
  if (outbound.trim() && outbound !== savedOutbound) return true;
  const previous = new Set(savedRules), current = new Set(rules);
  return previous.size !== current.size || [...current].some(rule => !previous.has(rule));
}

export type RoutingAction = 'save' | 'enable' | 'disable';

export function routingStatusLabel({ state, busy, dirty, saveFailed, saveUnconfirmed, pollPaused }: {
  state: string; busy: RoutingAction | null; dirty: boolean;
  saveFailed: boolean; saveUnconfirmed?: boolean; pollPaused: boolean;
}): string {
  if (busy) return { save: 'saving', enable: 'enabling', disable: 'disabling' }[busy];
  if (saveFailed) return 'saveError';
  if (saveUnconfirmed) return 'saveUnconfirmed';
  if (dirty) return 'unsaved';
  if (state === 'error') return 'states.error';
  if (pollPaused) return 'pollPaused';
  return `states.${['idle', 'disabled', 'cleaned', 'queued', 'waiting_service', 'submitted'].includes(state) ? state : 'unknown'}`;
}

const ACTION_BUTTONS = {
  save: { action: 'save', color: 'blue', labelKey: 'save' },
  enable: { action: 'enable', color: 'green', labelKey: 'enable' },
  disable: { action: 'disable', color: 'orange', labelKey: 'disable' },
} as const;

export function routingButtonAction(enabled: boolean, dirty: boolean, valid: boolean, hasSecret = false, busy: RoutingAction | null = null) {
  // A malformed draft must never prevent disabling the saved configuration.
  const action = busy || (enabled && (!dirty || !valid) ? 'disable' : !enabled && !dirty && hasSecret ? 'enable' : 'save');
  return ACTION_BUTTONS[action];
}

// At most thirty reads, with slower polling while a job remains queued.
export function queuedPollDelay(attempt: number): number | null {
  if (attempt >= 30) return null;
  return attempt < 10 ? 3000 : attempt < 20 ? 6000 : 12000;
}

export function routingDisplayState(enabled: boolean, hasSecret: boolean, ruleCount: number, state: string): string {
  return !enabled && !hasSecret && ruleCount === 0 && state === 'disabled' ? 'idle' : state;
}

// Only fixed protocol codes may reach the error banner. Never render an
// arbitrary exception, provider response or credential-shaped error value.
const SYNC_ERROR_CODES = new Set([
  'INVALID_OUTBOUND', 'INVALID_RULES', 'INVALID_CONFIG', 'INVALID_PANEL_CONFIG',
  'INVALID_ROUTING_CONFIG', 'INVALID_SERVICE', 'ENDPOINT_DENIED', 'ENDPOINT_DNS',
  'SNIPPETS_NOT_READY', 'USER_MAPPING',
  'REMOTE_IO', 'REMOTE_HTTP', 'REMOTE_RESPONSE', 'STATE_UNSAFE',
  'PENDING_CORRUPT', 'PENDING_BASELINE_MISSING', 'PENDING_SOURCE_UNAVAILABLE', 'PENDING_LIMIT',
  'SERVICE_OPTIONS_KEY_MISSING', 'SERVICE_OPTIONS_BUSY', 'SERVICE_OPTIONS_CONFIG_INVALID',
  'SERVICE_OPTIONS_TASK_INVALID', 'SERVICE_OPTIONS_TARGET_INVALID', 'SERVICE_OPTIONS_TARGET_CHANGED',
  'SERVICE_OPTIONS_TIMEOUT', 'SERVICE_OPTIONS_SYNC_FAILED', 'INTERNAL_ERROR',
]);
export function routingSyncErrorCode(value: unknown): string {
  return typeof value === 'string' && SYNC_ERROR_CODES.has(value) ? value : 'SERVICE_OPTIONS_SYNC_FAILED';
}
