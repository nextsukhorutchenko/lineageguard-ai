import { z } from "zod";

export const DeploymentProfileSchema = z.enum(["LOCAL", "PUBLIC_REPLAY"]);
export type DeploymentProfile = z.infer<typeof DeploymentProfileSchema>;

export const PUBLIC_REPLAY_REQUEST =
  "Rename column customer_id to customer_key in dataset snowflake:b2fd91.order_entry_db.analytics.order_details";

export const PublicReplayErrorCodeSchema = z.enum([
  "DEMO_BUSY",
  "DEMO_CAPACITY_REACHED",
  "RUN_EXPIRED",
]);

export const PublicReplayErrorSchema = z
  .object({
    error: z
      .object({
        code: PublicReplayErrorCodeSchema,
        message: z.string().min(1).max(160),
      })
      .strict(),
  })
  .strict();
