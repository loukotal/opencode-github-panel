import { createMemo, createSignal, For, Show, type JSX } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import type { ChangedFile, DraftComment, Thread } from "./contract"
import { Chevron, Group, type Folds } from "./fold"
import { clipPatch, feedbackContext, isLine, patchBody, snippetOf, type Feedback, type Target } from "./feedback"
import { parsePatch, type DiffLine } from "./git"
import { parseFileDiff, PatchView, type PatchNote } from "./patch"
import type { Actions } from "./actions"
import type { definition } from "./definition"

export type { Target }

const LINE_LIMIT = 1500
/** Changed lines past which a file starts collapsed when there are others to read. */
export const LARGE_FILE = 600

export type FeedbackStore = ReturnType<typeof createFeedback>

/** The comments for the agent on what `scope` names. They stay, across reloads too, until sent or discarded. */
export function createFeedback(actions: Actions, scope: () => string) {
  const ctx = usePlugin<typeof definition>()
  const prefs = ctx.stores.prefs
  const all = (): readonly Feedback[] => prefs.value.chatComments?.[scope()] ?? []
  const write = (next: readonly Feedback[]) =>
    prefs.update((draft) => {
      const comments = { ...draft.chatComments }
      if (next.length > 0) comments[scope()] = next.map((item) => ({ ...item }))
      else delete comments[scope()]
      draft.chatComments = comments
    })
  return {
    all,
    on: (path: string, where: string) => all().filter((item) => item.path === path && item.where === where),
    add: (path: string, where: string, patch: string, target: Target, body: string) =>
      write([
        ...all(),
        {
          id: crypto.randomUUID(),
          path,
          where,
          line: target.line,
          side: target.side,
          startLine: target.startLine ?? null,
          snippet: snippetOf(patch, target),
          body,
        },
      ]),
    update: (id: string, body: string) => write(all().map((item) => (item.id === id ? { ...item, body } : item))),
    remove: (id: string) => write(all().filter((item) => item.id !== id)),
    clear: () => write([]),
    send: () => {
      const items = all()
      if (items.length === 0) return
      if (actions.attachAll(items.map(feedbackContext), ctx.t("feedback.prompt"), items.length === 1 ? feedbackContext(items[0] as Feedback).label : ctx.t("feedback.toast", { count: items.length }))) write([])
    },
  }
}

/** While there are comments for the agent: how many, and sending them to the chat. */
export function FeedbackBar(props: { feedback: FeedbackStore }) {
  const ctx = usePlugin()
  const ui = ctx.ui
  const t = ctx.t
  const clear = async () => {
    const ok = await ctx.dialogs.confirm({ title: t("feedback.clearTitle"), description: t("feedback.count", { count: props.feedback.all().length }), confirm: t("feedback.clear"), danger: true })
    if (ok) props.feedback.clear()
  }
  return (
    <Show when={props.feedback.all().length > 0}>
      <div class="ghp-feedback-bar">
        <ui.Icon name="bubble-5" size="small" />
        <b class="ghp-grow ghp-ellipsis">{t("feedback.count", { count: props.feedback.all().length })}</b>
        <ui.Button size="small" variant="ghost" onClick={() => void clear()}>
          {t("feedback.clear")}
        </ui.Button>
        <ui.Button size="small" variant="contrast" icon="bubble-5" onClick={props.feedback.send}>
          {t("feedback.send")}
        </ui.Button>
      </div>
    </Show>
  )
}

/** The box "Add to chat" opens: an optional comment to send with the whole diff. */
export function AttachBar(props: { onCancel: () => void; onAttach: (note: string) => void }) {
  const ctx = usePlugin()
  const ui = ctx.ui
  const t = ctx.t
  const [note, setNote] = createSignal("")
  return (
    <div class="ghp-attach">
      <textarea
        class="ghp-textarea"
        rows={2}
        ref={(element) => requestAnimationFrame(() => element.focus())}
        placeholder={t("diff.attachPlaceholder")}
        aria-label={t("diff.attachPlaceholder")}
        value={note()}
        onInput={(event) => setNote(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            props.onAttach(note().trim())
          }
          if (event.key === "Escape") props.onCancel()
        }}
      />
      <div class="ghp-item-actions">
        <span class="ghp-faint ghp-grow">{t("diff.attachHint")}</span>
        <ui.Button size="small" variant="ghost" onClick={props.onCancel}>
          {t("cancel")}
        </ui.Button>
        <ui.Button size="small" variant="contrast" icon="bubble-5" onClick={() => props.onAttach(note().trim())}>
          {t("action.addToChat")}
        </ui.Button>
      </div>
    </div>
  )
}

