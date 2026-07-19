import type { Metadata, Viewport } from "next";
import "./globals.css";

const SITE_URL = "https://icon-maker-jp.tetoriapot.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "アイコンメーカー｜画像を30秒でアイコンに",
  description:
    "画像をブラウザ内で切り抜き、円形・正方形のアイコンとして保存。登録不要、アップロード不要で使えます。",
  applicationName: "アイコンメーカー",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "好きな画像を、あなたらしいアイコンに。",
    description: "切り抜いて、整えて、すぐ保存。登録不要のアイコンメーカー。",
    type: "website",
    locale: "ja_JP",
    images: [
      {
        url: `${SITE_URL}/og.png`,
        width: 1536,
        height: 1024,
        alt: "アイコンメーカー — 好きな画像を、あなたらしいアイコンに。",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "アイコンメーカー｜画像を30秒でアイコンに",
    description: "切り抜いて、整えて、すぐ保存。登録不要のアイコンメーカー。",
    images: [`${SITE_URL}/og.png`],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#17151c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
