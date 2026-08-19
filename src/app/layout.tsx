import type { Metadata } from "next";
import { ExperienceProvider } from "@/components/experience-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRACE",
  description: "TRACE campus experience web app",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full flex flex-col"><ExperienceProvider>{children}</ExperienceProvider></body>
    </html>
  );
}