/** A comment for the agent between the diff lines, with its text or a box to edit it, and Delete. */
export function FeedbackNote(props: { item: Feedback; feedback: FeedbackStore }) {
  const ctx = usePlugin()
  const ui = ctx.ui
  const t = ctx.t
  const [editing, setEditing] = createSignal(false)
  const [text, setText] = createSignal("")
  const save = () => {
    if (!text().trim()) return
    props.feedback.update(props.item.id, text().trim())
    setEditing(false)
  }
  return (
    <div class="ghp-draft-comment" data-source="user">
      <div class="ghp-draft-comment-head">
        <span class="ghp-pill ghp-draft-pill">{t("diff.forAgent")}</span>
        <span class="ghp-faint ghp-ellipsis">
          {props.item.startLine !== null && props.item.startLine !== props.item.line
            ? t("draft.lines", { from: props.item.startLine, to: props.item.line })
            : t("draft.line", { line: props.item.line })}
        </span>
        <div class="ghp-spacer" />
        <Show when={!editing()}>
          <ui.IconButton
            icon="edit"
            label={t("draft.edit")}
            size="small"
            variant="ghost-muted"
            onClick={() => {
              setText(props.item.body)
              setEditing(true)
            }}
          />
          <ui.IconButton icon="trash" label={t("draft.delete")} size="small" variant="ghost-muted" onClick={() => props.feedback.remove(props.item.id)} />
        </Show>
      </div>
      <Show when={editing()} fallback={<div class="ghp-draft-comment-body"><ui.Markdown text={props.item.body} /></div>}>
        <div class="ghp-composer">
          <textarea
            class="ghp-textarea"
            rows={3}
            aria-label={t("draft.edit")}
            value={text()}
            onInput={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                save()
              }
              if (event.key === "Escape") setEditing(false)
            }}
          />
          <div class="ghp-item-actions">
            <div class="ghp-spacer" />
            <ui.Button size="small" variant="ghost" onClick={() => setEditing(false)}>
              {t("cancel")}
            </ui.Button>
            <ui.Button size="small" variant="contrast" disabled={!text().trim()} onClick={save}>
              {t("draft.save")}
            </ui.Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

/**
 * The changed files of a pull request or commit: a summary with Collapse all / Expand all, an index that jumps to a
 * file, and the diffs. With `viewed`, each file has a Viewed box that folds it.
 */
