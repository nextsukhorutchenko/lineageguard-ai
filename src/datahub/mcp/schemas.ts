import { z } from "zod";

export const searchResponseSchema = z
  .object({
    searchResults: z
      .array(
        z
          .object({
            entity: z
              .object({
                urn: z.string().startsWith("urn:li:"),
                name: z.string().optional(),
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
    urn: z.string(),
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
        urn: z.string(),
        name: z.string().optional(),
        platform: z.object({ name: z.string().optional() }).passthrough().optional(),
      })
      .passthrough(),
    degree: z.number().int().nonnegative(),
    lineageColumns: z.array(z.string()).default([]),
  })
  .passthrough();

export const lineageResponseSchema = z
  .object({
    downstreams: z
      .object({ searchResults: z.array(lineageResultSchema).default([]) })
      .passthrough()
      .optional(),
  })
  .passthrough();
