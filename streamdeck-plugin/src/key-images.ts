/**
 * Runtime key faces: the base glyph plus a +/− badge baked into the image,
 * so up/down keys are distinguishable even with key titles hidden.
 * Stream Deck accepts inline SVG via setImage as a data URI.
 */
export function directionBadge(glyph: string, color: string, direction: "up" | "down"): string {
  const badge =
    direction === "down"
      ? `<line x1="49" y1="58" x2="63" y2="58" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`
      : `<line x1="49" y1="58" x2="63" y2="58" stroke="${color}" stroke-width="5" stroke-linecap="round"/><line x1="56" y1="51" x2="56" y2="65" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72"><rect width="72" height="72" rx="12" fill="#17171b"/>${glyph}${badge}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
