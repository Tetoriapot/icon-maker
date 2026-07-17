import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin = `${protocol}://${host}`;

  return {
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
          url: `${origin}/og.png`,
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
      images: [`${origin}/og.png`],
    },
  };
}

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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
