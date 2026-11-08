import { useEffect, useRef, useState } from 'react';
import { Paper, Group, Box, Text, Button, CloseButton } from '@mantine/core';
import { IconShare2 } from '@tabler/icons-react';
import { useTranslation, Trans } from 'react-i18next';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { getCookie } from '../api/cookie';

const SHOWN_KEY = 'shm_pwa_install_banner_shown';

export function PWAInstallBanner() {
  const { canInstall, isIOSInstall, isTelegramWebApp, install } = usePWAInstall();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const checked = useRef(false);
  const eligible = canInstall || isIOSInstall || isTelegramWebApp;

  useEffect(() => {
    if (!eligible || checked.current) return;
    checked.current = true;
    try {
      if (localStorage.getItem(SHOWN_KEY) === '1') return;
      // Remember the first offer, even if the user leaves without dismissing it.
      localStorage.setItem(SHOWN_KEY, '1');
      setVisible(true);
    } catch { /* Skip automatic offers when the browser cannot remember them. */ }
  }, [eligible]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === SHOWN_KEY && event.newValue === '1') setVisible(false);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!visible || !eligible) return null;

  const openInBrowser = () => {
    const sessionId = getCookie();
    const sessionParam = sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : '';
    const url = window.location.origin + `/?addToHomeScreen=1${sessionParam}`;
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <Paper
      withBorder
      shadow="sm"
      p="sm"
      style={{
        position: 'fixed',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 200,
        width: 'min(380px, calc(100vw - 32px))',
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group wrap="nowrap" gap="sm" style={{ flex: 1, minWidth: 0 }}>
          <img src="/icon-192.png" alt="" style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
          <Box style={{ minWidth: 0 }}>
            <Text size="sm" fw={600}>{t('common.installApp')}</Text>
            {isTelegramWebApp ? (
              <Text size="xs" c="dimmed" lineClamp={2}>{t('common.installAppDesc')}</Text>
            ) : isIOSInstall && !canInstall ? (
              <Text size="xs" c="dimmed" lineClamp={3}>
                <Trans i18nKey="common.installAppIOSDesc" components={{ icon: <IconShare2 size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> }} />
              </Text>
            ) : (
              <Text size="xs" c="dimmed" lineClamp={2}>{t('common.installAppDesc')}</Text>
            )}
          </Box>
        </Group>
        <Group gap={4} wrap="nowrap">
          {isTelegramWebApp ? (
            <Button size="xs" onClick={openInBrowser}>{t('common.installAppBtn')}</Button>
          ) : canInstall ? (
            <Button size="xs" onClick={() => install()}>{t('common.installAppBtn')}</Button>
          ) : null}
          <CloseButton size="sm" onClick={() => setVisible(false)} aria-label={t('common.installAppDismiss')} />
        </Group>
      </Group>
    </Paper>
  );
}
