export function createThreadSwitchGuard() {
  let latestRequestId = 0;

  return {
    begin(): number {
      latestRequestId += 1;
      return latestRequestId;
    },
    isCurrent(requestId: number): boolean {
      return requestId === latestRequestId;
    },
  };
}
