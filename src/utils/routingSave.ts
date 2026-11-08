import { readRoutingOptions } from './routing.ts';
import type { RoutingOptions, buildEnableRequest, buildDisableRequest } from './routing.ts';

type SaveRequest = ReturnType<typeof buildEnableRequest> | ReturnType<typeof buildDisableRequest>;
type Response = { data: unknown };
interface Transport {
  save: (payload: SaveRequest) => Promise<Response>;
  get: (userServiceId: number, signal?: AbortSignal) => Promise<Response>;
}
export type RoutingSaveResult = { confirmed: true; options: RoutingOptions }
  | { confirmed: false; options: RoutingOptions | null };

// A lost response says nothing about whether the server committed the write.
// Re-read redacted state once; never resend credentials or claim the draft saved.
export async function saveRoutingOptions(
  payload: SaveRequest,
  transport: Transport,
  signal: AbortSignal,
  onUnconfirmed: () => void,
): Promise<RoutingSaveResult> {
  signal.throwIfAborted();
  try {
    const response = await transport.save(payload);
    signal.throwIfAborted();
    const options = readRoutingOptions(response.data);
    if (!options.supported) throw new Error('Unexpected service options response');
    return { confirmed: true, options };
  } catch (error) {
    signal.throwIfAborted();
    if (error && typeof error === 'object' && 'response' in error && error.response) throw error;
    onUnconfirmed();
    try {
      const response = await transport.get(payload.user_service_id, signal);
      signal.throwIfAborted();
      const options = readRoutingOptions(response.data);
      return { confirmed: false, options: options.supported ? options : null };
    } catch {
      signal.throwIfAborted();
      return { confirmed: false, options: null };
    }
  }
}
