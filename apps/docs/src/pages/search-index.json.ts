import { getCollection } from "astro:content";

/**
 * A search index for the search box.
 *
 * Every page's title, description, headings and body text go into one JSON file per language. The
 * browser fetches it once and filters locally — no service, no query leaving the page, which is the
 * same rule the product itself follows. At 25 pages in two languages this is a few hundred
 * kilobytes and a linear scan is instant; a full-text engine would be the wrong amount of
 * machinery.
 */

/** Strip MDX down to searchable prose: no imports, no JSX, no fenced code, no frontmatter. */
function toText(body: string): string {
  return body
    .replace(/^---[\s\S]*?---/, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^import .*$/gm, " ")
    .replace(/^export .*$/gm, " ")
    .replace(/[#*`>|_[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The `##` headings, which are the most useful thing to match a query against. */
function headings(body: string): string[] {
  return [...body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((m) => m[1].trim());
}

export async function GET() {
  const docs = await getCollection("docs");
  const pages = docs.map((d) => {
    const body = String(d.body ?? "");
    const lang = d.id.startsWith("en/") ? "en" : "zh";
    const slug = d.id.replace(/^en\//, "");
    return {
      // /en/getting-started/installation/ vs /getting-started/installation/
      url: lang === "en" ? `/en/${slug}/` : `/${slug}/`,
      lang,
      title: d.data.title,
      description: d.data.description,
      group: d.data.group,
      headings: headings(body),
      // Every word counts: a page cut at 4 000 characters silently loses the second half, and
      // three pages were already at the cap — the tail of `verification`, `formats/code` and
      // `configuration` could not be found by search at all. The whole body is a few KB.
      text: toText(body),
    };
  });
  return new Response(JSON.stringify({ pages }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};