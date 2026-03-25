import type { Metadata } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Flent · Pipeline",
  description: "Landlord supply pipeline (Google Sheets)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${jetbrainsMono.variable} font-sans antialiased bg-app-bg text-app-text min-h-screen`}
      >
        <ThemeProvider>
          <div className="pointer-events-none fixed top-3 right-3 z-[100]">
            <div className="pointer-events-auto">
              <ThemeToggle />
            </div>
          </div>
          {/* Reserve space so theme control never covers page chrome (esp. AI agent header). */}
          <div className="min-h-screen pr-14 sm:pr-16">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
