export function Progress({
  value,
  className = "",
}: {
  value: number;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div
      className={`progress ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}
