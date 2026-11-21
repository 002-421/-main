import {capacity, calibratedCapacity, calibratedWidth, widthCapacity, type PreviewCalibration} from './preview-calibration.ts';
import type { PrintBox } from './print-document.ts';
import type { RichNode } from './model';
import { DISCLAIMER_TEXT, EQUIPMENT_TEXT } from './report-footer.ts';

export { previewPageLayout } from './page-geometry.ts';
import { previewPageLayout } from './page-geometry.ts';
import {wordPreviewGeometry,normalizeWordPreview} from './word-preview.ts';

/** The same footer measurement supplies preview and print-only object bounds. */
function createMeasurement(doc: RichNode, wordBox?:PrintBox, wrapWidth?:number) {
  const layout = wordBox?wordPreviewGeometry(doc,wordBox):previewPageLayout(doc);
  const css = [layout.widthMm, layout.heightMm, layout.topMm, layout.bottomMm, layout.leftMm, layout.rightMm]
    .map((value, index) => `--preview-${['width', 'height', 'top', 'bottom', 'left', 'right'][index]}:${value}mm`).join(';') + `;--preview-font-size:${layout.fontSizePt}pt` + (wrapWidth===undefined?'':`;--preview-wrap-width:${wrapWidth}px`);
  const scratch = document.createElement('article');
  scratch.className = 'export-preview-paper preview-measure'+(wordBox?' word-reference-preview':'');
  scratch.style.cssText = css;
  const measure = document.createElement('div');
  measure.className = 'report-content';
  measure.style.fontFamily = layout.fontFamily;
  if(wordBox)measure.style.lineHeight=String(Number(doc.attrs?.lineHeight)||1.05);
  scratch.append(measure);
  document.body.append(scratch);
  const footerProbe = document.createElement('div');
  footerProbe.className = 'preview-word-footer';
  if(wordBox)footerProbe.style.fontFamily=layout.fontFamily;
  const disclaimer=document.createElement('div'),equipment=document.createElement('div'),emphasis=document.createElement('em'),pageNumber=document.createElement('div');
  disclaimer.textContent=DISCLAIMER_TEXT;
  emphasis.textContent=EQUIPMENT_TEXT;equipment.append(emphasis);
  pageNumber.className='preview-word-page-number';pageNumber.textContent='1';
  if(wordBox)pageNumber.style.fontSize=`${layout.fontSizePt}pt`;
  footerProbe.append(disclaimer,equipment,pageNumber);
  scratch.append(footerProbe);
  const scale = scratch.getBoundingClientRect().width / scratch.offsetWidth || 1;
  const footerReserve = 6.5 * 96 / 25.4 + footerProbe.getBoundingClientRect().height / scale + 3 * 96 / 25.4;
  const bottom = Math.max(layout.bottomMm * 96 / 25.4, footerReserve);
  const contentHeight = (layout.heightMm - layout.topMm) * 96 / 25.4 - bottom;
  const effectiveCss = css + `;--preview-bottom:${bottom}px`;

  return {scratch, measure, scale, layout, contentHeight, effectiveCss, footerHeight:footerProbe.getBoundingClientRect().height/scale};
}
export function measurePrintBox(doc: RichNode): PrintBox {
  const box = createMeasurement(doc);
  try {
    const image=document.createElement('img');box.measure.append(image);
    const style=getComputedStyle(image),margin=(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);
    return {width:box.measure.getBoundingClientRect().width/box.scale,height:box.contentHeight-2,imageHeight:box.contentHeight-margin-2};
  }
  finally { box.scratch.remove(); }
}

/** Calibrate only the break calculation, without moving paper margins or footer. */
export function measurePreviewCapacity(doc:RichNode,wordBox?:PrintBox) {
  const box=createMeasurement(doc,wordBox);
  try {
    const probe=document.createElement('p');probe.textContent='Аа';
    const line=typeof doc.attrs?.lineHeight==='number'&&doc.attrs.lineHeight>0?doc.attrs.lineHeight:1.05;
    probe.style.cssText='margin:0;padding:0';
    probe.style.fontFamily=box.layout.fontFamily;probe.style.fontSize=`${box.layout.fontSizePt}pt`;probe.style.lineHeight=String(line);
    box.measure.append(probe);
    if(wordBox)normalizeWordPreview(box.measure,doc);
    const lineHeight=probe.getBoundingClientRect().height/box.scale;
    const maximum=Math.max(box.contentHeight,Math.min((box.layout.heightMm-box.layout.topMm-box.layout.bottomMm)*96/25.4,(box.layout.heightMm-box.layout.topMm-6.5)*96/25.4-box.footerHeight-1));
    return capacity(box.contentHeight,maximum,lineHeight);
  } finally {box.scratch.remove();}
}

