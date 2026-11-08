import { useState, useEffect } from 'react';

const STORAGE_KEY = 'isInsideTelegramWebApp';

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
            language_code?: string;
          };
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        openTelegramLink: (url: string) => void;
        openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
        BackButton: {
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
      };
    };
  }
}

function checkIsInsideTelegramWebApp(): boolean {
  const tgWebApp = window.Telegram?.WebApp;
  return !!(tgWebApp && (
    (tgWebApp.initData && tgWebApp.initData.length > 0) ||
    tgWebApp.initDataUnsafe?.user?.id
  ));
}

function getStoredValue(): boolean | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      return stored === 'true';
    }
  } catch {
  }
  return null;
}

function setStoredValue(value: boolean): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, String(value));
  } catch {
  }
}

export function useTelegramWebApp() {
  const [isInsideTelegramWebApp, setIsInsideTelegramWebApp] = useState<boolean>(() => {
    const cached = getStoredValue();
    if (cached !== null) {
      return cached;
    }
    return checkIsInsideTelegramWebApp();
  });

  useEffect(() => {
    const checkAndStore = () => {
      const isInside = checkIsInsideTelegramWebApp();
      setIsInsideTelegramWebApp(isInside);
      setStoredValue(isInside);

      // Language is selected centrally from site default and saved preference.
      // Telegram account language must not overwrite an explicit UI choice.
    };
    checkAndStore();
    const timer = setTimeout(checkAndStore, 100);
    return () => clearTimeout(timer);
  }, []);

  return {
    isInsideTelegramWebApp,
    telegramWebApp: window.Telegram?.WebApp || null,
  };
}

export function isInsideTelegramWebApp(): boolean {
  const cached = getStoredValue();
  if (cached !== null) {
    return cached;
  }
  return checkIsInsideTelegramWebApp();
}
