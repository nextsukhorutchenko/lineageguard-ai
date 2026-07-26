import { describe, expect, it } from "vitest";
import { parseSnowflakeObjectName, quoteSnowflakeIdentifier } from "./snowflake-identifiers.js";

describe("Snowflake identifiers", () => {
  it("accepts exactly database.schema.table", () => {
    expect(parseSnowflakeObjectName("ORDER_ENTRY_DB.ANALYTICS.ORDER_DETAILS")).toEqual({
      database: "ORDER_ENTRY_DB",
      schema: "ANALYTICS",
      table: "ORDER_DETAILS",
    });
  });

  it("does not strip the golden datapack prefix", () => {
    expect(
      parseSnowflakeObjectName("b2fd91.order_entry_db.analytics.order_details"),
    ).toBeUndefined();
  });

  it.each(["", "DB.TABLE", "DB.PUBLIC.TABLE.EXTRA", "DB.PUBLIC.order-details", "DB.PUBLIC.2TABLE"])(
    "rejects an invalid physical object name %j",
    (value) => {
      expect(parseSnowflakeObjectName(value)).toBeUndefined();
    },
  );

  it("quotes and escapes a validated identifier", () => {
    expect(quoteSnowflakeIdentifier('customer"key')).toBe('"customer""key"');
  });

  it.each(["", "customer\nkey", "customer\u2028key"])(
    "rejects an empty or control-bearing identifier %j",
    (value) => {
      expect(() => quoteSnowflakeIdentifier(value)).toThrow(
        "Snowflake identifiers must be non-empty printable text.",
      );
    },
  );
});
