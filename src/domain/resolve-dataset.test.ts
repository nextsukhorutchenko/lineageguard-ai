import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import type { ChangeIntent } from "./change-intent.js";
import { resolveDataset } from "./resolve-dataset.js";

const intent = (datasetHint: string): ChangeIntent => ({
  kind: "rename_column",
  datasetHint,
  sourceColumn: "customer_id",
  targetColumn: "customer_key",
});

describe("resolveDataset", () => {
  it("resolves an exact dataset URN", () => {
    const candidate = {
      urn: "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)",
      name: "b2fd91.order_entry_db.analytics.order_details",
      platform: "snowflake",
    };

    expect(resolveDataset(intent(candidate.urn), [candidate])).toEqual(candidate);
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
