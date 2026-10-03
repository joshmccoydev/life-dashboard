import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function DomainColumn({
  title,
  subtitle,
  icon: Icon,
  className,
  children,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  className: string;
  children: ReactNode;
}) {
  return (
    <section className={`domain-column ${className}`} aria-label={title}>
      <header className="domain-column-header">
        <Icon aria-hidden="true" />
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
      </header>
      <div className="domain-column-content">{children}</div>
    </section>
  );
}
