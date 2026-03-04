import {
  BILLING_CYCLE_MONTHS,
  type BillingCycle,
} from "@powerhousedao/service-offering/document-models/service-offering";

export { BILLING_CYCLE_MONTHS };
export type { BillingCycle };

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
  SEMI_ANNUAL: "semi-annually",
  ANNUAL: "annually",
  ONE_TIME: "one-time",
};

export const BILLING_CYCLE_SHORT_LABELS: Record<BillingCycle, string> = {
  MONTHLY: "Month",
  QUARTERLY: "Quarter",
  SEMI_ANNUAL: "6 Months",
  ANNUAL: "Year",
  ONE_TIME: "One Time",
};

export const RECURRING_BILLING_CYCLES: BillingCycle[] = [
  "MONTHLY",
  "QUARTERLY",
  "SEMI_ANNUAL",
  "ANNUAL",
];

export function formatPrice(
  amount: number,
  currency: string = "USD",
): string {
  const symbol = currency === "USD" ? "$" : currency;
  return `${symbol}${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
