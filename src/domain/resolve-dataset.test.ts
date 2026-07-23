import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import type { ChangeIntent } from "./change-intent.js";
import { findUniqueCanonicalDatasetUrnMatch, resolveDataset } from "./resolve-dataset.js";

const intent = (datasetHint: string): ChangeIntent => ({
  kind: "rename_column",
  datasetHint,
  sourceColumn: "customer_id",
  targetColumn: "customer_key",
});

describe("findUniqueCanonicalDatasetUrnMatch", () => {
  const canonical = "urn:li:dataset:(urn:li:dataPlatform:snowflake,Orders,PROD)";
  const matching = {
    urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD)",
    name: "orders",
    platform: "snowflake",
  };

  it("finds exactly one candidate by explicit canonical dataset URN", () => {
    expect(findUniqueCanonicalDatasetUrnMatch(canonical, [matching])).toBe(matching);
  });

  it.each(["orders", "snowflake:orders"])("rejects noncanonical alias hint %s", (hint) => {
    expect(findUniqueCanonicalDatasetUrnMatch(hint, [matching])).toBeUndefined();
  });

  it("rejects a canonical hint matched only through candidate name", () => {
    expect(
      findUniqueCanonicalDatasetUrnMatch(canonical, [
        {
          urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,other,PROD)",
          name: canonical,
        },
      ]),
    ).toBeUndefined();
  });

  it("rejects an absent canonical candidate URN", () => {
    expect(findUniqueCanonicalDatasetUrnMatch(canonical, [])).toBeUndefined();
  });

  it("rejects duplicate normalized canonical candidate URNs", () => {
    expect(
      findUniqueCanonicalDatasetUrnMatch(canonical, [matching, { ...matching, urn: canonical }]),
    ).toBeUndefined();
  });
});

describe("resolveDataset", () => {
  it("resolves an exact dataset URN", () => {
    const candidate = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)",
      name: "b2fd91.order_entry_db.analytics.order_details",
      platform: "snowflake",
    };

    expect(resolveDataset(intent(candidate.urn), [candidate])).toEqual({
      ...candidate,
      environment: "PROD",
    });
  });

  it("resolves an unnamed candidate by exact URN when its display name falls back to identity", () => {
    const urn =
      "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.unnamed_orders,PROD)";

    expect(resolveDataset(intent(urn), [{ urn, name: urn }])).toEqual({
      urn,
      name: urn,
      platform: "snowflake",
      environment: "PROD",
    });
  });

  it("resolves an exact platform-qualified dataset name", () => {
    expect(
      resolveDataset(intent("snowflake:b2fd91.order_entry_db.analytics.order_details"), [
        {
          urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)",
          name: "b2fd91.order_entry_db.analytics.order_details",
          platform: "snowflake",
        },
        {
          urn: "urn:li:dataset:(urn:li:dataPlatform:dbt,b2fd91.ORDER_ENTRY_DB.analytics.order_details,PROD)",
          name: "b2fd91.ORDER_ENTRY_DB.analytics.order_details",
          platform: "dbt",
        },
      ]),
    ).toMatchObject({ platform: "snowflake" });
  });

  it("resolves an exact plain dataset name from a complete candidate set", () => {
    const candidate = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD)",
      name: "orders",
    };

    expect(resolveDataset(intent("orders"), [candidate])).toMatchObject({
      urn: candidate.urn,
      name: "orders",
    });
  });

  it("resolves a platform-qualified identity from a canonical DataHub dataset URN", () => {
    const candidate = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,account.database.schema.orders,PROD)",
      name: "ORDERS",
    };

    expect(resolveDataset(intent("snowflake:account.database.schema.orders"), [candidate])).toEqual(
      {
        ...candidate,
        platform: "snowflake",
        environment: "PROD",
      },
    );
  });

  it("preserves percent-encoded reserved characters in a canonical dataset name", () => {
    const candidate = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders%2Carchive%28daily%29,PROD)",
      name: "ORDERS ARCHIVE",
    };

    expect(resolveDataset(intent("snowflake:orders%2Carchive%28daily%29"), [candidate])).toEqual({
      ...candidate,
      platform: "snowflake",
      environment: "PROD",
    });
  });

  it("preserves a literal percent sequence accepted by pinned DataHub", () => {
    const candidate = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders%ZZarchive,PROD)",
      name: "ORDERS ARCHIVE",
    };

    expect(resolveDataset(intent("snowflake:orders%ZZarchive"), [candidate])).toEqual({
      ...candidate,
      platform: "snowflake",
      environment: "PROD",
    });
  });

  it("does not derive an identity from DataHub reserved symbol U+241F in a component", () => {
    const urn = "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders\u241Farchive,PROD)";

    expect(() =>
      resolveDataset(intent("snowflake:orders\u241Farchive"), [{ urn, name: "ORDERS" }]),
    ).toThrowError(expect.objectContaining({ code: "TARGET_NOT_FOUND" }));
  });

  it("also rejects ASCII unit separator U+001F as an additional safety guard", () => {
    const urn = "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders\u001Farchive,PROD)";

    expect(() =>
      resolveDataset(intent("snowflake:orders\u001Farchive"), [{ urn, name: "ORDERS" }]),
    ).toThrowError(expect.objectContaining({ code: "TARGET_NOT_FOUND" }));
  });

  it.each([
    {
      label: "an extra top-level component",
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD,DEV)",
      hint: "snowflake:orders,PROD",
    },
    {
      label: "a raw comma in the dataset component",
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,archive,PROD)",
      hint: "snowflake:orders,archive",
    },
    {
      label: "raw parentheses in the dataset component",
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,orders(daily),PROD)",
      hint: "snowflake:orders(daily)",
    },
  ])("does not derive an identity from a dataset URN with $label", ({ urn, hint }) => {
    expect(() => resolveDataset(intent(hint), [{ urn, name: "ORDERS" }])).toThrowError(
      expect.objectContaining({ code: "TARGET_NOT_FOUND" }),
    );
  });

  it.each([
    "urn:li:chart:(urn:li:dataPlatform:snowflake,account.database.schema.orders)",
    "urn:li:dataset:(not-a-platform-urn,account.database.schema.orders,PROD)",
    "urn:li:dataset:(urn:li:dataPlatform:snowflake,account.database.schema.orders)",
  ])("does not derive a dataset identity from malformed or non-dataset URN: %s", (urn) => {
    expect(() =>
      resolveDataset(intent("snowflake:account.database.schema.orders"), [
        {
          urn,
          name: "ORDERS",
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: "TARGET_NOT_FOUND" }));
  });

  it("rejects a request with no exact candidate", () => {
    expect(() => resolveDataset(intent("snowflake:orders"), [])).toThrowError(AppError);
    expect(() => resolveDataset(intent("snowflake:orders"), [])).toThrowError(
      expect.objectContaining({ code: "TARGET_NOT_FOUND" }),
    );
  });

  it("requests clarification for multiple exact candidates in URN order", () => {
    const zeta = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,zeta,PROD)",
      name: "orders",
      platform: "snowflake",
    };
    const alpha = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,alpha,PROD)",
      name: "orders",
      platform: "snowflake",
    };

    expect(() => resolveDataset(intent("orders"), [zeta, alpha])).toThrowError(AppError);
    expect(() => resolveDataset(intent("orders"), [zeta, alpha])).toThrowError(
      expect.objectContaining({
        code: "NEEDS_USER_CLARIFICATION",
        details: {
          candidates: [alpha.urn, zeta.urn],
        },
      }),
    );
  });
});
