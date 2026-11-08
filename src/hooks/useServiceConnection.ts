import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { config } from '../config';
import { loadProxySubscription } from '../utils/subscription';
import type { ProxySubscription } from '../utils/subscription';

interface ConnectionState {
  key: string;
  loading: boolean;
  failed: boolean;
  subscription: ProxySubscription | null;
  vpnConfig: string | null;
}

export function useServiceConnection(userServiceId: number, category: string, status: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${userServiceId}:${category}:${status}:${attempt}`;
  const empty: ConnectionState = { key, loading: category === 'proxy' || category === 'vpn', failed: false, subscription: null, vpnConfig: null };
  const [state, setState] = useState<ConnectionState>(empty);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setState({ key, loading: category === 'proxy' || category === 'vpn', failed: false, subscription: null, vpnConfig: null });
    const load = async () => {
      try {
        if (category === 'proxy') {
          const subscription = await loadProxySubscription(userServiceId, config.PROXY_STORAGE_PREFIX,
            async (name, requestSignal) => (await api.get(`/storage/manage/${encodeURIComponent(name)}`, {
              params: { format: 'json' }, signal: requestSignal, timeout: 10_000,
            })).data, signal);
          if (!signal.aborted) setState({ key, loading: false, failed: false, subscription, vpnConfig: null });
        } else if (category === 'vpn') {
          const name = `${config.VPN_STORAGE_PREFIX || 'vpn'}${userServiceId}`;
          const response = await api.get(`/storage/manage/${encodeURIComponent(name)}`, { signal, responseType: 'text', timeout: 10_000 });
          if (!signal.aborted) setState({ key, loading: false, failed: false, subscription: null, vpnConfig: response.data || null });
        }
      } catch {
        if (!signal.aborted) setState({ key, loading: false, failed: true, subscription: null, vpnConfig: null });
      }
    };
    void load();
    return () => controller.abort();
  }, [key, userServiceId, category]);

  // React runs effects after rendering. Never render the previous service's
  // URL/config even for that first frame when the selected service changes.
  return { ...(state.key === key ? state : empty), reload: () => setAttempt(value => value + 1) };
}
