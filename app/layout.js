import "./globals.css";

export const metadata = {
  title: "Energie-Simulator Pratteln · Kipfer-Logistik",
  description: "Was wäre, wenn die Lüftung mit PV seit 2021 laufen würde?",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
