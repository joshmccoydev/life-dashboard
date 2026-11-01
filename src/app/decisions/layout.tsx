export const metadata = {
  title: "decisions",
  manifest: "/decisions.webmanifest",
  robots: {
    index: false,
    follow: false,
  },
  appleWebApp: {
    capable: true,
    title: "decisions",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0b0c",
};

export default function DecisionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            if ("serviceWorker" in navigator) {
              navigator.serviceWorker.register("/decisions-sw.js", {
                scope: "/decisions",
              });
            }
          `,
        }}
      />
    </>
  );
}
