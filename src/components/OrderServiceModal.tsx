import PaymentForm from './PaymentForm';
import { parsePeriod, requiredTopUp } from '../utils/format';
import { useDisplay } from '../hooks/useDisplay';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Stack, Text, Card, Group, Badge, Loader, Center, Button, Paper, Divider, Alert, Checkbox, ScrollArea } from '@mantine/core';
import { IconArrowLeft, IconCheck, IconWallet } from '@tabler/icons-react';
import { servicesApi, userApi } from '../api/client';
import { notifications } from '@mantine/notifications';
import { config } from '../config';

interface OrderService {
  service_id: number;
  name: string;
  category: string;
  cost: number;
  partial_renew?: boolean;
  real_cost: number;
  real_cost_with_bonuses:  number;
  cost_discount: number;
  cost_bonus: number;
  discount: number;
  period: number;
  descr: string;
}

interface OrderServiceModalProps {
  opened: boolean;
  onClose: () => void;
  onOrderSuccess?: () => void;
  mode?: 'order' | 'change';
  currentService?: {
    user_service_id: number;
    service_id: number;
    status: string;
    category: string;
    name?: string;
  };
  onChangeSuccess?: () => void;
}

function normalizeCategory(category: string): string {
  if (category.match(/remna|remnawave|marzban|marz|mz/i)) {
    return 'proxy';
  }
  if (category.match(/^(vpn|wg|awg)/i)) {
    return 'vpn';
  }
  if (['web_tariff', 'web', 'mysql', 'mail', 'hosting'].includes(category)) {
    return category;
  }
  return 'other';
}

function formatPeriod(value: number, t: any) {
  if (!value) return '-';

  const period = parsePeriod(value);
  if (!period) return '—';
  const { months, days, hours } = period;

  const parts: string[] = [];

  if (months) {
    if (months % 12 === 0 && !days && !hours) {
      const years = months / 12;
      parts.push(`${years} ${t('common.years', { count: years })}`);
    } else {
      parts.push(`${months} ${t('common.months', { count: months })}`);
    }
  }
  if (days) parts.push(`${days} ${t('common.days')}`);
  if (hours) parts.push(`${hours} ${t('common.hours')}`);

  return parts.join(' ');
}

