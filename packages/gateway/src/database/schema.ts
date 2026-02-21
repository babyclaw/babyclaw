import { randomUUID } from "node:crypto";
import { relations } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Enums (string unions — SQLite has no native enums)
// ---------------------------------------------------------------------------

export const MessageRole = {
  system: "system",
  user: "user",
  assistant: "assistant",
} as const;
export type MessageRole = (typeof MessageRole)[keyof typeof MessageRole];

export const ScheduleType = {
  one_off: "one_off",
  recurring: "recurring",
} as const;
export type ScheduleType = (typeof ScheduleType)[keyof typeof ScheduleType];

export const ScheduleStatus = {
  active: "active",
  canceled: "canceled",
  completed: "completed",
} as const;
export type ScheduleStatus =
  (typeof ScheduleStatus)[keyof typeof ScheduleStatus];

export const ScheduleRunStatus = {
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  skipped_overlap: "skipped_overlap",
  skipped_downtime: "skipped_downtime",
} as const;
export type ScheduleRunStatus =
  (typeof ScheduleRunStatus)[keyof typeof ScheduleRunStatus];

export const HeartbeatOutcome = {
  ok: "ok",
  alerted: "alerted",
  error: "error",
  skipped_overlap: "skipped_overlap",
  skipped_empty: "skipped_empty",
} as const;
export type HeartbeatOutcome =
  (typeof HeartbeatOutcome)[keyof typeof HeartbeatOutcome];

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export const chats = sqliteTable(
  "Chat",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    platform: text("platform").notNull(),
    platformChatId: text("platformChatId").notNull(),
    type: text("type").notNull(),
    title: text("title"),
    alias: text("alias"),
    isMain: integer("isMain", { mode: "boolean" }).notNull().default(false),
    linkedAt: integer("linkedAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("Chat_platform_platformChatId_key").on(
      table.platform,
      table.platformChatId,
    ),
    uniqueIndex("Chat_platform_alias_key").on(table.platform, table.alias),
  ],
);

export const sessions = sqliteTable("Session", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),
  key: text("key").notNull().unique(),
  chatId: integer("chatId", { mode: "number" }).notNull(),
  threadId: integer("threadId", { mode: "number" }),
  title: text("title"),
  workingMemory: text("workingMemory"),
  lastActivityAt: integer("lastActivityAt", { mode: "timestamp" }),
  memoriesLastExtractedAt: integer("memoriesLastExtractedAt", {
    mode: "timestamp",
  }),
  createdAt: integer("createdAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
});

export const messages = sqliteTable(
  "Message",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    sessionId: text("sessionId")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull().$type<MessageRole>(),
    content: text("content").notNull(),
    metadata: text("metadata"),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("Message_sessionId_createdAt_idx").on(
      table.sessionId,
      table.createdAt,
    ),
  ],
);

export const schedules = sqliteTable(
  "Schedule",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    chatId: integer("chatId", { mode: "number" }).notNull(),
    createdByUserId: integer("createdByUserId", { mode: "number" }).notNull(),
    threadId: integer("threadId", { mode: "number" }),
    directMessagesTopicId: integer("directMessagesTopicId", {
      mode: "number",
    }),
    title: text("title"),
    taskPrompt: text("taskPrompt").notNull(),
    sourceText: text("sourceText").notNull(),
    type: text("type").notNull().$type<ScheduleType>(),
    cronExpression: text("cronExpression"),
    runAt: integer("runAt", { mode: "timestamp" }),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().$type<ScheduleStatus>().default("active"),
    nextRunAt: integer("nextRunAt", { mode: "timestamp" }),
    lastRunAt: integer("lastRunAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date())
      .$onUpdateFn(() => new Date()),
    targetChatRef: text("targetChatRef"),
    canceledAt: integer("canceledAt", { mode: "timestamp" }),
  },
  (table) => [
    index("Schedule_chatId_status_nextRunAt_idx").on(
      table.chatId,
      table.status,
      table.nextRunAt,
    ),
  ],
);

