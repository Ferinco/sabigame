import type { Metadata } from "next";
import { Baloo_2, Nunito } from "next/font/google";
import "./globals.css";
import { getGuestId, ensureGuestSession } from "@/lib/guest/session";

const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SabiGame — fast trivia, faster friends",
  description: "Pick a category, race up to 3 opponents, answer fast to score big.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const guestId = await getGuestId();
  await ensureGuestSession(guestId);

  return (
    <html
      lang="en"
      className={`${baloo.variable} ${nunito.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
