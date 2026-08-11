import type { Metadata } from "next";
import "./globals.css";
import "./mass-payment.css";

export const metadata: Metadata = {
  title: "OffGrid - Money without borders",
  description: "Real testnet payments powered by Arc and Circle App Kit.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var saved=localStorage.getItem("offgrid-theme");var theme=saved==="light"||saved==="dark"?saved:(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme}catch(e){}})()` }} /></head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
