/**
 * Runtime key faces: the base glyph plus a +/− badge baked into the image,
 * so up/down keys are distinguishable even with key titles hidden.
 * Stream Deck accepts inline SVG via setImage as a data URI.
 *
 * Results are memoized — there are only a handful of (glyph, color, direction)
 * combinations, so the SVG→base64 encode runs at most once per key face.
 */
const cache = new Map<string, string>();

export function directionBadge(glyph: string, color: string, direction: "up" | "down"): string {
  const key = `${color}|${direction}|${glyph}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const stroke = `stroke="${color}" stroke-width="5" stroke-linecap="round"`;
  const horizontal = `<line x1="49" y1="58" x2="63" y2="58" ${stroke}/>`;
  const vertical = direction === "up" ? `<line x1="56" y1="51" x2="56" y2="65" ${stroke}/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="12" fill="#17171b"/>${glyph}${horizontal}${vertical}</svg>`;
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  cache.set(key, uri);
  return uri;
}
