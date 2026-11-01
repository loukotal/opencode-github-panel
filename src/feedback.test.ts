import { describe, expect, test } from "bun:test"
import { clipPatch, feedbackContext, patchBody, snippetOf, splitPatch, type Feedback } from "./feedback"

const PATCH = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,3 +1,3 @@", " one", "-two", "+TWO", " three", "@@ -10,2 +10,3 @@", " ten", "+new", " eleven", ""].join("\n")

describe("feedback", () => {
  test("patchBody drops the file header", () => {
    expect(patchBody(PATCH).startsWith("@@ -1,3")).toBe(true)
    expect(patchBody("Binary files a and b differ\n")).toBe("")
  })

  test("snippetOf quotes one line", () => {
    expect(snippetOf(PATCH, { line: 2, side: "RIGHT" })).toBe("+TWO")
    expect(snippetOf(PATCH, { line: 2, side: "LEFT" })).toBe("-two")
    expect(snippetOf(PATCH, { line: 99, side: "RIGHT" })).toBe("")
  })

  test("snippetOf quotes a range, across sides and in either order", () => {
    expect(snippetOf(PATCH, { line: 3, side: "RIGHT", startLine: 1, startSide: "RIGHT" })).toBe(" one\n-two\n+TWO\n three")
    expect(snippetOf(PATCH, { line: 2, side: "RIGHT", startLine: 2, startSide: "LEFT" })).toBe("-two\n+TWO")
    expect(snippetOf(PATCH, { line: 1, side: "RIGHT", startLine: 2, startSide: "RIGHT" })).toBe(" one\n-two\n+TWO")
  })

  test("splitPatch names each file", () => {
    const two = `${PATCH}diff --git a/b c.ts b/b c.ts\nnew file mode 100644\n--- /dev/null\n+++ b/b c.ts\n@@ -0,0 +1 @@\n+x\n`
    expect(splitPatch(two).map((part) => part.path)).toEqual(["a.ts", "b c.ts"])
  })

  test("clipPatch keeps whole hunks and counts the rest", () => {
    expect(clipPatch(PATCH, 100).hidden).toBe(0)
    const clipped = clipPatch(PATCH, 5)
    expect(clipped.hidden).toBeGreaterThan(0)
    expect(clipped.patch).toContain("+TWO")
    expect(clipped.patch).not.toContain("+new")
    expect(clipped.patch.startsWith("diff --git")).toBe(true)
  })

  test("feedbackContext names the lines and carries the comment", () => {
    const item: Feedback = { id: "1", path: "src/a.ts", where: "uncommitted in the working tree", line: 3, side: "RIGHT", startLine: 1, snippet: "+x", body: "Why?" }
    expect(feedbackContext(item)).toEqual({ label: "a.ts:1-3", subject: "lines 1-3 of src/a.ts, uncommitted in the working tree", text: "+x", comment: "Why?" })
  })
})
