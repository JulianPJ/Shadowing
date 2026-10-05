import type { Metadata } from 'next';
import '@fontsource-variable/dm-sans';
import '@fontsource/noto-sans-jp/400.css';
import '@fontsource/noto-sans-jp/500.css';
import './globals.css';
import { AccountBridge } from '@/components/account';
export const metadata: Metadata = {
  title: 'Hibiki — Find your Japanese rhythm',
  description:
    'Listen. Pause. Make it your own. A calm space for section-by-section Japanese shadowing practice.',
  icons: { icon: '/icon.svg' },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <AccountBridge />
      </body>
    </html>
  );
}
