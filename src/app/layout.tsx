import './globals.css';
import type { Metadata, Viewport } from 'next';
import Shell from '@/components/Shell';

export const metadata: Metadata = { title: 'Yoke Ad Studio', description: 'Make branded ads, share them for feedback, iterate.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wdth,wght@75..100,400..700&display=swap" />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
