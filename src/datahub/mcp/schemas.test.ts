import { describe, expect, it } from "vitest";
import {
  getEntitiesResponseSchema,
  lineageResponseSchema,
  schemaResponseSchema,
  searchResponseSchema,
} from "./schemas.js";

interface SafeParser {
  safeParse(value: unknown): { readonly success: boolean };
}

interface ArrayLimitCase {
  readonly label: string;
  readonly schema: SafeParser;
  readonly build: (length: number) => unknown;
  readonly maximum: number;
}

const topLevelCases: readonly ArrayLimitCase[] = [
  {
    label: "search results",
    schema: searchResponseSchema,
    build: (length) => ({
      start: 0,
      count: length,
      total: length,
      searchResults: Array.from({ length }, (_, index) => ({
        entity: { urn: `urn:li:dataset:(search-${index})` },
      })),
    }),
    maximum: 50,
  },
  {
    label: "schema fields",
    schema: schemaResponseSchema,
    build: (length) => ({
      urn: "urn:li:dataset:(schema)",
      offset: 0,
      fields: Array.from({ length }, (_, index) => ({ fieldPath: `field_${index}` })),
      totalFields: length,
      returned: length,
      remainingCount: 0,
    }),
    maximum: 100,
  },
  {
    label: "lineage results",
    schema: lineageResponseSchema,
    build: (length) => ({
      downstreams: {
        searchResults: Array.from({ length }, (_, index) => ({
          entity: { urn: `urn:li:dataset:(lineage-${index})` },
          degree: 1,
          lineageColumns: [],
        })),
        offset: 0,
        returned: length,
        hasMore: false,
      },
    }),
    maximum: 100,
  },
  {
    label: "entity results",
    schema: getEntitiesResponseSchema,
    build: (length) =>
      Array.from({ length }, (_, index) => ({
        urn: `urn:li:dataset:(entity-${index})`,
        type: "DATASET",
      })),
    maximum: 10,
  },
];

interface StringLimitCase {
  readonly label: string;
  readonly maximum: number;
  readonly build: (value: string) => unknown;
  readonly schema: SafeParser;
}

const stringCases: readonly StringLimitCase[] = [
  {
    label: "name",
    maximum: 500,
    build: (value) => ({
      start: 0,
      count: 1,
      total: 1,
      searchResults: [{ entity: { urn: "urn:li:dataset:test", name: value } }],
    }),
    schema: searchResponseSchema,
  },
  {
    label: "platform",
    maximum: 100,
    build: (value) => ({
      start: 0,
      count: 1,
      total: 1,
      searchResults: [
        {
          entity: { urn: "urn:li:dataset:test", platform: { name: value } },
        },
      ],
    }),
    schema: searchResponseSchema,
  },
  {
    label: "entity type",
    maximum: 100,
    build: (value) => [{ urn: "urn:li:dataset:test", type: value }],
    schema: getEntitiesResponseSchema,
  },
  {
    label: "native data type",
    maximum: 500,
    build: (value) => ({
      urn: "urn:li:dataset:test",
      offset: 0,
      fields: [{ fieldPath: "customer_id", nativeDataType: value }],
      totalFields: 1,
      returned: 1,
      remainingCount: 0,
    }),
    schema: schemaResponseSchema,
  },
  {
    label: "field path",
    maximum: 500,
    build: (value) => ({
      urn: "urn:li:dataset:test",
      offset: 0,
      fields: [{ fieldPath: value }],
      totalFields: 1,
      returned: 1,
      remainingCount: 0,
    }),
    schema: schemaResponseSchema,
  },
  {
    label: "lineage column",
    maximum: 500,
    build: (value) => ({
      downstreams: {
        searchResults: [
          {
            entity: { urn: "urn:li:dataset:test" },
            degree: 1,
            lineageColumns: [value],
          },
        ],
        offset: 0,
        returned: 1,
        hasMore: false,
      },
    }),
    schema: lineageResponseSchema,
  },
  {
    label: "description",
    maximum: 2_000,
    build: (value) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        properties: { description: value },
      },
    ],
    schema: getEntitiesResponseSchema,
  },
  {
    label: "entity error",
    maximum: 2_000,
    build: (value) => [{ urn: "urn:li:dataset:test", error: value }],
    schema: getEntitiesResponseSchema,
  },
];

interface NestedArrayLimitCase {
  readonly label: string;
  readonly schema: SafeParser;
  readonly build: (length: number) => unknown;
}

