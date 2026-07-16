/**
 * MapPinButton -- small icon button to trigger the map location picker.
 *
 * Shared between OrderForm and VehicleForm (DRY).
 * Renders a map-pin SVG icon with consistent styling.
 */

interface MapPinButtonProps {
  onClick: () => void;
  title?: string;
}

export function MapPinButton({ onClick, title = "Pick on map" }: MapPinButtonProps) {
  return (
    <button
      type="button"
      className="btn-icon btn-icon--pick-map"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
        <circle cx="12" cy="10" r="3" />
      </svg>
    </button>
  );
}
