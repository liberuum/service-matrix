import type {
  ServiceOfferingState,
  ServiceOfferingPHState,
} from "@powerhousedao/service-offering/document-models/service-offering";

export type { ServiceOfferingState };

/**
 * Wraps a raw ServiceOfferingState (from GraphQL API) into the shape
 * expected by getUserSelectionPriceBreakdown.
 *
 * The function only reads state.global, so we can safely cast
 * even though PHBaseState has auth/document fields we don't provide.
 */
export function mapToOfferingState(
  offering: ServiceOfferingState,
): ServiceOfferingPHState {
  return {
    global: offering,
    local: {} as Record<PropertyKey, never>,
  } as ServiceOfferingPHState;
}
