import { useEffect, useRef, useState } from 'react';
import { serviceOptionsApi } from '../api/client';
import { readRoutingOptions } from '../utils/routing';
import type { RoutingOptions } from '../utils/routing';
import { queuedPollDelay } from '../utils/routingUi';

export function useServiceRouting(userServiceId: number) {
  const [attempt, setAttempt] = useState(0);
  const revision = useRef(0);
  const [pollEpoch, setPollEpoch] = useState(0);
  const [pollPaused, setPollPaused] = useState(false);
  const [state, setState] = useState<{ id: number; options: RoutingOptions | null; failed: boolean }>({ id: userServiceId, options: null, failed: false });
  const current = state.id === userServiceId ? state : { id: userServiceId, options: null, failed: false };
  useEffect(() => {
    const controller = new AbortController();
    const version = ++revision.current;
    setPollPaused(false);
    setState({ id: userServiceId, options: null, failed: false });
    serviceOptionsApi.get(userServiceId, controller.signal).then(response => {
      if (!controller.signal.aborted && version === revision.current) setState({ id: userServiceId, options: readRoutingOptions(response.data), failed: false });
    }).catch(() => {
      if (!controller.signal.aborted && version === revision.current) setState({ id: userServiceId, options: null, failed: true });
    });
    return () => { controller.abort(); };
  }, [userServiceId, attempt]);
  useEffect(() => {
    if (current.options?.status !== 'queued') { setPollPaused(false); return; }
    const controller = new AbortController();
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      if (controller.signal.aborted) return;
      const delay = queuedPollDelay(attempts);
      if (delay === null) { setPollPaused(true); return; }
      timer = setTimeout(() => {
        attempts += 1;
        const version = revision.current;
        serviceOptionsApi.get(userServiceId, controller.signal).then(response => {
          if (!controller.signal.aborted && version === revision.current) setState({ id: userServiceId, options: readRoutingOptions(response.data), failed: false });
        }).catch(() => { /* Keep the last known status if a background read fails. */ })
          .finally(schedule);
      }, delay);
    };
    schedule();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [userServiceId, current.options?.status, pollEpoch]);
  return {
    ...current,
    loading: !current.options && !current.failed,
    pollPaused,
    reload: () => setAttempt(value => value + 1),
    update: (options: RoutingOptions) => {
      revision.current += 1;
      setPollPaused(false); setPollEpoch(value => value + 1);
      setState({ id: userServiceId, options, failed: false });
    },
  };
}
