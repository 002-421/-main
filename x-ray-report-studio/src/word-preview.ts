import type {RichNode} from './model';
import type {PrintBox} from './print-document';
import {previewPageLayout} from './page-geometry.ts';

const mm = (twips:number) => twips * 25.4 / 1440;
const twips = (value:number) => Math.round(value * 1440 / 25.4);

/** Read-only projection of exportDocx's source-report section, including its printBox. */
export function wordPreviewGeometry(doc:RichNode, box:PrintBox) {
  const original=previewPageLayout(doc), attrs=doc.attrs??{};
  const margin=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=80?mm(twips(value)):mm(1020);
  return {...original,widthMm:mm(twips(original.widthMm)),heightMm:mm(twips(original.heightMm)),
    topMm:mm(twips(original.topMm)),leftMm:margin(attrs.marginLeftMm),rightMm:margin(attrs.marginRightMm),
    bottomMm:mm(Math.max(0,Math.round((original.heightMm-original.topMm)*1440/25.4-box.height*15))),
    fontSizePt:typeof attrs.fontSizePt==='number'&&attrs.fontSizePt>0?attrs.fontSizePt:12};
}

const naturalLines = new Map<string,number>();
function naturalLineHeight(family:string,size:number) {
  const key=JSON.stringify([family,size]),cached=naturalLines.get(key);
  if(cached!==undefined)return cached;
  const probe=document.createElement('div');
  probe.style.cssText='position:fixed;left:-10000px;visibility:hidden;white-space:nowrap;margin:0;padding:0;line-height:normal';
  probe.style.fontFamily=family;probe.style.fontSize=`${size}pt`;
  probe.textContent='ЯуЦg';
  document.body.append(probe);
  const height=probe.getBoundingClientRect().height*72/96;
  probe.remove();
  if(naturalLines.size>=128)naturalLines.clear();
  naturalLines.set(key,height);
  return height;
}

/** Normalize only detached preview DOM. Never writes to the document or export plan. */
export function normalizeWordPreview(root:HTMLElement, doc:RichNode) {
  const attrs=doc.attrs??{}, rootSize=Number(attrs.fontSizePt)||12;
  for(const p of root.querySelectorAll<HTMLElement>('p,h1,h2,h3')) {
    const heading=/^H[1-3]$/.test(p.tagName), level=Number(p.tagName.slice(1));
    const style=p.dataset.sourceStyle||(heading?`Heading${level}`:'Normal');
    const themed=['Title','Subtitle','Heading1','Heading2','Heading3'].includes(style);
    const themedSize:Record<string,number>={Title:21,Subtitle:11,Heading1:11,Heading2:10,Heading3:10};
    const fontSize=Math.round((parseFloat(p.style.fontSize)||(themed?themedSize[style]:rootSize))*2)/2;
    p.style.fontSize=`${fontSize}pt`;
    p.style.fontFamily=p.style.fontFamily||(themed?'Calibri':String(attrs.fontFamily||'Arial'));
    // The source Word styles specify inter-character spacing in twips.
    if(style==='Title'||style==='Subtitle')p.style.letterSpacing=style==='Title'?'0.25pt':'0.75pt';
    const marked=[...p.querySelectorAll<HTMLElement>('[style]')].map(n=>n.style.lineHeight).filter(Boolean)
      .map(value=>parseFloat(value)/(value.endsWith('%')?100:1)).filter(value=>value>=.5&&value<=5);
    const ratio=marked.length?Math.max(...marked):parseFloat(p.style.lineHeight)||(style==='Title'?1:Number(attrs.lineHeight)||1.05);
    // Word AT_LEAST specifies a floor, whereas CSS line-height is fixed.
    // Preserve the OOXML minimum and let the available font's natural line
    // box raise the browser floor so ordinary glyphs are not compressed.
    const minimum=Math.round(fontSize*20*Math.round(ratio*240)/240)/20;
    let natural=naturalLineHeight(p.style.fontFamily,fontSize);
    p.querySelectorAll<HTMLElement>('[style]').forEach(run=>{
      const size=run.style.fontSize;
      if(!size&&!run.style.fontFamily)return;
      const points=size.endsWith('px')?parseFloat(size)*.75:size.endsWith('pt')?parseFloat(size):fontSize;
      const family=run.style.fontFamily||p.style.fontFamily;
      if(points>0&&points<=200){
        natural=Math.max(natural,naturalLineHeight(family,points));
      }
    });
    p.style.lineHeight=`${Math.max(minimum,natural)}pt`;
    p.dataset.wordLineRule='atLeast';
    p.dataset.wordLineMinimumPt=String(minimum);
    p.querySelectorAll<HTMLElement>('[style]').forEach(n=>{if(n.style.lineHeight)n.style.lineHeight='inherit';});
    const pt=(value:string,fallback:number)=>`${value?Math.max(0,Math.round(parseFloat(value)*20)/20):fallback}pt`;
    p.style.marginTop=pt(p.style.marginTop,themed?9:0);
    p.style.marginBottom=pt(p.style.marginBottom,heading?5:Number(attrs.spaceAfterPt)||5);
    p.style.marginLeft=pt(p.style.marginLeft,0);p.style.marginRight=pt(p.style.marginRight,0);
    p.style.textIndent=pt(p.style.textIndent,0);
  }
}
