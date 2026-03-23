# Service Matrix — Editor Context

## Architecture

The Service Matrix is a standalone React app (`src/App.tsx`) that fetches a `ServiceOfferingDocument` via GraphQL and renders it with `<ServiceMatrix>` and `<TheMatrix>`.

- **App.tsx** — Entry point. Fetches the offering document from a GraphQL endpoint, passes state to `<ServiceMatrix>`.
- **ServiceMatrix.tsx** — Wrapper that renders tabs/views including `<TheMatrix>`.
- **TheMatrix.tsx** — The main pricing matrix grid. Displays tiers as columns, service groups as row sections, with pricing totals in a sticky footer.
- **utils.ts** — Centralized price calculation engine (`getUserSelectionPriceBreakdown`). This is the single source of truth for all pricing math.
- **pricing-utils.ts** — Display helpers: `formatPrice`, billing cycle labels/constants, `detectMajorityCycle`.

## Default API URL

```
http://localhost:4001/graphql
```

## Price Calculation Model (utils.ts)

All pricing flows through `getUserSelectionPriceBreakdown(state, selection)` which returns a `PriceBreakdown`.

### UserSelection input

```ts
{
  tierId: string;              // selected tier
  billingCycle: BillingCycle;  // global cycle (MONTHLY | QUARTERLY | SEMI_ANNUAL | ANNUAL)
  optionGroupIds: string[];    // all selected group IDs (non-addon groups always included + user-toggled addons)
  groupBillingCycleOverrides?: Record<string, BillingCycle>;  // per-group cycle overrides (Custom billing mode)
  addonBillingCycleOverrides?: Record<string, BillingCycle>;  // per-addon cycle overrides
}
```

### Billing cycle multiplier

```ts
BILLING_CYCLE_MONTHS = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12, ONE_TIME: 0 }
```

Pricing amounts in the data model represent **monthly rates**. The cycle total = `monthlyRate * months`.

### Tier base price

```
tierMonthlyAmount = tier.pricing.amount ?? 0
tierCycleTotal = tierMonthlyAmount * (months || 1)
```

### Option group pricing resolution (`resolveGroupPricing`)

For each group, pricing is resolved in priority order:
1. **Tier-dependent pricing** — `group.tierDependentPricing.find(tp => tp.tierId === tier.id).recurringPricing`
2. **Standalone pricing** — `group.standalonePricing.recurringPricing`

Monthly base = the `MONTHLY` entry's `amount` (or 0).
Cycle amount = the entry matching `effectiveCycle`'s `amount * months` (falls back to monthlyBase * months).

### Discount application

Discounts are applied in priority order (first match wins):
1. **Direct cycle discount** — `cycleOption.discount` on the pricing entry itself
2. **Inherited tier discount** — when `group.discountMode === "INHERIT_TIER"`, uses `tier.billingCycleDiscounts` for the effective cycle

Discount types:
- `PERCENTAGE` — `amount * (1 - discountValue / 100)`
- `FLAT` — `amount - discountValue`

Result is clamped to `Math.max(0, ...)` and rounded to 2 decimal places.

### Setup costs

Setup costs come from `tierPricing.setupCost` or `group.standalonePricing.setupCost`. Setup cost discounts follow the same PERCENTAGE/FLAT logic.

### Grand recurring total

```
grandRecurringTotal = tierCycleTotal + sum(optionGroupBreakdowns.recurringAmount) + sum(addOnBreakdowns.recurringAmount)
```

Setup costs are NOT included in the grand recurring total — they are displayed separately as one-time fees.

### tierMonthlyBase

Sum of monthly base prices across selected regular (non-setup, non-addon) option groups. Used to display the "per month" base rate and to compare against the tier's fixed price.

### PriceBreakdown output

```ts
{
  tierCycleTotal: number;                  // tier base * months
  tierCurrency: string;                    // tier currency (default "USD")
  tierMonthlyBase: number;                 // sum of monthly bases for regular groups
  optionGroupBreakdowns: OptionGroupBreakdown[];  // regular groups
  setupGroupBreakdowns: OptionGroupBreakdown[];   // setup/formation groups
  addOnBreakdowns: AddOnBreakdown[];              // optional add-on groups
  totals: { grandRecurringTotal: number }         // final recurring total
}
```

## TheMatrix Display Logic

### Tier header pricing

- **CALCULATED mode** (`tier.pricingMode === "CALCULATED"`) — displays `tierMonthlyBase` (sum of group monthly rates)
- **Fixed mode** — displays `tier.pricing.amount`, with a warning badge if group sum exceeds it

### Grand total footer (sticky)

- **Global billing mode** — single "Recurring Tier Price" row showing `grandRecurringTotal` with savings badge
- **Custom billing mode** — itemized rows per option group showing individual `recurringAmount` with per-group cycle labels

Undiscounted total for savings% = `tierCycleTotal + sum(addOnBreakdowns.cycleAmount)`
Savings % = `round((undiscounted - discounted) / undiscounted * 100)`

### Add-on subtotals

Each add-on group shows `+recurringAmount/cycle` when enabled, with its own discount badge.

### Setup & Formation fees

Displayed as "one-time" amounts. Uses `setupGroupBreakdowns` from the price breakdown. Shows discounted price when setup cost discounts exist.

### Billing cycle behavior

- Global cycle selector filters by `state.global.availableBillingCycles`
- Per-group overrides create "Custom billing mode" (detected by `isCustomBillingMode`)
- Majority detection: when >50% of regular groups share a cycle different from global, auto-switches global cycle and clears overrides
- Switching global cycle resets all group overrides

### Group types

- **Regular groups** — `costType !== "SETUP" && !isAddOn` — always selected
- **Setup groups** — `costType === "SETUP"` — one-time formation fees
- **Add-on groups** — `isAddOn === true` — user-toggleable, independent cycle selection