export function DiffList(props: {
  files: readonly ChangedFile[]
  folds: Folds
  viewed?: ReadonlySet<string>
  onViewed?: (path: string, viewed: boolean) => void
  threads?: readonly Thread[]
  renderThread?: (thread: Thread) => JSX.Element
  onComment?: (file: ChangedFile, target: Target, body: string) => Promise<boolean>
  /** Adds a comment to the draft review, or starts one; `drafting` says one exists. */
  onDraft?: (file: ChangedFile, target: Target, body: string) => Promise<boolean>
  drafting?: boolean
  drafts?: readonly DraftComment[]
  renderDraft?: (comment: DraftComment, orphan: boolean) => JSX.Element
  onAttach?: (file: ChangedFile, note: string) => void
  feedback?: FeedbackStore
  /** Names this diff in comments for the agent. */
  where?: string
}) {
  const ctx = usePlugin()
  const ui = ctx.ui
  const t = ctx.t
  const elements = new Map<string, HTMLElement>()
  const large = (file: ChangedFile) => props.files.length > 15 || file.additions + file.deletions > LARGE_FILE
  // A file the draft review comments on starts open, large or not.
  const drafted = (file: ChangedFile) => (props.drafts ?? []).some((comment) => comment.path === file.path)
  const open = (file: ChangedFile) => !props.folds.folded(file.path, !!props.viewed?.has(file.path) || (props.files.length > 1 && large(file) && !drafted(file)))
  const jump = (file: ChangedFile) => {
    props.folds.fold(file.path, false)
    requestAnimationFrame(() => {
      const element = elements.get(file.path)
      element?.scrollIntoView({ block: "start" })
      element?.querySelector<HTMLElement>(".ghp-dfile-toggle")?.focus({ preventScroll: true })
    })
  }
  return (
    <div class="ghp-files">
      <div class="ghp-bar">
        <span class="ghp-faint ghp-ellipsis">
          {ctx.plural("item.files", props.files.length)} · <span class="ghp-add">+{props.files.reduce((sum, file) => sum + file.additions, 0)}</span>{" "}
          <span class="ghp-del">−{props.files.reduce((sum, file) => sum + file.deletions, 0)}</span>
          <Show when={props.viewed}>
            {(viewed) => ` · ${t("view.viewedCount", { count: props.files.filter((file) => viewed().has(file.path)).length, total: props.files.length })}`}
          </Show>
        </span>
        <div class="ghp-spacer" />
        <Show when={props.files.length > 1}>
          <ui.Button
            size="small"
            variant="ghost-muted"
            icon={props.folds.all() ? "expand" : "collapse"}
            class="ghp-fold-all"
            onClick={() => props.folds.foldAll(!props.folds.all())}
          >
            {props.folds.all() ? t("view.expandAll") : t("view.collapseAll")}
          </ui.Button>
        </Show>
      </div>
      <Show when={props.files.length > 1}>
        <Group
          class="ghp-findex"
          title={t("view.changedFiles")}
          count={props.files.length}
          open={props.folds.flag("index", props.files.length <= 25)}
          onToggle={() => props.folds.setFlag("index", !props.folds.flag("index", props.files.length <= 25))}
        >
          <For each={props.files}>
            {(file) => (
              <button type="button" class="ghp-findex-row" data-viewed={props.viewed?.has(file.path) ? "" : undefined} onClick={() => jump(file)}>
                <span class="ghp-status" data-status={statusLetter(file.status)}>
                  {statusLetter(file.status)}
                </span>
                <span class="ghp-dfile-path" title={file.path}>
                  {file.path}
                </span>
                <Show when={props.viewed?.has(file.path)}>
                  <ui.Icon name="check" size="small" class="ghp-faint" />
                </Show>
                <span class="ghp-add">+{file.additions}</span>
                <span class="ghp-del">−{file.deletions}</span>
              </button>
            )}
          </For>
        </Group>
      </Show>
      <For each={props.files} fallback={<div class="ghp-empty ghp-empty-inline">{t("diff.none")}</div>}>
        {(file) => (
          <DiffFile
            file={file}
            ref={(element) => elements.set(file.path, element)}
            open={open(file)}
            onToggle={(next) => props.folds.fold(file.path, !next)}
            viewed={props.viewed ? props.viewed.has(file.path) : undefined}
            onViewed={
              props.onViewed
                ? (viewed) => {
                    props.onViewed?.(file.path, viewed)
                    props.folds.fold(file.path, viewed)
                  }
                : undefined
            }
            threads={(props.threads ?? []).filter((thread) => thread.path === file.path)}
            renderThread={props.renderThread}
            onComment={props.onComment ? (target, body) => props.onComment?.(file, target, body) ?? Promise.resolve(false) : undefined}
            onDraft={props.onDraft ? (target, body) => props.onDraft?.(file, target, body) ?? Promise.resolve(false) : undefined}
            drafting={props.drafting}
            drafts={(props.drafts ?? []).filter((comment) => comment.path === file.path)}
            renderDraft={props.renderDraft}
            onAttach={props.onAttach ? (note) => props.onAttach?.(file, note) : undefined}
            feedback={props.feedback}
            where={props.where}
          />
        )}
      </For>
    </div>
  )
}

