/**
 * +html.tsx — Expo Router's customizable HTML shell for the WEB build.
 *
 * Adds PWA support:
 *   - <link rel="manifest"> for "Add to Home Screen" installability
 *   - Apple-specific meta tags (iOS Safari ignores the standard manifest
 *     for fullscreen / status-bar styling — it needs apple-mobile-web-app-*)
 *   - Service worker registration for offline caching of the app shell
 *
 * This file is web-only; native builds ignore it entirely.
 */
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no"
        />

        {/* PWA: standard manifest + theme color */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#E84545" />

        {/* iOS Safari: enable home-screen install with full-screen + status bar */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="SmombieAlert" />
        <link rel="apple-touch-icon" href="/icon.png" />

        <title>SmombieAlert — AI Pedestrian Safety Guard</title>

        {/* Prevent body-scroll bounce on iOS; Expo Router default */}
        <ScrollViewStyleReset />

        {/* Service worker registration for offline support */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').catch(function (err) {
                    console.warn('[sw] registration failed:', err);
                  });
                });
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
