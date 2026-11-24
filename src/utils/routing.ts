const states = ['unconfigured', 'queued', 'submitted', 'disabled', 'pending_disable', 'waiting', 'error'] as const;
export interface RoutingSettings {
  outbound_text: string;
  rules: string[];
  enabled: boolean;
  status: typeof states[number];
  error?: string;
  publish_at?: number;
}

export function routingSettings(payload: unknown): RoutingSettings {
  const rows = (payload as { data?: unknown } | null)?.data;
  const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (!row || typeof row.enabled !== 'boolean' || typeof row.outbound_text !== 'string'
    || !Array.isArray(row.rules) || !row.rules.every((line: unknown) => typeof line === 'string')
    || !states.includes(row.status)) throw new Error('Invalid routing response');
  return row;
}

export function routingAction(record: RoutingSettings, outbound: string, rules: string) {
  if (!record.outbound_text || record.error === 'TARGET_CHANGED' ||
      record.outbound_text !== outbound || record.rules.join('\n') !== rules) return 'save';
  return record.enabled ? 'disable' : 'enable';
}
