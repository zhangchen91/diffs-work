import assert from "node:assert/strict";
import test from "node:test";
import { laneFor } from "../../../packages/diff-ui/src/lib/lanes.ts";

const bytes = new ArrayBuffer(4);
const text = { name: "a", text: "x" };
const bin = { name: "a.docx", bytes };

test("every family resolves to a lane, from one table", () => {
  // The point of this module: a family added here works on both surfaces at once. The failure it
  // prevents is Word arriving in the website and not the local viewer, or PDF existing only in one.
  assert.equal(laneFor("pdf", bin, { ...bin, name: "b.pdf" }), "pdf");
  assert.equal(laneFor("xlsx", bin, bin), "sheet");
  assert.equal(laneFor("docx", bin, bin), "opc");
  assert.equal(laneFor("pptx", bin, bin), "opc");
  assert.equal(laneFor("code", text, { ...text, name: "b" }), "code");
  assert.equal(laneFor("markdown", text, text), "text");
  assert.equal(laneFor("text", text, text), "text");
});

test("a family whose inputs are missing gets no lane, rather than a wrong one", () => {
  assert.equal(laneFor("pdf", text, text), null, "a pdf needs bytes");
  assert.equal(laneFor("docx", text, text), null, "a docx needs bytes");
  assert.equal(laneFor("code", { name: "a" }, { name: "b" }), null, "code needs text");
});
