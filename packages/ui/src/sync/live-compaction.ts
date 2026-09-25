/**
 * Live compaction projection.
 *
 * The transcript notice keys off a persisted `compaction` part, which OpenCode
 * writes only once the compaction is stored. The live stream reports the same
 * compaction first (`session.next.compaction.started|delta|ended`), so without
 * this projection the notice appears only after the turn settles.
 *
 * This module owns the projection only. The lifecycle transitions that fill
 * `State.live_compaction` live in `event-reducer.ts` next to every other event
 * transition, and the persisted part stays the source of truth: `projectLive
 * Compaction` emits nothing once the authoritative message for the record's
 * `messageID` is in the store, whatever its parts already are.
 */
import type { AssistantMessage, Message, Part, UserMessage } from "@opencode-ai/sdk/v2/client"

import type { LiveCompactionRecord } from "./types"

/** Agent OpenCode attributes its own compaction output to. */
const COMPACTION_AGENT = "compaction"

// Ids of the live rows are derived from the compaction's message ID so a
// re-projection of an unchanged record keeps identical ids. The suffixes cannot
// collide with a server id: OpenCode never emits a double colon.
const SUMMARY_MESSAGE_SUFFIX = "::live-summary"
const COMPACTION_PART_SUFFIX = "::live-compaction"
const SUMMARY_PART_SUFFIX = "::live-summary-text"

/** A `{info, parts}` row, the shape the message store and the transcript share. */
type LiveCompactionEntry = { info: Message; parts: Part[] }

/**
 * IDs of the rows a record projects. Snapshot caches use it to tell projected
 * rows (which have no `state.part` entry) apart from authoritative ones.
 */
export const liveCompactionEntryIds = (record: LiveCompactionRecord | undefined): string[] => {
  if (!record) return []
  return [record.messageID, `${record.messageID}${SUMMARY_MESSAGE_SUFFIX}`]
}

const buildNoticeEntry = (record: LiveCompactionRecord): LiveCompactionEntry => {
  const info: UserMessage = {
    id: record.messageID,
    sessionID: record.sessionID,
    role: "user",
    time: { created: record.startedAt },
    agent: COMPACTION_AGENT,
    model: { providerID: "", modelID: "" },
  }
  const part: Part = {
    id: `${record.messageID}${COMPACTION_PART_SUFFIX}`,
    sessionID: record.sessionID,
    messageID: record.messageID,
    type: "compaction",
    auto: record.reason === "auto",
  }

  return { info, parts: [part] }
}

/**
 * The compaction's own output, as OpenCode persists it: an assistant message
 * flagged `summary`, parented to the notice message and dropped from the
 * transcript flow. The notice reads its text back as the summary that stands in
 * for the compacted history, so the streaming text has to travel the same way.
 */
const buildSummaryEntry = (record: LiveCompactionRecord): LiveCompactionEntry => {
  const messageID = `${record.messageID}${SUMMARY_MESSAGE_SUFFIX}`
  const time: AssistantMessage["time"] = { created: record.startedAt }
  if (record.endedAt !== undefined) {
    time.completed = record.endedAt
  }
  const info: AssistantMessage = {
    id: messageID,
    sessionID: record.sessionID,
    role: "assistant",
    time,
    parentID: record.messageID,
    modelID: "",
    providerID: "",
    mode: COMPACTION_AGENT,
    agent: COMPACTION_AGENT,
    path: { cwd: "", root: "" },
    summary: true,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const part: Part = {
    id: `${messageID}${SUMMARY_PART_SUFFIX}`,
    sessionID: record.sessionID,
    messageID,
    type: "text",
    text: record.text,
  }

  return { info, parts: [part] }
}

/**
 * Rows a live compaction adds to a session's transcript, empty when there is
 * nothing to add. They belong at the end: the compaction is the newest history
 * rewrite, and an in-flight turn keeps it inside the turn it arrived in.
 */
export const projectLiveCompaction = (
  record: LiveCompactionRecord | undefined,
  messages: readonly Message[],
): LiveCompactionEntry[] => {
  if (!record) return []
  // The authoritative message is the compaction: a live row for the same ID
  // would render the notice twice, and the settled row is the better one.
  if (messages.some((message) => message.id === record.messageID)) return []
  // An empty summary cannot be shown or read back, and a notice with no summary
  // is what the persisted part looks like before its output exists.
  if (record.text.length === 0) return [buildNoticeEntry(record)]

  return [buildNoticeEntry(record), buildSummaryEntry(record)]
}
