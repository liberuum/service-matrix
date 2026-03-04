import { useState, useMemo, useCallback } from "react";
import {
  getUserSelectionPriceBreakdown,
  type PriceBreakdown,
  type ServiceOfferingState,
  type Service,
  type ServiceSubscriptionTier,
  type ServiceLevelBinding,
  type ServiceUsageLimit,
  type OptionGroup,
  type ServiceOfferingPHState,
} from "@powerhousedao/service-offering/document-models/service-offering";
import {
  formatPrice,
  BILLING_CYCLE_MONTHS,
  BILLING_CYCLE_LABELS,
  BILLING_CYCLE_SHORT_LABELS,
  RECURRING_BILLING_CYCLES,
  type BillingCycle,
} from "./pricing-utils";

const UNGROUPED_ID = "__ungrouped__";

const SERVICE_LEVELS = [
  { value: "INCLUDED", shortLabel: "\u2713", color: "#059669" },
  { value: "OPTIONAL", shortLabel: "Optional", color: "#0284c7" },
  { value: "NOT_INCLUDED", shortLabel: "\u2014", color: "#94a3b8" },
  { value: "NOT_APPLICABLE", shortLabel: "/", color: "#cbd5e1" },
  { value: "CUSTOM", shortLabel: "Custom", color: "#d97706" },
  { value: "VARIABLE", shortLabel: "#", color: "#7c3aed" },
] as const;

const CREATE_PRODUCT_INSTANCES_MUTATION = `
mutation CreateProductInstances($input: CreateProductInstancesInput!) {
  createProductInstances(input: $input) {
    success
    data
    errors
  }
}
`;

interface ServiceMatrixProps {
  offeringState: ServiceOfferingState;
  serviceOfferingId: string;
  graphqlUrl: string;
}

