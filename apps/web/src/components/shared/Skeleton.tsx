/**
 * Skeleton -- animated placeholder for loading states.
 *
 * Reusable building block for composing skeleton screens:
 *   - Accepts width, height, and borderRadius for any shape
 *   - Shimmer animation via CSS class
 *   - SkeletonColumn / SkeletonBoard composites for dispatch loading
 *
 * DRY: one base Skeleton + composed variants, no duplication.
 */

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  className?: string;
}

export function Skeleton({
  width = "100%",
  height = 16,
  borderRadius = "var(--radius-sm)",
  className = "",
}: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        borderRadius,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Composed skeletons (DRY building blocks)                           */
/* ------------------------------------------------------------------ */

/** Skeleton for a single order card. */
export function SkeletonOrderCard() {
  return (
    <div className="skeleton-order-card">
      <div className="skeleton-order-card__header">
        <Skeleton width={100} height={12} />
        <Skeleton width={40} height={16} borderRadius="var(--radius-sm)" />
      </div>
      <div className="skeleton-order-card__details">
        <Skeleton width={60} height={10} />
        <Skeleton width={50} height={10} />
      </div>
    </div>
  );
}

/** Skeleton for a vehicle column. */
export function SkeletonColumn() {
  return (
    <div className="skeleton-column">
      <div className="skeleton-column__header">
        <Skeleton width={120} height={14} />
        <Skeleton width="100%" height={4} borderRadius="2px" />
      </div>
      <div className="skeleton-column__body">
        <SkeletonOrderCard />
        <SkeletonOrderCard />
        <SkeletonOrderCard />
      </div>
    </div>
  );
}

/** Full skeleton for the dispatch board during initial load. */
export function SkeletonBoard() {
  return (
    <div className="skeleton-board">
      {/* Unassigned panel skeleton */}
      <div className="skeleton-unassigned">
        <div className="skeleton-column__header">
          <Skeleton width={100} height={14} />
          <Skeleton width={30} height={18} borderRadius="999px" />
        </div>
        <div className="skeleton-column__body">
          <SkeletonOrderCard />
          <SkeletonOrderCard />
        </div>
      </div>
      {/* Vehicle column skeletons */}
      <SkeletonColumn />
      <SkeletonColumn />
      <SkeletonColumn />
    </div>
  );
}
