import type { RichNode } from './model';
import { DISCLAIMER_TEXT, EQUIPMENT_TEXT } from './report-footer.ts';

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
    fontSizePt: mm(attrs.fontSizePt, 12, 1, 200),
    fontFamily: typeof attrs.fontFamily === 'string' && attrs.fontFamily.length <= 100 ? attrs.fontFamily : 'Arial',
  };
}

export function paginateBrowserPreview(html: string, doc: RichNode): string {
  const layout = previewPageLayout(doc);
  const source = document.createElement('div');
  source.innerHTML = html;
  // OOXML `lineRule=auto` multiplies the font's natural line box. CSS multiplies
  // font-size instead; Arial's natural line box is about 1.18 times that size.
  source.querySelectorAll<HTMLElement>('p,h1,h2,h3').forEach(node => {
    const ratio = Number(node.style.lineHeight || doc.attrs?.lineHeight || 1.05);
    if (Number.isFinite(ratio) && ratio >= 0.5 && ratio <= 5) node.style.lineHeight = String(ratio * 1.18);
  });
  const blocks: HTMLElement[] = [];
  const collect = (node: Element) => {
    if (node.matches('section[data-report-section]')) { [...node.children].forEach(collect); return; }
    blocks.push(node.cloneNode(true) as HTMLElement);
  };
  [...source.children].forEach(collect);
  const css = [layout.widthMm, layout.heightMm, layout.topMm, layout.bottomMm, layout.leftMm, layout.rightMm]
    .map((value, index) => `--preview-${['width', 'height', 'top', 'bottom', 'left', 'right'][index]}:${value}mm`).join(';') + `;--preview-font-size:${layout.fontSizePt}pt`;
  const scratch = document.createElement('article');
  scratch.className = 'export-preview-paper preview-measure';
  scratch.style.cssText = css;
  const measure = document.createElement('div');
  measure.className = 'report-content';
  measure.style.fontFamily = layout.fontFamily;
  scratch.append(measure);
  document.body.append(scratch);
  const contentHeight = (layout.heightMm - layout.topMm - layout.bottomMm) * 96 / 25.4;
  const pages: HTMLElement[] = [];
  const makePage = () => { const paper = document.createElement('article'); paper.className = 'export-preview-paper'; paper.style.cssText = css; const content = document.createElement('div'); content.className = 'report-content'; content.style.fontFamily = layout.fontFamily; paper.append(content); pages.push(paper); return content; };
  let target = makePage();
  const measuredHeight = () => measure.getBoundingClientRect().height;
  const fits = (node: HTMLElement) => { measure.append(node); const fits = measuredHeight() <= contentHeight + 0.5; node.remove(); return fits; };
  const append = (node: HTMLElement) => { measure.append(node.cloneNode(true)); target.append(node); };
  const paragraphPart = (original: HTMLElement, start: number, end: number, total: number): HTMLElement => {
    const part = original.cloneNode(false) as HTMLElement;
    part.removeAttribute('data-page-break-before');
    const texts: Text[] = [];
    const walker = document.createTreeWalker(original, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) texts.push(walker.currentNode as Text);
    const at = (offset: number): [Text, number] => { let used = 0; for (const node of texts) { if (offset <= used + node.length) return [node, offset - used]; used += node.length; } return [texts.at(-1)!, texts.at(-1)!.length]; };
    const [fromNode, fromOffset] = at(start), [toNode, toOffset] = at(end);
    const range = document.createRange(); range.setStart(fromNode, fromOffset); range.setEnd(toNode, toOffset);
    part.append(range.cloneContents());
    if (start) part.classList.add('preview-paragraph-continuation');
    if (end < total) part.classList.add('preview-paragraph-fragment');
    return part;
  };
  try {
    for (const block of blocks) {
      // The Word exporter preserves explicit page breaks and keep-with-next.
      if (block.hasAttribute('data-page-break-before') && target.children.length) { target = makePage(); measure.replaceChildren(); }
      if (!fits(block.cloneNode(true) as HTMLElement) && target.children.length && block.tagName !== 'P') {
        const keepPrevious = target.lastElementChild?.matches('[data-keep-next="true"],h1,h2,h3');
        const previous = keepPrevious ? target.lastElementChild as HTMLElement : null;
        if (previous) { previous.remove(); measure.lastElementChild?.remove(); }
        target = makePage();
        measure.replaceChildren();
        if (previous) append(previous);
      }
      if (block.tagName === 'P' && (block.textContent ?? '').length > 0 && !block.querySelector('img') && !fits(block.cloneNode(true) as HTMLElement)) {
        if (target.children.length && target.lastElementChild?.matches('[data-keep-next="true"],h1,h2,h3')) {
          const previous = target.lastElementChild as HTMLElement;
          previous.remove(); target = makePage(); measure.replaceChildren(); append(previous);
        }
        const text = block.textContent ?? '';
        const boundaries = [...text.matchAll(/\s+/g)].map(match => match.index + match[0].length).filter(index => index > 0 && index < text.length);
        boundaries.push(text.length);
        let start = 0;
        while (start < text.length) {
          const candidates = boundaries.filter(index => index > start);
          let low = 0, high = candidates.length - 1, selected = -1;
          while (low <= high) {
            const middle = (low + high) >> 1;
            const part = paragraphPart(block, start, candidates[middle], text.length);
            if (fits(part)) { selected = middle; low = middle + 1; } else high = middle - 1;
          }
          if (selected < 0 && target.children.length) { target = makePage(); measure.replaceChildren(); continue; }
          const end = candidates[Math.max(0, selected)];
          append(paragraphPart(block, start, end, text.length));
          start = end;
          if (start < text.length) { target = makePage(); measure.replaceChildren(); }
        }
      } else append(block);
      if (measuredHeight() > contentHeight + 0.5) target.parentElement?.setAttribute('data-preview-overflow', 'true');
    }
  } finally { scratch.remove(); }
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return pages.map((paper, index) => {
    const footer = document.createElement('div'); footer.className = 'preview-word-footer';
    footer.innerHTML = `<div>${escape(DISCLAIMER_TEXT)}</div><div><em>${escape(EQUIPMENT_TEXT)}</em></div><div class="preview-word-page-number">${index + 1}</div>`;
    paper.append(footer);
    return `<div class="preview-page" style="width:${layout.widthMm}mm"><span class="preview-page-number">Страница ${index + 1}</span>${paper.outerHTML}</div>`;
  }).join('');
}
