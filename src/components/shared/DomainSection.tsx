import type { ReactNode } from "react";
import type { DataState } from "@/domains/models";
import { Feed } from "./feed";

export function DomainSection({
  label,
  source,
  now,
  className = "",
  children,
}: {
  label: string;
  source?: DataState<unknown>;
  now: Date;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`domain-section ${className}`}>
      <div className="domain-section-header">
        <h3>{label}</h3>
        {source ? <Feed state={source} now={now} /> : null}
      </div>
      {children}
    </section>
  );
}
