import fs from 'node:fs';
import { chromium, defineConfig } from '@playwright/test';

function resolveChromiumExecutable(): string | undefined {
  try {
    const defaultPath = chromium.executablePath();
    if (defaultPath && fs.existsSync(defaultPath)) {
      return defaultPath;
    }
  } catch {
    // ignore and fall back
  }

  const fallbacks = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const candidate of fallbacks) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const executablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 390, height: 844 },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
});