/** One changed file with its diff. With `onComment`, every line can take an inline review comment. */
export function DiffFile(props: {
  file: ChangedFile
  open: boolean
  onToggle: (open: boolean) => void
  ref?: (element: HTMLElement) => void
  viewed?: boolean
  onViewed?: (viewed: boolean) => void
  threads?: readonly Thread[]
  renderThread?: (thread: Thread) => JSX.Element
  onComment?: (target: Target, body: string) => Promise<boolean>
  onDraft?: (target: Target, body: string) => Promise<boolean>
  drafting?: boolean
  drafts?: readonly DraftComment[]
  renderDraft?: (comment: DraftComment, orphan: boolean) => JSX.Element
  onAttach?: (note: string) => void
  feedback?: FeedbackStore
  where?: string
}) {
  const ctx = usePlugin()
  const ui = ctx.ui
  const t = ctx.t
  const open = () => props.open
  const [noting, setNoting] = createSignal(false)
  const slash = props.file.path.lastIndexOf("/")
  const renamed = () => !!props.file.previous && props.file.previous !== props.file.path

  return (
    <section class="ghp-dfile" ref={(element) => props.ref?.(element)} data-open={open() ? "" : undefined} data-viewed={props.viewed ? "" : undefined}>
      <div class="ghp-dfile-head">
        <button type="button" class="ghp-dfile-toggle" aria-expanded={open()} onClick={() => props.onToggle(!open())}>
          <Chevron open={open()} />
          <span class="ghp-status" data-status={statusLetter(props.file.status)}>
            {statusLetter(props.file.status)}
          </span>
          <span class="ghp-dfile-path" title={renamed() ? `${props.file.previous} → ${props.file.path}` : props.file.path}>
            <Show when={renamed()}>
              <span class="ghp-faint">{props.file.previous} → </span>
            </Show>
            <span class="ghp-faint">{slash === -1 ? "" : props.file.path.slice(0, slash + 1)}</span>
            {slash === -1 ? props.file.path : props.file.path.slice(slash + 1)}
          </span>
          <Show when={(props.threads ?? []).length > 0}>
            <span class="ghp-pill">💬 {(props.threads ?? []).length}</span>
          </Show>
          <Show when={(props.drafts ?? []).length > 0}>
            <span class="ghp-pill ghp-draft-pill" title={t("draft.title")}>
              ✎ {(props.drafts ?? []).length}
            </span>
          </Show>
          <span class="ghp-add">+{props.file.additions}</span>
          <span class="ghp-del">−{props.file.deletions}</span>
        </button>
        <Show when={props.onAttach && props.file.patch}>
          <ui.Tooltip value={t("action.addToChat")}>
            <ui.IconButton
              icon="bubble-5"
              label={t("action.addToChat")}
              size="small"
              variant="ghost-muted"
              onClick={() => {
                setNoting(!noting())
                props.onToggle(true)
              }}
            />
          </ui.Tooltip>
        </Show>
        <Show when={props.onViewed}>
          <label class="ghp-dfile-viewed">
            <input type="checkbox" checked={!!props.viewed} onChange={(event) => props.onViewed?.(event.currentTarget.checked)} />
            {t("view.viewed")}
          </label>
        </Show>
      </div>

      <Show when={open()}>
        <Show when={noting()}>
          <AttachBar
            onCancel={() => setNoting(false)}
            onAttach={(note) => {
              props.onAttach?.(note)
              setNoting(false)
            }}
          />
        </Show>
        <DiffBody
          path={props.file.path}
          previous={props.file.previous}
          patch={props.file.patch ?? ""}
          threads={props.threads}
          renderThread={props.renderThread}
          onComment={props.onComment}
          onDraft={props.onDraft}
          drafting={props.drafting}
          drafts={props.drafts}
          renderDraft={props.renderDraft}
          feedback={props.feedback}
          where={props.where}
        />
      </Show>
    </section>
  )
}

/**
 * A file's patch with what hangs off its lines: review threads, draft comments, comments for the agent and a comment box
 * on the lines picked in the gutter. What is on lines not shown goes under the diff. Without hunks to draw (a binary
 * file, a conflict's combined diff), `fallback` shows instead.
 */
