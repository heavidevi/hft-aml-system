import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'HFT Engine + AML Monitor',
  description: 'C++ matching engine and real-time anti-money-laundering monitor',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
