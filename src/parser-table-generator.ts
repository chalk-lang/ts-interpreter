/*/
  Creates tables for parser of Chalk.
/*/

import { promises } from "fs";

import { Grammar, Rule, isTerminal, chalkGrammar, startSymbols } from "./grammar";

export interface Transition {
  [key: string]: {
    shift: number|null;
    reduce: number[];
  }
};

function setEquals<T>(a: Set<T>, b: Set<T>): boolean {
  return a.size === b.size && (() => {
    let f = true;
    
    a.forEach(a => b.has(a) || (f = false));
    
    return f;
  })();
}

class Visited {
  constructor(public symbol: string, public prev: Visited|null) {}
  
  has(symbol: string): boolean {
    return this.symbol === symbol || !!this.prev && this.prev.has(symbol);
  }
}

const firstMap: Map<string, Set<string>> = (() => {
  const map: Map<string, Set<string>> = new Map();
  
  function first(symbols: string[], visited: Visited|null = null): Set<string> {
    if (symbols.length === 0) return new Set([ "" ]);
    if (isTerminal(symbols[0])) return new Set([ symbols[0] ]);
    if (visited && visited.has(symbols[0])) return new Set();
    
    return chalkGrammar.map(rule => {
      if (rule[0] === symbols[0]) {
        return first(rule[1].concat(symbols.slice(1)), new Visited(symbols[0], visited));
      }
      
      return null;
      
    }).reduce((acc: Set<string>, a) => (a && a.forEach(a => acc.add(a)), acc), new Set());
  }
  
  chalkGrammar.forEach(rule => {
    map.has(rule[0]) || map.set(rule[0], first(rule[1]));
  });
  
  return map;
})();

function first(symbols: string[]) {
  const s = new Set<string>();
  
  symbols.some(symbol => {
    if (isTerminal(symbols[0])) {
      s.add(symbols[0]);
      
      return true;
    }
    
    const f = firstMap.get(symbol) as Set<string>;
    
    f.forEach(f => f === "" || s.add(f));
    
    return !f.has("");
  }) || s.add("");
  
  return s;
}

class RuleAt {
  read: string|null;
  
  constructor(
    public rule: Rule,
    public dot: number,
    public context: Set<string>
  ) {
    this.read = rule[1][dot] || null;
  }
  
  move(): RuleAt { return new RuleAt(this.rule, this.dot + 1, this.context) }
  
  static equals(a: RuleAt, b: RuleAt): boolean {
    return a.rule === b.rule && a.dot === b.dot && setEquals(a.context, b.context);
  }
}

class Actions {
  shift: number|null = null;
  reduce: number[] = [];
  
  ruleAts: RuleAt[] = [];
}

class ParserState {
  transitions: Map<string, Actions> = new Map();
  ruleAts: RuleAt[];
  
  constructor(
    ruleAts: RuleAt[],
  ) {
    this.ruleAts = ruleAts;
    
    this.addMissingRuleAts();
  }
  
  addMissingRuleAts(): void {
    for (let i = 0; i < this.ruleAts.length; i++) {
      const ruleAt = this.ruleAts[i];

      if (!ruleAt.read || isTerminal(ruleAt.read)) continue;
      
      const context = first(ruleAt.rule[1].slice(ruleAt.dot + 1));
      
      if (context.has("")) {
        ruleAt.context.forEach(f => context.add(f));
        
        ruleAt.context.has("") || context.delete("");
      }
      
      chalkGrammar.forEach(r => {
        if (r[0] !== ruleAt.read) return;
        
        const missing = new RuleAt(r, 0, context);
        
        this.ruleAts.every(r => !RuleAt.equals(r, missing)) && this.ruleAts.push(missing);
      });
    }
  }
  
  getActions(symbol: string): Actions {
    const actions = this.transitions.get(symbol) || new Actions();
    
    this.transitions.set(symbol, actions);
    
    return actions;
  }
  
  addStates(addState: (kernel: RuleAt[]) => number): void {
    for (let ruleAt of this.ruleAts) {
      if (ruleAt.read) {
        const { ruleAts } = this.getActions(ruleAt.read);
        const moved = ruleAt.move();
        
        ruleAts.every(r => !RuleAt.equals(r, moved)) && ruleAts.push(moved);
      } else {
        ruleAt.context.forEach(symbol =>(
          this.getActions(symbol).reduce.push(chalkGrammar.indexOf(ruleAt.rule))),
        );
      }
    }
    
    for (let [ symbol, actions ] of this.transitions) {
      symbol === "" || (actions.shift = addState(actions.ruleAts));
    }
  }
  
  static equals(a: ParserState, b: ParserState): boolean {
    if (a.ruleAts.length !== b.ruleAts.length) return false;
    
    return a.ruleAts.every(a => b.ruleAts.some(b => RuleAt.equals(a, b)));
  }
  
  jsonObject(): Transition {
    const obj: Transition = {};
    
    for (let [ symbol, actions ] of this.transitions) {
      obj[symbol] = { shift: actions.shift, reduce: actions.reduce };
    }
    
    return obj;
  }
}

class Main {
  table: ParserState[];
  startTime: number;
  
  constructor() {
    console.log("Calculating parser tables.");
    
    this.startTime = Date.now();
    
    this.table = startSymbols.map(startSymbol =>
      new ParserState([ new RuleAt([ "", [ startSymbol ] ], 0, new Set([ "" ])) ]),
    );
    
    const addState = this.addState.bind(this);
    
    for (let i = 0; i < this.table.length; i++) {
      this.table[i].addStates(addState);
      process.stdout.write("\r\x1b[K" + i + " / 3362 ("
        + (Math.floor(i / 0.3362) / 100) + "%)");
    }
    
    this.saveFile();
  }
  
  addState(kernel: RuleAt[]): number {
    const newState = new ParserState(kernel);
    const index = this.table.findIndex(state => ParserState.equals(state, newState));
    
    return index === -1 ? this.table.push(newState) - 1 : index;
  }
  
  async saveFile(): Promise<void> {
    const data = JSON.stringify(this.table.map(state => state.jsonObject()));
    
    promises.writeFile("out/parser-table.json", data);
    
    console.log("Done: Calculating parser tables. Took " + (Date.now() - this.startTime) + "ms.");
  }
}

new Main();