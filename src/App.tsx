import { useState, useCallback } from "react";
import { ServiceMatrix } from "./ServiceMatrix";
import type { ServiceOfferingState } from "./types";
import "./index.css";

const DEFAULT_GRAPHQL_URL =
  "https://switchboard-staging.powerhouse.xyz/graphql";
const DEFAULT_ID = "d57609a0-956e-457e-b460-021531c3ec18";

const QUERY = `
query ServiceOfferings($filter: RSServiceOfferingsFilter) {
  serviceOfferings(filter: $filter) {
    id
    operatorId
    resourceTemplateId
    title
    summary
    description
    thumbnailUrl
    infoLink
    status
    lastModified
    availableBillingCycles
    facetTargets {
      id
      categoryKey
      categoryLabel
      selectedOptions
    }
    services {
      id
      title
      description
      displayOrder
      isSetupFormation
      optionGroupId
    }
    tiers {
      id
      name
      description
      isCustomPricing
      pricingMode
      pricing {
        amount
        currency
      }
      defaultBillingCycle
      billingCycleDiscounts {
        billingCycle
        discountRule {
          discountType
          discountValue
        }
      }
      serviceLevels {
        id
        serviceId
        level
        customValue
        optionGroupId
      }
      usageLimits {
        id
        serviceId
        metric
        unitName
        freeLimit
        paidLimit
        resetCycle
        notes
        unitPrice
        unitPriceCurrency
      }
    }
    optionGroups {
      id
      name
      description
      isAddOn
      defaultSelected
      pricingMode
      standalonePricing {
        setupCost {
          amount
          currency
          discount {
            discountType
            discountValue
          }
        }
        recurringPricing {
          id
          billingCycle
          amount
          currency
          discount {
            discountType
            discountValue
          }
        }
      }
      tierDependentPricing {
        id
        tierId
        setupCost {
          amount
          currency
          discount {
            discountType
            discountValue
          }
        }
        setupCostDiscounts {
          billingCycle
          discountRule {
            discountType
            discountValue
          }
        }
        recurringPricing {
          id
          billingCycle
          amount
          currency
          discount {
            discountType
            discountValue
          }
        }
      }
      costType
      availableBillingCycles
      billingCycleDiscounts {
        billingCycle
        discountRule {
          discountType
          discountValue
        }
      }
      discountMode
      price
      currency
    }
  }
}
`;

export function App() {
  const [serviceOfferingId, setServiceOfferingId] = useState(DEFAULT_ID);
  const [inputValue, setInputValue] = useState(DEFAULT_ID);
  const [graphqlUrl, setGraphqlUrl] = useState(DEFAULT_GRAPHQL_URL);
  const [urlInput, setUrlInput] = useState(DEFAULT_GRAPHQL_URL);
  const [data, setData] = useState<ServiceOfferingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchOffering = useCallback(
    (id: string) => {
      setLoading(true);
      setError(null);
      setData(null);
      setServiceOfferingId(id);
      setGraphqlUrl(urlInput.trim() || DEFAULT_GRAPHQL_URL);

      fetch(urlInput.trim() || DEFAULT_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: QUERY,
        variables: { filter: { id } },
      }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.errors) {
          setError(json.errors[0]?.message || "GraphQL error");
          return;
        }
        const offerings = json.data?.serviceOfferings;
        if (offerings?.length > 0) {
          setData(offerings[0] as ServiceOfferingState);
        } else {
          setError("No service offerings found for this ID");
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
    },
    [urlInput],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      fetchOffering(inputValue.trim());
    }
  };

  return (
    <div className="app">
      <div className="app__header">
        <h1 className="app__title">Service Offering Pricing Matrix</h1>
        <form className="app__fetch-bar" onSubmit={handleSubmit}>
          <label className="app__fetch-label" htmlFor="graphql-url">
            GraphQL Endpoint:
          </label>
          <input
            id="graphql-url"
            className="app__fetch-input"
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="GraphQL endpoint URL..."
          />
        </form>
        <form className="app__fetch-bar" onSubmit={handleSubmit}>
          <label className="app__fetch-label" htmlFor="offering-id">
            Service Offering ID:
          </label>
          <input
            id="offering-id"
            className="app__fetch-input"
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Paste service offering ID..."
          />
          <button className="app__fetch-btn" type="submit" disabled={loading}>
            {loading ? "Loading..." : "Fetch"}
          </button>
        </form>
        {serviceOfferingId && data && (
          <div className="app__meta">
            <span className="app__meta-title">{data.title}</span>
            <span className="app__meta-id">ID: {serviceOfferingId}</span>
            <span className="app__meta-id">{graphqlUrl}</span>
          </div>
        )}
      </div>

      {loading && (
        <div className="app__status">Loading service offering...</div>
      )}
      {error && (
        <div className="app__status app__status--error">Error: {error}</div>
      )}
      {data && <ServiceMatrix offeringState={data} serviceOfferingId={serviceOfferingId} graphqlUrl={graphqlUrl} />}
      {!data && !loading && !error && (
        <div className="app__status">
          Click "Fetch" to load the service offering.
        </div>
      )}
    </div>
  );
}

export default App;
