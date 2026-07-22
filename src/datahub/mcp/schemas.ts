import { z } from "zod";

const urnSchema = z.string().startsWith("urn:li:");

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
                name: z.string().optional(),
                properties: z.object({ name: z.string().optional() }).passthrough().optional(),
                type: z.string().optional(),
                platform: z.object({ name: z.string().optional() }).passthrough().optional(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export const schemaResponseSchema = z
  .object({
    urn: urnSchema,
    offset: z.number().int().nonnegative(),
    fields: z.array(
      z
        .object({
          fieldPath: z.string(),
          nativeDataType: z.string().optional(),
          nullable: z.boolean().optional(),
          description: z.string().optional(),
        })
        .passthrough(),
    ),
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
        name: z.string().optional(),
        platform: z.object({ name: z.string().optional() }).passthrough().optional(),
      })
      .passthrough(),
    degree: z.number().int().nonnegative(),
    lineageColumns: z.array(z.string()).default([]),
  })
  .passthrough();

const lineageDirectionSchema = z
  .object({
    searchResults: z.array(lineageResultSchema).default([]),
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

export const getEntityErrorSchema = z.object({ urn: urnSchema, error: z.string() }).passthrough();

export const getEntitySuccessSchema = z
  .object({
    urn: urnSchema,
    error: z.never().optional(),
    type: z.string().default("UNKNOWN"),
    name: z.string().optional(),
    platform: z.object({ name: z.string().optional() }).passthrough().optional(),
    properties: z
      .object({ name: z.string().optional(), description: z.string().optional() })
      .passthrough()
      .optional(),
    ownership: z
      .object({ owners: z.array(ownerSchema).default([]) })
      .passthrough()
      .optional(),
    tags: z
      .object({ tags: z.array(tagSchema).default([]) })
      .passthrough()
      .optional(),
    glossaryTerms: z
      .object({ terms: z.array(termSchema).default([]) })
      .passthrough()
      .optional(),
    siblings: z
      .object({ siblings: z.array(siblingSchema).default([]) })
      .passthrough()
      .optional(),
    dataQuality: z
      .object({ assertions: z.array(qualitySignalSchema).default([]) })
      .passthrough()
      .optional(),
    quality: z
      .object({ signals: z.array(qualitySignalSchema).default([]) })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const getEntitiesResponseSchema = z
  .array(z.union([getEntityErrorSchema, getEntitySuccessSchema]))
  .max(10);
