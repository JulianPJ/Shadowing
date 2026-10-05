'use client';
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const THEME_COOKIE = 'hibiki-theme';
const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function activeTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(activeTheme());
  }, []);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${nextTheme} mode`;

  return (
    <button
      type="button"
      className="theme-toggle icon-button"
      aria-label={label}
      title={label}
      onClick={() => {
        applyTheme(nextTheme);
        document.cookie = `${THEME_COOKIE}=${nextTheme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
        setTheme(nextTheme);
      }}
    >
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
