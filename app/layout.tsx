import type { Metadata } from 'next';
import { SessionProvider } from '@/components/SessionProvider';

export const metadata: Metadata = {
  title: 'Financial Sentiment Reasoning Engine',
  description: 'Open-source financial sentiment reasoning engine for stock queries and news analysis.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
