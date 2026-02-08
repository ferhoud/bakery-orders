// pages/_document.js
import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  const appName = "Bakery Orders";
  const theme = "#0ea5e9";

  return (
    <Html lang="fr">
      <Head>
        {/* PWA */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="application-name" content={appName} />
        <meta name="theme-color" content={theme} />

        {/* iOS "web app" mode */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content={appName} />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />

        {/* Icons */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="icon" href="/icons/icon-192.png" />

        {/* Better rendering */}
        <meta name="format-detection" content="telephone=no" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
