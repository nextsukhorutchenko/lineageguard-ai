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

  it.each([
    "Drop column customer_id in dataset snowflake:orders",
    "Rename customer_id in dataset snowflake:orders",
    "Rename column customer_id to customer_key and drop email in dataset snowflake:orders",
    "Rename column customer_id to customer_key in dataset snowflake:orders; drop column email",
    "Rename column customer_id to customer_key in dataset snowflake:orders. Drop column email",
    "Rename column customer_id to customer_key in dataset snowflake:orders\nDrop column email",
  ])("rejects unsupported or incomplete input: %s", (request) => {
    expect(() => parseChangeIntent(request)).toThrowError(AppError);
    expect(() => parseChangeIntent(request)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });
});
