/** Bounded rule learning. Rulebooks are inert prose; only this finite DSL executes. */
import { createHash } from 'node:crypto';
export type IntegerState = Record<string, number>;
export type Operation = { op: 'set' | 'add' | 'multiply'; key: string; value: number }
  | { op: 'copy'; key: string; from: string } | { op: 'addAction'; key: string };
export interface RuleCandidate { schemaVersion: 1; candidateId: string; rulebook: string; program: Operation[]; parentReceiptHash?: string; counterexampleHash?: string }
export interface Transition { state: IntegerState; action: number; nextState: IntegerState }
export interface RuleReceipt { schemaVersion: 1; candidate: RuleCandidate; observations: Transition[]; hiddenProbes: Transition[]; accepted: boolean; failures: string[]; receiptHash: string }
const badKeys = new Set(['__proto__', 'prototype', 'constructor']);
function object(v: unknown): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw Error('Expected plain object');
  if (Reflect.ownKeys(v).some(k => typeof k !== 'string' || !Object.getOwnPropertyDescriptor(v, k)?.enumerable || !('value' in Object.getOwnPropertyDescriptor(v, k)!))) throw Error('Accessors and hidden fields forbidden');
}
function fields(v: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (Object.keys(v).some(k => ![...required, ...optional].includes(k)) || required.some(k => !(k in v))) throw Error('Invalid fields');
}
function dense(v: unknown): asserts v is unknown[] {
  if (!Array.isArray(v) || Reflect.ownKeys(v).length !== v.length + 1 || Object.keys(v).length !== v.length || Array.from({length:v.length}, (_,i)=>Object.getOwnPropertyDescriptor(v,String(i))).some(d=>!d || !('value' in d))) throw Error('Expected dense data array');
}
function integer(v: unknown): asserts v is number { if (!Number.isSafeInteger(v)) throw Error('Expected safe integer'); }
function key(v: unknown): asserts v is string { if (typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(v) || badKeys.has(v)) throw Error('Invalid state key'); }
function state(v: unknown): asserts v is IntegerState { object(v); if (Object.keys(v).length > 32) throw Error('State limit'); for (const [k, n] of Object.entries(v)) { key(k); integer(n); } }
function candidate(v: unknown): asserts v is RuleCandidate {
  object(v); fields(v, ['schemaVersion', 'candidateId', 'rulebook', 'program'], ['parentReceiptHash', 'counterexampleHash']);
  if (v.schemaVersion !== 1 || typeof v.candidateId !== 'string' || !/^[\w.-]{1,80}$/.test(v.candidateId) || typeof v.rulebook !== 'string' || Buffer.byteLength(v.rulebook, 'utf8') > 4096) throw Error('Invalid candidate');
  if ((v.parentReceiptHash === undefined) !== (v.counterexampleHash === undefined)) throw Error('Revision binding incomplete');
  for (const k of ['parentReceiptHash', 'counterexampleHash']) if (v[k] !== undefined && (typeof v[k] !== 'string' || !/^[a-f0-9]{64}$/.test(v[k]))) throw Error('Invalid hash');
  if (!Array.isArray(v.program) || v.program.length < 1 || v.program.length > 32) throw Error('Program limit');
  dense(v.program);
  for (const op of v.program) {
    object(op); key(op.key);
    if (['set', 'add', 'multiply'].includes(String(op.op))) { fields(op, ['op', 'key', 'value']); integer(op.value); }
    else if (op.op === 'copy') { fields(op, ['op', 'key', 'from']); key(op.from); }
    else if (op.op === 'addAction') fields(op, ['op', 'key']);
    else throw Error('Unsupported operation');
  }
}
function transition(v: unknown): asserts v is Transition { object(v); fields(v, ['state', 'action', 'nextState']); state(v.state); state(v.nextState); integer(v.action); }
/** Canonical integer JSON: object key order is insignificant; array order is significant. */
export function canonicalRuleJson(v: unknown): string {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'number') { integer(v); return JSON.stringify(v); }
  if (Array.isArray(v)) return '[' + v.map(canonicalRuleJson).join(',') + ']';
  object(v); return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonicalRuleJson(v[k])).join(',') + '}';
}
export function ruleHash(v: unknown): string { return createHash('sha256').update(canonicalRuleJson(v)).digest('hex'); }
export function executeRule(c: RuleCandidate, initial: IntegerState, action: number): IntegerState {
  candidate(c); state(initial); integer(action); const out: IntegerState = { ...initial };
  for (const op of c.program) {
    if (op.op !== 'set' && !Object.hasOwn(out, op.key)) throw Error('Missing target');
    if (op.op === 'copy' && !Object.hasOwn(out, op.from)) throw Error('Missing source');
    const value = op.op === 'set' ? op.value : op.op === 'copy' ? out[op.from]! : op.op === 'add' ? out[op.key]! + op.value : op.op === 'multiply' ? out[op.key]! * op.value : out[op.key]! + action;
    integer(value); out[op.key] = value; if (Object.keys(out).length > 32) throw Error('State limit');
  }
  return out;
}
function failures(c: RuleCandidate, transitions: Transition[]): string[] {
  return transitions.flatMap(t => { try { if (ruleHash(executeRule(c, t.state, t.action)) === ruleHash(t.nextState)) return []; } catch { /* Execution errors reject. */ } return [ruleHash(t)]; });
}
/** Parent receipts must themselves be supplied with their ancestry for verification. */
export function evaluateRuleCandidates(candidates: RuleCandidate[], observations: Transition[], hiddenProbes: Transition[], parents: RuleReceipt[] = []): RuleReceipt[] {
  if (!Array.isArray(candidates) || candidates.length < 1 || candidates.length > 16 || !Array.isArray(parents) || parents.length > 64) throw Error('Candidate/ancestry limit');
  dense(candidates); dense(parents);
  for (const list of [observations, hiddenProbes]) { if (!Array.isArray(list) || list.length < 1 || list.length > 256) throw Error('Transition limit'); dense(list); list.forEach(transition); }
  const known = new Map<string, RuleReceipt>();
  for (const p of parents) {
    object(p); fields(p as unknown as Record<string, unknown>, ['schemaVersion', 'candidate', 'observations', 'hiddenProbes', 'accepted', 'failures', 'receiptHash']);
    candidate(p.candidate);
    const { parentReceiptHash: _parent, counterexampleHash: _counter, ...root } = p.candidate;
    const expected = evaluateRuleCandidates([root], p.observations, p.hiddenProbes, [])[0]!;
    expected.candidate = p.candidate;
    const { receiptHash: _hash, ...body } = expected;
    expected.receiptHash = ruleHash(body);
    if (p.candidate.parentReceiptHash) {
      const ancestor = known.get(p.candidate.parentReceiptHash);
      if (!ancestor || !ancestor.failures.includes(p.candidate.counterexampleHash!) || !p.observations.some(t => ruleHash(t) === p.candidate.counterexampleHash)) throw Error('Invalid ancestry');
    }
    if (!expected || canonicalRuleJson(expected) !== canonicalRuleJson(p)) throw Error('Invalid parent');
    known.set(p.receiptHash, p);
  }
  const ids = new Set<string>();
  return candidates.map(c => {
    candidate(c); if (ids.has(c.candidateId)) throw Error('Duplicate candidate'); ids.add(c.candidateId);
    if (c.parentReceiptHash) {
      const p = known.get(c.parentReceiptHash);
      if (!p || !p.failures.includes(c.counterexampleHash!) || !observations.some(t => ruleHash(t) === c.counterexampleHash)) throw Error('Unbound revision');
    }
    const failed = failures(c, [...observations, ...hiddenProbes]);
    const body = { schemaVersion: 1 as const, candidate: c, observations, hiddenProbes, accepted: failed.length === 0, failures: failed };
    return JSON.parse(JSON.stringify({ ...body, receiptHash: ruleHash(body) })) as RuleReceipt;
  });
}
export function verifyRuleReceipt(receipt: RuleReceipt, parents: RuleReceipt[] = []): boolean {
  try {
    object(receipt); fields(receipt as unknown as Record<string, unknown>, ['schemaVersion', 'candidate', 'observations', 'hiddenProbes', 'accepted', 'failures', 'receiptHash']);
    if (receipt.schemaVersion !== 1) return false;
    const expected = evaluateRuleCandidates([receipt.candidate], receipt.observations, receipt.hiddenProbes, parents)[0]!;
    return canonicalRuleJson(expected) === canonicalRuleJson(receipt);
  } catch { return false; }
}
