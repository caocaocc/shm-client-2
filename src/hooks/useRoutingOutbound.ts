import { useEffect, useRef, useState } from 'react';
import { serviceOptionsApi } from '../api/client';
import { readSavedRoutingOutbound } from '../utils/routing';

// Complete credentials live only in the currently mounted service form.
// Status polling continues to use the ordinary redacted endpoint.
// Preload on mount, like connection details; switching tabs does not restart it.
export function useRoutingOutbound(userServiceId: number, hasSecret: boolean) {
  const [draft, setDraft] = useState({ text: '', saved: '' });
  const [loading, setLoading] = useState(hasSecret);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const settled = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!hasSecret || settled.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setFailed(false);
    serviceOptionsApi.readSecret(userServiceId, controller.signal).then(response => {
      if (controller.signal.aborted || settled.current) return;
      const text = readSavedRoutingOutbound(response.data);
      settled.current = true;
      setDraft({ text, saved: text });
    }).catch(() => {
      if (!controller.signal.aborted && !settled.current) setFailed(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => { controller.abort(); setLoading(false); };
  }, [userServiceId, hasSecret, attempt]);

  const change = (text: string) => {
    // Even an intentional empty edit takes precedence over an in-flight read.
    settled.current = true; request.current?.abort();
    setLoading(false); setFailed(false);
    setDraft(previous => ({ ...previous, text }));
  };
  const markSaved = () => {
    settled.current = true; request.current?.abort();
    setLoading(false); setFailed(false);
    setDraft(previous => ({ ...previous, saved: previous.text }));
  };
  return { ...draft, loading, failed, change, markSaved,
    retry: () => setAttempt(value => value + 1),
  };
}
