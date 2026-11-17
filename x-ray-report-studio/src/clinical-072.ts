import type { Finding, ReviewBlocks } from './ai-review.ts';
// Conservative single-finding comparisons. Ambiguous multi-finding clauses are skipped.
const sentence=(text:string)=>[...text.matchAll(/(?:[^.!?\n]|\.(?=\d))+[.!?]?/gu)].map(m=>({text:m[0],start:m.index!}));
const uncertain=/(?:возможн|вероятн|ранее|не исключ|на остальных уровнях)/iu;
const anatomy=(s:string)=>{
 const matches=[...s.matchAll(/лобн\p{L}*|теменн\p{L}*|височн\p{L}*|затылочн\p{L}*|мозжеч\p{L}*|ствол\p{L}*|базальн\p{L}*|талам\p{L}*|желудоч\p{L}*|гиппокамп\p{L}*|оболоч\p{L}*|пазух\p{L}*|артери\p{L}*|венозн\p{L}*|тазобедренн\p{L}*/giu)];
 const keys=[...new Set(matches.map(m=>/^(лобн|теменн|височн|затылочн|мозжеч|ствол|базальн|талам|желудоч|гиппокамп|оболоч|пазух|артери|венозн|тазобедренн)/iu.exec(m[0])![0].toLowerCase()))];return keys.length===1?keys[0]:keys.length?'ambiguous':'';
};
const kinds=(s:string)=>[...s.matchAll(/(?<!\p{L})(очаг\p{L}*|синовит\p{L}*|стеноз\p{L}*|экструзи\p{L}*)(?!\p{L})/giu)];
const kind=(s:string)=>kinds(s).length===1?/^(очаг|синовит|стеноз|экструзи)/iu.exec(kinds(s)[0][0])![0].toLowerCase():'';
const normalizedLevels=(s:string)=>[...s.replace(/С/g,'C').replace(/с/g,'C').matchAll(/\b(C[1-7]|L[1-5])\s*[-–/]\s*(C[1-7]|L[1-5]|S1|[1-7])\b/giu)].map(m=>m[1].toUpperCase()+'-'+(/^\d$/.test(m[2])?m[1][0].toUpperCase()+m[2]:m[2].toUpperCase()));
const deny=(s:string)=>/(?:не\s+(?:выявлен\p{L}*|определя\p{L}*|расширен\p{L}*|сужен\p{L}*|накаплива\p{L}*)|(?:очаг\p{L}*|экструзи\p{L}*|стеноз\p{L}*)\s+нет|без\s+(?:очаг\p{L}*|стеноз\p{L}*))/iu.test(s);
function comment(blockId:string,text:string,start:number,length:number,explanation:string,related:string):Finding{return {blockId,operation:'comment',original:text.slice(start,start+length),proposed:'',from:start,to:start+length,category:'clinical',priority:'medium',confidence:'limited',meaningRisk:true,explanation,related};}
export function additionalClinicalRules(blocks:ReviewBlocks):Finding[]{
 const out:Finding[]=[],d=sentence(blocks.description),c=sentence(blocks.conclusion);
 // One consolidated warning for all explicitly named stenoses and the global denial.
 const stenoses=d.filter(x=>!deny(x.text)&&!uncertain.test(x.text)&&/стеноз/iu.test(x.text)&&normalizedLevels(x.text).length);
 const denial=d.find(x=>!uncertain.test(x.text)&&/позвоночн\p{L}*\s+канал\p{L}*[^.!?]*не сужен/iu.test(x.text)&&!normalizedLevels(x.text).length);
 if(stenoses.length&&denial){const levels=[...new Set(stenoses.flatMap(x=>normalizedLevels(x.text)))];out.push(comment('description',blocks.description,denial.start,denial.text.length,`Противоречие по стенозу ${levels.join(', ')}.`,[...stenoses.map(x=>x.text.trim()),denial.text.trim()].join(' ↔ ')));}
 // Brain localization: compare only an unambiguous unique focus of matching kind.
 const dl=d.filter(x=>kind(x.text)==='очаг'),cl=c.filter(x=>kind(x.text)==='очаг');
 if(dl.length===1&&cl.length===1){const a=dl[0],b=cl[0],aa=anatomy(a.text),ba=anatomy(b.text);if(aa&&ba&&aa!=='ambiguous'&&ba!=='ambiguous'&&aa!==ba&&!deny(a.text)&&!deny(b.text)&&!uncertain.test(a.text+b.text))out.push({...comment('conclusion',blocks.conclusion,b.start,b.text.length,'Возможное расхождение локализации единственного очага.',a.text.trim()),category:'consistency'});}
 // Specific properties, never compare cord deformation to signal intensity.
 for(const [pattern,explanation] of [[/стеноз/iu,'Описание и заключение расходятся по наличию стеноза.'],[/желудоч\p{L}*[^.!?]*расширен/iu,'Описание и заключение расходятся по расширению желудочков.'],[/накаплива\p{L}*\s+контраст|контраст[^.!?]*накаплива/iu,'Описание и заключение расходятся по накоплению контраста.']] as const){
  const a=d.filter(x=>pattern.test(x.text)),b=c.filter(x=>pattern.test(x.text));if(a.length!==1||b.length!==1)continue;
  const al=normalizedLevels(a[0].text),bl=normalizedLevels(b[0].text);if(al.length&&bl.length&&!al.some(x=>bl.includes(x)))continue;
  const aa=anatomy(a[0].text),ba=anatomy(b[0].text);if(aa&&ba&&aa!==ba||uncertain.test(a[0].text+b[0].text)||deny(a[0].text)===deny(b[0].text))continue;
  out.push(comment('conclusion',blocks.conclusion,b[0].start,b[0].text.length,explanation,a[0].text.trim()));
 }
 const terminologies=d.filter(x=>/пролабирован/iu.test(x.text));
 for(const t of terminologies){const ls=normalizedLevels(t.text);if(ls.length!==1)continue;const e=d.find(x=>/экструзи/iu.test(x.text)&&!deny(x.text)&&normalizedLevels(x.text).includes(ls[0]));if(e)out.push({...comment('description',blocks.description,t.start,t.text.length,`Уточните терминологию дискового изменения ${ls[0]}.`,e.text.trim()),priority:'low'});}
 return out;
}
