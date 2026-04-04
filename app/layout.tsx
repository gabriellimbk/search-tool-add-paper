import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF to JSON OCR",
  description: "Upload a PDF and convert it into OCR JSON."
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
