import aff from '../node_modules/dictionary-ru/index.aff?raw';
import dic from '../node_modules/dictionary-ru/index.dic?raw';
import dictionaryLicense from '../node_modules/dictionary-ru/license?raw';
import nspellLicense from '../node_modules/nspell/license?raw';
import isBufferLicense from '../node_modules/is-buffer/LICENSE?raw';
import { createRussianChecker } from './proofreading-core';

export type { ProofIssue } from './proofreading-core';
export { MAX_PROOF_ISSUES } from './proofreading-core';

// The dictionary and its licences are included in the standalone HTML bundle.
// This checker never sends report text, names, or personal words to a service.
export const russianProofreadingLicense = `dictionary-ru 3.0.0\n${dictionaryLicense}\n\nnspell 2.1.5\n${nspellLicense}\n\nis-buffer 2.0.5\n${isBufferLicense}`;

let checker: ReturnType<typeof createRussianChecker> | undefined;
export async function checkRussian(text: string, personalWords: string[] = []) {
  // Give the interface a frame to display the progress indicator before the
  // dictionary is parsed on the first check. Later checks reuse the dictionary.
  if (!checker) {
    await new Promise(resolve => setTimeout(resolve, 30));
    checker ??= createRussianChecker(aff, dic);
  }
  return checker(text, personalWords);
}
