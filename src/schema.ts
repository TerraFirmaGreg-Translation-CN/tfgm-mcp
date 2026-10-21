import { z } from 'zod';

export const buildSchema = z.object({ modpack: z.string(), contentHash: z.string().optional() }).passthrough();
export const chaptersSchema = z.object({ chapters: z.array(z.object({ id: z.string(), filename: z.string(), title: z.string() }).passthrough()) });
export const questSchema = z.object({
  id: z.string(), title: z.string().optional(), description: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(), tasks: z.array(z.record(z.string(), z.unknown())).optional(),
  rewards: z.array(z.record(z.string(), z.unknown())).optional(), guidePage: z.string().optional(),
}).passthrough();
export const chapterSchema = z.object({ quests: z.array(questSchema) }).passthrough();
export const questIndexSchema = z.object({ quests: z.array(z.object({
  id: z.string(), chapter: z.string(), title: z.string(), chapterTitle: z.string().optional(), content: z.string(),
})) });
export const labelsSchema = z.object({ items: z.array(z.object({ id: z.string(), label: z.string(), haystack: z.string().optional() })) });
export const guideIndexSchema = z.array(z.object({ entry: z.string(), content: z.string(), url: z.string() }));
export const recipeSchema = z.object({
  id: z.string(), category: z.string().optional(), widgets: z.array(z.record(z.string(), z.unknown())),
}).passthrough();
export const itemRecipesSchema = z.object({
  inputs: z.record(z.string(), z.array(z.string())).default({}),
  outputs: z.record(z.string(), z.array(z.string())).default({}),
});
export type Quest = z.infer<typeof questSchema>;
