import { MapPin } from "lucide-react";

interface GpsMapLinkProps {
  lat: number | string | null;
  lng: number | string | null;
  accuracy?: number | string | null;
}

function isPresentCoordinate(value: number | string | null): value is number | string {
  return value !== null && value !== "";
}

export default function GpsMapLink({ lat, lng, accuracy }: GpsMapLinkProps) {
  if (!isPresentCoordinate(lat) || !isPresentCoordinate(lng)) {
    return null;
  }

  const coordinate = `${lat},${lng}`;
  const accuracyNumber = typeof accuracy === "number"
    ? accuracy
    : accuracy
      ? Number(accuracy)
      : null;

  return (
    <a
      href={`https://maps.google.com/?q=${coordinate}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Open GPS location"
      className="inline-flex items-center gap-1 text-accent hover:text-accent-hover"
    >
      <MapPin aria-hidden="true" className="h-4 w-4" />
      {accuracyNumber !== null && Number.isFinite(accuracyNumber) && (
        <span className="text-xs text-text-muted">
          ({Math.round(accuracyNumber)} m)
        </span>
      )}
    </a>
  );
}
