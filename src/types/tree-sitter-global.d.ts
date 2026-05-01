import type { IndexableLanguage } from "./index.js";

type MpTreeSitterParser = {
  setLanguage(grammar: unknown): void;
  parse(content: string): unknown;
};

type MpTreeSitterParserConstructor = new () => MpTreeSitterParser;

type MpTreeSitterState = {
  Parser: MpTreeSitterParserConstructor;
  grammars: Record<IndexableLanguage, unknown>;
  pools: Record<IndexableLanguage, MpTreeSitterParser[]>;
  _nextIdx: Record<IndexableLanguage, number>;
  _pinnedTrees: unknown[];
  resetPools(): void;
};

declare global {
  var __mpTreeSitter: MpTreeSitterState | undefined;

  namespace NodeJS {
    interface Process {
      __mpTreeSitter?: MpTreeSitterState;
    }
  }
}

export {};
