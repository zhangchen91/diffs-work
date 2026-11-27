/**
 * The `diff_compare` tool contract: one name, one description, one input schema.
 *
 * It was written out twice — once for the MCP server and once for the DeepSeek Harness plugin —
 * so an agent on one surface could be told about a parameter the other did not have. Every agent
 * integration (MCP clients, DSH, Claude, and whatever comes next) now reads this.
 */

export const DIFF_TOOL_NAME = "diff_compare" as const;

export const DIFF_TOOL_DESCRIPTION =
  "Compare two versions of a file on this machine and return what changed, deterministically. " +
  "Use it before claiming work is done: the result is evidence, a summary is not. Supports code, " +
  "Markdown, plain text, Word (.docx), Excel (.xlsx), PowerPoint (.pptx) and PDF. Everything runs " +
  "locally; no file content is uploaded.";

export interface JsonSchemaProperty {
  type: "string" | "number" | "boolean";
  description?: string;
  enum?: string[];
}

/** JSON Schema for the tool input. Kept plain so every host's validator accepts it. */
export const DIFF_TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    old: { type: "string" as const, description: "Path to the before file, or the file plus a revision." },
    new: { type: "string" as const, description: "Path to the after file. Omit when comparing a revision." },
    revision: {
      type: "string" as const,
      description: "A git revision to compare `old` against instead of a second file (e.g. HEAD~1).",
    },
    cwd: { type: "string" as const, description: "Working directory for relative paths." },
    context: { type: "number" as const, description: "Unchanged rows to show around each change (0-20, default 3)." },
    maxHunks: { type: "number" as const, description: "Maximum hunks to return (1-200, default 40)." },
    format: { type: "string" as const, enum: ["json", "unified"], description: "`unified` also returns a patch." },
  },
  required: ["old"] as const,
  additionalProperties: false,
};

/** The whole tool, in the shape both MCP and Anthropic-style hosts use. */
export const DIFF_TOOL = {
  name: DIFF_TOOL_NAME,
  description: DIFF_TOOL_DESCRIPTION,
  inputSchema: DIFF_TOOL_INPUT_SCHEMA,
} as const;
