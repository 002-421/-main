declare module 'nspell' {
  export interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
  }
  export default function nspell(aff: string, dic: string): NSpell;
}
