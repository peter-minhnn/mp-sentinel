"use strict";

// When loaded through Node's --require, this runs in the root CJS context
// before Jest creates per-suite VM contexts. setupFiles also loads this file
// inside each suite; in that case we only attach the already-created process
// state to the suite global and do not require tree-sitter again.
//
// The shared state is stored on process because process is the same object
// across Jest VM contexts. globalThis is not shared between suites.

const POOL_SIZE = 8;

function makeParser(Parser, grammar) {
  const parser = new Parser();
  parser.setLanguage(grammar);
  return parser;
}

function makePool(Parser, grammar) {
  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(makeParser(Parser, grammar));
  }
  return pool;
}

function makePools(Parser, grammars) {
  return {
    typescript: makePool(Parser, grammars.typescript),
    tsx: makePool(Parser, grammars.tsx),
    javascript: makePool(Parser, grammars.javascript),
    jsx: makePool(Parser, grammars.jsx),
  };
}

function makeState() {
  const treeSitter = require("tree-sitter");
  const tsGrammars = require("tree-sitter-typescript");
  const jsGrammar = require("tree-sitter-javascript");
  const grammars = {
    typescript: tsGrammars.typescript,
    tsx: tsGrammars.tsx,
    javascript: jsGrammar,
    jsx: jsGrammar,
  };

  return {
    Parser: treeSitter,
    grammars,
    pools: makePools(treeSitter, grammars),
    _nextIdx: { typescript: 0, tsx: 0, javascript: 0, jsx: 0 },
    _pinnedTrees: [],
    resetPools() {
      this.pools = makePools(treeSitter, grammars);
      this._nextIdx = { typescript: 0, tsx: 0, javascript: 0, jsx: 0 };
      this._pinnedTrees = [];
    },
  };
}

process.__mpTreeSitter = process.__mpTreeSitter || makeState();
globalThis.__mpTreeSitter = process.__mpTreeSitter;
