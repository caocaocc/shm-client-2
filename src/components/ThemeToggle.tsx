import { ActionIcon, useMantineColorScheme, useComputedColorScheme } from '@mantine/core';
import { IconSun, IconMoon } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme('light');

  return (
    <ActionIcon
      onClick={() => setColorScheme(computedColorScheme === 'light' ? 'dark' : 'light')}
      variant="default"
      size="lg"
      aria-label={t('common.toggleTheme')}
    >
      {computedColorScheme === 'light' ? <IconMoon size={18} /> : <IconSun size={18} />}
    </ActionIcon>
  );
}