export function ServiceMatrix({ offeringState, serviceOfferingId, graphqlUrl }: ServiceMatrixProps) {
  const services = offeringState.services ?? [];
  const tiers = offeringState.tiers ?? [];
  const optionGroups = offeringState.optionGroups ?? [];

  const state = useMemo(
    () =>
      ({
        global: offeringState,
        local: {} as Record<PropertyKey, never>,
      }) as ServiceOfferingPHState,
    [offeringState],
  );

  // Interactive state
  const [selectedTierIdx, setSelectedTierIdx] = useState(0);
  const [activeBillingCycle, setActiveBillingCycle] =
    useState<BillingCycle>("MONTHLY");
  const [enabledOptionalGroups, setEnabledOptionalGroups] = useState<
    Set<string>
  >(
    () =>
      new Set(
        optionGroups.filter((g) => g.defaultSelected).map((g) => g.id),
      ),
  );
  const [groupBillingCycles, setGroupBillingCycles] = useState<
    Record<string, BillingCycle>
  >({});
  const [addonBillingCycles, setAddonBillingCycles] = useState<
    Record<string, BillingCycle>
  >({});

  // Purchase modal state
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [purchaseName, setPurchaseName] = useState("");
  const [purchaseTeamName, setPurchaseTeamName] = useState("");
  const [purchaseEmail, setPurchaseEmail] = useState("");
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<{
    success: boolean;
    linkToDrive?: string;
    errors?: string[];
  } | null>(null);

  const isCustomBillingMode = useMemo(() => {
    const overrides = Object.values(groupBillingCycles);
    if (overrides.length === 0) return false;
    return overrides.some((cycle) => cycle !== activeBillingCycle);
  }, [groupBillingCycles, activeBillingCycle]);

  const handleGlobalCycleChange = useCallback((cycle: BillingCycle) => {
    setActiveBillingCycle(cycle);
    setGroupBillingCycles({});
  }, []);

  const toggleOptionalGroup = useCallback((groupId: string) => {
    setEnabledOptionalGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const handlePurchaseSubmit = useCallback(async () => {
    setPurchaseLoading(true);
    setPurchaseResult(null);
    try {
      const selectedTier = tiers[selectedTierIdx];
      const input = {
        serviceOfferingId,
        name: purchaseName,
        teamName: purchaseTeamName,
        customerEmail: purchaseEmail,
        userSelection: {
          tierId: selectedTier?.id ?? "",
          billingCycle: activeBillingCycle,
          optionGroupIds: [...enabledOptionalGroups],
          groupBillingCycleOverrides: Object.entries(groupBillingCycles).map(
            ([groupId, billingCycle]) => ({ groupId, billingCycle }),
          ),
          addonBillingCycleOverrides: Object.entries(addonBillingCycles).map(
            ([groupId, billingCycle]) => ({ groupId, billingCycle }),
          ),
        },
      };
      const res = await fetch(graphqlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: CREATE_PRODUCT_INSTANCES_MUTATION,
          variables: { input },
        }),
      });
      const json = await res.json();
      const result = json.data?.createProductInstances;
      if (result?.success) {
        const data = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
        setPurchaseResult({
          success: true,
          linkToDrive: data?.linkToDrive ?? data?.driveUrl ?? undefined,
        });
      } else {
        setPurchaseResult({
          success: false,
          errors: result?.errors ?? json.errors?.map((e: { message: string }) => e.message) ?? ["Unknown error"],
        });
      }
    } catch (err: unknown) {
      setPurchaseResult({
        success: false,
        errors: [(err as Error).message || "Network error"],
      });
    } finally {
      setPurchaseLoading(false);
    }
  }, [
    serviceOfferingId,
    graphqlUrl,
    purchaseName,
    purchaseTeamName,
    purchaseEmail,
    tiers,
    selectedTierIdx,
    activeBillingCycle,
    enabledOptionalGroups,
    groupBillingCycles,
    addonBillingCycles,
  ]);

  const openPurchaseModal = useCallback(() => {
    setPurchaseName("");
    setPurchaseTeamName("");
    setPurchaseEmail("");
    setPurchaseResult(null);
    setShowPurchaseModal(true);
  }, []);

  // Group classification
  const setupGroups = useMemo(
    () => optionGroups.filter((g) => g.costType === "SETUP"),
    [optionGroups],
  );
  const regularGroups = useMemo(
    () => optionGroups.filter((g) => g.costType !== "SETUP" && !g.isAddOn),
    [optionGroups],
  );
  const addonGroups = useMemo(
    () => optionGroups.filter((g) => g.isAddOn),
    [optionGroups],
  );

  const availableCycles = useMemo(() => {
    const globalCycles = offeringState.availableBillingCycles ?? [];
    if (globalCycles.length === 0) return RECURRING_BILLING_CYCLES;
    return RECURRING_BILLING_CYCLES.filter((c) => globalCycles.includes(c));
  }, [offeringState.availableBillingCycles]);

  // Group services by optionGroupId
  const groupedServices = useMemo(() => {
    const groups = new Map<string, Service[]>();
    optionGroups.forEach((g) => groups.set(g.id, []));
    groups.set(UNGROUPED_ID, []);

    services.forEach((service) => {
      const groupId = service.optionGroupId || UNGROUPED_ID;
      const groupServices = groups.get(groupId) || [];
      groupServices.push(service);
      groups.set(groupId, groupServices);
    });

    groups.forEach((groupServices) => {
      groupServices.sort(
        (a, b) => (a.displayOrder ?? 999) - (b.displayOrder ?? 999),
      );
    });

    return groups;
  }, [services, optionGroups]);

  const ungroupedSetupServices = useMemo(
    () =>
      (groupedServices.get(UNGROUPED_ID) || []).filter(
        (s) => s.isSetupFormation,
      ),
    [groupedServices],
  );
  const ungroupedRegularServices = useMemo(
    () =>
      (groupedServices.get(UNGROUPED_ID) || []).filter(
        (s) => !s.isSetupFormation,
      ),
    [groupedServices],
  );

  // Precompute price breakdowns for all tiers
  const tierBreakdowns = useMemo((): PriceBreakdown[] => {
    const addonIds = [...enabledOptionalGroups];
    return tiers.map((tier) =>
      getUserSelectionPriceBreakdown(state, {
        tierId: tier.id,
        billingCycle: activeBillingCycle,
        optionGroupIds: addonIds,
        groupBillingCycleOverrides: groupBillingCycles,
        addonBillingCycleOverrides: addonBillingCycles,
      }),
    );
  }, [
    tiers,
    optionGroups,
    activeBillingCycle,
    enabledOptionalGroups,
    groupBillingCycles,
    addonBillingCycles,
    state,
  ]);

  const getTierDisplayPrice = (tierIdx: number) => {
    const breakdown = tierBreakdowns[tierIdx];
    if (!breakdown) return null;
    const months = BILLING_CYCLE_MONTHS[activeBillingCycle];
    const undiscountedTotal =
      breakdown.tierCycleTotal +
      breakdown.addOnBreakdowns.reduce((s, a) => s + a.cycleAmount, 0);
    const discountedTotal = breakdown.totals.grandRecurringTotal;
    const monthlyEq =
      months > 0
        ? Math.round((discountedTotal / months) * 100) / 100
        : discountedTotal;
    const savingsPercent =
      undiscountedTotal > 0
        ? Math.round(
            ((undiscountedTotal - discountedTotal) / undiscountedTotal) * 100,
          )
        : 0;
    return {
      monthlyEquivalent: monthlyEq,
      billedTotal: discountedTotal,
      hasDiscount: savingsPercent > 0,
      savingsPercent,
    };
  };

  const getServiceLevelForTier = (
    serviceId: string,
    tier: ServiceSubscriptionTier,
  ) => tier.serviceLevels.find((sl) => sl.serviceId === serviceId);

  const getLevelDisplay = (
    serviceLevel: ServiceLevelBinding | undefined,
  ) => {
    if (!serviceLevel) return { label: "\u2014", color: "#94a3b8" };
    const level = serviceLevel.level;
    const config = SERVICE_LEVELS.find((l) => l.value === level);
    if (level === "CUSTOM" && serviceLevel.customValue) {
      return {
        label: serviceLevel.customValue,
        color: config?.color || "#d97706",
      };
    }
    return {
      label: config?.shortLabel || level,
      color: config?.color || "#94a3b8",
    };
  };

  const getUniqueMetricsForService = (serviceId: string): string[] => {
    const metricsSet = new Set<string>();
    tiers.forEach((tier) => {
      tier.usageLimits
        .filter((ul) => ul.serviceId === serviceId)
        .forEach((ul) => metricsSet.add(ul.metric));
    });
    return Array.from(metricsSet);
  };

  const getUsageLimitForMetric = (
    serviceId: string,
    metric: string,
    tier: ServiceSubscriptionTier,
  ): ServiceUsageLimit | undefined =>
    tier.usageLimits.find(
      (ul) => ul.serviceId === serviceId && ul.metric === metric,
    );

  // Render helpers
  const renderGroupSection = (
    group: OptionGroup,
    groupServices: Service[],
    isSetup: boolean,
    isOptional: boolean,
    isEnabled: boolean,
  ) => {
    if (groupServices.length === 0) return null;

    const headerClass = isSetup
      ? "matrix__group-header--setup"
      : isOptional
        ? "matrix__group-header--optional"
        : "matrix__group-header--regular";
    const rowClass = isSetup
      ? "matrix__service-row--setup"
      : isOptional
        ? "matrix__service-row--optional"
        : "matrix__service-row--regular";

    const effectiveBillingCycle = group.isAddOn
      ? activeBillingCycle
      : groupBillingCycles[group.id] || activeBillingCycle;

    // Get group breakdown for pricing display
    const groupBreakdown = isOptional
      ? tierBreakdowns[selectedTierIdx]?.addOnBreakdowns.find(
          (b) => b.optionGroupId === group.id,
        )
      : tierBreakdowns[selectedTierIdx]?.optionGroupBreakdowns.find(
          (b) => b.optionGroupId === group.id,
        );

    return (
      <tbody key={group.id}>
        <tr className={`matrix__group-header ${headerClass}`}>
          <td className={`matrix__group-header-sticky ${headerClass}`}>
            <div className="matrix__group-header-inner">
              {isOptional && (
                <button
                  onClick={() => toggleOptionalGroup(group.id)}
                  className={`matrix__group-toggle ${isEnabled ? "matrix__group-toggle--on" : "matrix__group-toggle--off"}`}
                >
                  <span className="matrix__group-toggle-knob" />
                </button>
              )}
              <div className="matrix__group-name-block">
                <span className="matrix__group-name">{group.name}</span>
                {group.isAddOn && (
                  <span className="matrix__group-subtitle">
                    Optional Add-on
                  </span>
                )}
              </div>
              {/* Group pricing info */}
              {!isSetup &&
                groupBreakdown &&
                (() => {
                  const bd = groupBreakdown;
                  const monthlyBase = bd.monthlyBase;
                  const recurringAmount = bd.recurringAmount;
                  const discount = bd.discount;
                  const currency = bd.currency;
                  if (
                    monthlyBase <= 0 &&
                    !group.standalonePricing?.setupCost
                  )
                    return null;
                  const setupCost = group.standalonePricing?.setupCost;
                  const months =
                    BILLING_CYCLE_MONTHS[effectiveBillingCycle];
                  const monthlyEq =
                    months > 0
                      ? Math.round((recurringAmount / months) * 100) / 100
                      : recurringAmount;
                  const savingsPct =
                    discount && discount.originalAmount > 0
                      ? Math.round(
                          ((discount.originalAmount -
                            discount.discountedAmount) /
                            discount.originalAmount) *
                            100,
                        )
                      : 0;
                  return (
                    <div className="matrix__addon-pricing-bar">
                      {monthlyBase > 0 && (
                        <span className="matrix__addon-price">
                          {formatPrice(
                            effectiveBillingCycle === "MONTHLY"
                              ? monthlyBase
                              : monthlyEq,
                            currency,
                          )}
                          /mo
                        </span>
                      )}
                      {effectiveBillingCycle !== "MONTHLY" &&
                        monthlyBase > 0 && (
                          <span className="matrix__addon-billed">
                            Billed{" "}
                            {formatPrice(recurringAmount, currency)}{" "}
                            {BILLING_CYCLE_LABELS[effectiveBillingCycle]}
                          </span>
                        )}
                      {savingsPct > 0 && (
                        <span className="matrix__addon-discount">
                          SAVE {Math.round(savingsPct)}%
                        </span>
                      )}
                      {setupCost && setupCost.amount > 0 && (
                        <span className="matrix__addon-setup">
                          +{" "}
                          {formatPrice(
                            setupCost.amount,
                            setupCost.currency || "USD",
                          )}{" "}
                          Setup
                        </span>
                      )}
                    </div>
                  );
                })()}
            </div>
          </td>
          <td
            colSpan={tiers.length}
            className={headerClass}
            style={{ textAlign: "center" }}
          >
            <span
              className={`matrix__group-badge ${
                isSetup || !isOptional
                  ? "matrix__group-badge--included"
                  : "matrix__group-badge--optional"
              }`}
            >
              {isSetup ? "INCLUDED" : isOptional ? "OPTIONAL" : "INCLUDED"}
            </span>
          </td>
        </tr>

        {groupServices.map((service) => {
          const metrics = getUniqueMetricsForService(service.id);
          return (
            <ServiceRow
              key={service.id}
              service={service}
              metrics={metrics}
              tiers={tiers}
              rowClass={rowClass}
              getServiceLevelForTier={getServiceLevelForTier}
              getUsageLimitForMetric={getUsageLimitForMetric}
              getLevelDisplay={getLevelDisplay}
              selectedTierIdx={selectedTierIdx}
            />
          );
        })}

        {/* Setup total row */}
        {isSetup &&
          (() => {
            const basePrice = group.price ?? 0;
            if (basePrice === 0) return null;
            const selectedTier = tiers[selectedTierIdx] ?? null;
            const tierPricing = selectedTier
              ? group.tierDependentPricing?.find(
                  (tp) => tp.tierId === selectedTier.id,
                )
              : null;
            const cycleDiscount = tierPricing?.setupCostDiscounts?.find(
              (d) => d.billingCycle === activeBillingCycle,
            );
            const genericDiscount = tierPricing?.setupCost?.discount;
            const discount =
              cycleDiscount?.discountRule ?? genericDiscount;
            let effectivePrice = basePrice;
            if (discount && discount.discountValue > 0) {
              if (discount.discountType === "PERCENTAGE") {
                effectivePrice =
                  basePrice * (1 - discount.discountValue / 100);
              } else {
                effectivePrice = Math.max(
                  0,
                  basePrice - discount.discountValue,
                );
              }
              effectivePrice =
                Math.round(effectivePrice * 100) / 100;
            }
            const curr = group.currency || "USD";
            const hasDiscount = effectivePrice !== basePrice;
            return (
              <tr className="matrix__setup-total-row">
                <td>TOTAL SETUP FEE</td>
                <td
                  colSpan={tiers.length}
                  style={{ textAlign: "center" }}
                >
                  {hasDiscount ? (
                    <>
                      <span
                        style={{
                          textDecoration: "line-through",
                          opacity: 0.5,
                          marginRight: 6,
                        }}
                      >
                        {formatPrice(basePrice, curr)}
                      </span>
                      {formatPrice(effectivePrice, curr)} flat fee
                    </>
                  ) : (
                    `${formatPrice(basePrice, curr)} flat fee`
                  )}
                </td>
              </tr>
            );
          })()}

        {/* Add-on subtotal row */}
        {isOptional &&
          (() => {
            const baseMonthly = isEnabled
              ? (groupBreakdown?.monthlyBase ?? 0)
              : 0;
            const adjustedTotal = isEnabled
              ? (groupBreakdown?.recurringAmount ?? 0)
              : 0;
            const setupCost = isEnabled
              ? (group.standalonePricing?.setupCost?.amount ?? 0)
              : 0;
            const billingLabel = `/${BILLING_CYCLE_SHORT_LABELS[effectiveBillingCycle].toLowerCase()}`;
            const currency =
              groupBreakdown?.currency || group.currency || "USD";
            return (
              <tr className={`matrix__total-row ${headerClass}`}>
                <td className={headerClass}>SUBTOTAL</td>
                <td
                  colSpan={tiers.length}
                  style={{ textAlign: "center" }}
                >
                  {isEnabled && (baseMonthly > 0 || setupCost > 0) ? (
                    <>
                      {baseMonthly > 0 &&
                        `+${formatPrice(adjustedTotal, currency)}${billingLabel}`}
                      {baseMonthly > 0 && setupCost > 0 && " + "}
                      {setupCost > 0 &&
                        `${formatPrice(setupCost, currency)} setup`}
                    </>
                  ) : isEnabled ? (
                    "Included"
                  ) : (
                    "\u2014"
                  )}
                </td>
              </tr>
            );
          })()}
      </tbody>
    );
  };

  const selectedTierName = tiers[selectedTierIdx]?.name ?? "—";
  const enabledAddonNames = addonGroups
    .filter((g) => enabledOptionalGroups.has(g.id))
    .map((g) => g.name);

  return (
    <div className="matrix">
      {/* Purchase Service Button */}
      <div className="matrix__purchase-bar">
        <button className="matrix__purchase-btn" onClick={openPurchaseModal}>
          Purchase Service
        </button>
      </div>

      {/* Purchase Modal */}
      {showPurchaseModal && (
        <div className="matrix__modal-overlay" onClick={() => !purchaseLoading && setShowPurchaseModal(false)}>
          <div className="matrix__modal" onClick={(e) => e.stopPropagation()}>
            {purchaseResult?.success ? (
              <>
                <h2 className="matrix__modal-title">Purchase Successful</h2>
                <div className="matrix__modal-success">
                  <p>Your service has been provisioned successfully.</p>
                  {purchaseResult.linkToDrive && (
                    <a
                      href={purchaseResult.linkToDrive}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="matrix__modal-drive-link"
                    >
                      Open Drive
                    </a>
                  )}
                </div>
                <div className="matrix__modal-actions">
                  <button
                    className="matrix__modal-btn matrix__modal-btn--secondary"
                    onClick={() => setShowPurchaseModal(false)}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="matrix__modal-title">Purchase Service</h2>

                <div className="matrix__modal-summary">
                  <div className="matrix__modal-summary-row">
                    <span className="matrix__modal-summary-label">Tier</span>
                    <span className="matrix__modal-summary-value">{selectedTierName}</span>
                  </div>
                  <div className="matrix__modal-summary-row">
                    <span className="matrix__modal-summary-label">Billing Cycle</span>
                    <span className="matrix__modal-summary-value">{BILLING_CYCLE_LABELS[activeBillingCycle]}</span>
                  </div>
                  {enabledAddonNames.length > 0 && (
                    <div className="matrix__modal-summary-row">
                      <span className="matrix__modal-summary-label">Add-ons</span>
                      <span className="matrix__modal-summary-value">{enabledAddonNames.join(", ")}</span>
                    </div>
                  )}
                </div>

                <label className="matrix__modal-label">
                  Name
                  <input
                    className="matrix__modal-input"
                    type="text"
                    value={purchaseName}
                    onChange={(e) => setPurchaseName(e.target.value)}
                    disabled={purchaseLoading}
                  />
                </label>
                <label className="matrix__modal-label">
                  Team Name
                  <input
                    className="matrix__modal-input"
                    type="text"
                    value={purchaseTeamName}
                    onChange={(e) => setPurchaseTeamName(e.target.value)}
                    disabled={purchaseLoading}
                  />
                </label>
                <label className="matrix__modal-label">
                  Customer Email
                  <input
                    className="matrix__modal-input"
                    type="email"
                    value={purchaseEmail}
                    onChange={(e) => setPurchaseEmail(e.target.value)}
                    disabled={purchaseLoading}
                  />
                </label>

                {purchaseResult?.errors && (
                  <div className="matrix__modal-errors">
                    {purchaseResult.errors.map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                )}

                <div className="matrix__modal-actions">
                  <button
                    className="matrix__modal-btn matrix__modal-btn--secondary"
                    onClick={() => setShowPurchaseModal(false)}
                    disabled={purchaseLoading}
                  >
                    Cancel
                  </button>
                  <button
                    className="matrix__modal-btn matrix__modal-btn--primary"
                    onClick={handlePurchaseSubmit}
                    disabled={purchaseLoading || !purchaseName.trim() || !purchaseEmail.trim()}
                  >
                    {purchaseLoading ? "Submitting..." : "Submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Billing Cycle Selector */}
      <div className="matrix__billing-cycle-bar">
        <div className="matrix__billing-cycle-tabs">
          {availableCycles.map((cycle) => {
            // Compute discount badge for this cycle
            const addonIds = [...enabledOptionalGroups];
            let savingsPct = 0;
            if (cycle !== "MONTHLY" && tiers.length > 0) {
              const bd = getUserSelectionPriceBreakdown(state, {
                tierId: tiers[selectedTierIdx]?.id ?? "",
                billingCycle: cycle,
                optionGroupIds: addonIds,
                groupBillingCycleOverrides: {},
                addonBillingCycleOverrides: {},
              });
              const undiscounted =
                bd.tierCycleTotal +
                bd.addOnBreakdowns.reduce((s, a) => s + a.cycleAmount, 0);
              const discounted = bd.totals.grandRecurringTotal;
              savingsPct =
                undiscounted > 0
                  ? Math.round(
                      ((undiscounted - discounted) / undiscounted) * 100,
                    )
                  : 0;
            }
            return (
              <button
                key={cycle}
                onClick={() => handleGlobalCycleChange(cycle)}
                className={`matrix__billing-cycle-tab ${
                  !isCustomBillingMode && activeBillingCycle === cycle
                    ? "matrix__billing-cycle-tab--active"
                    : ""
                }`}
              >
                {BILLING_CYCLE_SHORT_LABELS[cycle]}
                {savingsPct > 0 && (
                  <span className="matrix__cycle-save-badge">
                    Save {savingsPct} %
                  </span>
                )}
              </button>
            );
          })}
          {isCustomBillingMode && (
            <span className="matrix__billing-cycle-tab matrix__billing-cycle-tab--custom matrix__billing-cycle-tab--active">
              Custom
            </span>
          )}
        </div>
      </div>

      <div className="matrix__table-wrap">
        <table className="matrix__table">
          <thead>
            <tr>
              <th className="matrix__corner-cell">
                <span className="matrix__section-label">
                  SERVICE CATALOG
                </span>
              </th>
              {tiers.map((tier, idx) => {
                const cyclePrice = tier.isCustomPricing
                  ? null
                  : getTierDisplayPrice(idx);
                const tierCurrency =
                  tierBreakdowns[idx]?.tierCurrency || "USD";

                // Per-contributor metric
                const perContributorMetric = tiers[idx]?.usageLimits?.find(
                  (ul) => ul.metric?.toLowerCase().includes("contributor"),
                );
                const perContributorPrice = perContributorMetric?.unitPrice;

                return (
                  <th
                    key={tier.id}
                    onClick={() => setSelectedTierIdx(idx)}
                    className={`matrix__tier-header ${
                      idx === selectedTierIdx
                        ? "matrix__tier-header--selected"
                        : ""
                    }`}
                  >
                    <div className="matrix__tier-header-inner">
                      <div className="matrix__tier-radio" />
                      <span className="matrix__tier-name">
                        {tier.name}
                      </span>
                      {tier.isCustomPricing ? (
                        <span className="matrix__tier-price">Custom</span>
                      ) : cyclePrice ? (
                        <>
                          <span className="matrix__tier-price-main">
                            {formatPrice(
                              cyclePrice.monthlyEquivalent,
                              tierCurrency,
                            )}
                            <span className="matrix__tier-price-unit">
                              /mo
                            </span>
                          </span>
                          {!isCustomBillingMode &&
                            activeBillingCycle !== "MONTHLY" && (
                              <span className="matrix__tier-billed">
                                Billed{" "}
                                {formatPrice(
                                  cyclePrice.billedTotal,
                                  tierCurrency,
                                )}{" "}
                                {BILLING_CYCLE_LABELS[activeBillingCycle]}
                              </span>
                            )}
                          {perContributorPrice != null &&
                            perContributorPrice > 0 && (
                              <span className="matrix__tier-billed">
                                ~{formatPrice(perContributorPrice, tierCurrency)}{" "}
                                per Contributor
                              </span>
                            )}
                          {!isCustomBillingMode &&
                            cyclePrice.hasDiscount &&
                            cyclePrice.savingsPercent > 0 && (
                              <span className="matrix__tier-discount-badge">
                                SAVE {cyclePrice.savingsPercent}%
                              </span>
                            )}
                        </>
                      ) : (
                        <span className="matrix__tier-price">&mdash;</span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Setup Groups */}
          {setupGroups.map((group) =>
            renderGroupSection(
              group,
              groupedServices.get(group.id) || [],
              true,
              false,
              true,
            ),
          )}
          {ungroupedSetupServices.length > 0 &&
            renderGroupSection(
              {
                id: UNGROUPED_ID + "-setup",
                name: "Setup & Formation",
                description: null,
                isAddOn: false,
                defaultSelected: true,
                availableBillingCycles: [],
                billingCycleDiscounts: [],
                costType: null,
                currency: null,
                price: null,
                pricingMode: null,
                standalonePricing: null,
                tierDependentPricing: null,
                discountMode: null,
              } as OptionGroup,
              ungroupedSetupServices,
              true,
              false,
              true,
            )}

          {/* Regular Groups */}
          {regularGroups.map((group) =>
            renderGroupSection(
              group,
              groupedServices.get(group.id) || [],
              false,
              false,
              true,
            ),
          )}
          {ungroupedRegularServices.length > 0 &&
            renderGroupSection(
              {
                id: UNGROUPED_ID + "-regular",
                name: "Recurring Services",
                description: null,
                isAddOn: false,
                defaultSelected: true,
                availableBillingCycles: [],
                billingCycleDiscounts: [],
                costType: null,
                currency: null,
                price: null,
                pricingMode: null,
                standalonePricing: null,
                tierDependentPricing: null,
                discountMode: null,
              } as OptionGroup,
              ungroupedRegularServices,
              false,
              false,
              true,
            )}

          {/* Add-on Groups */}
          {addonGroups.map((group) =>
            renderGroupSection(
              group,
              groupedServices.get(group.id) || [],
              false,
              true,
              enabledOptionalGroups.has(group.id),
            ),
          )}
        </table>

        {/* Grand Total - Sticky at bottom */}
        <div className="matrix__grand-total-sticky">
          <table className="matrix__table">
            <tbody>
              {/* Recurring Tier Price */}
              {!isCustomBillingMode ? (
                <tr className="matrix__grand-total-row">
                  <td>
                    Recurring Tier Price
                    <span className="matrix__grand-total-cycle">
                      /
                      {BILLING_CYCLE_SHORT_LABELS[
                        activeBillingCycle
                      ].toLowerCase()}
                    </span>
                  </td>
                  {tiers.map((tier, idx) => {
                    const breakdown = tierBreakdowns[idx];
                    const discountedTotal =
                      breakdown?.totals.grandRecurringTotal ?? 0;
                    const undiscountedTotal =
                      (breakdown?.tierCycleTotal ?? 0) +
                      (breakdown?.addOnBreakdowns.reduce(
                        (s, a) => s + a.cycleAmount,
                        0,
                      ) ?? 0);
                    const savingsPct =
                      undiscountedTotal > 0
                        ? Math.round(
                            ((undiscountedTotal - discountedTotal) /
                              undiscountedTotal) *
                              100,
                          )
                        : 0;
                    return (
                      <td
                        key={tier.id}
                        className={
                          idx === selectedTierIdx
                            ? "matrix__grand-total-cell--selected"
                            : ""
                        }
                        style={{ textAlign: "center" }}
                      >
                        {idx === selectedTierIdx ? (
                          tier.isCustomPricing ? (
                            "Custom"
                          ) : (
                            <>
                              {formatPrice(
                                discountedTotal,
                                breakdown?.tierCurrency || "USD",
                              )}
                              {savingsPct > 0 && (
                                <span className="matrix__discount-tag">
                                  SAVE {savingsPct}%
                                </span>
                              )}
                            </>
                          )
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ) : (
                tierBreakdowns[
                  selectedTierIdx
                ]?.optionGroupBreakdowns.map((ogb) => (
                  <tr
                    key={`group-${ogb.optionGroupId}`}
                    className="matrix__grand-total-row"
                  >
                    <td>
                      {ogb.optionGroupName}
                      <span className="matrix__grand-total-cycle">
                        /
                        {BILLING_CYCLE_SHORT_LABELS[
                          ogb.effectiveBillingCycle
                        ].toLowerCase()}
                      </span>
                    </td>
                    {tiers.map((tier, idx) => (
                      <td
                        key={tier.id}
                        className={
                          idx === selectedTierIdx
                            ? "matrix__grand-total-cell--selected"
                            : ""
                        }
                        style={{ textAlign: "center" }}
                      >
                        {idx === selectedTierIdx ? (
                          tier.isCustomPricing ? (
                            "Custom"
                          ) : ogb.monthlyBase > 0 ? (
                            <>
                              {formatPrice(
                                ogb.recurringAmount,
                                ogb.currency,
                              )}
                              {ogb.discount &&
                                ogb.discount.discountValue > 0 && (
                                  <span className="matrix__discount-tag">
                                    SAVE{" "}
                                    {Math.round(
                                      ogb.discount.discountType ===
                                        "PERCENTAGE"
                                        ? ogb.discount.discountValue
                                        : ogb.cycleAmount > 0
                                          ? ((ogb.cycleAmount -
                                              ogb.recurringAmount) /
                                              ogb.cycleAmount) *
                                            100
                                          : 0,
                                    )}
                                    %
                                  </span>
                                )}
                            </>
                          ) : (
                            "\u2014"
                          )
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))
              )}

              {/* Add-on recurring rows */}
              {tierBreakdowns[selectedTierIdx]?.addOnBreakdowns
                .filter((ab) => ab.monthlyBase > 0)
                .map((ab) => (
                  <tr
                    key={`addon-${ab.optionGroupId}`}
                    className="matrix__grand-total-row matrix__grand-total-row--addon"
                  >
                    <td>
                      + {ab.optionGroupName}
                      <span className="matrix__grand-total-cycle">
                        /
                        {BILLING_CYCLE_SHORT_LABELS[
                          ab.selectedBillingCycle
                        ].toLowerCase()}
                      </span>
                    </td>
                    {tiers.map((tier, idx) => (
                      <td
                        key={tier.id}
                        className={
                          idx === selectedTierIdx
                            ? "matrix__grand-total-cell--selected"
                            : ""
                        }
                        style={{ textAlign: "center" }}
                      >
                        {idx === selectedTierIdx ? (
                          <>
                            +
                            {formatPrice(ab.recurringAmount, ab.currency)}
                            {ab.discount &&
                              ab.discount.discountValue > 0 && (
                                <span className="matrix__discount-tag">
                                  SAVE{" "}
                                  {Math.round(
                                    ab.discount.discountType ===
                                      "PERCENTAGE"
                                      ? ab.discount.discountValue
                                      : ab.cycleAmount > 0
                                        ? ((ab.cycleAmount -
                                            ab.recurringAmount) /
                                            ab.cycleAmount) *
                                          100
                                        : 0,
                                  )}
                                  %
                                </span>
                              )}
                          </>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                ))}

              {/* Add-on setup costs */}
              {tierBreakdowns[selectedTierIdx]?.addOnBreakdowns
                .filter(
                  (ab) => ab.setupCost !== null && ab.setupCost > 0,
                )
                .map((ab) => (
                  <tr
                    key={`addon-setup-${ab.optionGroupId}`}
                    className="matrix__grand-total-row matrix__grand-total-row--addon"
                  >
                    <td>
                      + {ab.optionGroupName}{" "}
                      <span className="matrix__grand-total-cycle">
                        (one-time setup)
                      </span>
                    </td>
                    {tiers.map((tier, idx) => (
                      <td
                        key={tier.id}
                        className={
                          idx === selectedTierIdx
                            ? "matrix__grand-total-cell--selected"
                            : ""
                        }
                        style={{ textAlign: "center" }}
                      >
                        {idx === selectedTierIdx
                          ? `${formatPrice(
                              ab.setupCost!,
                              ab.setupCostCurrency || "USD",
                            )} one-time`
                          : null}
                      </td>
                    ))}
                  </tr>
                ))}

              {/* Setup & Formation Fees */}
              {(() => {
                const setupBds =
                  tierBreakdowns[selectedTierIdx]
                    ?.setupGroupBreakdowns ?? [];
                const totalSetupBase = setupBds.reduce(
                  (sum, s) =>
                    sum +
                    (s.setupCostDiscount?.originalAmount ??
                      s.setupCost ??
                      0),
                  0,
                );
                const totalSetupEffective = setupBds.reduce(
                  (sum, s) => sum + (s.setupCost ?? 0),
                  0,
                );
                if (totalSetupBase === 0) return null;
                const hasDiscount =
                  totalSetupEffective !== totalSetupBase;
                return (
                  <tr className="matrix__grand-total-row matrix__grand-total-row--setup">
                    <td>+ Setup & Formation Fees</td>
                    {tiers.map((tier, idx) => (
                      <td
                        key={tier.id}
                        className={
                          idx === selectedTierIdx
                            ? "matrix__grand-total-cell--selected"
                            : ""
                        }
                        style={{ textAlign: "center" }}
                      >
                        {idx === selectedTierIdx
                          ? hasDiscount
                            ? `${formatPrice(totalSetupEffective, "USD")} one-time`
                            : `${formatPrice(totalSetupBase, "USD")} one-time`
                          : null}
                      </td>
                    ))}
                  </tr>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Service row sub-component
function ServiceRow({
  service,
  metrics,
  tiers,
  rowClass,
  getServiceLevelForTier,
  getUsageLimitForMetric,
  getLevelDisplay,
  selectedTierIdx,
}: {
  service: Service;
  metrics: string[];
  tiers: ServiceSubscriptionTier[];
  rowClass: string;
  getServiceLevelForTier: (
    serviceId: string,
    tier: ServiceSubscriptionTier,
  ) => ServiceLevelBinding | undefined;
  getUsageLimitForMetric: (
    serviceId: string,
    metric: string,
    tier: ServiceSubscriptionTier,
  ) => ServiceUsageLimit | undefined;
  getLevelDisplay: (sl: ServiceLevelBinding | undefined) => {
    label: string;
    color: string;
  };
  selectedTierIdx: number;
}) {
  return (
    <>
      <tr className={`matrix__service-row ${rowClass}`}>
        <td className={`matrix__service-cell ${rowClass}`}>
          <span className="matrix__service-title">{service.title}</span>
          {service.isSetupFormation && (
            <span className="matrix__service-setup-badge">Setup</span>
          )}
        </td>
        {tiers.map((tier, tierIdx) => {
          const serviceLevel = getServiceLevelForTier(service.id, tier);
          const display = getLevelDisplay(serviceLevel);
          const isNotIncluded =
            !serviceLevel || serviceLevel.level === "NOT_INCLUDED";

          return (
            <td
              key={tier.id}
              className={`matrix__level-cell ${
                tierIdx === selectedTierIdx
                  ? "matrix__level-cell--highlight"
                  : ""
              } ${isNotIncluded ? "matrix__level-cell--not-included" : ""}`}
            >
              <span
                className={`matrix__level-value ${isNotIncluded ? "matrix__level-value--not-included" : ""}`}
                style={{ color: display.color }}
              >
                {display.label}
              </span>
            </td>
          );
        })}
      </tr>

      {/* Metric rows */}
      {metrics.map((metric) => (
        <tr
          key={`${service.id}-${metric}`}
          className={`matrix__metric-row ${rowClass}`}
        >
          <td className={`matrix__metric-cell ${rowClass}`}>
            <div className="matrix__metric-name-wrapper">
              <span className="matrix__metric-name">{metric}</span>
            </div>
          </td>
          {tiers.map((tier, tierIdx) => {
            const usageLimit = getUsageLimitForMetric(
              service.id,
              metric,
              tier,
            );
            return (
              <td
                key={tier.id}
                className={`matrix__metric-value-cell ${
                  tierIdx === selectedTierIdx
                    ? "matrix__level-cell--highlight"
                    : ""
                }`}
              >
                {usageLimit ? (
                  <div className="matrix__metric-card">
                    <div className="matrix__metric-card-row">
                      <span className="matrix__metric-card-label">
                        Free
                      </span>
                      <span className="matrix__metric-card-value">
                        <strong>
                          {usageLimit.freeLimit ?? "\u221E"}
                        </strong>
                        {usageLimit.unitName
                          ? ` ${usageLimit.unitName}`
                          : ""}
                      </span>
                    </div>
                    {usageLimit.unitPrice != null &&
                      usageLimit.unitPrice > 0 && (
                        <div className="matrix__metric-card-row matrix__metric-card-row--overage">
                          <span className="matrix__metric-card-label">
                            Overage
                          </span>
                          <span className="matrix__metric-card-value matrix__metric-card-value--overage">
                            {formatPrice(
                              usageLimit.unitPrice,
                              usageLimit.unitPriceCurrency || "USD",
                            )}
                            /{usageLimit.unitName || "unit"}
                          </span>
                        </div>
                      )}
                  </div>
                ) : (
                  <span className="matrix__metric-empty">\u2014</span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
