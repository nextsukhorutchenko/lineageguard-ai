export interface RequestLease {
  readonly generation: number;
  readonly controller: AbortController;
}

export interface RequestOwner {
  begin(): RequestLease;
  cancel(): void;
  finish(lease: RequestLease): boolean;
  isCurrent(lease: RequestLease): boolean;
  isInFlight(): boolean;
}

export function createRequestOwner(): RequestOwner {
  let generation = 0;
  let current: RequestLease | undefined;

  return {
    begin(): RequestLease {
      current?.controller.abort();
      generation += 1;
      current = { generation, controller: new AbortController() };
      return current;
    },
    cancel(): void {
      current?.controller.abort();
    },
    finish(lease: RequestLease): boolean {
      if (current !== lease || current.generation !== lease.generation) return false;
      current = undefined;
      return true;
    },
    isCurrent: (lease: RequestLease): boolean =>
      current === lease && current.generation === lease.generation,
    isInFlight: (): boolean => current !== undefined,
  };
}
