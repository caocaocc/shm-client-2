import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Group, Loader, Stack, Text, Textarea } from '@mantine/core';
import { isAxiosError } from 'axios';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useDisplay } from '../hooks/useDisplay';
import { routingAction, routingSettings, type RoutingSettings } from '../utils/routing';

const path = '/user/service/routing';
const errorLabels: Record<string, string> = {
  INVALID_OUTBOUND: 'badOutbound', INVALID_RULES: 'badRules', ENDPOINT_DENIED: 'denied',
  SERVICE_UNAVAILABLE: 'unavailable', TARGET_CHANGED: 'targetChanged', TARGET_UNAVAILABLE: 'unavailable',
};
const labelFor = (code: unknown) => typeof code === 'string' && Object.prototype.hasOwnProperty.call(errorLabels, code) ? errorLabels[code] : 'panel';
type Draft = { outbound: string; rules: string };

export function ServiceRouting({ id, active }: { id: number; active: boolean }) {
  const { t } = useTranslation();
  const { timestamp } = useDisplay();
  const [record, setRecord] = useState<RoutingSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const [reading, setReading] = useState(false);
  const [writing, setWriting] = useState(false);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    if (writeRequest.current) return;
    readRequest.current?.abort();
    const request = new AbortController();
    readRequest.current = request;
    setReading(true);
    try {
      const result = await api.get(path, { params: { user_service_id: id }, timeout: 10000, signal: request.signal });
      if (!request.signal.aborted) setRecord(routingSettings(result.data));
    } catch (error) {
      if (!request.signal.aborted) {
        const code = isAxiosError(error) ? error.response?.data?.error : undefined;
        setNotice(previous => previous || (code ? labelFor(code) : 'retry'));
      }
    } finally {
      if (!request.signal.aborted) setReading(false);
    }
  }, [id]);

  useEffect(() => {
    if (active) void read();
    return () => readRequest.current?.abort();
  }, [active, read]);
  useEffect(() => () => { writeRequest.current?.abort(); }, []);

  useEffect(() => {
    if (!active || !record || writing || reading || notice === 'retry') return;
    if (!['queued', 'pending_disable', 'waiting'].includes(record.status)) return;
    const due = record.publish_at ? record.publish_at * 1000 - Date.now() + 500 : 5000;
    const timer = window.setTimeout(read, Math.max(2000, Math.min(due, 60000)));
    return () => window.clearTimeout(timer);
  }, [record, read, active, writing, reading, notice]);

  const fields = draft || { outbound: record?.outbound_text ?? '', rules: record?.rules.join('\n') ?? '' };
  const action = record ? routingAction(record, fields.outbound, fields.rules) : 'save';
  const submit = async () => {
    if (!record || writeRequest.current) return;
    readRequest.current?.abort();
    setReading(false);
    setWriting(true);
    setNotice('');
    const request = new AbortController();
    writeRequest.current = request;
    try {
      const payload = action === 'save'
        ? { outbound_text: fields.outbound, rules: fields.rules.split(/\r?\n/).map(line => line.trim()).filter(Boolean) } : {};
      const response = await api.post(path, { action, user_service_id: id, ...payload }, { signal: request.signal, timeout: 10000 });
      if (!request.signal.aborted) {
        setRecord(routingSettings(response.data));
        setDraft(null);
      }
    } catch (error) {
      if (!request.signal.aborted) {
        const code = isAxiosError(error) ? error.response?.data?.error : undefined;
        setDraft(fields);
        setNotice(code ? labelFor(code) : 'unconfirmed');
        writeRequest.current = null;
        if (!code || code === 'TARGET_CHANGED') void read();
      }
    } finally {
      if (!request.signal.aborted) { writeRequest.current = null; setWriting(false); }
    }
  };

  return <Stack gap="sm">
    {record && <>
      <Textarea label={t('routing.outbound')} dir="ltr" maxLength={65536} spellCheck={false} autoComplete="off" rows={4} resize="none" disabled={writing}
        placeholder={t('routing.example')} value={fields.outbound}
        onChange={e => setDraft({ ...fields, outbound: e.currentTarget.value })} />
      <Textarea label={t('routing.rules')} dir="ltr" maxLength={65536} spellCheck={false} autoComplete="off" rows={4} resize="none" disabled={writing}
        description={t('routing.help')} inputWrapperOrder={['label','input','description','error']} value={fields.rules}
        onChange={e => setDraft({ ...fields, rules: e.currentTarget.value })} />
      <Text size="sm" role="status">{t('routing.' + (record.status === 'queued' && !record.enabled ? 'pending_disable' : record.status))}
        {record.publish_at ? ' · ' + t('routing.estimated') + ' ' + timestamp(record.publish_at) : ''}
      </Text>
      {record.error && <Text size="sm" c="orange" role="alert">{t('routing.' + labelFor(record.error))}</Text>}
    </>}
    {!record && reading && <Loader size="sm" />}
    {notice && <Text size="sm" c="orange" role="alert">{t(!record && notice === 'retry' ? 'services.routingLoadError' : 'routing.' + notice)}</Text>}
    <Group justify="flex-end">
      <Button variant="subtle" loading={reading} disabled={writing} onClick={() => { setNotice(''); void read(); }}>{t('common.refresh')}</Button>
      {record && <Button loading={writing} disabled={reading || (action === 'save' && (!fields.outbound.trim() || !fields.rules.trim()))}
        color={{ save: 'blue', enable: 'green', disable: 'orange' }[action]} onClick={submit}>
        {t(action === 'save' ? 'common.save' : 'routing.' + action)}
      </Button>}
    </Group>
  </Stack>;
}
