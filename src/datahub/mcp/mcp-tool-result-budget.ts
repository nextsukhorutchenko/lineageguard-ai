import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DATAHUB_MCP_BOUNDARY_POLICY } from "./mcp-boundary-policy.js";

interface BudgetState {
  bytes: number;
  nodes: number;
}

type ObjectFrame = {
  readonly kind: "object";
  readonly value: Record<string, unknown>;
  readonly keys: Generator<string>;
  readonly depth: number;
  readonly first: boolean;
};

type WorkItem =
  | { readonly kind: "value"; readonly value: unknown; readonly parentDepth: number }
  | {
      readonly kind: "array";
      readonly value: readonly unknown[];
      readonly index: number;
      readonly length: number;
      readonly depth: number;
    }
  | ObjectFrame
  | { readonly kind: "exit"; readonly value: object };

const boundaryFailure = (): Error =>
  new Error("DataHub MCP tool result exceeded the application boundary.");

function addBytes(state: BudgetState, amount: number): void {
  state.bytes += amount;
  if (state.bytes > DATAHUB_MCP_BOUNDARY_POLICY.maxToolResultBytes) {
    throw boundaryFailure();
  }
}

function addJsonString(state: BudgetState, value: string): void {
  addBytes(state, 2);

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code === 0x22 || code === 0x5c) {
      addBytes(state, 2);
    } else if (code <= 0x1f) {
      addBytes(
        state,
        code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6,
      );
    } else if (code <= 0x7f) {
      addBytes(state, 1);
    } else if (code <= 0x7ff) {
      addBytes(state, 2);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addBytes(state, 4);
        index += 1;
      } else {
        addBytes(state, 6);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      addBytes(state, 6);
    } else {
      addBytes(state, 3);
    }
  }
}

function* ownJsonKeys(value: object): Generator<string> {
  for (const key in value) {
    if (Object.hasOwn(value, key)) yield key;
  }
}

function ownEnumerableDataDescriptor(value: object, key: string): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
    throw boundaryFailure();
  }
  return descriptor;
}

function arrayLength(value: readonly unknown[]): number {
  const descriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    !Number.isSafeInteger(descriptor.value) ||
    descriptor.value < 0
  ) {
    throw boundaryFailure();
  }
  return descriptor.value;
}

function assertFinalContainerProperties(value: object): void {
  if (Object.getOwnPropertySymbols(value).length > 0) throw boundaryFailure();

  const array = Array.isArray(value);
  const length = array ? arrayLength(value) : undefined;
  for (const key of Object.getOwnPropertyNames(value)) {
    if (array && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw boundaryFailure();
    }
    if (array && !canonicalArrayIndex(key, length!)) throw boundaryFailure();
  }
}

function countJoinedTextBlockNewlines(result: CallToolResult, state: BudgetState): void {
  if (typeof result !== "object" || result === null) throw boundaryFailure();
  const contentDescriptor = ownEnumerableDataDescriptor(result, "content");
  const content = contentDescriptor.value;
  if (!Array.isArray(content) || Object.getPrototypeOf(content) !== Array.prototype) {
    throw boundaryFailure();
  }

  const length = arrayLength(content);
  if (length > DATAHUB_MCP_BOUNDARY_POLICY.maxJsonNodes) throw boundaryFailure();

  let textBlocks = 0;
  for (let index = 0; index < length; index += 1) {
    const blockDescriptor = ownEnumerableDataDescriptor(content, String(index));
    const block = blockDescriptor.value;
    if (typeof block !== "object" || block === null) throw boundaryFailure();
    const typeDescriptor = ownEnumerableDataDescriptor(block, "type");
    if (typeDescriptor.value !== "text") continue;
    if (textBlocks > 0) addBytes(state, 1);
    textBlocks += 1;
  }
}

function assertPlainRecord(value: object): asserts value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw boundaryFailure();
}

function canonicalArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}

export function assertMcpToolResultWithinBudget(result: CallToolResult): void {
  const state: BudgetState = { bytes: 0, nodes: 0 };
  countJoinedTextBlockNewlines(result, state);

  const active = new Set<object>();
  const stack: WorkItem[] = [{ kind: "value", value: result, parentDepth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop()!;

    if (item.kind === "exit") {
      assertFinalContainerProperties(item.value);
      active.delete(item.value);
      continue;
    }

    if (item.kind === "array") {
      if (item.index >= item.length) continue;
      if (item.index > 0) addBytes(state, 1);
      const descriptor = Object.getOwnPropertyDescriptor(item.value, String(item.index));
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw boundaryFailure();
      }
      stack.push({ ...item, index: item.index + 1 });
      stack.push({ kind: "value", value: descriptor.value, parentDepth: item.depth });
      continue;
    }

    if (item.kind === "object") {
      const next = item.keys.next();
      if (next.done) continue;
      const descriptor = Object.getOwnPropertyDescriptor(item.value, next.value);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
        throw boundaryFailure();
      }
      if (!item.first) addBytes(state, 1);
      addJsonString(state, next.value);
      addBytes(state, 1);
      stack.push({ ...item, first: false });
      stack.push({ kind: "value", value: descriptor.value, parentDepth: item.depth });
      continue;
    }

    state.nodes += 1;
    if (state.nodes > DATAHUB_MCP_BOUNDARY_POLICY.maxJsonNodes) throw boundaryFailure();

    const value = item.value;
    if (value === null) {
      addBytes(state, 4);
      continue;
    }
    if (typeof value === "string") {
      addJsonString(state, value);
      continue;
    }
    if (typeof value === "boolean") {
      addBytes(state, value ? 4 : 5);
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw boundaryFailure();
      addBytes(state, String(Object.is(value, -0) ? 0 : value).length);
      continue;
    }
    if (typeof value !== "object") throw boundaryFailure();

    const depth = item.parentDepth + 1;
    if (depth > DATAHUB_MCP_BOUNDARY_POLICY.maxJsonDepth) throw boundaryFailure();
    if (active.has(value)) throw boundaryFailure();
    active.add(value);
    addBytes(state, 2);
    stack.push({ kind: "exit", value });

    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw boundaryFailure();
      const length = arrayLength(value);
      if (length > DATAHUB_MCP_BOUNDARY_POLICY.maxJsonNodes) throw boundaryFailure();
      stack.push({
        kind: "array",
        value,
        index: 0,
        length,
        depth,
      });
      continue;
    }

    assertPlainRecord(value);
    stack.push({
      kind: "object",
      value,
      keys: ownJsonKeys(value),
      depth,
      first: true,
    });
  }
}
