import type { RichNode } from './model';
import { reviewPlain } from './ai-review.ts';

export function personalDataWarnings(text:string):string[]{
  const found:string[]=[];
  if(/(?:пациент|больн(?:ой|ая)|врач|дата рождения|д\.\s*р\.|паспорт|снилс|полис|адрес|телефон|№\s*(?:исследования|карты|протокола)|(?:исследовани\p{L}*|протокол\p{L}*|ID)\s*(?:№|:)\s*[\p{L}\d-]+)/iu.test(text))found.push('личные или служебные сведения');
  if(/№\s*[\p{L}\d-]{3,}/u.test(text))found.push('номер документа');
  if(/(?<!\d)\d{2}[.\-/]\d{2}[.\-/]\d{4}(?!\d)/u.test(text))found.push('дата');
  if(/(?:\+?7|8)[\s()-]*\d{3}[\s()-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/u.test(text)||/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(text))found.push('контакт');
  if(/(?<!\p{L})[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?(?!\p{L})/u.test(text)||/(?<!\p{L})[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s*[А-ЯЁ]\./u.test(text))found.push('возможное ФИО');
  return found;
}

/** Only confirmed medical sections enter the preview; no header, doctor or image nodes. */
export function medicalTextForCopy(doc:RichNode):string{
  if(doc.type!=='doc'||!Array.isArray(doc.content))throw new Error('Необходимо уточнить границы описания и заключения');
  const sections=doc.content.filter(node=>node.type==='reportSection');
  if(sections.length!==4||sections.map(node=>node.attrs?.id).join('|')!=='header|description|conclusion|signature')throw new Error('Необходимо уточнить границы описания и заключения');
  const body=reviewPlain(sections[1]).trim(),conclusion=reviewPlain(sections[2]).trim();
  if(!body||!conclusion)throw new Error('Необходимо уточнить границы описания и заключения');
  const recommendations:string[]=[];
  for(const node of sections[3].content??[]){
    if(node.type!=='paragraph'&&node.type!=='heading')continue;
    const line=reviewPlain(node).trim();
    if(/^Рекомендации\s*:/iu.test(line))recommendations.push(line.split(/(?<!\p{L})Врач(?:-рентгенолог)?\s*:/iu)[0].trim());
  }
  return `Описание:\n${body}\n\nЗаключение:\n${conclusion}${recommendations.length?`\n\n${recommendations.join('\n')}`:''}`.replace(/&#(?:x20|32);|&nbsp;/giu,' ');
}
