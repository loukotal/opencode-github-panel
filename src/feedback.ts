import { parsePatch, type DiffLine } from "./git"
import type { Context } from "./context"

/** One or more lines of a diff: `line` on `side` is the last, `startLine` on `startSide` the first when they differ. */
export interface Target {
  readonly line: number
  readonly side: "LEFT" | "RIGHT"
  readonly startLine?: number | null
  readonly startSide?: "LEFT" | "RIGHT"
}

/** A comment on lines of a diff, kept until the user sends it to the chat. */
export interface Feedback {
  readonly id: string
  readonly path: string
  /** Which diff it is on, such as "staged in the working tree". */
  readonly where: string
  readonly line: number
  readonly side: "LEFT" | "RIGHT"
  readonly startLine: number | null
  readonly snippet: string
  readonly body: string
}

const SNIPPET_LINES = 40

/** The patch from its first hunk on, without the `diff --git`, `---` and `+++` lines. */
export function patchBody(patch: string) {
  const normal = patch.replace(/\r\n/g, "\n").replace(/\n$/, "")
  const start = /^@@ /m.exec(normal)
  return start ? normal.slice(start.index) : ""
}

/**
 * The patch of each file in a diff, as `git diff` writes an untracked folder as several. Prefixes become the usual `a/`
 * and `b/` whatever the user's git config says (`diff.mnemonicPrefix` writes `i/` and `w/`), since the diff's parser
 * takes no others.
 */
export function splitPatch(diff: string): { path: string; patch: string }[] {
  const parts = diff.split(/^(?=diff --git )/m).filter((part) => part.startsWith("diff --git "))
  return parts.map((part, index) => {
    const start = part.search(/^@@ /m)
    const head = start === -1 ? part : part.slice(0, start)
    const clean = head
      .replace(/^diff --git [a-z]\/(.*) [a-z]\/(.*)$/m, "diff --git a/$1 b/$2")
      .replace(/^--- [a-z]\//m, "--- a/")
      .replace(/^\+\+\+ [a-z]\//m, "+++ b/")
    const patch = clean + (start === -1 ? "" : part.slice(start))
    // Git ends a name holding a space with a tab.
    const named = /^\+\+\+ b\/(.+?)\t?$/m.exec(clean)?.[1] ?? /^--- a\/(.+?)\t?$/m.exec(clean)?.[1] ?? /^diff --git a\/(.+?) b\//.exec(clean)?.[1]
    return { path: named ?? `${index}`, patch }
  })
}

/** The patch with whole hunks up to `limit` lines (always at least one), and how many lines that leaves out. */
export function clipPatch(patch: string, limit: number) {
  const hunks = patchBody(patch).split(/^(?=@@ )/m)
  const total = hunks.reduce((sum, hunk) => sum + hunk.split("\n").length, 0)
  if (total <= limit) return { patch, hidden: 0 }
  const kept: string[] = []
  let size = 0
  for (const hunk of hunks) {
    const length = hunk.split("\n").length
    if (kept.length > 0 && size + length > limit) break
    kept.push(hunk)
    size += length
  }
  const head = patch.slice(0, Math.max(0, patch.search(/^@@ /m)))
  return { patch: head + kept.join(""), hidden: total - size }
}

/** Whether a diff line is the numbered line on that side. A context line has a number on both. */
export function isLine(line: DiffLine, number: number, side: "LEFT" | "RIGHT") {
  if (line.kind === "hunk") return false
  return side === "LEFT" ? line.kind !== "add" && line.old === number : line.kind !== "del" && line.new === number
}

/** The lines of `target` as a small diff, for the agent to read without the rest of the file. */
export function snippetOf(patch: string, target: Target) {
  const lines = parsePatch(patchBody(patch))
  const end = lines.findIndex((line) => isLine(line, target.line, target.side))
  if (end === -1) return ""
  const from = lines.findIndex((line) => isLine(line, target.startLine ?? target.line, target.startSide ?? target.side))
  const range = lines.slice(Math.min(from === -1 ? end : from, end), Math.max(from, end) + 1).filter((line) => line.kind !== "hunk")
  const text = range.slice(0, SNIPPET_LINES).map((line) => `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}${line.text}`)
  return [...text, ...(range.length > SNIPPET_LINES ? [`… ${range.length - SNIPPET_LINES} more lines`] : [])].join("\n")
}

/** A comment as the composer quotes it: the lines, where they are, and the comment. */
export function feedbackContext(item: Feedback): Context {
  const name = item.path.split("/").pop() ?? item.path
  const range = item.startLine !== null && item.startLine !== item.line ? `${item.startLine}-${item.line}` : `${item.line}`
  return {
    label: `${name}:${range}`,
    subject: `line${range.includes("-") ? "s" : ""} ${range} of ${item.side === "LEFT" ? "the old version of " : ""}${item.path}, ${item.where}`,
    text: item.snippet || "(These lines are no longer in the diff.)",
    comment: item.body,
  }
}