export const scheduleRuns = sqliteTable(
  "ScheduleRun",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    scheduleId: text("scheduleId")
      .notNull()
      .references(() => schedules.id, { onDelete: "cascade" }),
    scheduledFor: integer("scheduledFor", { mode: "timestamp" }).notNull(),
    status: text("status")
      .notNull()
      .$type<ScheduleRunStatus>()
      .default("pending"),
    attempt: integer("attempt").notNull().default(1),
    sessionKey: text("sessionKey"),
    assistantMessageId: integer("assistantMessageId", { mode: "number" }),
    error: text("error"),
    startedAt: integer("startedAt", { mode: "timestamp" }),
    finishedAt: integer("finishedAt", { mode: "timestamp" }),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("ScheduleRun_scheduleId_createdAt_idx").on(
      table.scheduleId,
      table.createdAt,
    ),
    index("ScheduleRun_status_createdAt_idx").on(
      table.status,
      table.createdAt,
    ),
    index("ScheduleRun_sessionKey_idx").on(table.sessionKey),
  ],
);

export const heartbeatRuns = sqliteTable(
  "HeartbeatRun",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    startedAt: integer("startedAt", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finishedAt", { mode: "timestamp" }),
    outcome: text("outcome").notNull().$type<HeartbeatOutcome>(),
    summary: text("summary"),
    error: text("error"),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("HeartbeatRun_createdAt_idx").on(table.createdAt)],
);

export const channelMessageLinks = sqliteTable(
  "ChannelMessageLink",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => randomUUID()),
    platform: text("platform").notNull(),
    platformChatId: text("platformChatId").notNull(),
    platformMessageId: text("platformMessageId").notNull(),
    sessionKey: text("sessionKey").notNull(),
    scheduleId: text("scheduleId").references(() => schedules.id, {
      onDelete: "set null",
    }),
    scheduleRunId: text("scheduleRunId").references(() => scheduleRuns.id, {
      onDelete: "set null",
    }),
    createdAt: integer("createdAt", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("ChannelMessageLink_platform_chatId_messageId_key").on(
      table.platform,
      table.platformChatId,
      table.platformMessageId,
    ),
    index("ChannelMessageLink_sessionKey_idx").on(table.sessionKey),
    index("ChannelMessageLink_scheduleId_idx").on(table.scheduleId),
    index("ChannelMessageLink_scheduleRunId_idx").on(table.scheduleRunId),
  ],
);

// ---------------------------------------------------------------------------
// Relations (for Drizzle relational query API)
// ---------------------------------------------------------------------------

export const sessionsRelations = relations(sessions, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  session: one(sessions, {
    fields: [messages.sessionId],
    references: [sessions.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ many }) => ({
  runs: many(scheduleRuns),
  links: many(channelMessageLinks),
}));

export const scheduleRunsRelations = relations(
  scheduleRuns,
  ({ one, many }) => ({
    schedule: one(schedules, {
      fields: [scheduleRuns.scheduleId],
      references: [schedules.id],
    }),
    links: many(channelMessageLinks),
  }),
);

export const channelMessageLinksRelations = relations(
  channelMessageLinks,
  ({ one }) => ({
    schedule: one(schedules, {
      fields: [channelMessageLinks.scheduleId],
      references: [schedules.id],
    }),
    scheduleRun: one(scheduleRuns, {
      fields: [channelMessageLinks.scheduleRunId],
      references: [scheduleRuns.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// Inferred row types
// ---------------------------------------------------------------------------

export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;

export type ScheduleRun = typeof scheduleRuns.$inferSelect;
export type NewScheduleRun = typeof scheduleRuns.$inferInsert;

export type HeartbeatRun = typeof heartbeatRuns.$inferSelect;
export type NewHeartbeatRun = typeof heartbeatRuns.$inferInsert;

export type ChannelMessageLink = typeof channelMessageLinks.$inferSelect;
export type NewChannelMessageLink = typeof channelMessageLinks.$inferInsert;
