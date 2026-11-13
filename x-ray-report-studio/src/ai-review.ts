import type { RichNode } from './model';
import { MedicalTerminologyEngine, ClinicalConsistencyEngine, ClinicalLogicEngine } from './clinical-review.ts';

export type ReviewBlockId = 'description' | 'conclusion';
export type ReviewBlocks = Record<ReviewBlockId, string>;
export type Operation = 'replace' | 'insert' | 'delete' | 'comment';
export type Suggestion = {
  id: string; operation: Operation; blockId: ReviewBlockId; original: string;
  proposed: string; explanation: string; category: string; priority: 'low' | 'medium' | 'high';
  from: number; to: number; state: 'pending' | 'accepted' | 'rejected';
  confidence?: 'high' | 'limited'; meaningRisk?: boolean;
};
export type Finding = Omit<Suggestion, 'id' | 'state'>;
export const reviewCategories = [
  ['spelling', 'Орфография'], ['punctuation', 'Пунктуация'],
  ['style', 'Стиль и грамматика'], ['terminology', 'Медицинская терминология'],
  ['consistency', 'Согласованность описания и заключения'], ['clinical', 'Клиническая логика'],
] as const;
export type ReviewCategory = typeof reviewCategories[number][0];
export function categoryGroup(category: string): ReviewCategory | null {
  if (category === 'template') return 'style';
  if (['side', 'level', 'size'].includes(category)) return 'consistency';
  return reviewCategories.find(([id]) => id === category)?.[0] ?? null;
}

const allowed = new Set<ReviewBlockId>(['description', 'conclusion']);
const safeNodes = new Set(['reportSection', 'paragraph', 'heading', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule', 'hardBreak', 'table', 'tableRow', 'tableCell', 'tableHeader']);

export function reviewPlain(node: RichNode): string {
  if (!safeNodes.has(node.type)) throw new Error('Неоднозначная структура блока');
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'horizontalRule') return '';
  if (node.type === 'hardBreak') return '\n';
  if (!node.content) return '';
  const separator = ['paragraph', 'heading', 'listItem'].includes(node.type) ? '' : '\n';
  return node.content.map(reviewPlain).join(separator);
}

export class ReportBlockExtractor {
  extract(doc: RichNode): ReviewBlocks {
    if (doc.type !== 'doc' || !Array.isArray(doc.content)) throw new Error('Неизвестный формат документа');
    const sections = doc.content.slice(0, 4);
    const tail = doc.content.slice(4);
    if (sections.length !== 4 || sections.some(n => n.type !== 'reportSection') || tail.some(n => n.type !== 'paragraph' || reviewPlain(n).trim())) throw new Error('Границы описания и заключения не подтверждены');
    const ids = sections.map(n => n.attrs?.id);
    if (ids.join('|') !== 'header|description|conclusion|signature') throw new Error('Границы описания и заключения не подтверждены');
    const description = reviewPlain(sections[1]).trim();
    const conclusion = reviewPlain(sections[2]).trim();
    if (!description || !conclusion) throw new Error('Пустой разрешённый блок');
    return { description, conclusion };
  }
}

export class PrivacyGuard {
  check(blocks: ReviewBlocks): void {
    const text = `${blocks.description}\n${blocks.conclusion}`;
    if (/(?:фио|ф\.\s*и\.\s*о\.|пациент|врач|дата рождения|дата исследования|№\s*исследования|\b\d{2}\.\d{2}\.\d{4}\b|\b\+?7[\s()-]*\d{3}[\s()-]*\d{3})/iu.test(text)) throw new Error('В разрешённых блоках обнаружены возможные персональные данные');
  }
  preview(blocks: ReviewBlocks): string { this.check(blocks); return `Описание:\n${blocks.description}\n\nЗаключение:\n${blocks.conclusion}`; }
}

function issue(blockId: ReviewBlockId, text: string, start: number, end: number, category: string, explanation: string): Finding {
  return { operation: 'comment', blockId, original: text.slice(start, end), proposed: '', explanation, category, priority: 'medium', from: start, to: end };
}

export class TemplateValidator {
  validate(blocks: ReviewBlocks): Finding[] {
    const out: Finding[] = [];
    for (const blockId of ['description', 'conclusion'] as const) {
      const text = blocks[blockId];
      for (const match of text.matchAll(/\[\[[^\]]*\]\]|⟦[^⟧]*⟧|\{\{[^}]*\}\}|\b(?:XXX|SSS)\b/giu)) {
        out.push(issue(blockId, text, match.index, match.index + match[0].length, 'template', 'Незаполненный маркер шаблона'));
      }
    }
    return out;
  }
}

