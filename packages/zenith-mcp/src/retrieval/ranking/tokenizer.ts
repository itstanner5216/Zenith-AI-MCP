const WORD_RE = /[\p{L}\p{N}_]+/gu;

export function tokenizeLexicalTerms(text: string): string[] {
  if (!text) return [];
  return text.toLowerCase().match(WORD_RE) ?? [];
}
