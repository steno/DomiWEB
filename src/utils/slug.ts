/** URL-safe slug for claim/site paths on GitHub Pages. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function leadIdFromPlace(placeId: string, metroId: string): string {
  const safe = placeId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `${metroId}__${safe}`;
}
