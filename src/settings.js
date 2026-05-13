import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { createNotionClient, resolveMeetingTarget } from "./notion.js";

const NOTION_TARGETS_FILE = "notion-database-targets.json";
const DEFAULT_NOTION_TARGET_LABEL = "未命名會議資料庫";
const DEFAULT_NOTION_TARGETS = [
  {
    id: "35951c68-6dac-80bf-b5b5-c34e379a865a",
    label: "好主意好會議"
  },
  {
    id: "35d51c68-6dac-80a4-9fd8-ed5372c520fe",
    label: "讀書會議"
  }
];

export async function getPublicConfig(rootDir = process.cwd()) {
  const targetStore = await readNotionTargetStore(rootDir);
  const selectedTargetId = resolveSelectedTargetId(targetStore);
  const selectedTarget = targetStore.targets.find((target) => target.id === selectedTargetId) || null;

  return {
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    notionConfigured: Boolean(process.env.NOTION_TOKEN && selectedTargetId),
    notionHostPersonId: process.env.NOTION_HOST_PERSON_ID || "",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    notionDatabaseId: selectedTargetId ? maskValue(selectedTargetId) : "",
    notionTargetLabel: selectedTarget?.label || "",
    notionTargets: targetStore.targets.map((target) => ({
      id: target.id,
      label: target.label,
      maskedId: maskValue(target.id),
      selected: target.id === selectedTargetId
    }))
  };
}

export async function saveSettings(rootDir, settings = {}) {
  const targetStore = await readNotionTargetStore(rootDir);
  const updatedTargetStore = upsertNotionTargetFromSettings(targetStore, settings);
  const selectedTargetId = resolveSelectedTargetId(updatedTargetStore);

  const next = {
    PORT: String(process.env.PORT || "5178"),
    GEMINI_API_KEY: clean(settings.geminiApiKey) || process.env.GEMINI_API_KEY || "",
    GEMINI_MODEL: clean(settings.geminiModel) || process.env.GEMINI_MODEL || "gemini-2.5-flash",
    NOTION_TOKEN: clean(settings.notionToken) || process.env.NOTION_TOKEN || "",
    NOTION_HOST_PERSON_ID: clean(settings.notionHostPersonId) || process.env.NOTION_HOST_PERSON_ID || "",
    NOTION_MEETING_DATABASE_ID: selectedTargetId || ""
  };

  process.env.PORT = next.PORT;
  process.env.GEMINI_API_KEY = next.GEMINI_API_KEY;
  process.env.GEMINI_MODEL = next.GEMINI_MODEL;
  process.env.NOTION_TOKEN = next.NOTION_TOKEN;
  process.env.NOTION_HOST_PERSON_ID = next.NOTION_HOST_PERSON_ID;
  process.env.NOTION_MEETING_DATABASE_ID = next.NOTION_MEETING_DATABASE_ID;

  await writeNotionTargetStore(rootDir, updatedTargetStore);
  await writeFile(path.join(rootDir, ".env"), buildEnvFile(next), "utf8");
  return getPublicConfig(rootDir);
}

export async function testGeminiSettings() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Gemini API Key 尚未設定");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    contents: "OK"
  });

  const text = response.text?.trim() || "";
  return {
    ok: Boolean(text),
    message: text || "Gemini 測試成功"
  };
}

export async function testNotionSettings() {
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_MEETING_DATABASE_ID) {
    throw new Error("Notion Token 或 Notion Database ID 尚未設定");
  }

  const notion = createNotionClient();
  const target = await resolveMeetingTarget(notion, process.env.NOTION_MEETING_DATABASE_ID);
  const title = getPlainTitle(target.dataSource.title || target.database?.title) || "未命名會議資料庫";

  return {
    ok: true,
    title,
    databaseId: maskValue(target.dataSource.id)
  };
}