export function DiffBody(props: {
  path: string
  previous?: string | null
  patch: string
  threads?: readonly Thread[]
  renderThread?: (thread: Thread) => JSX.Element
  onComment?: (target: Target, body: string) => Promise<boolean>
  onDraft?: (target: Target, body: string) => Promise<boolean>
  drafting?: boolean
  drafts?: readonly DraftComment[]
  renderDraft?: (comment: DraftComment, orphan: boolean) => JSX.Element
  feedback?: FeedbackStore
  where?: string
  fallback?: JSX.Element
}) {
  const ctx = usePlugin()
  const ui = ctx.ui
  const t = ctx.t
  const [all, setAll] = createSignal(false)
  const [target, setTarget] = createSignal<Target>()
  const clipped = createMemo(() => (all() ? { patch: props.patch, hidden: 0 } : clipPatch(props.patch, LINE_LIMIT)))
  const shownPatch = createMemo(() => clipped().patch)
  const fileDiff = createMemo(() => parseFileDiff(props.path, props.previous, shownPatch()))
  const lines = createMemo(() => parsePatch(patchBody(shownPatch())))
  const commentable = () => !!props.onComment || !!props.onDraft || !!props.feedback
  const comments = () => (props.feedback && props.where ? props.feedback.on(props.path, props.where) : [])
  // A context line is on both sides, and the diff draws it on the new one.
  const place = (line: number | null, side: string): Pick<PatchNote, "line" | "side"> | undefined => {
    if (line === null) return undefined
    const wanted = side === "LEFT" ? "LEFT" : "RIGHT"
    const found: DiffLine | undefined = lines().find((item) => isLine(item, line, wanted))
    if (!found) return undefined
    return found.kind === "context" && found.new !== null ? { line: found.new, side: "RIGHT" } : { line, side: wanted }
  }
  const stray = <T extends { line: number | null; side: string }>(list: readonly T[]) => list.filter((item) => !place(item.line, item.side))
  const notes = createMemo((): PatchNote[] => {
    const at = target()
    const threads = (props.threads ?? []).flatMap((thread) => {
      const where = place(thread.line, thread.side)
      const id = thread.id
      return where
        ? [{ ...where, key: `t:${id}`, render: () => <For each={(props.threads ?? []).filter((item) => item.id === id)}>{(item) => <div class="ghp-dthread">{props.renderThread?.(item)}</div>}</For> }]
        : []
    })
    const drafts = (props.drafts ?? []).flatMap((comment) => {
      const where = place(comment.line, comment.side)
      const id = comment.id
      return where
        ? [{ ...where, key: `d:${id}`, render: () => <For each={(props.drafts ?? []).filter((item) => item.id === id)}>{(item) => <div class="ghp-dthread ghp-ddraft">{props.renderDraft?.(item, false)}</div>}</For> }]
        : []
    })
    const feedback = comments().flatMap((item) => {
      const where = place(item.line, item.side)
      const id = item.id
      const store = props.feedback
      return where && store
        ? [{ ...where, key: `f:${id}`, render: () => <For each={comments().filter((entry) => entry.id === id)}>{(entry) => <div class="ghp-dthread ghp-ddraft"><FeedbackNote item={entry} feedback={store} /></div>}</For> }]
        : []
    })
    const box = at && place(at.line, at.side)
    return [
      ...threads,
      ...drafts,
      ...feedback,
      ...(box
        ? [
            {
              ...box,
              key: "composer",
              render: () => (
                <div class="ghp-dthread">
                  <LineComposer
                    target={target}
                    onClose={() => setTarget(undefined)}
                    onComment={props.onComment}
                    onDraft={props.onDraft}
                    drafting={props.drafting}
                    onFeedback={
                      props.feedback && props.where
                        ? (picked, body) => props.feedback?.add(props.path, props.where ?? "", props.patch, picked, body)
                        : undefined
                    }
                  />
                </div>
              ),
            },
          ]
        : []),
    ]
  })

  return (
    <Show when={props.patch} fallback={<div class="ghp-faint ghp-pad">{t("diff.noPatch")}</div>}>
      <Show when={fileDiff()} fallback={props.fallback ?? <div class="ghp-faint ghp-pad">{t("diff.noPatch")}</div>}>
        {(diff) => <PatchView fileDiff={diff()} notes={notes()} selected={target()} onSelect={commentable() ? setTarget : undefined} />}
      </Show>
      <Show when={clipped().hidden > 0}>
        <div class="ghp-more">
          <ui.Button size="small" variant="ghost" onClick={() => setAll(true)}>
            {t("diff.showAll", { count: clipped().hidden })}
          </ui.Button>
        </div>
      </Show>
      <For each={stray(props.threads ?? [])}>{(thread) => <div class="ghp-dthread">{props.renderThread?.(thread)}</div>}</For>
      <For each={stray(props.drafts ?? [])}>{(comment) => <div class="ghp-dthread ghp-ddraft">{props.renderDraft?.(comment, true)}</div>}</For>
      <Show when={props.feedback}>
        {(store) => <For each={stray(comments())}>{(item) => <div class="ghp-dthread ghp-ddraft"><FeedbackNote item={item} feedback={store()} /></div>}</For>}
      </Show>
    </Show>
  )
}

