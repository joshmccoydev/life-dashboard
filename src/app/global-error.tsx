"use client";
import { useEffect } from "react";
export default function GlobalError() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), 30000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#0b1017",
          color: "#dce3ed",
          fontFamily: "Arial",
          padding: "8vw",
          fontSize: "24px",
        }}
      >
        <h1>LifeDash is reconnecting</h1>
        <p>Retrying automatically in 30 seconds.</p>
      </body>
    </html>
  );
}
