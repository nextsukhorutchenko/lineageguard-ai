import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { parseChangeIntent } from "./change-intent.js";

describe("parseChangeIntent", () => {
  it("parses the single supported rename grammar", () => {
    expect(
      parseChangeIntent(
        "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details",
      ),
    ).toEqual({
      kind: "rename_column",
      datasetHint: "snowflake:b2fd91.order_entry_db.analytics.order_details",
      sourceColumn: "customer_id",
      targetColumn: "customer_key",
    });
  });

  it("accepts an exact canonical DataHub URN containing structural commas", () => {
    expect(
      parseChangeIntent(
        "Rename column customer_id to customer_key in dataset urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)",
      ),
    ).toMatchObject({
      datasetHint: "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders,PROD)",
    });
  });

  it("accepts action-like words inside a canonical DataHub dataset-name component", () => {
    const datasetHint =
      "urn:li:dataset:(urn:li:dataPlatform:snowflake,analytics.orders and remove history,PROD)";

    expect(
      parseChangeIntent(`Rename column customer_id to customer_key in dataset ${datasetHint}`),
    ).toMatchObject({ datasetHint });
  });

  it.each([
    "Drop column customer_id in dataset snowflake:orders",
    "Rename customer_id in dataset snowflake:orders",
    "Rename column customer_id to customer_key and drop email in dataset snowflake:orders",
    "Rename column customer_id to customer_key in dataset snowflake:orders; drop column email",
    "Rename column customer_id to customer_key in dataset snowflake:orders, drop column email",
    "Rename column customer_id to customer_key in dataset snowflake:orders, alter column email",
    "Rename column customer_id to customer_key in dataset snowflake:orders and remove email",
    "Rename column customer_id to customer_key in dataset snowflake:orders (and remove email)",
    "Rename column customer_id to customer_key in dataset urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD, drop column email)",
    "Rename column customer_id to customer_key in dataset urn:li:dataset:(urn:li:dataPlatform:snowflake,orders,PROD, drop column email",
    "Rename column customer_id to customer_key in dataset snowflake:orders. Drop column email",
    "Rename column customer_id to customer_key in dataset snowflake:orders\nDrop column email",
  ])("rejects unsupported or incomplete input: %s", (request) => {
    expect(() => parseChangeIntent(request)).toThrowError(AppError);
    expect(() => parseChangeIntent(request)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});