export function extractNotionDatabaseId(value = "") {
  const text = value.trim();
  if (!text) return "";

  const compact = text.replace(/-/g, "");
  const match = compact.match(/[0-9a-fA-F]{32}/);
  if (!match) return text;

  const id = match[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function buildEnvFile(values) {
  return [
    `PORT=${values.PORT}`,
    "",
    "# Required for real audio analysis.",
    `GEMINI_API_KEY=${values.GEMINI_API_KEY}`,
    `GEMINI_MODEL=${values.GEMINI_MODEL}`,
    "",
    "# Optional. Leave blank until you are ready to write records into Notion.",
    `NOTION_TOKEN=${values.NOTION_TOKEN}`,
    `NOTION_HOST_PERSON_ID=${values.NOTION_HOST_PERSON_ID}`,
    `NOTION_MEETING_DATABASE_ID=${values.NOTION_MEETING_DATABASE_ID}`,
    ""
  ].join("\n");
}

async function readNotionTargetStore(rootDir) {
  const filePath = path.join(rootDir, NOTION_TARGETS_FILE);
  let store = null;

  if (existsSync(filePath)) {
    try {
      store = JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      store = null;
    }
  }

  return normalizeNotionTargetStore(store);
}

async function writeNotionTargetStore(rootDir, store) {
  await writeFile(
    path.join(rootDir, NOTION_TARGETS_FILE),
    JSON.stringify(normalizeNotionTargetStore(store), null, 2),
    "utf8"
  );
}

function normalizeNotionTargetStore(store = {}) {
  const currentEnvTarget = extractNotionDatabaseId(process.env.NOTION_MEETING_DATABASE_ID || "");
  const rawTargets = Array.isArray(store?.targets) ? store.targets : DEFAULT_NOTION_TARGETS;
  const targets = [];
  const seen = new Set();

  for (const target of rawTargets) {
    const id = extractNotionDatabaseId(clean(target?.id || target?.databaseId || ""));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    targets.push({
      id,
      label: clean(target?.label) || `未命名會議記錄 ${targets.length + 1}`
    });
  }

  if (currentEnvTarget && !seen.has(currentEnvTarget)) {
    targets.unshift({
      id: currentEnvTarget,
      label: DEFAULT_NOTION_TARGET_LABEL
    });
    seen.add(currentEnvTarget);
  }

  const selectedTargetId = extractNotionDatabaseId(clean(store?.selectedTargetId || "")) ||
    (targets.some((target) => target.id === currentEnvTarget) ? currentEnvTarget : "") ||
    targets[0]?.id ||
    "";

  return {
    selectedTargetId,
    targets
  };
}

function upsertNotionTargetFromSettings(store, settings = {}) {
  const targets = [...(store?.targets || DEFAULT_NOTION_TARGETS)];
  const selectedFromForm = extractNotionDatabaseId(clean(settings.notionTargetId || ""));
  const newTargetId = extractNotionDatabaseId(clean(settings.notionDatabaseIdOrUrl || ""));
  const label = clean(settings.notionTargetLabel || "");
  let selectedTargetId = selectedFromForm || store.selectedTargetId || "";

  if (newTargetId) {
    selectedTargetId = newTargetId;
    const existing = targets.find((target) => target.id === newTargetId);
    if (existing) {
      existing.label = label || existing.label;
    } else {
      targets.push({
        id: newTargetId,
        label: label || `未命名會議記錄 ${targets.length + 1}`
      });
    }
  } else if (selectedFromForm && label) {
    const existing = targets.find((target) => target.id === selectedFromForm);
    if (existing) {
      existing.label = label;
    }
  }

  if (!targets.some((target) => target.id === selectedTargetId)) {
    selectedTargetId = targets[0]?.id || "";
  }

  return normalizeNotionTargetStore({
    selectedTargetId,
    targets
  });
}

function resolveSelectedTargetId(store) {
  if (store.targets.some((target) => target.id === store.selectedTargetId)) {
    return store.selectedTargetId;
  }
  return store.targets[0]?.id || "";
}

function getPlainTitle(title = []) {
  return title.map((part) => part.plain_text || "").join("");
}

function clean(value) {
  return String(value || "").trim();
}

function maskValue(value) {
  const text = String(value || "");
  if (text.length <= 8) return "已設定";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

