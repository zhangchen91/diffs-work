import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/**
 * Docs are Markdown/MDX organised as `<locale>/<section>/<page>.mdx`.
 * `zh` pages live at the root (`getting-started/installation`), English under `en/`.
 * A community language only needs a new folder plus its tag in the switcher.
 */
const docs = defineCollection({
  loader: glob({ pattern: "**/*.mdx", base: "./src/content/docs" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    group: z.enum(["Start", "Concepts", "Formats", "Integrate", "Reference"]),
    order: z.number().default(100),
    lang: z.enum(["zh", "en"]).default("zh"),
  }),
});

export const collections = { docs };
