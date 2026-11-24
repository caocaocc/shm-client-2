import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { config } from '../config';
import { loadProxySubscription, type Subscription } from '../utils/subscription';

interface ConnectionRead {
  key: string;
  subscription: Subscription | null;
  vpnConfig: string | null;
  failed: boolean;
}

export function useServiceConnection(id: number, category: string, status: string) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ConnectionRead | null>(null);
  const active = status === 'ACTIVE' && (category === 'proxy' || category === 'vpn');
  const key = [id, category, status, revision].join('/');
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const options = { signal: controller.signal, timeout: 10000 };
    const load = async () => {
      const next: ConnectionRead = { key, subscription: null, vpnConfig: null, failed: false };
      try {
        if (category === 'proxy') {
          next.subscription = await loadProxySubscription(id, config.PROXY_STORAGE_PREFIX, async storage => {
            const response = await api.get('/storage/manage/' + encodeURIComponent(storage), { ...options, params: { format: 'json' } });
            return response.data;
          }, controller.signal);
        } else {
          const storage = (config.VPN_STORAGE_PREFIX?.trim() || 'vpn') + id;
          const response = await api.get('/storage/manage/' + encodeURIComponent(storage), { ...options, responseType: 'text' });
          if (typeof response.data === 'string' && response.data.trim()) next.vpnConfig = response.data;
        }
      } catch (error) { next.failed = (error as { response?: { status?: number } }).response?.status !== 404; }
      if (!controller.signal.aborted) setResult(next);
    };
    void load();
    return () => controller.abort();
  }, [active, key, id, category]);
  const ready = active && result?.key === key ? result : null;
  return {
    subscription: ready?.subscription ?? null, vpnConfig: ready?.vpnConfig ?? null, failed: ready?.failed ?? false,
    loading: active && !ready, reload: () => setRevision(value => value + 1),
  };
}