export function measurePreviewWidth(doc:RichNode,wordBox?:PrintBox) {
 const box=createMeasurement(doc,wordBox);
 try {
  const standard=box.measure.getBoundingClientRect().width/box.scale;
  const maximum=Math.max(standard,(box.layout.widthMm-box.layout.leftMm-5)*96/25.4);
  return widthCapacity(standard,maximum);
 } finally {box.scratch.remove();}
}

export function paginateBrowserPreview(html: string, doc: RichNode, calibration?:PreviewCalibration, wordBox?:PrintBox): string {
  const source = document.createElement('div');
  source.innerHTML = html;
  if(wordBox)normalizeWordPreview(source,doc);
  const blocks: HTMLElement[] = [];
  const collect = (node: Element) => {
    if (node.matches('section[data-report-section]')) { [...node.children].forEach(collect); return; }
    // Tiptap wraps resizable tables in a scrolling view, which is not a print block.
    if (node.matches('.tableWrapper') && node.querySelector(':scope > table')) {
      const table=node.querySelector(':scope > table')!;
      for(const attr of ['data-last-description','data-conclusion-body','data-keep-next']){
        if(node.hasAttribute(attr))table.setAttribute(attr,node.getAttribute(attr)!);
      }
      collect(table);return;
    }
    blocks.push(node.cloneNode(true) as HTMLElement);
  };
  [...source.children].forEach(collect);
  const adjusted=calibration?.enabled?calibratedCapacity(measurePreviewCapacity(doc,wordBox),calibration):undefined;
  const width=calibration?.widthOffsetMm?calibratedWidth(measurePreviewWidth(doc,wordBox),calibration).width:undefined;
  const {scratch, measure, scale, layout, contentHeight:standardHeight, effectiveCss} = createMeasurement(doc,wordBox,width);
  const contentHeight=adjusted?.height??standardHeight;

  const pages: HTMLElement[] = [];
  const makePage = () => { const paper = document.createElement('article'); paper.className = 'export-preview-paper'+(wordBox?' word-reference-preview':''); paper.style.cssText = effectiveCss; const content = document.createElement('div'); content.className = 'report-content'; content.style.fontFamily = layout.fontFamily; if(wordBox)content.style.lineHeight=String(Number(doc.attrs?.lineHeight)||1.05); paper.append(content); pages.push(paper); return content; };
  let target = makePage();
  const measuredHeight = () => {
    const top = measure.getBoundingClientRect().top;
    return Math.max(measure.getBoundingClientRect().height, ...[...measure.querySelectorAll('*')].map(n => n.getBoundingClientRect().bottom - top)) / scale;
  };
  const withinWidth=()=>{const box=measure.getBoundingClientRect();return [...measure.querySelectorAll('*')].every(element=>{const rect=element.getBoundingClientRect();return rect.width===0&&rect.height===0||rect.right<=box.right+1;});};
  const fits = (node: HTMLElement) => { measure.append(node); const fits = measuredHeight() <= contentHeight - 0.5&&withinWidth(); node.remove(); return fits; };
  const fitsOnEmptyPage=(nodes:HTMLElement[])=>{
    const saved=[...measure.childNodes];
    try{measure.replaceChildren(...nodes.map(node=>node.cloneNode(true)));return measuredHeight()<=contentHeight-.5&&withinWidth();}
    finally{measure.replaceChildren(...saved);}
  };
  const append = (node: HTMLElement) => {
    const copy = node.cloneNode(true) as HTMLElement;
    measure.append(copy);
    if(!withinWidth())throw new Error('Объект превышает ширину печатной области; текст не уменьшен и не обрезан.');
    if (measuredHeight() > contentHeight) throw new Error('Неделимый блок превышает высоту страницы. Текст не уменьшен и не обрезан. Разделите строку таблицы или уменьшите графический объект.');
    target.append(node);
  };
  const lineCount=(part:HTMLElement)=>{
    measure.append(part);const range=document.createRange();range.selectNodeContents(part);
    const rows:{top:number;bottom:number}[]=[];
    for(const rect of [...range.getClientRects()].filter(r=>r.width>.1&&r.height>.1).sort((a,b)=>a.top-b.top)){
      const row=rows.find(row=>Math.min(row.bottom,rect.bottom)-Math.max(row.top,rect.top)>Math.min(row.bottom-row.top,rect.height)*.5);
      if(row){row.top=Math.min(row.top,rect.top);row.bottom=Math.max(row.bottom,rect.bottom);}else rows.push({top:rect.top,bottom:rect.bottom});
    }
    part.remove();return rows.length;
  };
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
    if (start) {
      part.classList.add('preview-paragraph-continuation');
      part.removeAttribute('data-conclusion-start');
      part.removeAttribute('data-conclusion-body');
    }
    if (end < total) {
      part.classList.add('preview-paragraph-fragment');
      part.removeAttribute('data-last-description');
      part.removeAttribute('data-keep-next');
    }
    return part;
  };
  const nextPage=()=>{target=makePage();measure.replaceChildren();};
  const keepsNext=(node:Element)=>node.matches('[data-keep-next="true"],h1:not([data-keep-next="false"]),h2:not([data-keep-next="false"]),h3:not([data-keep-next="false"])');
  const breakpoints=(text:string)=>[...text.matchAll(/\s+/g)].map(match=>match.index+match[0].length).filter(at=>at>0&&at<text.length).concat(text.length);
  const firstConclusionLines=(block:HTMLElement)=>{
    const text=block.textContent??'';
    if(!block.matches('p[data-conclusion-body="true"]')||!text||block.querySelector('img'))return block;
    const breaks=breakpoints(text);
    let low=0,high=breaks.length-1;
    while(low<high){
      const middle=(low+high)>>1;
      if(lineCount(paragraphPart(block,0,breaks[middle],text.length))>=2)high=middle;else low=middle+1;
    }
    const end=breaks[low];
    // A one-line remainder would require keeping the whole short paragraph.
    return end<text.length&&lineCount(paragraphPart(block,end,text.length,text.length))>=2
      ? paragraphPart(block,0,end,text.length) : block;
  };
  const moveChain=(follower:HTMLElement,canSplit=false)=>{
    const chain:HTMLElement[]=[];
    let previous=target.lastElementChild;
    while(previous&&keepsNext(previous)){
      chain.unshift(previous as HTMLElement);
      previous=previous.previousElementSibling;
    }
    if(!chain.length){nextPage();return;}
    const prefix=canSplit?firstConclusionLines(follower):follower;
    let start=0;
    if(wordBox){
      // Earlier description may stay on its page if the entire group cannot
      // fit. A standalone conclusion heading and its start are inseparable.
      while(start<chain.length&&!fitsOnEmptyPage([...chain.slice(start),prefix])){
        if(chain[start].hasAttribute('data-keep-conclusion'))throw new Error('Заголовок заключения и его начало не помещаются вместе в выбранной области печати.');
        start++;
      }
    }
    const moving=chain.slice(start);
    for(const block of [...moving].reverse()){block.remove();measure.lastElementChild?.remove();}
    if(target.children.length)nextPage();else measure.replaceChildren();
    moving.forEach(append);
  };
  try {
    for (const block of blocks) {
      if(block.tagName==='TABLE'){
        const rows=[...block.querySelectorAll(':scope > thead > tr,:scope > tbody > tr,:scope > tfoot > tr,:scope > tr')];
        if(rows.some(row=>row.querySelector('[rowspan]:not([rowspan="1"])'))&&!fits(block.cloneNode(true) as HTMLElement))throw new Error('Таблица с объединёнными строками не помещается на страницу; безопасный перенос требует разделения таблицы.');
        let piece=block.cloneNode(true) as HTMLElement;piece.querySelectorAll('tr').forEach(row=>row.remove());
        const addRow=(table:HTMLElement,row:Element)=>{const body=table.querySelector('tbody')??table;body.append(row.cloneNode(true));};
        for(const row of rows){const candidate=piece.cloneNode(true) as HTMLElement;addRow(candidate,row);
          if(!fits(candidate)&&piece.querySelector('tr')){append(piece);target=makePage();measure.replaceChildren();piece=block.cloneNode(true) as HTMLElement;piece.querySelectorAll('tr').forEach(r=>r.remove());}
          else if(!fits(candidate)&&target.children.length){moveChain(candidate);}
          addRow(piece,row);
          if(!fits(piece.cloneNode(true) as HTMLElement))throw new Error('Строка таблицы выше печатной страницы; содержимое не обрезано.');
        }
        if(rows.length){if(/^\s*ЗАКЛЮЧЕНИЕ\s*[.:]/iu.test(blocks[blocks.indexOf(block)+1]?.textContent??''))piece.setAttribute('data-keep-next','true');append(piece);}continue;
      }
      // The Word exporter preserves explicit page breaks and keep-with-next.
      if (block.hasAttribute('data-page-break-before') && target.children.length) { target = makePage(); measure.replaceChildren(); }
      const canSplit=block.tagName==='P'&&Boolean(block.textContent?.length)&&!block.querySelector('img');
      const overflows=!fits(block.cloneNode(true) as HTMLElement);
      if(overflows&&target.children.length){
        const last=target.lastElementChild;
        if(!canSplit||last&&keepsNext(last)){
          // A long conclusion can begin here if its two-line prefix fits.
          // Its continuation alone is not a reason to move the entire group.
          const bodyPrefix=canSplit&&block.hasAttribute('data-conclusion-body')?firstConclusionLines(block):null;
          if(!bodyPrefix||!fits(bodyPrefix.cloneNode(true) as HTMLElement))moveChain(block,canSplit);
        }
      }
      if (canSplit && !fits(block.cloneNode(true) as HTMLElement)) {
        const text = block.textContent ?? '';
        const boundaries = breakpoints(text);
        let start = 0;
        while (start < text.length) {
          const candidates = boundaries.filter(index => index > start);
          let low = 0, high = candidates.length - 1, selected = -1;
          while (low <= high) {
            const middle = (low + high) >> 1;
            const part = paragraphPart(block, start, candidates[middle], text.length);
            if (fits(part)) { selected = middle; low = middle + 1; } else high = middle - 1;
          }
          if (selected < 0 && target.children.length) {
            if(target.lastElementChild?.hasAttribute('data-keep-conclusion'))throw new Error('Начало заключения не помещается с заголовком.');
            nextPage();continue;
          }
          if(wordBox&&selected>=0&&candidates[selected]<text.length){
            let headLines=lineCount(paragraphPart(block,start,candidates[selected],text.length));
            // Match Word widowControl: do not strand one visual line on either page.
            if(headLines<2&&target.children.length){if(target.lastElementChild?.hasAttribute('data-keep-conclusion'))throw new Error('Начало заключения не помещается с заголовком.');nextPage();continue;}
            if(lineCount(paragraphPart(block,candidates[selected],text.length,text.length))<2){
              const wanted=headLines-1;let lo=0,hi=selected,best=-1;
              while(lo<=hi){const mid=(lo+hi)>>1;
                if(lineCount(paragraphPart(block,start,candidates[mid],text.length))<=wanted){best=mid;lo=mid+1;}else hi=mid-1;
              }
              if(best>=0&&lineCount(paragraphPart(block,start,candidates[best],text.length))>=2)selected=best;
              else if(target.children.length){if(target.lastElementChild?.hasAttribute('data-keep-conclusion'))throw new Error('Начало заключения не помещается с заголовком.');nextPage();continue;}
            }
          }
          const end = candidates[Math.max(0, selected)];
          append(paragraphPart(block, start, end, text.length));
          start = end;
          if (start < text.length) { target = makePage(); measure.replaceChildren(); }
        }
      } else append(block);
      if (measuredHeight() > contentHeight - 0.5) target.parentElement?.setAttribute('data-preview-overflow', 'true');
    }
  } finally { scratch.remove(); }
  const heading=pages.find(page=>page.querySelector('[data-keep-conclusion][data-conclusion-start]'));
  if(heading&&!heading.querySelector('[data-conclusion-body]'))throw new Error('Начало заключения не помещается с заголовком.');
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  return pages.map((paper, index) => {
    const footer = document.createElement('div'); footer.className = 'preview-word-footer';
    if(wordBox)footer.style.fontFamily=layout.fontFamily;
    footer.innerHTML = `<div>${escape(DISCLAIMER_TEXT)}</div><div><em>${escape(EQUIPMENT_TEXT)}</em></div><div class="preview-word-page-number">${index + 1}</div>`;
    if(wordBox)(footer.lastElementChild as HTMLElement).style.fontSize=`${layout.fontSizePt}pt`;
    paper.append(footer);
    return `<div class="preview-page" style="width:${layout.widthMm}mm"><span class="preview-page-number">Страница ${index + 1}</span>${paper.outerHTML}</div>`;
  }).join('');
}
