import { formatBytes } from '../utils/subscription';
import { parsePeriod } from '../utils/format';
import { useDisplay } from '../hooks/useDisplay';
import { useState, useEffect } from 'react';
import { Modal, Stack, Text, Center, Loader, Paper, Pagination, LoadingOverlay, ScrollArea } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { userApi } from '../api/client';
import DataTable, { Column } from './DataTable';

interface Withdraw {
  usage?: { limit_bytes: number; used_bytes?: number | null };
  withdraw_id: number;
  user_service_id: number;
  service_id: number;
  cost: number;
  total: number;
  discount: number;
  bonus: number;
  months: number;
  qnt: number;
  create_date: string;
  withdraw_date: string;
  end_date: string;
}

interface WithdrawHistoryModalProps {
  opened: boolean;
  onClose: () => void;
}

const PER_PAGE = 10;

function formatPeriod(value: number, t: ReturnType<typeof useTranslation>['t']) {
  if (!value) return '---';
  const period = parsePeriod(value);
  if (!period) return '—';
  const { months, days, hours } = period;
  const parts: string[] = [];
  if (months) parts.push(`${months} ${t('common.months')}`);
  if (days) parts.push(`${days} ${t('common.days')}`);
  if (hours) parts.push(`${hours} ${t('common.hours')}`);
  return parts.join(' ');
}

export default function WithdrawHistoryModal({ opened, onClose }: WithdrawHistoryModalProps) {
  const [withdrawals, setWithdrawals] = useState<Withdraw[]>([]);
  const [initialLoading, setInitialLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [sortField, setSortField] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const { t, i18n } = useTranslation();
  const { money, date } = useDisplay();

  const fetchWithdrawals = async (
    p: number,
    isInitial = false,
    field?: string,
    direction?: 'asc' | 'desc',
  ) => {
    if (isInitial) setInitialLoading(true);
    else setTableLoading(true);
    try {
      const offset = (p - 1) * PER_PAGE;
      const response = await userApi.getWithdrawals({
        limit: PER_PAGE,
        offset,
        ...(field ? { sort_field: field, sort_direction: direction || sortDirection } : {}),
        filter: { total: { '!=': 0 } },
      });
      setWithdrawals(response.data.data || []);
      if (typeof response.data.items === 'number') {
        setTotalItems(response.data.items);
      }
    } catch {
      // silent
    } finally {
      setInitialLoading(false);
      setTableLoading(false);
    }
  };

  useEffect(() => {
    if (!opened) return;
    setPage(1);
    setSortField('');
    setSortDirection('asc');
    fetchWithdrawals(1, true);
  }, [opened]);

  useEffect(() => {
    if (!opened || initialLoading) return;
    fetchWithdrawals(page, false, sortField, sortDirection);
  }, [page, sortField, sortDirection]);

  const totalPages = Math.ceil(totalItems / PER_PAGE);

  const columns: Column<Withdraw>[] = [
    {
      title: t('withdrawals.withdrawDate'),
      accessor: (w) => date(w.withdraw_date),
      sortable: true,
      sortKey: 'withdraw_date',
    },
    {
      title: t('withdrawals.endDate'),
      accessor: (w) => date(w.end_date),
      sortable: true,
      sortKey: 'end_date',
    },
    {
      title: t('services.cost'),
      accessor: (w) => <Text size="sm">{money(w.cost)}</Text>,
      sortable: true,
      sortKey: 'cost',
    },
    {
      title: t('withdrawals.total'),
      accessor: (w) => (
        <Text size="sm" fw={500} c="red" style={{ whiteSpace: 'nowrap' }}>
          {money(-Math.abs(w.total))}
        </Text>
      ),
      sortable: true,
      sortKey: 'total',
    },
    {
      title: t('order.period'),
      accessor: (w) => (
        <Text size="sm" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {formatPeriod(w.months, t)}{w.qnt && w.qnt > 1 ? ` × ${w.qnt}` : ''}
        </Text>
      ),
      sortable: true,
      sortKey: 'months',
      width: 160,
    },
  ];

  if (withdrawals.some(row => row.usage)) {
    columns.push({
      title: t('withdrawals.usage'),
      accessor: row => {
        if (!row.usage) return '—';
        const { used_bytes, limit_bytes } = row.usage;
        const limit = formatBytes(limit_bytes, i18n.language);
        if (typeof used_bytes === 'number') return formatBytes(used_bytes, i18n.language) + ' / ' + limit;
        return t(used_bytes === null ? 'withdrawals.usageUnknown' : 'withdrawals.usageOpen', { limit });
      },
    });
  }
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t('profile.wdHistory')}
      size="lg"
    >
      {initialLoading ? (
        <Center h={200}>
          <Loader size="lg" />
        </Center>
      ) : withdrawals.length === 0 ? (
        <Paper p="xl" radius="md">
          <Center>
            <Text c="dimmed">{t('withdrawals.historyEmpty')}</Text>
          </Center>
        </Paper>
      ) : (
        <Stack gap="md">
          <Paper withBorder radius="md" style={{ overflow: 'hidden', position: 'relative' }}>
            <LoadingOverlay visible={tableLoading} overlayProps={{ blur: 1 }} />
            <ScrollArea>
              <DataTable
                data={withdrawals}
                columns={columns}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={(field, dir) => {
                  setSortField(field);
                  setSortDirection(dir);
                  setPage(1);
                }}
              />
            </ScrollArea>
          </Paper>
          {totalPages > 1 && (
            <Center>
              <Pagination total={totalPages} value={page} onChange={setPage} />
            </Center>
          )}
        </Stack>
      )}
    </Modal>
  );
}
