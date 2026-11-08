import { Badge, Group, Stack, Text } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '../utils/display';
import { formatBytes, remainingTraffic } from '../utils/subscription';
import type { ProxySubscription } from '../utils/subscription';

export default function SubscriptionSummary({ subscription }: { subscription: ProxySubscription | null }) {
  const { t, i18n } = useTranslation();
  if (!subscription || !Object.entries(subscription).some(([key, value]) => key !== 'url' && value !== undefined)) return null;
  const remaining = remainingTraffic(subscription);
  const rows = [
    subscription.usedBytes !== undefined && [t('subscription.trafficUsed'), formatBytes(subscription.usedBytes, i18n.language)],
    subscription.limitBytes !== undefined && [t('subscription.trafficLimit'), subscription.limitBytes === 0 ? t('subscription.unlimited') : formatBytes(subscription.limitBytes, i18n.language)],
    remaining !== undefined && [t('subscription.trafficRemaining'), formatBytes(remaining, i18n.language)],
    subscription.resetStrategy && [t('subscription.resetCycle'), t(`subscription.strategies.${subscription.resetStrategy}`, subscription.resetStrategy)],
    subscription.expiresAt && [t('subscription.expiresAt'), formatDateTime(subscription.expiresAt)],
    subscription.deviceLimit !== undefined && [t('subscription.deviceLimit'), subscription.deviceLimit === null ? t('subscription.panelDefault') : subscription.deviceLimit === 0 ? t('subscription.unlimited') : t('subscription.devices', { count: subscription.deviceLimit })],
  ].filter((row): row is string[] => !!row);
  const statusColor = subscription.status === 'ACTIVE' ? 'green' : subscription.status === 'LIMITED' || subscription.status === 'EXPIRED' ? 'red' : 'gray';
  return (
    <Stack gap="xs" mt="sm">
      <Text size="sm" fw={600}>{t('subscription.title')}</Text>
      {subscription.status && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">{t('subscription.status')}:</Text>
          <Badge color={statusColor} variant="light">{t(`subscription.statusLabels.${subscription.status}`, subscription.status)}</Badge>
        </Group>
      )}
      {rows.map(([label, value]) => (
        <Group key={label} justify="space-between">
          <Text size="sm" c="dimmed">{label}:</Text>
          <Text size="sm">{value}</Text>
        </Group>
      ))}
      <Text size="xs" c="dimmed">{t('subscription.snapshotHint')}</Text>
    </Stack>
  );
}
