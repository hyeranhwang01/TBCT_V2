import type { Metadata, Viewport } from "next";
import "@xyflow/react/dist/style.css";
import "./globals.css";
import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: "TBCT Protocol Studio",
  description: "Clinician-Authored Treatment Protocol Workspace",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "TBCT Studio" },
};

export const viewport: Viewport = {
  themeColor: "#3566AE",
};

// Applies a stored explicit light/dark theme choice to <html> before first
// paint -- without this, the page would render in globals.css's default
// (@media prefers-color-scheme) theme for one frame and then flip to the
// stored explicit choice once React hydrates and use-theme-preference.ts's
// effect runs, a visible flash on every load. Deliberately a raw inline
// script (not a React effect) so it runs synchronously, before hydration.
// "system" (or nothing stored) intentionally does nothing here -- that's
// the CSS media query's job.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = window.localStorage.getItem("tbct-theme-preference");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
