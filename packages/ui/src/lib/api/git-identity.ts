import { z } from 'zod';

export const gitIdentityProfileIdSchema = z.string().trim().min(1).max(200);
const profileTextSchema = z.string().trim().min(1).max(512);
const optionalProfileTextSchema = z.string().trim().max(512).nullable().optional();

export const gitIdentityProfileSchema = z.object({
  id: gitIdentityProfileIdSchema,
  name: profileTextSchema,
  userName: profileTextSchema,
  userEmail: profileTextSchema,
  signCommits: z.boolean().optional(),
  signingKey: optionalProfileTextSchema,
  color: optionalProfileTextSchema,
  icon: optionalProfileTextSchema,
}).strict();

export type GitIdentityProfile = z.infer<typeof gitIdentityProfileSchema>;

export const gitIdentityProfilesSchema = z.array(gitIdentityProfileSchema).max(256)
  .refine((profiles) => new Set(profiles.map((profile) => profile.id)).size === profiles.length, 'Git identity profile IDs must be unique');

export const gitIdentitySummarySchema = z.object({
  userName: z.string().max(512).nullable(),
  userEmail: z.string().max(512).nullable(),
}).strict();

export type GitIdentitySummary = z.infer<typeof gitIdentitySummarySchema>;

export const gitIdentityMutationResultSchema = z.object({
  success: z.boolean(),
  profile: gitIdentityProfileSchema,
}).strict();
