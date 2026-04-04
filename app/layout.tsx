import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "Bad Choices",
  description: "Fast social chaos for rooms, dates, teams, and streams."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
