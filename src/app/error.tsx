"use client";
import { useEffect } from "react";
export default function ErrorPage() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), 30000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main className="dashboard">
      <div className="panel panel-error">
        <h1>LifeDash is reconnecting</h1>
        <p>
          A temporary problem interrupted startup. Retrying automatically in 30
          seconds.
        </p>
      </div>
    </main>
  );
}
