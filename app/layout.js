import "./globals.css";

export const metadata = {
  title: "Donut City — Next Generation Role Play",
  description: "Donut City FiveM Role Play server — optimized scripts, MLOs, clothing, and live player status."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
