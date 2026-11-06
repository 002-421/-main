import Az from 'az';
import { unzipSync, strFromU8 } from 'fflate';
import packedDictionary from './assets/morphology/dictionary.ts';

export type MorphTag = Record<string, string | boolean | undefined>;
export type MorphParse = { word:string; tag:MorphTag; score:number; parser:string; inflect:(tags:Record<string,string>)=>MorphParse|false; normalize:()=>MorphParse|false };
let ready:Promise<(word:string)=>MorphParse[]>|undefined;
export function loadMorphology():Promise<(word:string)=>MorphParse[]> {
  return ready ??= new Promise((resolve,reject)=>{
    const bytes=Uint8Array.from(atob(packedDictionary),char=>char.charCodeAt(0));
    const files=unzipSync(bytes);
    // Dictionary reads are served entirely from the embedded archive, including file:// browsers.
    Az.load=(url:string,type:string,callback:(error:Error|null,data?:unknown)=>void)=>queueMicrotask(()=>{
      try {
        const data=files[url.split('/').at(-1)!];
        if(!data)throw new Error('Не найден встроенный морфологический словарь.');
        callback(null,type==='json'?JSON.parse(strFromU8(data)):data.slice().buffer);
      }catch(error){callback(error as Error);}
    });
    Az.Morph.init('embedded',(error:Error|null)=>error?reject(error):resolve((word:string)=>Az.Morph(word,{ignoreCase:true})));
  });
}