export class ConsistencyEngine {
  validate(blocks: ReviewBlocks): Finding[] {
    const out: Finding[] = [];
    const a = blocks.description, b = blocks.conclusion;
    const side = (s: string) => new Set([...s.matchAll(/(?<![а-яё])(справа|слева)(?![а-яё])/giu)].map(m => m[0].toLowerCase()));
    const left = side(a), right = side(b);
    if (left.size === 1 && right.size === 1 && [...left][0] !== [...right][0]) out.push(issue('conclusion', b, b.toLowerCase().indexOf([...right][0]), b.toLowerCase().indexOf([...right][0]) + [...right][0].length, 'side', 'Сторона в заключении отличается от описания'));
    const levels = (s: string) => new Set([...s.matchAll(/\bL[1-5]\s*[-–]\s*(?:L[1-5]|S1)\b/giu)].map(m => m[0].toUpperCase().replace(/\s|–/g, '-')));
    const al = levels(a), bl = levels(b);
    if (al.size === 1 && bl.size === 1 && [...al][0] !== [...bl][0]) { const m = b.match(/\bL[1-5]\s*[-–]\s*(?:L[1-5]|S1)\b/iu)!; out.push(issue('conclusion', b, m.index!, m.index! + m[0].length, 'level', 'Уровень в заключении отличается от описания')); }
    const size = (s: string) => [...s.matchAll(/\b\d+(?:[,.]\d+)?\s*мм(?![а-яё])/giu)].map(m => m[0].replace(/\s/g, '').replace(',', '.'));
    const as = size(a), bs = size(b);
    if (as.length === 1 && bs.length === 1 && as[0] !== bs[0]) { const m = b.match(/\b\d+(?:[,.]\d+)?\s*мм(?![а-яё])/iu)!; out.push(issue('conclusion', b, m.index!, m.index! + m[0].length, 'size', 'Размер в заключении отличается от описания')); }
    return out;
  }
}

export interface AIProvider { review(blocks: ReviewBlocks, signal?: AbortSignal): Promise<Finding[]>; }
export class MockAIProvider implements AIProvider {
  private readonly findings: Finding[];
  constructor(findings: Finding[] = []) { this.findings = findings; }
  async review(_blocks: ReviewBlocks): Promise<Finding[]> { return structuredClone(this.findings); }
}
export { LocalAIProvider } from './local-ai-provider.ts';
export class CloudAIProvider implements AIProvider { async review(_blocks: ReviewBlocks): Promise<Finding[]> { throw new Error('Облачный режим отключён в XRS-AI-01'); } }

