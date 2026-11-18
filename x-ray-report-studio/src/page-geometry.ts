import type { RichNode } from './model';

export type PreviewPageLayout = { widthMm: number; heightMm: number; topMm: number; bottomMm: number; leftMm: number; rightMm: number; fontSizePt: number; fontFamily: string };

/** Match the section geometry emitted by exportDocx for catalog reports. */
export function previewPageLayout(doc: RichNode): PreviewPageLayout {
  const attrs = doc.attrs ?? {};
  const mm = (value: unknown, fallback: number, min = 0, max = 1000) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
  return {
    widthMm: mm(attrs.pageWidthMm, 210, 100), heightMm: mm(attrs.pageHeightMm, 297, 100),
    topMm: Math.max(43, mm(attrs.marginTopMm, 16, 0, 80)),
    bottomMm: mm(attrs.marginBottomMm, 907 * 25.4 / 1440, 0, 80),
    leftMm: mm(attrs.marginLeftMm, 18, 0, 80), rightMm: mm(attrs.marginRightMm, 18, 0, 80),
    fontSizePt: mm(attrs.fontSizePt, 11, 1, 200),
    fontFamily: typeof attrs.fontFamily === 'string' && attrs.fontFamily.length <= 100 ? attrs.fontFamily : 'Arial',
  };
}