const nestedArrayCases: readonly NestedArrayLimitCase[] = [
  {
    label: "lineage columns",
    schema: lineageResponseSchema,
    build: (length) => ({
      downstreams: {
        searchResults: [
          {
            entity: { urn: "urn:li:dataset:test" },
            degree: 1,
            lineageColumns: Array.from({ length }, (_, index) => `field_${index}`),
          },
        ],
      },
    }),
  },
  {
    label: "owners",
    schema: getEntitiesResponseSchema,
    build: (length) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        ownership: {
          owners: Array.from({ length }, (_, index) => ({
            owner: { urn: `urn:li:corpuser:owner-${index}` },
          })),
        },
      },
    ],
  },
  {
    label: "tags",
    schema: getEntitiesResponseSchema,
    build: (length) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        tags: {
          tags: Array.from({ length }, (_, index) => ({
            tag: { urn: `urn:li:tag:tag-${index}` },
          })),
        },
      },
    ],
  },
  {
    label: "glossary terms",
    schema: getEntitiesResponseSchema,
    build: (length) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        glossaryTerms: {
          terms: Array.from({ length }, (_, index) => ({
            term: { urn: `urn:li:glossaryTerm:term-${index}` },
          })),
        },
      },
    ],
  },
  {
    label: "siblings",
    schema: getEntitiesResponseSchema,
    build: (length) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        siblings: {
          siblings: Array.from({ length }, (_, index) => ({
            urn: `urn:li:dataset:(sibling-${index})`,
          })),
        },
      },
    ],
  },
  {
    label: "assertions",
    schema: getEntitiesResponseSchema,
    build: (length) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        dataQuality: {
          assertions: Array.from({ length }, () => ({ status: "PASS" as const })),
        },
      },
    ],
  },
  {
    label: "quality signals",
    schema: getEntitiesResponseSchema,
    build: (length) => [
      {
        urn: "urn:li:dataset:test",
        type: "DATASET",
        quality: {
          signals: Array.from({ length }, () => ({ status: "PASS" as const })),
        },
      },
    ],
  },
];

describe("DataHub MCP response schemas", () => {
  it.each(topLevelCases)("accepts $label at its request maximum", ({ schema, build, maximum }) => {
    expect(schema.safeParse(build(maximum)).success).toBe(true);
  });

  it.each(topLevelCases)(
    "rejects $label above its request maximum",
    ({ schema, build, maximum }) => {
      expect(schema.safeParse(build(maximum + 1)).success).toBe(false);
    },
  );

  it.each(stringCases)("bounds $label at $maximum characters", ({ maximum, build, schema }) => {
    expect(schema.safeParse(build("x".repeat(maximum))).success).toBe(true);
    expect(schema.safeParse(build("x".repeat(maximum + 1))).success).toBe(false);
  });

  it("bounds a complete URN at 500 characters", () => {
    const build = (length: number) => ({
      start: 0,
      count: 1,
      total: 1,
      searchResults: [
        {
          entity: {
            urn: `urn:li:${"x".repeat(length - "urn:li:".length)}`,
          },
        },
      ],
    });

    expect(searchResponseSchema.safeParse(build(500)).success).toBe(true);
    expect(searchResponseSchema.safeParse(build(501)).success).toBe(false);
  });

  it.each(nestedArrayCases)("bounds $label at 100 entries", ({ schema, build }) => {
    expect(schema.safeParse(build(100)).success).toBe(true);
    expect(schema.safeParse(build(101)).success).toBe(false);
  });

  it("preserves passthrough fields at every declared object boundary", () => {
    expect(
      searchResponseSchema.parse({
        start: 0,
        count: 1,
        total: 1,
        responseUnknown: true,
        searchResults: [
          {
            searchResultUnknown: true,
            entity: {
              urn: "urn:li:dataset:test",
              entityUnknown: true,
              platform: { name: "snowflake", platformUnknown: true },
            },
          },
        ],
      }),
    ).toMatchObject({
      responseUnknown: true,
      searchResults: [
        {
          searchResultUnknown: true,
          entity: {
            entityUnknown: true,
            platform: { platformUnknown: true },
          },
        },
      ],
    });

    expect(
      schemaResponseSchema.parse({
        urn: "urn:li:dataset:test",
        offset: 0,
        fields: [{ fieldPath: "customer_id", schemaFieldUnknown: true }],
        totalFields: 1,
        returned: 1,
        remainingCount: 0,
        responseUnknown: true,
      }),
    ).toMatchObject({
      responseUnknown: true,
      fields: [{ schemaFieldUnknown: true }],
    });

    expect(
      lineageResponseSchema.parse({
        downstreams: {
          searchResults: [
            {
              entity: { urn: "urn:li:dataset:test" },
              degree: 1,
              lineageColumns: [],
              lineageUnknown: true,
            },
          ],
        },
        responseUnknown: true,
      }),
    ).toMatchObject({
      responseUnknown: true,
      downstreams: {
        searchResults: [{ lineageUnknown: true }],
      },
    });
  });
});