export default function OrderServiceModal({
  opened,
  onClose,
  onOrderSuccess,
  mode = 'order',
  currentService,
  onChangeSuccess,
}: OrderServiceModalProps) {
  const { t } = useTranslation();
  const { money } = useDisplay();
  const [services, setServices] = useState<OrderService[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedService, setSelectedService] = useState<OrderService | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [balanceFailed, setBalanceFailed] = useState(false);
  const [finishAfterActive, setFinishAfterActive] = useState(false);

  const isChangeMode = mode === 'change';
  const canDeferChange = isChangeMode && currentService?.status === 'ACTIVE';

  const getEffectiveCost = (service: OrderService): number => {
    if (config.ORDER_COST_WITH_BONUSES === 'true') return Number(service.real_cost_with_bonuses ?? service.real_cost ?? service.cost);
    if (config.ORDER_COST_DISCOUNT === 'true') return Number(service.real_cost ?? service.cost);
    return Number(service.cost || 0);
  };

  const getTopUpAmount = (service: OrderService, balance: number): number => {
    return requiredTopUp(getEffectiveCost(service), balance);
  };

  useEffect(() => {
    if (opened) {
      setSelectedService(null);
      setFinishAfterActive(false);
    }
  }, [opened, mode, currentService?.service_id]);

  useEffect(() => {
    if (opened) {
      fetchServices();
      if (!isChangeMode) {
        fetchUserBalance();
      }
    }
  }, [opened, isChangeMode, currentService?.category]);


  useEffect(() => {
    if (isChangeMode) {
      setFinishAfterActive(false);
    }
  }, [selectedService, isChangeMode]);

  const fetchUserBalance = async () => {
    setUserBalance(null);
    setBalanceFailed(false);
    try {
      const response = await userApi.getProfile();
      const userData = response.data.data?.[0] || response.data.data;
      if (userData?.balance == null || !Number.isFinite(Number(userData.balance))) throw new Error();
      setUserBalance(Number(userData.balance));
    } catch { setBalanceFailed(true); }
  };

  const fetchServices = async () => {
    setLoading(true);
    try {
      const response = await servicesApi.order_list(
        config.SERVICE_CHANGE_ALL_CATEGORY === 'false' && isChangeMode && currentService?.category ? { category: currentService.category } : undefined
      );
      const data: OrderService[] = response.data.data || [];
      const filtered = isChangeMode && currentService?.service_id
        ? data.filter(service => service.service_id !== currentService.service_id)
        : data;
      const ALLOWED_SORTINGS = ['cost_asc', 'cost_desc', 'name_asc', 'name_desc', 'descr_asc', 'descr_desc'] as const;
      type Sorting = typeof ALLOWED_SORTINGS[number];
      const rawSorting = config.ORDER_SORTING;
      const sorting: Sorting = (ALLOWED_SORTINGS as readonly string[]).includes(rawSorting)
        ? rawSorting as Sorting
        : 'cost_asc';
      const sorted = [...filtered].sort((a, b) => {
        switch (sorting) {
          case 'cost_asc':  return Number(a.cost) - Number(b.cost);
          case 'cost_desc': return Number(b.cost) - Number(a.cost);
          case 'name_asc':  return a.name.localeCompare(b.name);
          case 'name_desc': return b.name.localeCompare(a.name);
          case 'descr_asc':  return (a.descr || '').localeCompare(b.descr || '');
          case 'descr_desc': return (b.descr || '').localeCompare(a.descr || '');
          default:          return 0;
        }
      });
      setServices(sorted);
    } catch (error) {
      notifications.show({
        title: t('common.error'),
        message: t('order.loadError'),
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleOrder = async () => {
    if (!selectedService) return;

    setOrdering(true);
    try {
      await servicesApi.order(selectedService.service_id);

      notifications.show({
        title: t('common.success'),
        message: t('order.orderSuccess', { name: selectedService.name }),
        color: 'green',
      });

      onOrderSuccess?.();
      handleClose();
    } catch (error) {
      notifications.show({
        title: t('common.error'),
        message: t('order.orderError'),
        color: 'red',
      });
    } finally {
      setOrdering(false);
    }
  };

  const handleChange = async () => {
    if (!selectedService || !currentService) return;

    setOrdering(true);
    try {
      let finishActive;
      if (config.ALLOW_SERVICE_CHANGE_FORCE === 'true') {
        finishActive = 1;
      } else {
        finishActive = canDeferChange && finishAfterActive ? 1 : 0;
      }
      const partial_renew = selectedService.partial_renew ? 1 : 0;
      await userApi.changeService(currentService.user_service_id, selectedService.service_id, finishActive, partial_renew);

      notifications.show({
        title: t('common.success'),
        message: t('services.changeServiceSuccess'),
        color: 'green',
      });

      onChangeSuccess?.();
      handleClose();
    } catch (error) {
      notifications.show({
        title: t('common.error'),
        message: t('services.changeServiceError'),
        color: 'red',
      });
    } finally {
      setOrdering(false);
    }
  };

  const handleClose = () => {
    setSelectedService(null);
    setFinishAfterActive(false);
    onClose();
  };

  const handleBack = () => {
    setSelectedService(null);
    setFinishAfterActive(false);
  };

  const groupedServices = services.reduce((acc, service) => {
    const category = normalizeCategory(service.category || 'other');

    let categoryTitle;
    if (category === 'vpn' && config.VPN_CATEGORY_TITLE) {
      categoryTitle = config.VPN_CATEGORY_TITLE;
    } else if (category === 'proxy' && config.PROXY_CATEGORY_TITLE) {
      categoryTitle = config.PROXY_CATEGORY_TITLE;
    } else {
      categoryTitle = t(`categories.${category}`, category);
    }
    if (config.VISIBLE_CATEGORIES) {
      const visibleCategories = config.VISIBLE_CATEGORIES.split(',').map(c => c.trim().toLowerCase());
      const rawCategory = (service.category || 'other').toLowerCase();
      const normalizedCategory = category.toLowerCase();
      if (!visibleCategories.includes(rawCategory) && !visibleCategories.includes(normalizedCategory)) {
        return acc;
      }
    }

    if (!acc[category]) {
      acc[category] = {
        title: categoryTitle,
        services: [],
      };
    }

    acc[category].services.push(service);
    return acc;
  }, {} as Record<string, { title: string; services: OrderService[] }>);

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        selectedService
          ? t('order.serviceDetails')
          : (isChangeMode ? t('services.changeServiceTitle') : t('order.title'))
      }
      size="lg"
      scrollAreaComponent={ScrollArea.Autosize}
    >
      {loading ? (
        <Center h={200}>
          <Loader size="lg" />
        </Center>
      ) : selectedService ? (
        <Stack gap="md">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={handleBack}
            size="compact-sm"
            w="fit-content"
          >
            {t('order.backToList')}
          </Button>

          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Text fw={700} size="lg">{selectedService.name}</Text>
              </Group>

              <Divider />

              {selectedService.descr && (
                <Text size="sm" c="dimmed" style={{ whiteSpace: 'pre-wrap' }}>
                  {selectedService.descr}
                </Text>
              )}

              <Group justify="space-between" mt="md">
                <div>
                  <Text size="sm" c="dimmed">{t('services.cost')}</Text>
                  <Group gap="xs" align="baseline">
                    {selectedService.cost > getEffectiveCost(selectedService) && (
                      <Text fw={600} size="lg" style={{ textDecoration: 'line-through', color: '#999' }}>
                        {money(selectedService.cost)}
                      </Text>
                    )}
                    <Text fw={600} size="lg" color={selectedService.cost > getEffectiveCost(selectedService) ? 'green' : undefined}>
                      {money(getEffectiveCost(selectedService))}
                    </Text>
                  </Group>
                  {selectedService.cost > getEffectiveCost(selectedService) && (
                    <Text size="xs" c="dimmed" mt="xs">
                      {t('services.profit', { amount: money(selectedService.cost - getEffectiveCost(selectedService)) })}
                    </Text>
                  )}
                </div>
                <div>
                  <Text size="sm" c="dimmed">{t('order.period')}</Text>
                  <Text fw={500}>
                    {formatPeriod(selectedService.period, t)}
                  </Text>
                </div>
              </Group>
            </Stack>
          </Paper>

          {isChangeMode ? (
            <Stack gap="sm">
              {config.ALLOW_SERVICE_CHANGE_FORCE === 'false' && canDeferChange && (
                <Checkbox
                  label={selectedService.partial_renew ? t('services.changeAfterEndRenewal') : t('services.changeAfterEnd')}
                  checked={finishAfterActive}
                  onChange={(event) => setFinishAfterActive(event.currentTarget.checked)}
                />
              )}
              {config.ALLOW_SERVICE_CHANGE_FORCE === 'true' && (
                <Text>{t('services.changeAfterEnd')}</Text>
              )}
              <Button
                fullWidth
                size="md"
                color="blue"
                leftSection={<IconCheck size={18} />}
                onClick={handleChange}
                loading={ordering}
              >
                {t('services.changeService')}
              </Button>
            </Stack>
          ) : userBalance === null ? (
            balanceFailed ? <Button variant="light" onClick={fetchUserBalance}>{t('common.refresh')}</Button> : <Loader size="sm" />
          ) : (
            <>
              <Alert
                variant="light"
                color={userBalance >= getEffectiveCost(selectedService) ? 'green' : 'yellow'}
                icon={<IconWallet size={18} />}
              >
                <Group justify="space-between">
                  <Text size="sm">{t('order.yourBalance')}: <Text span fw={600}>{money(userBalance)}</Text></Text>
                  {userBalance >= getEffectiveCost(selectedService) ? (
                    <Badge color="green" variant="light">{t('order.enoughToPay')}</Badge>
                  ) : (
                    <Badge color="yellow" variant="light">{t('order.needTopUp', { amount: money(getTopUpAmount(selectedService, userBalance)) })}</Badge>
                  )}
                </Group>
              </Alert>

              {userBalance >= getEffectiveCost(selectedService) ? (
                <Button
                  fullWidth
                  size="md"
                  color="green"
                  leftSection={<IconCheck size={18} />}
                  onClick={handleOrder}
                  loading={ordering}
                >
                  {t('order.orderFor', { amount: money(getEffectiveCost(selectedService)) })}
                </Button>
              ) : (
                <Paper withBorder p="md" radius="md">
                  <Text mb="sm" fw={500}>{t('order.topUpBalance')}</Text>
                  {opened && <PaymentForm key={selectedService.service_id}
                    initialAmount={getTopUpAmount(selectedService, userBalance)} minimum={getTopUpAmount(selectedService, userBalance)}
                    label="order.orderAndPay" beforeCharge={async () => {
                      await servicesApi.order(selectedService.service_id);
                      onOrderSuccess?.();
                    }} onComplete={() => {
                      notifications.show({ message: t('order.orderPaySuccess', { name: selectedService.name }), color: 'green' });
                      handleClose();
                    }} />}
                </Paper>
              )}
            </>
          )}
        </Stack>
      ) : services.length === 0 ? (
        <Center h={200}>
          <Text c="dimmed">{t('order.noServicesAvailable')}</Text>
        </Center>
      ) : (
        <Stack gap="md">
          {Object.entries(groupedServices).map(([category, group ]) => (
            <div key={category}>
              <Text fw={500} size="sm" c="dimmed" mb="xs">
                { group.title }
              </Text>
              <Stack gap="xs">
                {group.services.map((service) => (
                  <Card
                    key={service.service_id}
                    withBorder
                    radius="md"
                    p="sm"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedService(service)}
                  >
                    <Group justify="space-between">
                      <div>
                        <Text fw={500}>{service.name}</Text>
                        {service.descr && (
                          <Text size="xs" c="dimmed" lineClamp={1}>
                            {service.descr}
                          </Text>
                        )}
                      </div>
                      <Group gap="sm" align="baseline">
                        {service.cost > getEffectiveCost(service) && (
                          <Text size="sm" c="dimmed" style={{ textDecoration: 'line-through' }}>
                            {money(service.cost)}
                          </Text>
                        )}
                        <Text fw={600} color={service.cost > getEffectiveCost(service) ? 'green' : undefined}>
                          {money(getEffectiveCost(service))}
                        </Text>
                        <Text size="xs" c="dimmed">
                          / {formatPeriod(service.period, t)}
                        </Text>
                      </Group>
                    </Group>
                  </Card>
                ))}
              </Stack>
            </div>
          ))}
        </Stack>
      )}
    </Modal>
  );
}
