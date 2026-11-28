// TASK-093: every MCP write tool requires a requestId. Existing write-tool tests describe one
// intended change per call, so each call gets its own fresh id here unless the test sets
// `requestId` itself (including to undefined, which JSON drops, to test a missing id). Tests that
// exercise replay or reuse pass their requestId explicitly.
export const WRITE_TOOL_NAMES = Object.freeze([
  'record_ready_food',
  'consume_ready_food',
  'mark_out_of_stock',
  'mark_in_stock',
  'set_stock_level',
  'set_inventory_quantity',
  'consume_stock',
  'add_stock'
]);

let counter = 0;

export function freshRequestId() {
  counter += 1;
  return 'test-request-' + String(counter).padStart(6, '0');
}

export function withRequestId(name, args) {
  if (!WRITE_TOOL_NAMES.includes(name) || args == null || typeof args !== 'object' || Array.isArray(args) ||
      Object.hasOwn(args, 'requestId')) {
    return args;
  }
  return Object.assign({ requestId: freshRequestId() }, args);
}
