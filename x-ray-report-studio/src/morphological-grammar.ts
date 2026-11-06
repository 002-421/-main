import {loadMorphology, type MorphParse, type MorphTag} from './morphology-loader.ts';
import type {ProofIssue} from './proofreading-core';

type Token={word:string;start:number;end:number;parses:MorphParse[]};
const cache=new Map<string,MorphParse[]>();
const attr=(tag:MorphTag,key:string)=>typeof tag[key]==='string'?String(tag[key]):'';
const canonicalCase=(value:string)=>({gen1:'gent',gen2:'gent',loc1:'loct',loc2:'loct',acc2:'accs'}[value]??value);
function agrees(a:MorphTag,b:MorphTag,withCase=true) {
  const n1=attr(a,'NMbr'),n2=attr(b,'NMbr');
  if(n1&&n2&&n1!==n2)return false;
  if(n1!=='plur'&&n2!=='plur'){
    const g1=attr(a,'GNdr'),g2=attr(b,'GNdr');
    if(g1&&g2&&g1!==g2&&g1!=='ms-f'&&g2!=='ms-f')return false;
  }
  const c1=canonicalCase(attr(a,'CAse')),c2=canonicalCase(attr(b,'CAse'));
  return !withCase||!c1||!c2||c1===c2;
}
const kinds=(token:Token,...pos:string[])=>token.parses.filter(p=>pos.includes(attr(p.tag,'POS')));
const modifier=(token:Token)=>kinds(token,'ADJF','PRTF');
const predicates=(token:Token)=>kinds(token,'VERB','ADJS','PRTS');
const matches=(left:MorphParse[],right:MorphParse[],withCase=true)=>left.some(a=>right.some(b=>agrees(a.tag,b.tag,withCase)));
const caseLike=(word:string,source:string)=>source===source.toLocaleUpperCase('ru')?word.toLocaleUpperCase('ru'):/^[А-ЯЁ]/u.test(source)?word[0].toLocaleUpperCase('ru')+word.slice(1):word;
function forms(parses:MorphParse[],targets:MorphParse[],withCase=true){
  const values:string[]=[];
  for(const target of targets)for(const parse of parses){
    const tags:Record<string,string>={POS:attr(parse.tag,'POS')};
    for(const key of ['TEns','PErs','MOod','VOic']){const value=attr(parse.tag,key);if(value)tags[key]=value;}
    for(const key of ['NMbr',...(withCase?['CAse']:[]),...(target.tag.NMbr!=='plur'?['GNdr']:[])]){
      const value=attr(target.tag,key);if(value)tags[key]=value;
    }
    const form=parse.inflect(tags);
    if(form&&agrees(form.tag,target.tag,withCase))values.push(String(form));
  }
  return [...new Set(values)].slice(0,3);
}

