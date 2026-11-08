import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Group, Loader, Stack, Text, Textarea, Tooltip, VisuallyHidden } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { serviceOptionsApi } from '../api/client';
import { useRoutingOutbound } from '../hooks/useRoutingOutbound';
import { buildDisableRequest, buildEnableRequest, draftAfterSave, normalizeRules, parseOutbound, RoutingInputError } from '../utils/routing';
import type { RoutingOptions } from '../utils/routing';
import { saveRoutingOptions } from '../utils/routingSave';
import { routingDraftChanged, routingDisplayState, routingStatusLabel, routingButtonAction, routingSyncErrorCode, type RoutingAction } from '../utils/routingUi';

interface Props {
  userServiceId: number; serviceStatus: string; options: RoutingOptions; onSaved: (value: RoutingOptions) => void;
  pollPaused: boolean;
}
export default function ServiceRoutingPanel({ userServiceId, serviceStatus, options, onSaved, pollPaused }: Props) {
  const { t } = useTranslation();
  const statusId = useId();
  const outboundDraft = useRoutingOutbound(userServiceId, options.has_secret);
  const outboundText = outboundDraft.text;
  const [rulesText, setRulesText] = useState(options.data.rules.join('\n'));
  const [busy, setBusy] = useState<RoutingAction | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saveUnconfirmed, setSaveUnconfirmed] = useState(false);
  const saveRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; saveRequest.current?.abort(); }; }, []);
  const outbound = useMemo(() => {
    try { return { parsed: parseOutbound(outboundText), error: null }; }
    catch (error) { return { parsed: null, error: error instanceof RoutingInputError ? error : new RoutingInputError('invalidOutbound') }; }
  }, [outboundText]);
  const rules = useMemo(() => {
    try { return { parsed: normalizeRules(rulesText), error: null }; }
    catch (error) { return { parsed: [], error: error instanceof RoutingInputError ? error : new RoutingInputError('invalidRule') }; }
  }, [rulesText]);
  const savedRules = useMemo(() => {
    try { return normalizeRules(options.data.rules.join('\n')); } catch { return []; }
  }, [options.data.rules]);
  const issueText = (error: RoutingInputError) => error.line
    ? t('routing.lineError', { line: error.line, message: t(`routing.errors.${error.code}`) })
    : t(`routing.errors.${error.code}`);
  const state = routingDisplayState(options.enabled, options.has_secret, options.data.rules.length, options.status);
  const syncErrorCode = routingSyncErrorCode(options.error);
  const dirty = routingDraftChanged(outboundText, rules.parsed, savedRules, outboundDraft.saved);
  const feedbackLabel = t(`routing.${routingStatusLabel({ state, busy, dirty, saveFailed, saveUnconfirmed, pollPaused })}`);
  const valid = !outbound.error && (Boolean(outbound.parsed) || options.has_secret) && !rules.error;
  const button = routingButtonAction(options.enabled, dirty, valid, options.has_secret, busy);
  const canAct = !busy && (button.action === 'disable' || (!outboundDraft.loading && valid));
  const persist = async (action: RoutingAction) => {
    if (!canAct) return;
    const disable = action === 'disable';
    const controller = new AbortController();
    saveRequest.current?.abort(); saveRequest.current = controller;
    const isCurrent = () => mounted.current && saveRequest.current === controller && !controller.signal.aborted;
    setBusy(action); setSaveFailed(false); setSaveUnconfirmed(false);
    try {
      // Disabling never parses or submits an unfinished/invalid draft.
      const payload = disable ? buildDisableRequest(userServiceId) : buildEnableRequest(userServiceId, outboundText, rulesText, options.has_secret, options.data.outbound, outboundDraft.saved);
      const result = await saveRoutingOptions(payload, serviceOptionsApi, controller.signal, () => {
        if (isCurrent()) { setSaveUnconfirmed(true); setBusy(null); }
      });
      if (!isCurrent()) return;
      if (result.options) onSaved(result.options);
      if (result.confirmed) {
        if (!disable) outboundDraft.markSaved();
        const draft = draftAfterSave({ outbound: outboundText, rules: rulesText }, result.options, disable);
        setRulesText(draft.rules);
      }
    } catch {
      if (isCurrent()) setSaveFailed(true);
    } finally { if (isCurrent()) setBusy(null); }
  };

  if (outboundDraft.loading) return <Group justify="center" py="md" role="status">
    <Loader size="sm" /><Text size="sm">{t('common.loading')}</Text>
  </Group>;

  return <Stack gap="md">
    {saveUnconfirmed && <Alert color="orange" icon={<IconAlertCircle size={16} />}>{t('routing.saveUnconfirmed')}</Alert>}
    {serviceStatus !== 'ACTIVE' && <Alert color="orange" icon={<IconAlertCircle size={16} />}>{t('routing.serviceWaiting')}</Alert>}
    {state === 'error' && <Alert color="red" icon={<IconAlertCircle size={16} />} title={t('routing.applyError')}>
      {t(`routing.syncErrors.${syncErrorCode}`)}
      <Text size="xs" mt={4}>{t('routing.errorCode', { code: syncErrorCode })}</Text>
    </Alert>}
    <Textarea
      label={t('routing.outboundLabel')}
      placeholder={t('routing.outboundPlaceholder')}
      value={outboundText} onChange={event => { outboundDraft.change(event.currentTarget.value); setSaveFailed(false); }}
      maxLength={16384} spellCheck={false} autoComplete="off" autoCapitalize="off"
      disabled={Boolean(busy)} error={outbound.error ? issueText(outbound.error) : undefined}
      styles={{ input: { fontFamily: 'monospace', fontSize: 16, height: 160, minHeight: 160, maxHeight: 160, resize: 'none', overflowY: 'auto' } }}
    />
    {outboundDraft.failed && <Group gap="xs">
      <Text size="xs" c="red" role="alert">{t('routing.loadOutboundError')}</Text>
      <Button size="compact-xs" variant="subtle" disabled={Boolean(busy)} onClick={outboundDraft.retry}>{t('routing.retryLoadOutbound')}</Button>
    </Group>}
    {outbound.parsed?.warnings.includes('platformDNS') && <Text size="xs" c="dimmed">{t('routing.platformDNS')}</Text>}
    <Textarea
      label={t('routing.rulesLabel')} placeholder={t('routing.rulesPlaceholder')}
      value={rulesText} onChange={event => { setRulesText(event.currentTarget.value); setSaveFailed(false); }}
      minRows={6} maxRows={14} autosize maxLength={60000} spellCheck={false} autoComplete="off" autoCapitalize="off"
      disabled={Boolean(busy)} error={rulesText.trim() && rules.error ? issueText(rules.error) : undefined}
      styles={{ input: { fontFamily: 'monospace', fontSize: 16 } }}
    />
    <Text size="xs" c="dimmed">{t('routing.direction')}</Text>
    <Box>
      <Tooltip label={feedbackLabel} events={{ hover: true, focus: true, touch: true }}>
        <Box component="span" style={{ display: 'block' }}>
          <Button variant="light" fullWidth color={button.color} disabled={!canAct} loading={Boolean(busy)} aria-describedby={statusId} onClick={() => void persist(button.action)}>{t(`routing.${button.labelKey}`)}</Button>
        </Box>
      </Tooltip>
      <VisuallyHidden id={statusId} role="status" aria-live="polite">{feedbackLabel}</VisuallyHidden>
    </Box>
  </Stack>;
}
