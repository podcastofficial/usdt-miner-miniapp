// Phase 2 / Part 5: small pure safety rules (unit-tested).
/** Auto-credit of deposits stays locked until at least one real deposit was verified on-chain AND approved by an admin by hand. */
export const autoCreditBlocked = (confirmedDeposits) =>
  Number(confirmedDeposits) >= 1 ? null
    : "Auto-credit stays OFF until a real small deposit has passed: send a tiny USDT amount, let it verify, approve it by hand in Admin > Deposits, then turn this on.";
