import { LngLat } from "@/lib/geo";

// Reverse-geocode a coordinate to a human place name (city/town) via Mapbox.
// Used purely for the label in the top bar — falls back to null so callers can
// show coordinates or a neutral label when geocoding is unavailable.
export async function reverseGeocode({ lat, lng }: LngLat): Promise<string | null> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
    `?types=place&limit=1&language=en&access_token=${token}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feature = data?.features?.[0];
    return feature?.text ?? feature?.place_name ?? null;
  } catch {
    return null;
  }
}
