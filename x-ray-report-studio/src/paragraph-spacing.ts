export type SpacingReference = { lineHeight: number; beforePt: number; afterPt: number };

export function isSpacingReference(value: unknown): value is SpacingReference {
  if (!value || typeof value !== 'object') return false;
  const {lineHeight, beforePt, afterPt} = value as SpacingReference;
  return Number.isFinite(lineHeight) && lineHeight >= .5 && lineHeight <= 5 &&
    [beforePt, afterPt].every(points => Number.isFinite(points) && points >= 0 && points <= 1000);
}

export function spacingAtLineHeight(reference: SpacingReference, lineHeight: number) {
  // Recompute from the same original values on every change. Round only in the
  // output format (CSS or OOXML), never use a previously scaled value as input.
  const at = (points: number) => lineHeight === reference.lineHeight
    ? points : Math.min(1000, points * lineHeight / reference.lineHeight);
  return { lineHeight, spaceBeforePt: at(reference.beforePt), spaceAfterPt: at(reference.afterPt), spacingReference: reference };
}