/** The comment box on the picked lines. Where it can go depends on the diff: GitHub, the draft review, the agent. */
function LineComposer(props: {
  target: () => Target | undefined
  onClose: () => void
  onComment?: (target: Target, body: string) => Promise<boolean>
  onDraft?: (target: Target, body: string) => Promise<boolean>
  drafting?: boolean
  onFeedback?: (target: Target, body: string) => void
}) {
  const ctx = usePlugin()
  const ui = ctx.ui
  const t = ctx.t
  const [draft, setDraft] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const range = () => {
    const at = props.target()
    return at?.startLine && at.startLine !== at.line ? { from: at.startLine, to: at.line } : undefined
  }
  const send = async (mode: "single" | "review" | "agent") => {
    const at = props.target()
    const body = draft().trim()
    if (!at || !body || busy()) return
    if (mode === "agent") {
      props.onFeedback?.(at, body)
      props.onClose()
      return
    }
    const submit = mode === "review" ? props.onDraft : props.onComment
    if (!submit) return
    setBusy(true)
    const done = await submit(at, body)
    setBusy(false)
    if (done) props.onClose()
  }
  return (
    <div class="ghp-composer">
      <textarea
        class="ghp-textarea"
        rows={3}
        ref={(element) => requestAnimationFrame(() => element.focus())}
        placeholder={range() ? t("diff.commentLines", range() ?? { from: 0, to: 0 }) : t("diff.commentPlaceholder")}
        value={draft()}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            // In a review, ⌘⏎ adds to it; with no GitHub comment to post, it goes to the agent; otherwise it posts.
            void send(props.onDraft && (props.drafting || !props.onComment) ? "review" : props.onComment && !range() ? "single" : "agent")
          }
          if (event.key === "Escape") props.onClose()
        }}
      />
      <div class="ghp-item-actions">
        <div class="ghp-spacer" />
        <ui.Button size="small" variant="ghost" onClick={props.onClose}>
          {t("cancel")}
        </ui.Button>
        <Show when={props.onFeedback}>
          <ui.Button
            size="small"
            variant={props.onDraft || props.onComment ? "neutral" : "contrast"}
            icon="bubble-5"
            disabled={!draft().trim()}
            onClick={() => void send("agent")}
          >
            {t("diff.toAgent")}
          </ui.Button>
        </Show>
        {/* GitHub's single comment API here takes one line; a range goes through the draft review. */}
        <Show when={props.onComment && !range()}>
          <ui.Button size="small" variant={props.onDraft ? "neutral" : "contrast"} busy={busy()} disabled={!draft().trim()} onClick={() => void send("single")}>
            {props.onDraft ? t("draft.addSingle") : t("diff.comment")}
          </ui.Button>
        </Show>
        <Show when={props.onDraft}>
          <ui.Button size="small" variant="contrast" icon="review" busy={busy()} disabled={!draft().trim()} onClick={() => void send("review")}>
            {props.drafting ? t("draft.add") : t("draft.start")}
          </ui.Button>
        </Show>
      </div>
    </div>
  )
}

export function statusLetter(status: string) {
  if (status === "added") return "A"
  if (status === "removed") return "D"
  if (status === "renamed") return "R"
  if (status === "copied") return "C"
  return "M"
}
