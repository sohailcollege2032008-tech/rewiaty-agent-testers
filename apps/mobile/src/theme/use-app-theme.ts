import { useCallback, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import type { ThemeId } from '../../../../packages/reader-engine/src/types';
import {
  DEFAULT_SETTINGS,
  loadThemePreference,
  selectManualTheme,
} from '@/storage/settings-store';
import {
  getAppThemeTokens,
  resolveAppTheme,
  type AppThemeTokens,
} from './reader-theme';

type ThemeListener = (next: { theme: ThemeId; hasManualTheme: boolean }) => void;
const listeners = new Set<ThemeListener>();

export function notifyThemeListeners(next: { theme: ThemeId; hasManualTheme: boolean }): void {
  for (const listener of listeners) {
    listener(next);
  }
}

export function useAppTheme(): {
  themeId: ThemeId;
  tokens: AppThemeTokens;
  hasManualTheme: boolean;
  selectTheme: (theme: ThemeId) => Promise<void>;
  refreshTheme: () => Promise<void>;
} {
  const colorScheme = useColorScheme();
  const [savedTheme, setSavedTheme] = useState<ThemeId>(DEFAULT_SETTINGS.theme);
  const [hasManualTheme, setHasManualTheme] = useState(false);

  const refreshTheme = useCallback(async () => {
    try {
      const pref = await loadThemePreference();
      setSavedTheme(pref.settings.theme);
      setHasManualTheme(pref.hasManualTheme);
    } catch {
      // Tests or web environments without initialized SQLite gracefully fall back to system color scheme.
    }
  }, []);

  useEffect(() => {
    void refreshTheme();
  }, [refreshTheme]);

  useEffect(() => {
    const onUpdate: ThemeListener = (next) => {
      setSavedTheme(next.theme);
      setHasManualTheme(next.hasManualTheme);
    };
    listeners.add(onUpdate);
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);

  const selectTheme = useCallback(async (theme: ThemeId) => {
    setSavedTheme(theme);
    setHasManualTheme(true);
    notifyThemeListeners({ theme, hasManualTheme: true });
    try {
      await selectManualTheme(theme);
    } catch {
      // Ignore storage failures in mocked environments
    }
  }, []);

  const themeId = resolveAppTheme(savedTheme, hasManualTheme, colorScheme);
  const tokens = getAppThemeTokens(themeId, colorScheme);

  return {
    themeId,
    tokens,
    hasManualTheme,
    selectTheme,
    refreshTheme,
  };
}
