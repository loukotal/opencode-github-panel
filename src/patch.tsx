import { createEffect, createMemo, createRoot, getOwner, onCleanup, onMount, type JSX } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { FileDiff, getFiletypeFromFileName, parsePatchFiles, setLanguageOverride, type DiffLineAnnotation, type FileDiffMetadata, type FileDiffOptions, type SelectedLineRange } from "@pierre/diffs"
import type { Target } from "./feedback"
import { bundledLanguages } from "./langs"

/** Something shown under a line of the diff. `key` stays the same while it lives; `render` runs once per key. */
export interface PatchNote {
  readonly key: string
  readonly line: number
  readonly side: "LEFT" | "RIGHT"
  readonly render: () => JSX.Element
}

const toSide = (side: "LEFT" | "RIGHT") => (side === "LEFT" ? "deletions" : "additions")
const fromSide = (side: string | undefined) => (side === "deletions" ? "LEFT" : "RIGHT")

/** A GitHub patch has only hunks, and the parser needs the file's names too. */
export function parseFileDiff(path: string, previous: string | null | undefined, patch: string): FileDiffMetadata | undefined {
  const text = /^(diff --git|--- )/m.test(patch.slice(0, patch.search(/^@@ /m) + 1)) ? patch : `--- a/${previous ?? path}\n+++ b/${path}\n${patch}`
  try {
    const file = parsePatchFiles(text)[0]?.files[0]
    if (!file || file.hunks.length === 0) return undefined
    const language = getFiletypeFromFileName(path)
    return setLanguageOverride(file, language in bundledLanguages ? language : "text")
  } catch {
    return undefined
  }
}

export function targetOf(range: SelectedLineRange): Target {
  const startSide = fromSide(range.side)
  const side = fromSide(range.endSide ?? range.side)
  // A drag upwards ends on the first line.
  if (startSide === side && range.start > range.end) return { line: range.start, side, startLine: range.end, startSide }
  return { line: range.end, side, startLine: range.start, startSide }
}

/**
 * One file's diff, drawn by @pierre/diffs in its shadow root: syntax colors, changes within a line, and a gutter to pick
 * lines with. Notes stay this component's Solid elements, in the light DOM, slotted between the lines.
 */
export function PatchView(props: {
  fileDiff: FileDiffMetadata
  notes?: readonly PatchNote[]
  /** The lines to mark, while a comment on them is being written. */
  selected?: Target
  onSelect?: (target: Target) => void
}) {
  const ctx = usePlugin()
  const owner = getOwner()
  let host!: HTMLDivElement
  const mounted = new Map<string, { element: HTMLElement; dispose: () => void }>()
  const render = (key: string, note: PatchNote) => {
    const known = mounted.get(key)
    if (known) return known.element
    return createRoot((dispose) => {
      const element = (<div class="ghp-dnote">{note.render()}</div>) as HTMLElement
      mounted.set(key, { element, dispose })
      return element
    }, owner)
  }
  const annotations = createMemo((): DiffLineAnnotation<string>[] =>
    (props.notes ?? []).map((note) => ({ side: toSide(note.side), lineNumber: note.line, metadata: note.key })),
  )
  const options = (): FileDiffOptions<string, undefined> => ({
    theme: { dark: "pierre-dark", light: "pierre-light" },
    themeType: ctx.appearance.mode(),
    diffStyle: "unified",
    overflow: "wrap",
    disableFileHeader: true,
    hunkSeparators: "line-info",
    lineHoverHighlight: "both",
    enableLineSelection: !!props.onSelect,
    enableGutterUtility: !!props.onSelect,
    onGutterUtilityClick: (range) => props.onSelect?.(targetOf(range)),
    onLineSelected: (range) => {
      if (!range || same(range, props.selected)) return
      props.onSelect?.(targetOf(range))
    },
    renderAnnotation: (annotation) => {
      const note = (props.notes ?? []).find((item) => item.key === annotation.metadata)
      return note ? render(note.key, note) : undefined
    },
  })

  onMount(() => {
    const diff = new FileDiff<string>(options())
    createEffect(() => {
      diff.setOptions(options())
      diff.render({ fileDiff: props.fileDiff, lineAnnotations: annotations(), containerWrapper: host, forceRender: false })
    })
    createEffect(() => diff.setThemeType(ctx.appearance.mode()))
    createEffect(() => {
      const target = props.selected
      diff.setSelectedLines(
        target
          ? { start: target.startLine ?? target.line, side: toSide(target.startSide ?? target.side), end: target.line, endSide: toSide(target.side) }
          : null,
      )
    })
    // Notes whose line is gone leave the view; their Solid roots go with them.
    createEffect(() => {
      const keys = new Set(annotations().map((annotation) => annotation.metadata))
      for (const [key, entry] of mounted) {
        if (keys.has(key)) continue
        entry.dispose()
        mounted.delete(key)
      }
    })
    onCleanup(() => {
      diff.cleanUp()
      for (const entry of mounted.values()) entry.dispose()
      mounted.clear()
    })
  })

  return <div class="ghp-patch" ref={host} />
}

function same(range: SelectedLineRange, target: Target | undefined) {
  if (!target) return false
  const picked = targetOf(range)
  return picked.line === target.line && picked.side === target.side && (picked.startLine ?? picked.line) === (target.startLine ?? target.line)
}
