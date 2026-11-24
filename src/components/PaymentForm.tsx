import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Loader, NumberInput, Select, Stack, Text } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useTranslation } from 'react-i18next';
import { userApi } from '../api/client';
import { useDisplay } from '../hooks/useDisplay';
import { paymentAmount } from '../utils/format';
import { chargeUrl, paymentChannels, type PaymentChannel } from '../utils/payments';
import ConfirmModal from './ConfirmModal';

interface Props {
  initialAmount: number;
  minimum?: number;
  manageSaved?: boolean;
  rememberedChannel?: { current: string | null };
  label?: string;
  beforeCharge?: () => Promise<void>;
  onComplete: (internal: boolean) => void;
  onCancel?: () => void;
}

export default function PaymentForm({ initialAmount, minimum = 0.01, manageSaved, rememberedChannel, label, beforeCharge, onComplete, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const { amountProps, money } = useDisplay();
  const [amount, setAmount] = useState<number | string>(initialAmount);
  const [list, setList] = useState<PaymentChannel[] | null>(null);
  const [selection, setSelection] = useState<string | null>(rememberedChannel?.current ?? null);
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState<PaymentChannel | null>(null);
  const lock = useRef(false);
  const prepared = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setList(null);
    setFailed(false);
    userApi.getPaySystems(controller.signal).then(({ data }) => {
      if (controller.signal.aborted) return;
      const options = paymentChannels(Array.isArray(data.data) ? data.data : []);
      setList(options);
      setSelection(previous => options.some(channel => channel.id === previous) ? previous : options[0]?.id ?? null);
    }).catch(() => {
      if (!controller.signal.aborted) { setList([]); setFailed(true); }
    });
    return () => controller.abort();
  }, [revision]);

  const selected = list?.find(channel => channel.id === selection);
  const submitted = paymentAmount(amount, minimum);
  const toast = (message: string) => notifications.show({ title: t('common.error'), message, color: 'red' });
  const remove = async () => {
    if (!deleting || lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      await userApi.deleteAutopayment(deleting.profile);
      setDeleting(null);
      setRevision(n => n + 1);
      notifications.show({ message: t('payments.autopaymentDeleted'), color: 'green' });
    } catch { toast(t('payments.autopaymentDeleteError')); }
    finally { setPending(false); lock.current = false; }
  };
  const pay = async () => {
    if (!selected || lock.current) return;
    if (!submitted) { toast(t('payments.invalidAmount')); return; }
    lock.current = true;
    setPending(true);
    const internal = !!(selected.internal || selected.recurring || selected.payment_mode === 'internal');
    let popup: Window | null = null;
    let step = 'payments.paymentError';
    try {
      const url = chargeUrl(selected, submitted, window.location.href);
      if (!internal && !beforeCharge) {
        window.open(url, '_blank', 'noopener,noreferrer');
        onComplete(false);
        return;
      }
      if (!internal) {
        popup = window.open('about:blank', '_blank');
        if (!popup) throw new Error();
        popup.opener = null;
      }
      if (beforeCharge && !prepared.current) {
        step = 'order.orderError';
        await beforeCharge();
        prepared.current = true;
      }
      step = 'payments.paymentError';
      if (internal) {
        const response = await fetch(url, { credentials: 'include' });
        if (![200, 204].includes(response.status)) {
          const detail = await response.json().catch(() => null);
          const lang = i18n.language.split('-')[0];
          const message = detail?.['msg_' + lang] || detail?.msg;
          toast(typeof message === 'string' && message.trim() ? message : t(step));
          return;
        }
        notifications.show({ message: t('payments.paymentSuccess'), color: 'green' });
      } else {
        popup!.location.href = url;
      }
      onComplete(internal);
    } catch {
      popup?.close();
      toast(t(step));
    } finally { lock.current = false; setPending(false); }
  };

  if (!list) return <Group justify="center" role="status"><Loader size="sm" />{t('payments.loadingPaymentSystems')}</Group>;
  if (!list.length) return <Stack gap="xs">
    <Text c="dimmed">{t(failed ? 'payments.paymentSystemsError' : 'payments.noPaymentSystems')}</Text>
    <Button variant="subtle" onClick={() => setRevision(n => n + 1)}>{t('common.refresh')}</Button>
  </Stack>;
  return <Stack>
    {manageSaved && list.some(channel => channel.allow_deletion) && <Stack gap="xs">
      <Text fw={500}>{t('payments.savedPaymentMethods')}</Text>
      {list.filter(channel => channel.allow_deletion).map(channel => <Group justify="space-between" key={channel.id}>
        <Group gap="xs"><Text size="sm">{channel.name}</Text><Badge size="xs">{t('payments.autopayment')}</Badge></Group>
        <ActionIcon color="red" variant="subtle" disabled={pending} aria-label={t('payments.deletePaymentMethod')}
          onClick={() => setDeleting(channel)}><IconX size={14}/></ActionIcon>
      </Group>)}
    </Stack>}
    <Select label={t('payments.paymentSystem')} data={list.map(channel => ({ value: channel.id, label: channel.name }))}
      value={selection} onChange={value => {
        setSelection(value);
        if (rememberedChannel) rememberedChannel.current = value;
      }} allowDeselect={false} disabled={pending} />
    <NumberInput label={t('payments.amount')} value={amount} onChange={setAmount} min={minimum}
      step={0.01} decimalScale={2} disabled={pending} {...amountProps}
      description={minimum > 0.01 ? t('order.minimum') + ' ' + money(minimum) : undefined} />
    <Group justify="flex-end">
      {onCancel && <Button variant="light" disabled={pending} onClick={onCancel}>{t('common.cancel')}</Button>}
      <Button onClick={pay} loading={pending} disabled={!selected}>
        {t(prepared.current ? 'payments.pay' : label || 'payments.pay', { amount: money(amount) })}
      </Button>
    </Group>
    {manageSaved && <ConfirmModal opened={!!deleting} onClose={() => setDeleting(null)} onConfirm={remove} loading={pending}
      title={t('payments.deletePaymentMethod')} message={t('payments.deletePaymentMethodConfirm', { name: deleting?.name })}
      confirmColor="red" confirmLabel={t('common.delete')} />}
  </Stack>;
}