export class ReviewEngine {
  private readonly provider: AIProvider;
  private readonly medical: { terminology: Pick<MedicalTerminologyEngine,'validate'>; consistency: Pick<ClinicalConsistencyEngine,'validate'>; clinical: Pick<ClinicalLogicEngine,'validate'> };
  constructor(provider: AIProvider = new MockAIProvider(), medical = { terminology:new MedicalTerminologyEngine(), consistency:new ClinicalConsistencyEngine(), clinical:new ClinicalLogicEngine() }) { this.provider = provider; this.medical = medical; }
  async review(doc: RichNode, categories: ReadonlySet<ReviewCategory> = new Set(reviewCategories.map(([id]) => id)), signal?: AbortSignal): Promise<{ blocks: ReviewBlocks; suggestions: Suggestion[] }> {
    signal?.throwIfAborted();
    const blocks = new ReportBlockExtractor().extract(doc);
    new PrivacyGuard().check(blocks);
    const findings:Finding[]=[];
    if(categories.has('style')) findings.push(...new TemplateValidator().validate(blocks));
    if(categories.has('consistency')) findings.push(...new ConsistencyEngine().validate(blocks),...this.medical.consistency.validate(blocks));
    if(categories.has('terminology')) findings.push(...this.medical.terminology.validate(blocks));
    if(categories.has('clinical')) findings.push(...this.medical.clinical.validate(blocks));
    if(['spelling','punctuation','style'].some(category=>categories.has(category as ReviewCategory)))findings.push(...await this.provider.review(blocks, signal));
    signal?.throwIfAborted();
    const unique=new Map<string,Finding>();
    for(const finding of findings){const group=categoryGroup(finding.category);if(!group||!categories.has(group)||!allowed.has(finding.blockId)||!Number.isInteger(finding.from)||!Number.isInteger(finding.to)||finding.from<0||finding.to>blocks[finding.blockId].length||finding.from>finding.to||blocks[finding.blockId].slice(finding.from,finding.to)!==finding.original)continue;const key=JSON.stringify([finding.blockId,finding.operation,group,finding.from,finding.to,finding.original,finding.proposed]);if(!unique.has(key))unique.set(key,finding);}
    const suggestions=[...unique.values()].map(f=>({ ...f, id: crypto.randomUUID(), state: 'pending' as const }));
    return { blocks, suggestions };
  }
}

export class TrackChangesEngine {
  private readonly tabs = new Map<string, Suggestion[]>();
  set(tabId: string, suggestions: Suggestion[]): void { this.tabs.set(tabId, structuredClone(suggestions)); }
  list(tabId: string): Suggestion[] { return structuredClone(this.tabs.get(tabId) ?? []); }
  reject(tabId: string, id: string): void { this.changeState(tabId, id, 'rejected'); }
  markAccepted(tabId: string, id: string): void { const item=this.get(tabId,id); if(item.state!=='pending')throw new Error('Правка уже рассмотрена'); item.state='accepted'; }
  accept(tabId: string, id: string, blocks: ReviewBlocks): ReviewBlocks {
    const suggestion = this.get(tabId, id);
    if (suggestion.state !== 'pending' || !allowed.has(suggestion.blockId)) throw new Error('Правка недоступна');
    const text = blocks[suggestion.blockId];
    if (!Number.isInteger(suggestion.from) || !Number.isInteger(suggestion.to) || suggestion.from < 0 || suggestion.to > text.length || suggestion.from > suggestion.to || text.slice(suggestion.from, suggestion.to) !== suggestion.original) throw new Error('Правка устарела');
    if (suggestion.operation === 'comment') throw new Error('Замечание не меняет текст');
    if (suggestion.operation === 'insert' && suggestion.from !== suggestion.to) throw new Error('Неверная позиция вставки');
    if (suggestion.operation === 'delete' && suggestion.proposed) throw new Error('Неверное удаление');
    const result = { ...blocks, [suggestion.blockId]: text.slice(0, suggestion.from) + (suggestion.operation === 'delete' ? '' : suggestion.proposed) + text.slice(suggestion.to) };
    suggestion.state = 'accepted';
    return result;
  }
  private get(tabId: string, id: string): Suggestion { const item = this.tabs.get(tabId)?.find(x => x.id === id); if (!item) throw new Error('Правка не найдена'); return item; }
  private changeState(tabId: string, id: string, state: 'rejected'): void { const item = this.get(tabId, id); if (item.state !== 'pending') throw new Error('Правка уже рассмотрена'); item.state = state; }
}
