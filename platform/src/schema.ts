import { customType, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const vector = customType<{ data: number[] | null; driverData: string | null }>({
  dataType: () => "vector(1536)",
});
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const sites = pgTable("sites", {
  id: uuid("id").primaryKey().defaultRandom(), host: text("host").notNull(), origin: text("origin").notNull(),
  brand: text("brand"), title: text("title"), platform: text("platform"), builder: text("builder"),
  themeName: text("theme_name"), themeVersion: text("theme_version"), theme: jsonb("theme"),
  apps: text("apps").array().notNull().default([]), currency: text("currency"), locale: text("locale"),
  country: text("country"), industry: text("industry").notNull().default("other"), industryScore: real("industry_score").notNull().default(0),
  rank: integer("rank"), mentions: integer("mentions").notNull().default(0), sources: text("sources").array().notNull().default([]),
  validatedAt: timestamp("validated_at", { withTimezone: true }), ...timestamps,
}, (t) => [uniqueIndex("sites_host_uidx").on(t.host), index("sites_platform_idx").on(t.platform), index("sites_theme_idx").on(t.themeName), index("sites_industry_idx").on(t.industry), index("sites_country_idx").on(t.country), index("sites_rank_idx").on(t.rank), index("sites_apps_gin_idx").using("gin", t.apps)]);

export const pages = pgTable("pages", {
  id: uuid("id").primaryKey().defaultRandom(), siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  url: text("url").notNull(), type: text("type").notNull(), slug: text("slug").notNull(), title: text("title"),
  description: text("description"), canonical: text("canonical"), ogImage: text("og_image"), lang: text("lang"), h1: text("h1"), ...timestamps,
}, (t) => [uniqueIndex("pages_site_url_uidx").on(t.siteId, t.url), index("pages_site_idx").on(t.siteId), index("pages_type_idx").on(t.type)]);

export const captures = pgTable("captures", {
  id: uuid("id").primaryKey().defaultRandom(), pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(), desktop: jsonb("desktop"), mobile: jsonb("mobile"), ...timestamps,
}, (t) => [uniqueIndex("captures_page_time_uidx").on(t.pageId, t.capturedAt), index("captures_page_idx").on(t.pageId), index("captures_time_idx").on(t.capturedAt)]);

export const blocks = pgTable("blocks", {
  id: uuid("id").primaryKey().defaultRandom(), captureId: uuid("capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
  ref: text("ref").notNull(), blockIndex: integer("block_index").notNull(), viewport: text("viewport").notNull(), typeHint: text("type_hint").notNull(),
  blockType: text("block_type"), tags: text("tags").array().notNull().default([]), parentType: text("parent_type"), tag: text("tag"),
  elementId: text("element_id"), classes: text("classes"), top: integer("top").notNull(), height: integer("height").notNull(), width: integer("width").notNull(),
  text: text("text").notNull(), textLength: integer("text_length").notNull(), headline: text("headline"), buttons: integer("buttons").notNull(),
  images: integer("images").notNull(), videos: integer("videos").notNull(), background: text("background").notNull(), imageKey: text("image_key"),
  thumbnailKey: text("thumbnail_key"), blurhash: text("blurhash"), imageWidth: integer("image_width"), imageHeight: integer("image_height"),
  aiDescription: text("ai_description"), aiResponse: jsonb("ai_response"), embedding: vector("embedding"), ...timestamps,
}, (t) => [uniqueIndex("blocks_capture_vp_index_uidx").on(t.captureId, t.viewport, t.blockIndex), index("blocks_capture_idx").on(t.captureId), index("blocks_viewport_idx").on(t.viewport), index("blocks_type_hint_idx").on(t.typeHint), index("blocks_block_type_idx").on(t.blockType), index("blocks_tags_gin_idx").using("gin", t.tags)]);

export const taxonomy = pgTable("taxonomy", {
  id: uuid("id").primaryKey().defaultRandom(), kind: text("kind").notNull(), key: text("key").notNull(), label: text("label").notNull(), synonyms: text("synonyms").array().notNull().default([]), parentId: uuid("parent_id"), ...timestamps,
}, (t) => [uniqueIndex("taxonomy_kind_key_uidx").on(t.kind, t.key), index("taxonomy_kind_idx").on(t.kind), index("taxonomy_synonyms_gin_idx").using("gin", t.synonyms)]);

export const siteTech = pgTable("site_tech", {
  id: uuid("id").primaryKey().defaultRandom(), siteId: uuid("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), name: text("name").notNull(), version: text("version"), metadata: jsonb("metadata").notNull().default({}), ...timestamps,
}, (t) => [uniqueIndex("site_tech_site_kind_name_uidx").on(t.siteId, t.kind, t.name), index("site_tech_site_idx").on(t.siteId), index("site_tech_kind_name_idx").on(t.kind, t.name)]);

export const users = pgTable("users", { id: uuid("id").primaryKey(), email: text("email"), name: text("name"), avatarUrl: text("avatar_url"), ...timestamps });
export const orgs = pgTable("orgs", { id: uuid("id").primaryKey().defaultRandom(), ownerId: uuid("owner_id").notNull().references(() => users.id), name: text("name").notNull(), slug: text("slug").notNull(), ...timestamps }, (t) => [uniqueIndex("orgs_slug_uidx").on(t.slug), index("orgs_owner_idx").on(t.ownerId)]);
export const boards = pgTable("boards", { id: uuid("id").primaryKey().defaultRandom(), orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }), createdBy: uuid("created_by").notNull().references(() => users.id), name: text("name").notNull(), description: text("description"), ...timestamps }, (t) => [index("boards_org_idx").on(t.orgId), index("boards_created_by_idx").on(t.createdBy)]);
export const boardItems = pgTable("board_items", { id: uuid("id").primaryKey().defaultRandom(), boardId: uuid("board_id").notNull().references(() => boards.id, { onDelete: "cascade" }), blockId: uuid("block_id").notNull().references(() => blocks.id, { onDelete: "cascade" }), addedBy: uuid("added_by").notNull().references(() => users.id), note: text("note"), position: integer("position").notNull().default(0), ...timestamps }, (t) => [uniqueIndex("board_items_board_block_uidx").on(t.boardId, t.blockId), index("board_items_board_position_idx").on(t.boardId, t.position), index("board_items_block_idx").on(t.blockId), index("board_items_added_by_idx").on(t.addedBy)]);
export const takedownRequests = pgTable("takedown_requests", { id: uuid("id").primaryKey().defaultRandom(), requesterUserId: uuid("requester_user_id").references(() => users.id), email: text("email").notNull(), host: text("host").notNull(), reason: text("reason").notNull(), status: text("status").notNull().default("pending"), resolvedAt: timestamp("resolved_at", { withTimezone: true }), ...timestamps }, (t) => [index("takedown_user_idx").on(t.requesterUserId), index("takedown_host_idx").on(t.host), index("takedown_status_idx").on(t.status)]);

export const captureDiffs = pgTable("capture_diffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  pageId: uuid("page_id").notNull().references(() => pages.id, { onDelete: "cascade" }),
  fromCaptureId: uuid("from_capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
  toCaptureId: uuid("to_capture_id").notNull().references(() => captures.id, { onDelete: "cascade" }),
  addedBlockCount: integer("added_block_count").notNull().default(0),
  removedBlockCount: integer("removed_block_count").notNull().default(0),
  changedBlockCount: integer("changed_block_count").notNull().default(0),
  summary: jsonb("summary").notNull().default({}), ...timestamps,
}, (t) => [index("capture_diffs_page_idx").on(t.pageId), index("capture_diffs_from_idx").on(t.fromCaptureId), index("capture_diffs_to_idx").on(t.toCaptureId)]);
