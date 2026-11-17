import { additionalClinicalRules } from './clinical-072.ts';
import type { Finding, ReviewBlocks, ReviewBlockId } from './ai-review.ts';
import { loadMedicalWordRecognizer } from './medical-word-recognition.ts';
import { medicalLexicon } from './medical-lexicon.ts';

export type ImagingModality = 'MRI' | 'CT';
export type TermEntry = { canonical: string; variants: string[]; modality: ImagingModality[]; kind: 'anatomy'|'abbreviation'|'term' };
// Add explicit canonical forms and accepted variants here. Unknown words are never errors.
export const imagingLexicons: Record<ImagingModality, TermEntry[]> = {
  MRI: [
    ...medicalLexicon.map(term=>({canonical:term,variants:[term],modality:['MRI'] as ImagingModality[],kind:'term' as const})),
    ...['головной мозг','лобная доля','теменная доля','височная доля','затылочная доля','мозжечок','гипофиз','позвоночный канал','межпозвонковый диск','коленный сустав','плечевой сустав'].map(term=>({canonical:term,variants:[term],modality:['MRI'] as ImagingModality[],kind:'anatomy' as const})),
    ...['МРТ','МР-томография','T1','T2','FLAIR','DWI','ADC','STIR','ВНЧС','ЦНС','C1','C2','C3','C4','C5','C6','C7','Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12','L1','L2','L3','L4','L5','S1'].map(term=>({canonical:term,variants:[term],modality:['MRI'] as ImagingModality[],kind:'abbreviation' as const})),
  ],
  CT: [
    ...['головной мозг','лобная доля','теменная доля','височная доля','затылочная доля','лёгкое','лёгочная ткань','бронх','печень','селезёнка','поджелудочная железа','почка','аорта','плевра'].map(term=>({canonical:term,variants:[term],modality:['CT'] as ImagingModality[],kind:'anatomy' as const})),
    ...['гиподенсивный','гиперденсивный','остеодеструкция','консолидация'].map(term=>({canonical:term,variants:[term],modality:['CT'] as ImagingModality[],kind:'term' as const})),
    ...['КТ','МСКТ','ВНЧС','ЦНС'].map(term=>({canonical:term,variants:[term],modality:['CT'] as ImagingModality[],kind:'abbreviation' as const})),
  ],
};
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const rx=(s:string)=>new RegExp(`(?<![\\p{L}])${escape(s)}(?![\\p{L}])`,'giu');
function finding(blockId:ReviewBlockId,text:string,start:number,end:number,category:string,explanation:string,related?:string):Finding{
  return {operation:'comment',blockId,original:text.slice(start,end),proposed:'',explanation:related?`${explanation} Связанный фрагмент: «${related}».` : explanation,category,priority:'medium',from:start,to:end,confidence:'limited',meaningRisk:true};
}
type Mention={term:string,start:number,end:number,negated:boolean,modality:'MRI'|'CT'};
function mentions(text:string,modality:'MRI'|'CT'):Mention[]{
  const entries=imagingLexicons[modality];const out:Mention[]=[];
  for(const entry of entries)for(const variant of entry.variants){for(const m of text.matchAll(rx(variant))){const start=m.index!,before=text.slice(Math.max(0,start-45),start);out.push({term:entry.canonical,start,end:start+m[0].length,negated:/(?:не|без|отсутств\p{L}*|не выявлен\p{L}*)\s+(?:[\\p{L}-]+\s+){0,2}$/iu.test(before),modality});}}
  return out.sort((a,b)=>a.start-b.start||b.end-a.end).filter((x,i,all)=>!all.slice(0,i).some(y=>x.start<y.end&&x.end>y.start));
}
function modalityFor(blocks:ReviewBlocks):'MRI'|'CT'|null{const text=`${blocks.description}\n${blocks.conclusion}`;const mri=/(?<!\p{L})(?:МРТ|МР-томограмм|T1|T2|FLAIR|DWI|ADC|STIR)(?!\p{L})/iu.test(text);const ct=/(?<!\p{L})(?:КТ|МСКТ)(?!\p{L})/iu.test(text);return mri===ct?null:mri?'MRI':'CT';}
export class MedicalTerminologyEngine {
  async validate(blocks:ReviewBlocks):Promise<Finding[]>{
    const recognized=await loadMedicalWordRecognizer();
    const modality=modalityFor(blocks);if(!modality)return [];
    const output:Finding[]=[];
    const entries=imagingLexicons[modality];
    const inflections=(term:string)=>{const endings=term.endsWith('ый')?['ая','ое','ые','ого','ому','ым','ом','ую','ой','ых','ыми']:term.endsWith('ий')?['яя','ее','ие','его','ему','им','ем','юю','ей','их','ими']:[];return [term,...endings.map(x=>term.slice(0,-2)+x)].map(x=>x.toLocaleLowerCase('ru-RU'));};
    const known=new Map<string,string>();
    for(const entry of entries)for(const term of [entry.canonical,...entry.variants])for(const form of inflections(term))known.set(form,entry.canonical.toLocaleLowerCase('ru-RU'));
    const distance=(a:string,b:string):number=>{
      const x=[...a.toLocaleLowerCase('ru-RU').replace(/ё/g,'е')],y=[...b.toLocaleLowerCase('ru-RU').replace(/ё/g,'е')];
      if(Math.abs(x.length-y.length)>2)return 3;
      let prev2:number[]|null=null,prev=Array.from({length:y.length+1},(_,i)=>i);
      for(let i=1;i<=x.length;i++){const row=[i];for(let j=1;j<=y.length;j++){let v=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));if(prev2&&i>1&&j>1&&x[i-1]===y[j-2]&&x[i-2]===y[j-1])v=Math.min(v,prev2[j-2]+1);row.push(v);}prev2=prev;prev=row;}
      return prev[y.length];
    };
    const typo=(word:string)=>{const limit=word.length>=13?2:1;let best=limit+1,candidates=new Set<string>();for(const [form,canonical] of known){const d=distance(word,form);if(d<best){best=d;candidates=new Set([canonical]);}else if(d===best)candidates.add(canonical);}return best<=limit&&candidates.size===1?[...candidates][0]:null;};
    for(const blockId of ['description','conclusion'] as const){const text=blocks[blockId];const seen=new Map<string,{form:string,start:number}>();
      for(const entry of imagingLexicons[modality])for(const variant of entry.variants)for(const m of text.matchAll(rx(variant))){const key=entry.canonical.toLocaleLowerCase('ru');const prev=seen.get(key);if(prev&&prev.form!==m[0]&&prev.form.toLocaleLowerCase('ru')!==m[0].toLocaleLowerCase('ru'))output.push(finding(blockId,text,m.index!,m.index!+m[0].length,'terminology',`Непоследовательное написание структуры: «${prev.form}» и «${m[0]}». Проверьте вручную.`));else seen.set(key,{form:m[0],start:m.index!});}
      for(const match of text.matchAll(/[А-Яа-яЁё]+/gu)){const word=match[0];if(recognized(word)||known.has(word.toLocaleLowerCase('ru-RU'))||word.length<8)continue;const candidate=typo(word);if(candidate)output.push(finding(blockId,text,match.index!,match.index!+word.length,'terminology',`Возможно, термин «${word}» является опечаткой зарегистрированного термина «${candidate}». Проверьте вручную.`));}
    }
    // Unknown terms are deliberately not labeled as misspellings.
    return output;
  }
}
const negated=(s:string)=>/(?:экструзи\p{L}*|стеноз\p{L}*|очаг\p{L}*)\s+нет|(?:не\s+(?:выявлен\p{L}*|определя\p{L}*|визуализиру\p{L}*|обнаруж\p{L}*)|отсутств\p{L}*|без\s+(?:очаг\p{L}*|признак\p{L}*|патологическ\p{L}*))/iu.test(s);
function clauses(text:string){const re=/(?:[^.!?\n]|\.(?=\d))+[.!?]?/gu;return [...text.matchAll(re)].map(m=>({text:m[0],start:m.index!}));}
const entity=/(?<!\p{L})(?:очаг\p{L}*|образовани\p{L}*|грыж\p{L}*|протрузи\p{L}*|экструзи\p{L}*|консолидаци\p{L}*|узел\p{L}*|кист\p{L}*|опухол\p{L}*|синовит\p{L}*)(?!\p{L})/iu;
const sidePattern=/(?<!\p{L})(?:справа|слева|правосторонн\p{L}*|левосторонн\p{L}*|прав(?:ый|ого|ому|ым|ом|ая|ой|ую|ое|ые|ых|ыми)|лев(?:ый|ого|ому|ым|ом|ая|ой|ую|ое|ые|ых|ыми))(?!\p{L})/giu;
const side=(s:string)=>{
  const entityMatches=[...s.matchAll(new RegExp(entity.source,'giu'))];
  if(entityMatches.length!==1)return '';
  if(/двусторонн|с обеих сторон/iu.test(s))return '';
  const directions=new Set([...s.matchAll(sidePattern)].map(match=>/^(?:прав|справа)/iu.test(match[0])?'прав':'лев'));
  return directions.size===1?[...directions][0]:'';
};
function dimensions(s:string){return [...s.normalize('NFC').matchAll(/(?<![\p{L}\d])\d+(?:[,.]\d+)?[\u0020\u00a0\u202f]*(?:мм|см)(?!\p{L})|(?<![\p{L}\d])\d+(?:[,.]\d+)?[\u0020\u00a0\u202f]*[×xх][\u0020\u00a0\u202f]*\d+(?:[,.]\d+)?(?:[\u0020\u00a0\u202f]*[×xх][\u0020\u00a0\u202f]*\d+(?:[,.]\d+)?)?[\u0020\u00a0\u202f]*(?:мм|см)?/giu)].map(m=>{const raw=m[0].replace(/[\u0020\u00a0\u202f]/gu,'').replace(/,/g,'.');const unit=/см/iu.test(raw)?10:1;return [...raw.matchAll(/\d+(?:\.\d+)?/gu)].map(n=>String(Number(n[0])*unit)).join('×')+'mm';});}
const level=/\b(C[1-7]|Th(?:1[0-2]|[1-9])|L[1-5])\s*[-–—/]\s*(C[1-7]|Th(?:1[0-2]|[1-9])|L[1-5]|S1|[1-7])\b/giu;
function levels(s:string){return [...s.replace(/С/g,'C').replace(/с/g,'C').matchAll(level)].flatMap(m=>{const left=m[1].toUpperCase(),right=/^\d$/.test(m[2])?left.replace(/\d+$/,'')+m[2]:m[2].toUpperCase();const a=/^([A-Z]+)(\d+)$/.exec(left)!,b=/^([A-Z]+)(\d+)$/.exec(right)!;if(a[1]===b[1]&&+b[2]>+a[2]+1&&+b[2]-+a[2]<=6)return Array.from({length:+b[2]-+a[2]},(_,i)=>`${a[1]}${+a[2]+i}-${a[1]}${+a[2]+i+1}`);return [`${left}-${right}`];});}
type SpineFinding={kind:string;level:string;side:string;start:number;end:number;clause:string};
function spineFindings(text:string):SpineFinding[]{
  const result:SpineFinding[]=[];
  for(const clause of clauses(text)){
    if(negated(clause.text)||/не исключа|вероятн|возможн/iu.test(clause.text))continue;
    const types=[...clause.text.matchAll(/(?<!\p{L})(экструзи\p{L}*|протрузи\p{L}*|стеноз\p{L}*)(?!\p{L})/giu)];
    const sites=[...clause.text.replace(/С/g,'C').replace(/с/g,'C').matchAll(level)];
    if(!types.length||!sites.length)continue;
    for(let i=0;i<types.length;i++){
      const type=types[i],next=types[i+1]?.index??clause.text.length,previous=types[i-1]?.index??-1;
      const before=sites.filter(site=>site.index!<type.index!&&site.index!>previous);
      const after=sites.filter(site=>site.index!>type.index!&&site.index!<next);
      const beforeNear=before.at(-1);
      const assigned=beforeNear&&(!after.length||type.index!-beforeNear.index!<after[0].index!-type.index!)?before:after;
      const kind=/^экструзи/iu.test(type[0])?'extrusion':/^протрузи/iu.test(type[0])?'protrusion':'stenosis';
      for(const site of assigned){for(const normalized of levels(site[0])){
        result.push({kind,level:normalized,side:side(clause.text),start:clause.start+site.index!,end:clause.start+site.index!+site[0].length,clause:clause.text.trim()});}
      }
    }
  }
  return result;
}
const anatomy=/(?:лобн\p{L}*|теменн\p{L}*|височн\p{L}*|затылочн\p{L}*|мозжечк\p{L}*|ствол\p{L}*|талам\p{L}*|желудоч\p{L}*|гиппокамп\p{L}*|базальн\p{L}*|оболоч\p{L}*|пазух\p{L}*|артери\p{L}*|венозн\p{L}*|гипофиз\p{L}*|печен\p{L}*|селезенк\p{L}*|легк\p{L}*|почк\p{L}*|плевр\p{L}*|коленн\p{L}*|плечев\p{L}*)/iu;
function entityKey(s:string){const raw=entity.exec(s)?.[0]?.toLocaleLowerCase('ru')??'';const e=/^(?:очаг|образовани|грыж|протрузи|экструзи|консолидаци|узел|кист|опухол|синовит)/u.exec(raw)?.[0]??raw;const a=anatomy.exec(s)?.[0]?.toLocaleLowerCase('ru')??'';return `${e}:${a}:${side(s)}`;}
const explicitAnatomyForms=new Map<string,string>();
for(const [canonical,forms] of [
  ['lung',['легкое','легкого','легкому','легким','легком','легкие','легких','легкими','лёгкое','лёгкого','лёгкому','лёгким','лёгком','лёгкие','лёгких','лёгкими']],
  ['spleen',['селезенка','селезенки','селезенке','селезенку','селезенкой','селезенкою']],
  ['pleura',['плевра','плевры','плевре','плевру','плеврой','плеврою']],
  ['kidney',['почка','почки','почке','почку','почкой','почкою','почек','почках']],
] as const)for(const form of forms)explicitAnatomyForms.set(form,canonical);
const anatomicalIdentity=(text:string)=>{
  const match=/(?:лобн\p{L}*|теменн\p{L}*|височн\p{L}*|затылочн\p{L}*|мозжечк\p{L}*|ствол\p{L}*|талам\p{L}*|желудоч\p{L}*|гиппокамп\p{L}*|базальн\p{L}*|оболоч\p{L}*|пазух\p{L}*|артери\p{L}*|венозн\p{L}*|гипофиз\p{L}*|печен\p{L}*|селезенк\p{L}*|легк\p{L}*|почк\p{L}*|плевр\p{L}*|коленн\p{L}*|плечев\p{L}*|шейн\p{L}*|грудн\p{L}*|поясничн\p{L}*)/iu.exec(text)?.[0]?.toLocaleLowerCase('ru').replace(/ё/g,'е')??'';
  return explicitAnatomyForms.get(match)??(/^(лобн|теменн|височн|затылочн|мозжечк|гипофиз|ствол|талам|желудоч|гиппокамп|базальн|оболоч|пазух|артери|венозн)/u.exec(match)?.[0]??match);
};
export class ClinicalConsistencyEngine {
  validate(blocks:ReviewBlocks):Finding[]{const out:Finding[]=[];const a=clauses(blocks.description),b=clauses(blocks.conclusion);
    const described=spineFindings(blocks.description),concluded=spineFindings(blocks.conclusion);
    for(const found of concluded){
      if(described.some(x=>x.kind===found.kind&&x.level===found.level))continue;
      if(!described.length)continue;
      out.push(finding('conclusion',blocks.conclusion,found.start,found.end,'consistency',`В заключении указана ${found.kind==='extrusion'?'экструзия':found.kind==='protrusion'?'протрузия':'стеноз'} ${found.level}, отсутствующая в описании. Проверьте уровень и тип изменения.`,(described.find(x=>x.kind===found.kind)??described[0]).clause));
    }
    for(const found of described){
      if(concluded.some(x=>x.kind===found.kind&&x.level===found.level))continue;
      const related=concluded.find(x=>x.kind===found.kind)??concluded[0];if(!related)continue;
      out.push(finding('conclusion',blocks.conclusion,related.start,related.end,'consistency',`В описании присутствует ${found.kind==='extrusion'?'экструзия':found.kind==='protrusion'?'протрузия':'стеноз'} ${found.level}, не отражённая в заключении. Проверьте уровень и тип изменения.`,found.clause));
    }
    for(const left of a){if(!entity.test(left.text))continue;const key=entityKey(left.text).split(':').slice(0,2).join(':');const leftCandidates=a.filter(item=>entity.test(item.text)&&entityKey(item.text).split(':').slice(0,2).join(':')===key);const related=b.filter(right=>entity.test(right.text)&&entityKey(right.text).split(':').slice(0,2).join(':')===key);if(leftCandidates.length!==1||related.length!==1)continue;
      for(const right of related){const ls=side(left.text),rs=side(right.text);if(!negated(left.text)&&!negated(right.text)&&ls&&rs&&((/прав|справа/u.test(ls))!==(/прав|справа/u.test(rs))))out.push(finding('conclusion',blocks.conclusion,right.start,right.start+right.text.length,'consistency','Возможное расхождение стороны для сходной находки.',left.text.trim()));
        const ll=levels(left.text),rl=levels(right.text);if(!negated(left.text)&&!negated(right.text)&&ll.length===1&&rl.length===1&&ll[0]!==rl[0])out.push(finding('conclusion',blocks.conclusion,right.start,right.start+right.text.length,'consistency','Возможное расхождение уровня позвоночника.',left.text.trim()));
        const ld=dimensions(left.text),rd=dimensions(right.text);if(ld.length===1&&rd.length===1&&ld[0]!==rd[0])out.push(finding('conclusion',blocks.conclusion,right.start,right.start+right.text.length,'consistency','Возможное расхождение размеров для сходной находки.',left.text.trim()));
      }
    }
    return out;
  }
}
export class ClinicalLogicEngine {
  validate(blocks:ReviewBlocks):Finding[]{
    const out:Finding[]=additionalClinicalRules(blocks);
    const uncertain=/(?:не исключа|возможн|вероятн|предполож|может соответств|без отрицательной динамики|ранее|предыдущ|в динамике|по сравнению)/iu;
    const pathology=(s:string)=>{const m=/(грыж\p{L}*|протрузи\p{L}*|экструзи\p{L}*|очаг\p{L}*|образовани\p{L}*|кист\p{L}*|узел\p{L}*|консолидаци\p{L}*|опухол\p{L}*|синовит\p{L}*)/iu.exec(s);if(!m)return '';const v=m[0].toLocaleLowerCase('ru');return v.startsWith('грыж')?'грыжа':v.startsWith('протрузи')?'протрузия':v.startsWith('экструзи')?'экструзия':v.startsWith('очаг')?'очаг':v.startsWith('образовани')?'образование':v.startsWith('кист')?'киста':v.startsWith('узел')?'узел':v.startsWith('консолидаци')?'консолидация':'опухоль';};
    const explicit=(s:string)=>/(?:определя\p{L}*|выявл\p{L}*|визуализиру\p{L}*|обнаруж\p{L}*|имеется|налич\p{L}*)/iu.test(s)&&!negated(s);
    const desc=clauses(blocks.description),concl=clauses(blocks.conclusion);
    for(const d of desc)for(const c of concl){
      if(uncertain.test(`${d.text} ${c.text}`))continue;
      const dl=levels(d.text),cl=levels(c.text);
      if(dl.length>1||cl.length>1||(dl.length&&cl.length&&dl[0]!==cl[0]))continue;
      const noStenosis=/позвоночн\p{L}* канал\p{L}*[^.!?]*не сужен/iu.test(d.text);
      const hasStenosis=/стеноз\p{L}* позвоночн\p{L}* канал/iu.test(c.text)&&!negated(c.text);
      const noHernia=/грыж\p{L}*[^.!?]*не выявлен/iu.test(d.text);
      const hasExtrusion=/экструзи\p{L}*/iu.test(c.text)&&!negated(c.text);
      if((noStenosis&&hasStenosis&&!out.some(x=>x.explanation.startsWith('Противоречие по стенозу')))||(noHernia&&hasExtrusion))out.push(finding('conclusion',blocks.conclusion,c.start,c.start+c.text.length,'clinical','Возможное противоречие: описание отрицает изменение, указанное в заключении.',d.text.trim()));
    }

    for(const [blockId,text,cs] of [['description',blocks.description,desc],['conclusion',blocks.conclusion,concl]] as const){
      for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){const x=cs[i],y=cs[j];if(!entity.test(x.text)||!entity.test(y.text)||uncertain.test(`${x.text} ${y.text}`))continue;const kx=entityKey(x.text),ky=entityKey(y.text);if(kx.split(':')[0]!==ky.split(':')[0]||kx.split(':')[1]!==ky.split(':')[1]||pathology(x.text)!==pathology(y.text))continue;if(side(x.text)&&side(y.text)&&side(x.text)!==side(y.text))continue;if(negated(x.text)===negated(y.text))continue;out.push(finding(blockId,text,y.start,y.start+y.text.length,'clinical','Возможны несовместимые утверждения о наличии одной и той же находки.',x.text.trim()));}
    }
    for(const d of desc)for(const c of concl){const type=pathology(d.text);if(!type||type!==pathology(c.text)||uncertain.test(`${d.text} ${c.text}`))continue;if(negated(d.text)===negated(c.text))continue;if((!explicit(d.text)&&!negated(d.text))||(!explicit(c.text)&&!negated(c.text)))continue;
      const da=anatomicalIdentity(d.text),ca=anatomicalIdentity(c.text);if(da&&ca&&da!==ca)continue;
      const spineRegion=(s:string)=>/шейн/iu.test(s)?'cervical':/грудн/iu.test(s)?'thoracic':/поясничн/iu.test(s)?'lumbar':'';
      const regionSide=spineRegion(da||ca);const explicitLevels=[...levels(d.text),...levels(c.text)];if(regionSide&&explicitLevels.some(value=>regionSide==='cervical'?!/^C/u.test(value):regionSide==='thoracic'?!/^TH/u.test(value):!/^L/u.test(value)))continue;
      const ds=side(d.text),cs=side(c.text);if(ds&&cs&&((/прав|справа/u.test(ds))!==(/прав|справа/u.test(cs))))continue;
      const dl=levels(d.text),cl=levels(c.text);if(dl.length>1||cl.length>1||(dl.length>0&&cl.length>0&&dl[0]!==cl[0]))continue;
      const dd=dimensions(d.text),cd=dimensions(c.text);if(dd.length&&cd.length&&dd.join('|')!==cd.join('|'))continue;
      out.push(finding('conclusion',blocks.conclusion,c.start,c.start+c.text.length,'clinical','Описание и заключение по-разному указывают наличие одной и той же находки.',d.text.trim()));
    }
    return out;
  }
}
