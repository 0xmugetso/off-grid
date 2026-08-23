import { parseUsdc } from "./money";

export interface CircleWireDepositCandidate {
  id?: string;
  amount?: { amount?: string; currency?: string };
  createDate?: string;
}

export function selectCircleMintWireDeposit<T extends CircleWireDepositCandidate>(
  deposits: T[],
  input: { amount: string; submittedAfter: string; excludedIds?: string[] },
) {
  const submittedAfter = new Date(input.submittedAfter).getTime();
  const excluded = new Set(input.excludedIds ?? []);

  return deposits
    .filter((deposit) => {
      if (!deposit.id || excluded.has(deposit.id)) return false;
      if (!deposit.amount?.amount || deposit.amount.currency !== "USD") return false;
      if (!deposit.createDate || new Date(deposit.createDate).getTime() < submittedAfter) return false;
      try {
        return parseUsdc(deposit.amount.amount) === parseUsdc(input.amount);
      } catch {
        return false;
      }
    })
    .sort((a, b) => new Date(a.createDate!).getTime() - new Date(b.createDate!).getTime())[0] ?? null;
}
