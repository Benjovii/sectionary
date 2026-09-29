// Closing a block's detail should go back to the page it was opened from (a
// flow, a site's page viewer) rather than to the wall. The link records the
// block it is opening just before it navigates; the wall checks for it and
// clears it when the detail closes.
//
// Module state rather than a URL flag: it only survives an in-app navigation,
// so a pasted or shared detail link can never send Back out of Sectionary.
// Keyed by block id and read without side effects, so React calling an
// initializer twice (strict mode) reads the same answer both times.

let pending: string | null = null;

/** Call from the link's onClick, before the navigation. */
export function markReturn(blockId: string): void {
  pending = blockId;
}

/** Whether this block was opened by a link that expects Back on close. */
export function returnsFor(blockId: string | null): boolean {
  return blockId !== null && pending === blockId;
}

export function clearReturn(): void {
  pending = null;
}
