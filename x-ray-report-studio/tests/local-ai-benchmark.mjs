// Synthetic only. Run with `node --expose-gc tests/local-ai-benchmark.mjs`.
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createRussianChecker } from '../src/proofreading-core.ts';
import { LocalAIProvider } from '../src/local-ai-provider.ts';

const aff=await readFile(new URL('../node_modules/dictionary-ru/index.aff',import.meta.url),'utf8');
const dic=await readFile(new URL('../node_modules/dictionary-ru/index.dic',import.meta.url),'utf8');
const provider=new LocalAIProvider(createRussianChecker(aff,dic));
const sentence='МРТ поясничного отдела. На уровне L4-L5 протрузия диска 2,5 мм. Субарахноидальное пространство без изменений. ';
await provider.review({description:sentence,conclusion:'Без особенностей.'});
for(const repetitions of [5,20,80]){
  global.gc?.();
  const before=process.memoryUsage();
  const blocks={description:sentence.repeat(repetitions),conclusion:'Без особенностей.'};
  const start=performance.now();
  const findings=await provider.review(blocks);
  const elapsed=performance.now()-start;
  global.gc?.();
  const after=process.memoryUsage();
  console.log(JSON.stringify({characters:blocks.description.length+blocks.conclusion.length,ms:Math.round(elapsed),findings:findings.length,heapMiB:Math.round(after.heapUsed/1048576),heapDeltaMiB:Math.round((after.heapUsed-before.heapUsed)/1048576),rssMiB:Math.round(after.rss/1048576)}));
}
