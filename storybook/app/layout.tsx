import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'The World That Remembered — A CosyWorld Storybook',
  description: 'A picture-book guide to avatars, items, locations, and one real emergent CosyWorld journey.',
  openGraph: {
    title: 'CosyWorld Storybook',
    description: 'Meet avatars, follow items, explore remembered locations, and read one real emergent journey.',
    images: [{ url: '/social-card.jpg', width: 1536, height: 1024, alt: 'CosyWorld Storybook watercolor cover' }],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
