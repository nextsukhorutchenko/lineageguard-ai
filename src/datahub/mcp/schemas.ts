import { z } from "zod";

const urnSchema = z.string().max(500).startsWith("urn:li:");
const nameSchema = z.string().max(500);
const fieldPathSchema = z.string().max(500);
const platformSchema = z.string().max(100);
const entityTypeSchema = z.string().max(100);
const nativeDataTypeSchema = z.string().max(500);
const descriptionSchema = z.string().max(2_000);
const dependencyErrorSchema = z.string().max(2_000);

export const searchResponseSchema = z
  .object({
    start: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    searchResults: z
      .array(
        z
          .object({
            entity: z
              .object({
                urn: urnSchema,
                name: nameSchema.optional(),
                properties: z.object({ name: nameSchema.optional() }).passthrough().optional(),
                type: entityTypeSchema.optional(),
                platform: z.object({ name: platformSchema.optional() }).passthrough().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .max(50)
      .default([]),
  })
  .passthrough();

export const schemaResponseSchema = z
  .object({
    urn: urnSchema,
    offset: z.number().int().nonnegative(),
    fields: z
      .array(
        z
          .object({
            fieldPath: fieldPathSchema,
            nativeDataType: nativeDataTypeSchema.optional(),
            nullable: z.boolean().optional(),
            description: descriptionSchema.optional(),
          })
          .passthrough(),
      )
      .max(100),
    totalFields: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    remainingCount: z.number().int().nonnegative(),
  })
  .passthrough();

const lineageResultSchema = z
  .object({
    entity: z
      .object({
        urn: urnSchema,
        name: nameSchema.optional(),
        platform: z.object({ name: platformSchema.optional() }).passthrough().optional(),
      })
      .passthrough(),
    degree: z.number().int().nonnegative(),
    lineageColumns: z.array(fieldPathSchema).max(100).default([]),
  })
  .passthrough();

const lineageDirectionSchema = z
  .object({
    searchResults: z.array(lineageResultSchema).max(100).default([]),
    offset: z.number().int().nonnegative().optional(),
    returned: z.number().int().nonnegative().optional(),
    hasMore: z.boolean().optional(),
    truncatedDueToTokenBudget: z.boolean().optional(),
  })
  .passthrough();

export const lineageResponseSchema = z
  .object({ downstreams: lineageDirectionSchema.optional() })
  .passthrough();

const ownerSchema = z.object({ owner: z.object({ urn: urnSchema }).passthrough() }).passthrough();
const tagSchema = z.object({ tag: z.object({ urn: urnSchema }).passthrough() }).passthrough();
const termSchema = z.object({ term: z.object({ urn: urnSchema }).passthrough() }).passthrough();
const siblingSchema = z.union([
  z.object({ urn: urnSchema }).passthrough(),
  z.object({ sibling: z.object({ urn: urnSchema }).passthrough() }).passthrough(),
]);
const qualityStatusSchema = z.enum([
  "PASS",
  "PASSED",
  "FAIL",
  "FAILED",
  "WARN",
  "WARNING",
  "UNKNOWN",
]);
const qualitySignalSchema = z.object({ status: qualityStatusSchema }).passthrough();

export const getEntityErrorSchema = z
  .object({ urn: urnSchema, error: dependencyErrorSchema })
  .passthrough();

export const getEntitySuccessSchema = z
  .object({
    urn: urnSchema,
    error: z.never().optional(),
    type: entityTypeSchema.default("UNKNOWN"),
    name: nameSchema.optional(),
    platform: z.object({ name: platformSchema.optional() }).passthrough().optional(),
    properties: z
      .object({ name: nameSchema.optional(), description: descriptionSchema.optional() })
      .passthrough()
      .optional(),
    ownership: z
      .object({ owners: z.array(ownerSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    tags: z
      .object({ tags: z.array(tagSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    glossaryTerms: z
      .object({ terms: z.array(termSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    siblings: z
      .object({ siblings: z.array(siblingSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    dataQuality: z
      .object({ assertions: z.array(qualitySignalSchema).max(100).default([]) })
      .passthrough()
      .optional(),
    quality: z
      .object({ signals: z.array(qualitySignalSchema).max(100).default([]) })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const getEntitiesResponseSchema = z
  .array(z.union([getEntityErrorSchema, getEntitySuccessSchema]))
  .max(10);
