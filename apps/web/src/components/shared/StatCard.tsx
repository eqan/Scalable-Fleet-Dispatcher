/**
 * StatCard -- summary metric display, extracted from App.tsx for reuse.
 *
 * Used in the dashboard header for vehicle count, order count, etc.
 * Also reusable in any future analytics or debug views.
 */

interface StatCardProps {
  label: string;
  value: number | string;
  variant?: "default" | "success" | "warning" | "muted";
}

export function StatCard({ label, value, variant = "default" }: StatCardProps) {
  return (
    <div className={`stat-card stat-card--${variant}`}>
      <span className="stat-card__value">{value}</span>
      <span className="stat-card__label">{label}</span>
    </div>
  );
}
