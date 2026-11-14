import type { Finding, AIProvider, ReviewBlocks, ReviewBlockId } from './ai-review.ts';
import type { ProofIssue } from './proofreading-core';
import { medicalLexicon } from './medical-lexicon.ts';

export type LocalChecker = (text: string, personalWords?: string[], signal?: AbortSignal) => Promise<ProofIssue[]>;

const punctuationRules = new Set(['spaces', 'before-punctuation', 'after-punctuation', 'punctuation-repeat']);
const sensitive = /(?:справа|слева|правосторонн\p{L}*|левосторонн\p{L}*|(?<!\p{L})не(?!\p{L})|выявлен\p{L}*|отсутств\p{L}*|\d+(?:[,.]\d+)?\s*(?:мм|см|мл)(?!\p{L})|\b(?:T1|T2|FLAIR|DWI|ADC|STIR|C[1-7]|Th(?:1[0-2]|[1-9])|L[1-5]|S1)\b)/iu;
const knownMedical = new Set<string>(medicalLexicon);

function meaningSensitive(original: string, proposed: string): boolean {
  return sensitive.test(`${original} ${proposed}`) || [original, proposed].some(word => knownMedical.has(word.toLocaleLowerCase('ru-RU')));
}

function convert(issue: ProofIssue, blockId: ReviewBlockId, text: string): Finding | null {
  if (issue.start < 0 || issue.end > text.length || issue.start >= issue.end || text.slice(issue.start, issue.end) !== issue.text) return null;
  const rule = issue.id.split('.')[1];
  const category = issue.kind === 'spelling' ? 'spelling' : punctuationRules.has(rule) ? 'punctuation' : 'style';
  const proposed = issue.suggestions[0] ?? '';
  // Dictionary guesses and contextual grammar rules can change medical meaning.
  // A comment can show the candidate, but cannot be accepted as an edit.
  const context = text.slice(Math.max(0, issue.start - 18), Math.min(text.length, issue.end + 18));
  // Even one Hunspell candidate is a spelling guess, not a medically verified
  // replacement. Keep it visible, but require the physician to edit manually.
  const risk = issue.kind === 'spelling' || meaningSensitive(context, proposed) || rule === 'repeat' || rule === 'punctuation-repeat' || rule === 'morph';
  const operation = !risk && proposed && proposed !== issue.text ? 'replace' : 'comment';
  return {
    operation, blockId, original: issue.text, proposed,
    explanation: issue.message, category, priority: 'low',
    from: issue.start, to: issue.end,
    confidence: issue.kind === 'grammar' && punctuationRules.has(rule) && !risk ? 'high' : 'limited',
    meaningRisk: risk,
  };
}

export class LocalAIProvider implements AIProvider {
  private readonly checker: LocalChecker;
  constructor(checker?: LocalChecker) {
    this.checker = checker ?? (async (text, personalWords, signal) => {
      const module = await import('./proofreading');
      signal?.throwIfAborted();
      return module.checkRussian(text, personalWords, signal);
    });
  }
  async review(blocks: ReviewBlocks, signal?: AbortSignal): Promise<Finding[]> {
    const findings: Finding[] = [];
    for (const blockId of ['description', 'conclusion'] as const) {
      signal?.throwIfAborted();
      const text = blocks[blockId];
      for (const issue of await this.checker(text, [], signal)) {
        const finding = convert(issue, blockId, text);
        if (finding) findings.push(finding);
      }
    }
    signal?.throwIfAborted();
    return findings;
  }
}
