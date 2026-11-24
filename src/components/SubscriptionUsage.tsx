import { Group, Paper, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useDisplay } from '../hooks/useDisplay';
import { formatBytes, remainingTraffic, type Subscription } from '../utils/subscription';

export function SubscriptionUsage({ data }: { data: Subscription }) {
  const { t, i18n } = useTranslation();
  const { timestamp } = useDisplay();
  const bytes = (value: number | undefined) => formatBytes(value, i18n.language);
  const unlimited = data.limitBytes === 0;
  const fields = [
    ['status', data.status && t('subscription.statusLabels.' + data.status, data.status)],
    ['trafficUsed', bytes(data.usedBytes)],
    ['trafficLimit', unlimited ? t('subscription.unlimited') : bytes(data.limitBytes)],
    ['trafficRemaining', unlimited ? t('subscription.unlimited') : bytes(remainingTraffic(data))],
    ['resetCycle', data.resetStrategy && t('subscription.strategies.' + data.resetStrategy, data.resetStrategy)],
    ['expiresAt', data.expiresAt && timestamp(data.expiresAt)],
    ['deviceLimit', data.deviceLimit === null ? t('subscription.panelDefault') : data.deviceLimit === 0
      ? t('subscription.unlimited') : data.deviceLimit !== undefined ? t('subscription.devices', { count: data.deviceLimit }) : undefined],
  ];
  return <Paper withBorder p="md"><Stack gap="xs">
    <Text fw={600}>{t('subscription.title')}</Text>
    {fields.map(([label, value]) => <Group key={label} justify="space-between">
      <Text size="sm" c="dimmed">{t('subscription.' + label)}</Text><Text size="sm">{value || '—'}</Text>
    </Group>)}
    <Text size="xs" c="dimmed">{t('subscription.snapshotHint')}</Text>
  </Stack></Paper>;
}