/** Analyze every word, then check local grammatical dependencies against all possible parses. */
export async function morphologicalIssues(text:string):Promise<ProofIssue[]> {
  const analyze=await loadMorphology();
  const tokens:Token[]=[];
  for(const match of text.matchAll(/[А-Яа-яЁё]+(?:[-‑][А-Яа-яЁё]+)*/gu)){
    const word=match[0],key=word.toLocaleLowerCase('ru');
    let parses=cache.get(key);
    if(!parses){
      const candidates=analyze(key);
      const best=Math.max(...candidates.map(p=>p.score),0);
      parses=candidates.filter(p=>p.score>=best*0.05&&['Dictionary','PrefixKnown','HyphenWords'].includes(p.parser));
      if(cache.size>20000)cache.clear();cache.set(key,parses);
    }
    tokens.push({word,start:match.index!,end:match.index!+word.length,parses});
    if(tokens.length%150===0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const issues:ProofIssue[]=[];
  const joined=(left:Token,right:Token)=>/^[ \t\u00a0]+$/.test(text.slice(left.end,right.start));
  const add=(token:Token,rule:string,message:string,suggestions:string[])=>{
    const corrections=[...new Set(suggestions.map(word=>caseLike(word,token.word)))].filter(word=>word.toLocaleLowerCase('ru').replace(/ё/g,'е')!==token.word.toLocaleLowerCase('ru').replace(/ё/g,'е'));
    if(!corrections.length||issues.some(issue=>issue.start===token.start))return;
    issues.push({id:`grammar.morph.${rule}.${token.start}`,start:token.start,end:token.end,text:token.word,kind:'grammar',message,suggestions:corrections.slice(0,3)});
  };
  const nextPredicate=(index:number)=>{
    for(let j=index+1;j<tokens.length&&j<=index+5;j++){
      if(!joined(tokens[j-1],tokens[j]))break;
      const current=predicates(tokens[j]);
      const following=tokens[j+1];
      const adverbial=current.some(p=>p.tag.ADJS&&p.tag.neut)&&/о$/i.test(tokens[j].word)&&tokens.slice(j+1,j+4).some((candidate,offset)=>{
        const gap=text.slice(tokens[j+offset].end,candidate.start);
        return /^[ \t\u00a0/]+$/.test(gap)&&(predicates(candidate).length||kinds(candidate,'PRTF').length);
      });
      if(adverbial)continue;
      if(current.length)return tokens[j];
      if(!kinds(tokens[j],'ADVB','PRCL').length)break;
    }
    return undefined;
  };
  const government:Record<string,string[]>={без:['gent'],для:['gent'],от:['gent'],до:['gent'],из:['gent'],около:['gent'],возле:['gent'],согласно:['datv'],благодаря:['datv'],вопреки:['datv'],при:['loct'],перед:['ablt'],над:['ablt'],к:['datv'],у:['gent'],после:['gent'],вокруг:['gent'],в:['loct','accs'],на:['loct','accs'],о:['loct'],об:['loct'],по:['datv','loct'],под:['ablt','accs'],за:['ablt','accs'],с:['gent','ablt']};
  for(let i=0;i<tokens.length;i++){
    const noun=tokens[i];
    let nounParses=modifier(noun).length&&!noun.parses[0]?.tag.NOUN?[]:kinds(noun,'NOUN');
    if(modifier(noun).length){
      for(let j=i+1;j<tokens.length&&j<=i+4&&joined(tokens[j-1],tokens[j]);j++){
        if(kinds(tokens[j],'NOUN').length){nounParses=[];break;}
        if(!modifier(tokens[j]).length)break;
      }
    }
    if(nounParses.length){
      const adjectives:Token[]=[];
      for(let j=i-1;j>=0&&i-j<=4&&joined(tokens[j],tokens[j+1])&&modifier(tokens[j]).length;j--){
        const prior=tokens[j-1];
        if(prior&&joined(prior,tokens[j])&&matches(modifier(prior),kinds(tokens[j],'NOUN')))break;
        adjectives.unshift(tokens[j]);
      }
      const preceding=tokens[i-adjectives.length-1];
      if(adjectives.length>1&&preceding&&kinds(preceding,'PREP').length&&nounParses.some(n=>n.tag.nomn)&&!matches(modifier(adjectives[0]),nounParses)&&adjectives.slice(1).every(a=>matches(modifier(a),nounParses)))adjectives.shift();
      const beforeModifiers=tokens[i-adjectives.length-1];
      const enumeration=beforeModifiers&&adjectives.length>0&&modifier(beforeModifiers).length>0&&/^[ \t]*,[ \t]*$/.test(text.slice(beforeModifiers.end,adjectives[0].start));
      const quantified=beforeModifiers&&kinds(beforeModifiers,'NUMR').length>0;
      const priorModifier=tokens[i-adjectives.length-2];
      const coordinated=enumeration||quantified||adjectives.length>0&&beforeModifiers?.word.toLocaleLowerCase('ru')==='и'&&priorModifier&&(modifier(priorModifier).length>0||!priorModifier.parses.length);
      const compatible=nounParses.filter(n=>adjectives.every(a=>modifier(a).some(p=>agrees(p.tag,n.tag))));
      const predicate=nextPredicate(i);
      let correctedNoun=false;
      if(adjectives.length&&!compatible.length&&!coordinated){
        // A matching singular adjective and predicate can identify a wrong noun form.
        if(adjectives.length===1&&predicate){
          const adjective=adjectives[0];
          const targets=modifier(adjective).filter(p=>p.tag.nomn&&predicates(predicate).some(v=>agrees(p.tag,v.tag,false)));
          if(targets.length){
            const suggestions=forms(nounParses,targets);
            if(suggestions.length){add(noun,'noun-agreement','Форма существительного не согласована с определением и сказуемым.',suggestions);correctedNoun=true;}
          }
        }
        if(!correctedNoun)for(const adjective of adjectives){
          const objectOfParticiple=modifier(adjective).some(p=>p.tag.PRTF&&p.tag.actv&&p.tag.tran)&&nounParses.some(n=>n.tag.accs);
          const substantivized=kinds(adjective,'NOUN').length>0&&nounParses.some(n=>n.tag.gent);
          if(!objectOfParticiple&&!substantivized&&!matches(modifier(adjective),nounParses))add(adjective,'modifier-agreement','Определение не согласовано с существительным по роду, числу или падежу.',forms(modifier(adjective),nounParses));
        }
      }
      const previous=tokens[i-1];
      const genitiveDependent=previous&&joined(previous,noun)&&kinds(previous,'NOUN').length>0&&nounParses.some(p=>p.tag.gent);
      const coordinationBefore=tokens.slice(Math.max(0,i-4),i).some((token,index,list)=>token.word.toLocaleLowerCase('ru')==='и'&&list.slice(index).every((left,at,tail)=>at===tail.length-1?joined(left,noun):joined(left,tail[at+1])));
      const governed=tokens[i-adjectives.length-1]&&kinds(tokens[i-adjectives.length-1],'PREP').length>0;
      const subject=genitiveDependent||coordinationBefore||governed?[]:(compatible.length?compatible:nounParses).filter(p=>p.tag.nomn&&(!previous||!joined(previous,noun)||p.score>=noun.parses[0].score*0.5||adjectives.length>0));
      if(!correctedNoun&&predicate&&subject.length&&!matches(subject,predicates(predicate),false)){
        add(predicate,'predicate-agreement','Сказуемое не согласовано с подлежащим по числу или роду.',forms(predicates(predicate),subject,false));
      }
      const prepIndex=i-adjectives.length-1,prep=tokens[prepIndex];
      if(prep&&joined(prep,tokens[prepIndex+1])){
        const cases=government[prep.word.toLocaleLowerCase('ru')];
        const uncertainGenitive=cases?.includes('gent')&&!adjectives.length&&/[ыи]$/i.test(noun.word);
        if(cases&&!uncertainGenitive&&!nounParses.some(p=>cases.includes(canonicalCase(attr(p.tag,'CAse'))))){
          const suggestions:string[]=[];
          for(const parse of nounParses)for(const c of cases){const form=parse.inflect({POS:'NOUN',NMbr:attr(parse.tag,'NMbr'),CAse:c});if(form)suggestions.push(String(form));}
          add(noun,'government','Падеж существительного не соответствует управлению предлога.',suggestions);
        }
      }
    }
    const verbs=kinds(noun,'VERB').filter(p=>String(p.normalize())==='быть');
    if(verbs.length){
      const participle=nextPredicate(i);
      if(participle){const passive=kinds(participle,'PRTS');if(passive.length&&!matches(verbs,passive,false))add(noun,'auxiliary-agreement','Вспомогательный глагол не согласован с причастием по числу или роду.',forms(verbs,passive,false));}
    }
    if(issues.length>=100)break;
  }
  return issues;
}
