import { z } from "zod";
import {
  EntityContextRetrievalSchema,
  RequiredCollectionCompletenessSchema,
} from "../workflow/contracts.js";

const TARGET_DATASET_URN =
  "urn:li:dataset:(urn:li:dataPlatform:snowflake,b2fd91.order_entry_db.analytics.order_details,PROD)";
const SOURCE_FIELD = "customer_id";

const urnSchema = z.string().startsWith("urn:li:").max(500);
const nameSchema = z.string().min(1).max(500);
const platformSchema = z.string().min(1).max(100);
const fieldPathSchema = z.string().min(1).max(500);

const datasetCandidateSchema = z
  .object({
    urn: urnSchema,
    name: nameSchema,
    platform: platformSchema.optional(),
    environment: z.string().min(1).max(100).optional(),
  })
  .strict();

const schemaFieldSchema = z
  .object({
    fieldPath: fieldPathSchema,
    nativeDataType: z.string().min(1).max(500).optional(),
    nullable: z.boolean().optional(),
    description: z.string().max(2_000).optional(),
  })
  .strict();

const lineageAssetSchema = z
  .object({
    urn: urnSchema,
    name: nameSchema.optional(),
    platform: platformSchema.optional(),
    hop: z.number().int().min(0).max(2),
    lineageColumns: z.array(fieldPathSchema).max(100),
  })
  .strict();

const entityContextSchema = z
  .object({
    urn: urnSchema,
    entityType: z.string().min(1).max(100),
    name: nameSchema.optional(),
    platform: platformSchema.optional(),
    description: z.string().max(2_000).optional(),
    owners: z.array(urnSchema).max(20),
    tags: z.array(urnSchema).max(20),
    glossaryTerms: z.array(urnSchema).max(20),
    siblingUrns: z.array(urnSchema).max(20),
    qualitySignals: z.array(z.string().min(1).max(100)).max(20),
  })
  .strict();

function requiredCollectionSchema<Item extends z.ZodType>(item: Item, maxItems: number) {
  return z
    .object({
      items: z.array(item).max(maxItems),
      completeness: RequiredCollectionCompletenessSchema,
    })
    .strict();
}

function addInvariantIssue(ctx: z.RefinementCtx): void {
  ctx.addIssue({
    code: "custom",
    message: "Fixture does not match the certified replay contract.",
  });
}

function hasUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function hasExactCompleteness(
  completeness: {
    readonly complete: boolean;
    readonly pages: number;
    readonly itemCount: number;
    readonly offsets: readonly number[];
    readonly reasonCodes: readonly string[];
  },
  itemCount: number,
  offsets: readonly number[],
): boolean {
  return (
    completeness.complete &&
    completeness.pages === offsets.length &&
    completeness.itemCount === itemCount &&
    completeness.offsets.length === offsets.length &&
    completeness.offsets.every((offset, index) => offset === offsets[index]) &&
    completeness.reasonCodes.length === 0
  );
}

const searchFixtureSchema = requiredCollectionSchema(datasetCandidateSchema, 1_000).superRefine(
  (value, ctx) => {
    const urns = value.items.map(({ urn }) => urn);
    if (
      value.items.length !== 12 ||
      !hasUnique(urns) ||
      value.items.filter(({ urn }) => urn === TARGET_DATASET_URN).length !== 1 ||
      !hasExactCompleteness(value.completeness, 12, [0])
    ) {
      addInvariantIssue(ctx);
    }
  },
);

const schemaFixtureSchema = requiredCollectionSchema(schemaFieldSchema, 10_000).superRefine(
  (value, ctx) => {
    const fieldPaths = value.items.map(({ fieldPath }) => fieldPath);
    if (
      value.items.length !== 55 ||
      !hasUnique(fieldPaths) ||
      value.items.filter(({ fieldPath }) => fieldPath === SOURCE_FIELD).length !== 1 ||
      !hasExactCompleteness(value.completeness, 55, [0])
    ) {
      addInvariantIssue(ctx);
    }
  },
);

function lineageFixtureSchema(itemCount: 24 | 11) {
  return requiredCollectionSchema(lineageAssetSchema, 100).superRefine((value, ctx) => {
    const urns = value.items.map(({ urn }) => urn);
    if (
      value.items.length !== itemCount ||
      !hasUnique(urns) ||
      !hasExactCompleteness(value.completeness, itemCount, [0])
    ) {
      addInvariantIssue(ctx);
    }
  });
}

const entityContextFixtureSchema = z
  .object({
    items: z.array(entityContextSchema).max(50),
    completeness: EntityContextRetrievalSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const urns = value.items.map(({ urn }) => urn);
    const sortedUrns = [...urns].sort();
    if (
      value.items.length !== 25 ||
      !hasUnique(urns) ||
      urns.some((urn, index) => urn !== sortedUrns[index]) ||
      !urns.includes(TARGET_DATASET_URN) ||
      !hasExactCompleteness(value.completeness, 25, [0, 10, 20])
    ) {
      addInvariantIssue(ctx);
    }
  });

export const fixtureSchemas = {
  "search-order-details.json": searchFixtureSchema,
  "schema-order-details.json": schemaFixtureSchema,
  "lineage-order-details-table.json": lineageFixtureSchema(24),
  "lineage-order-details-customer-id.json": lineageFixtureSchema(11),
  "entity-context-order-details-impact.json": entityContextFixtureSchema,
};

export type FixtureName = keyof typeof fixtureSchemas;
