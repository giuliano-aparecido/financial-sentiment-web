import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Financial RAG Reasoning Engine',
  description: 'Open-source financial RAG reasoning engine for stock queries and news analysis.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
