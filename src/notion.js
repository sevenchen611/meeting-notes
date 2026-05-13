import { Client } from "@notionhq/client";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const NOTION_VERSION = "2026-03-11";
const SINGLE_PART_LIMIT = 20 * 1024 * 1024;
const MULTI_PART_CHUNK_SIZE = 10 * 1024 * 1024;

export function isNotionConfigured() {
  return Boolean(process.env.NOTION_TOKEN && process.env.NOTION_MEETING_DATABASE_ID);
}

export function createNotionClient() {
  return new Client({
    auth: process.env.NOTION_TOKEN,
    notionVersion: NOTION_VERSION
  });
}

export async function createMeetingPage({ analysis, markdown, sourceFileName, sourceFile, attachAudio = false }) {
  if (!isNotionConfigured()) {
    throw new Error("Notion 還沒有設定完成，請先設定 Notion Token 和會議記錄資料庫。");
  }

  const notion = createNotionClient();
  const target = await resolveMeetingTarget(notion, process.env.NOTION_MEETING_DATABASE_ID);
  const titlePropertyName = getTitlePropertyName(target.dataSource);
  const title = formatMeetingPageTitle(analysis, markdown, sourceFileName);
  const audio = attachAudio ? await uploadAudioForNotion(notion, sourceFile) : null;
  const blocks = buildMeetingPageBlocks({ audio, analysis, markdown });

  const page = await notion.pages.create({
    parent: target.parent,
    properties: {
      [titlePropertyName]: {
        title: [
          {
            text: {
              content: title.slice(0, 2000)
            }
          }
        ]
      },
      ...buildMeetingProperties(target.dataSource, analysis, markdown)
    },
    children: blocks.slice(0, 100)
  });

  for (let index = 100; index < blocks.length; index += 100) {
    await notion.blocks.children.append({
      block_id: page.id,
      children: blocks.slice(index, index + 100)
    });
  }

  return {
    id: page.id,
    url: page.url,
    audio: audio
      ? {
          fileUploadId: audio.fileUploadId,
          fileName: audio.fileName,
          size: audio.size,
          uploadMode: audio.uploadMode,
          partCount: audio.partCount
        }
      : null
  };
}

export async function appendAudioToMeetingPage({ page, sourceFile }) {
  if (!isNotionConfigured()) {
    throw new Error("Notion 還沒有設定完成，請先設定 Notion Token 和會議記錄資料庫。");
  }

  const notion = createNotionClient();
  const audio = await uploadAudioForNotion(notion, sourceFile);
  await notion.blocks.children.append({
    block_id: page.id,
    children: buildAudioBlocks(audio)
  });

  return {
    ...page,
    audio: {
      fileUploadId: audio.fileUploadId,
      fileName: audio.fileName,
      size: audio.size,
      uploadMode: audio.uploadMode,
      partCount: audio.partCount
    }
  };
}

export async function resolveMeetingTarget(notion, configuredId) {
  const id = String(configuredId || "").trim();
  if (!id) {
    throw new Error("Notion 會議記錄資料庫尚未設定。");
  }

  try {
    const dataSource = await notion.dataSources.retrieve({ data_source_id: id });
    return {
      dataSource,
      parent: { data_source_id: dataSource.id }
    };
  } catch (dataSourceError) {
    const database = await notion.databases.retrieve({ database_id: id });
    const dataSourceId = database.data_sources?.[0]?.id;

    if (dataSourceId) {
      const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
      return {
        database,
        dataSource,
        parent: { data_source_id: dataSource.id }
      };
    }

    if (Object.keys(database.properties || {}).length) {
      return {
        database,
        dataSource: database,
        parent: { database_id: database.id }
      };
    }

    throw dataSourceError;
  }
}

async function uploadAudioForNotion(notion, sourceFile = {}) {
  const filePath = sourceFile.storedPath;
  if (!filePath) {
    throw new Error("找不到錄音檔路徑，所以無法把錄音保留到 Notion。");
  }

  const fileStats = await stat(filePath).catch(() => null);
  if (!fileStats?.isFile()) {
    throw new Error("錄音檔已不存在，無法上傳到 Notion。請重新上傳錄音並產生會議記錄。");
  }

  const fileName = safeNotionFileName(sourceFile.originalName || path.basename(filePath));
  const contentType = getAudioContentType(fileName, sourceFile.mimetype);
  const fileBuffer = await readFile(filePath);

  if (fileBuffer.byteLength <= SINGLE_PART_LIMIT) {
    const fileUpload = await notion.fileUploads.create({
      mode: "single_part",
      filename: fileName,
      content_type: contentType
    });

    const sent = await notion.fileUploads.send({
      file_upload_id: fileUpload.id,
      file: {
        filename: fileName,
        data: new Blob([fileBuffer], { type: contentType })
      }
    });

    return {
      fileUploadId: sent.id,
      fileName,
      size: fileBuffer.byteLength,
      uploadMode: "single_part",
      partCount: 1
    };
  }

  const parts = splitBuffer(fileBuffer, MULTI_PART_CHUNK_SIZE);
  const fileUpload = await notion.fileUploads.create({
    mode: "multi_part",
    filename: fileName,
    content_type: contentType,
    number_of_parts: parts.length
  });

  for (const [index, part] of parts.entries()) {
    await notion.fileUploads.send({
      file_upload_id: fileUpload.id,
      part_number: String(index + 1),
      file: {
        filename: fileName,
        data: new Blob([part], { type: contentType })
      }
    });
  }

  const completed = await notion.fileUploads.complete({
    file_upload_id: fileUpload.id
  });

  return {
    fileUploadId: completed.id,
    fileName,
    size: fileBuffer.byteLength,
    uploadMode: "multi_part",
    partCount: parts.length
  };
}

function buildAudioBlocks(audio) {
  return [
    heading("heading_3", "會議錄音"),
    {
      object: "block",
      type: "audio",
      audio: {
        type: "file_upload",
        file_upload: {
          id: audio.fileUploadId
        },
        caption: richText(`${audio.fileName}（${formatBytes(audio.size)}）`)
      }
    },
    {
      object: "block",
      type: "divider",
      divider: {}
    }
  ];
}

function buildMeetingPageBlocks({ audio, analysis, markdown }) {
  const { notesMarkdown, transcriptMarkdown } = splitTranscriptSection(markdown);
  return [
    ...(audio ? buildAudioBlocks(audio) : []),
    buildMeetingTabs(analysis, notesMarkdown, transcriptMarkdown)
  ];
}

function buildMeetingTabs(analysis = {}, notesMarkdown = "", transcriptMarkdown = "") {
  return {
    object: "block",
    type: "tab",
    tab: {
      children: [
        tabItem("摘要", buildSummaryBlocks(analysis, notesMarkdown)),
        tabItem("筆記", markdownToBlocks(notesMarkdown)),
        tabItem("逐字稿", buildTranscriptBlocks(analysis, transcriptMarkdown))
      ]
    }
  };
}

function tabItem(label, children = []) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(label),
      children: fitTabChildren(children)
    }
  };
}

function buildSummaryBlocks(analysis = {}, notesMarkdown = "") {
  const meeting = analysis.meeting || {};
  const standard = analysis.standard_minutes || {};
  const blocks = [
    heading("heading_3", "會議摘要"),
    paragraph(meeting.summary || extractFirstParagraph(notesMarkdown) || "尚無摘要。")
  ];

  const decisions = Array.isArray(standard.conclusions) && standard.conclusions.length
    ? standard.conclusions.map((item) => item.detail || item.label).filter(Boolean)
    : (analysis.discussion?.decisions || []).map((item) => item.decision).filter(Boolean);
  if (decisions.length) {
    blocks.push(heading("heading_3", "共同決議"));
    decisions.slice(0, 8).forEach((decision) => blocks.push(bullet(decision)));
  }

  const actionItems = flattenActionItems(analysis);
  if (actionItems.length) {
    blocks.push(heading("heading_3", "待辦摘要"));
    actionItems.slice(0, 8).forEach((item) => blocks.push(todo(item)));
  }

  return blocks;
}

function buildTranscriptBlocks(analysis = {}, transcriptMarkdown = "") {
  const transcriptText = extractTranscriptPlainText(transcriptMarkdown) || buildTranscriptPlainText(analysis);
  if (!transcriptText) {
    return [paragraph("尚未產生逐字稿。")];
  }

  return compactTextBlocks(transcriptText);
}

function getTitlePropertyName(dataSource) {
  const entry = Object.entries(dataSource.properties || {}).find(([, property]) => property.type === "title");
  return entry?.[0] || "Name";
}

function buildMeetingProperties(dataSource, analysis = {}, markdown = "") {
  const properties = {};
  const datePropertyName = getPropertyName(dataSource, ["日期", "會議日期", "Date", "Meeting Date"], "date");
  const statusPropertyName = getPropertyName(dataSource, ["待辦同步狀態", "Status"], "select");
  const summaryPropertyName = getPropertyName(dataSource, ["摘要", "會議摘要", "待辦同步摘要", "Summary"], "rich_text");
  const transcriptPropertyName = getPropertyName(
    dataSource,
    ["逐字稿", "完整逐字稿", "Transcript", "Full Transcript"],
    "rich_text",
    { allowFallback: false }
  );
  const meetingDate = resolveMeetingDate(analysis, markdown);

  if (datePropertyName && meetingDate) {
    properties[datePropertyName] = {
      date: {
        start: meetingDate
      }
    };
  }

  if (statusPropertyName && hasSelectOption(dataSource, statusPropertyName, "未同步")) {
    properties[statusPropertyName] = {
      select: {
        name: "未同步"
      }
    };
  }

  if (summaryPropertyName) {
    const actionCount = countActionItems(analysis);
    const followUpCount = Array.isArray(analysis?.follow_ups) ? analysis.follow_ups.length : 0;
    const summaryText = analysis?.meeting?.summary || `待辦 ${actionCount} 項；待追蹤 ${followUpCount} 項`;
    properties[summaryPropertyName] = {
      rich_text: richText(summaryText)
    };
  }

  if (transcriptPropertyName) {
    const transcriptText = extractTranscriptPlainText(markdown) || buildTranscriptPlainText(analysis);
    if (transcriptText) {
      properties[transcriptPropertyName] = {
        rich_text: richText(transcriptText)
      };
    }
  }

  return properties;
}

function countActionItems(analysis = {}) {
  const groups = analysis.standard_minutes?.action_groups;
  if (Array.isArray(groups) && groups.length) {
    return groups.reduce((sum, group) => sum + (Array.isArray(group.tasks) ? group.tasks.length : 0), 0);
  }
  return Array.isArray(analysis?.action_items) ? analysis.action_items.length : 0;
}

function getPropertyName(dataSource, preferredNames, type, options = {}) {
  const properties = dataSource.properties || {};
  for (const name of preferredNames) {
    if (properties[name]?.type === type) return name;
  }

  if (options.allowFallback === false) return "";

  const entry = Object.entries(properties).find(([, property]) => property.type === type);
  return entry?.[0] || "";
}

function hasSelectOption(dataSource, propertyName, optionName) {
  const options = dataSource.properties?.[propertyName]?.select?.options || [];
  return options.some((option) => option.name === optionName);
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function formatMeetingPageTitle(analysis = {}, markdown = "", sourceFileName = "") {
  const headingTitle = extractPrimaryHeading(markdown);
  if (headingTitle) return headingTitle;

  const title = analysis?.meeting?.title || sourceFileName || "\u6703\u8b70\u8a18\u9304";
  const date = resolveMeetingDate(analysis, markdown);
  if (!date) return title;

  const [, year, month, day] = date.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  if (!year) return title;
  return `${year}\u5e74${Number(month)}\u6708${Number(day)}\u65e5${title}`;
}

function extractPrimaryHeading(markdown = "") {
  const line = String(markdown || "")
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith("# "));
  if (!line) return "";
  return stripBold(line.trim().slice(2)).trim();
}

function resolveMeetingDate(analysis = {}, markdown = "") {
  const meetingDate = normalizeDate(analysis?.meeting?.date);
  if (meetingDate) return meetingDate;

  const headingTitle = extractPrimaryHeading(markdown);
  if (!headingTitle) return "";

  const match = headingTitle.match(/(\d{4})\s*\u5e74\s*(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5/);
  if (!match) return "";
  return `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
}

function splitTranscriptSection(markdown = "") {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s+逐字稿\s*$/.test(line.trim()));
  if (start < 0) {
    return {
      notesMarkdown: markdown,
      transcriptMarkdown: ""
    };
  }

  const [, markerLevelText = ""] = lines[start].match(/^(#{1,6})\s+/) || [];
  const markerLevel = markerLevelText.length || 3;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].trim().match(/^(#{1,6})\s+/);
    if (match && match[1].length <= markerLevel) {
      end = index;
      break;
    }
  }

  const notesMarkdown = [
    ...lines.slice(0, start),
    ...lines.slice(end)
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const transcriptMarkdown = lines.slice(start, end).join("\n").trim();

  return {
    notesMarkdown,
    transcriptMarkdown
  };
}

function extractFirstParagraph(markdown = "") {
  return String(markdown || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && line !== "---" && !line.startsWith("- ")) || "";
}

function extractTranscriptPlainText(markdown = "") {
  const { transcriptMarkdown } = splitTranscriptSection(markdown);
  const source = transcriptMarkdown || (String(markdown || "").includes("逐字稿") ? markdown : "");
  return String(source || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== "---" && !/^#{1,6}\s+逐字稿\s*$/.test(line))
    .map((line) => stripBold(line.replace(/^\s*[-*+]\s+/, "")))
    .join("\n");
}

function buildTranscriptPlainText(analysis = {}) {
  const segments = collectTranscriptSegments(analysis);
  return segments
    .map((segment) => {
      const timestamp = segment.timestamp ? `[${segment.timestamp}] ` : "";
      const speaker = segment.speaker || "未識別（待確認）";
      const text = segment.text || segment.summary || "";
      return `${timestamp}${speaker}：${text}`.trim();
    })
    .filter(Boolean)
    .join("\n");
}

function collectTranscriptSegments(analysis = {}) {
  const directSegments = asArray(analysis.transcript_segments)
    .map((segment) => ({
      speaker: segment?.speaker,
      timestamp: segment?.timestamp,
      text: segment?.text,
      summary: segment?.summary,
      confidence: segment?.confidence
    }))
    .filter((segment) => segment.text || segment.summary);

  if (directSegments.length) return directSegments;

  const nestedSegments = asArray(analysis.transcript?.segments)
    .map((segment) => ({
      speaker: segment?.speaker,
      timestamp: segment?.timestamp,
      text: segment?.text,
      summary: segment?.summary,
      confidence: segment?.confidence
    }))
    .filter((segment) => segment.text || segment.summary);

  if (nestedSegments.length) return nestedSegments;

  return asArray(analysis.raw_transcript_outline)
    .map((segment) => ({
      speaker: segment?.speaker,
      timestamp: segment?.timestamp,
      text: segment?.text,
      summary: segment?.summary,
      confidence: segment?.confidence
    }))
    .filter((segment) => segment.text || segment.summary);
}

function flattenActionItems(analysis = {}) {
  const groups = analysis.standard_minutes?.action_groups;
  if (Array.isArray(groups) && groups.length) {
    return groups.flatMap((group) => asArray(group.tasks).map((task) => {
      const owner = task.owner || group.owner;
      const ownerText = owner ? `${owner}：` : "";
      const due = task.due_date ? `（截止：${task.due_date}）` : "";
      return `${ownerText}${task.task || "待辦事項"}${task.detail ? ` ${task.detail}` : ""}${due}`;
    }));
  }

  return asArray(analysis.action_items).map((item) => {
    const owner = item.owner ? `${item.owner}：` : "";
    const due = item.due_date ? `（截止：${item.due_date}）` : "";
    return `${owner}${item.task || "待辦事項"}${item.source_or_reason ? ` ${item.source_or_reason}` : ""}${due}`;
  });
}

function compactTextBlocks(text = "") {
  const chunks = [];
  const clean = String(text || "");
  for (let index = 0; index < clean.length; index += 1800) {
    chunks.push(clean.slice(index, index + 1800));
  }
  return (chunks.length ? chunks : [""]).map((chunk) => paragraph(chunk));
}

function fitTabChildren(blocks = []) {
  const prepared = blocks.filter(Boolean);
  if (prepared.length <= 95) return prepared;
  return [
    ...prepared.slice(0, 94),
    paragraph("內容較長，Notion 分頁已保留前段；完整內容仍可在本機輸出 Markdown 查看。")
  ];
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function markdownToBlocks(markdown) {
  const blocks = [];
  const lines = markdown.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (line === "---") {
      blocks.push({ object: "block", type: "divider", divider: {} });
    } else if (line.startsWith("### ")) {
      blocks.push(heading("heading_3", stripBold(line.slice(4))));
    } else if (line.startsWith("## ")) {
      blocks.push(heading("heading_2", stripBold(line.slice(3))));
    } else if (line.startsWith("# ")) {
      blocks.push(heading("heading_1", stripBold(line.slice(2))));
    } else if (/^\s*-\s+\[\s\]\s+/.test(rawLine)) {
      blocks.push(todo(line.replace(/^\s*-\s+\[\s\]\s+/, "")));
    } else if (/^\s*-\s+/.test(rawLine)) {
      blocks.push(bullet(line.replace(/^\s*-\s+/, "")));
    } else if (/^\s*\d+\.\s+/.test(rawLine)) {
      blocks.push(numbered(line.replace(/^\s*\d+\.\s+/, "")));
    } else {
      for (const chunk of chunkText(line)) {
        blocks.push(paragraph(chunk));
      }
    }
  }

  return blocks;
}

function heading(type, text) {
  return {
    object: "block",
    type,
    [type]: {
      rich_text: richText(text)
    }
  };
}

function bullet(text) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: {
      rich_text: richText(text)
    }
  };
}

function numbered(text) {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: {
      rich_text: richText(text)
    }
  };
}

function todo(text) {
  return {
    object: "block",
    type: "to_do",
    to_do: {
      checked: false,
      rich_text: richText(text)
    }
  };
}

function paragraph(text) {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: richText(text)
    }
  };
}

function richText(text) {
  const chunks = [];
  for (const content of chunkText(text)) {
    chunks.push(...parseBoldRichText(content));
  }
  return chunks.length ? chunks : [{ type: "text", text: { content: "" } }];
}

function parseBoldRichText(text) {
  const parts = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(textPart(text.slice(lastIndex, match.index), false));
    }
    parts.push(textPart(match[1], true));
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(textPart(text.slice(lastIndex), false));
  }

  return parts.filter((part) => part.text.content);
}

function textPart(content, bold) {
  return {
    type: "text",
    text: { content },
    annotations: {
      bold
    }
  };
}

function stripBold(text) {
  return String(text || "").replace(/\*\*(.+?)\*\*/g, "$1");
}

function chunkText(text, size = 1800) {
  const chunks = [];
  const clean = String(text || "").slice(0, 12000);
  for (let index = 0; index < clean.length; index += size) {
    chunks.push(clean.slice(index, index + size));
  }
  return chunks.length ? chunks : [""];
}

function splitBuffer(buffer, chunkSize) {
  const chunks = [];
  for (let start = 0; start < buffer.byteLength; start += chunkSize) {
    chunks.push(buffer.subarray(start, Math.min(start + chunkSize, buffer.byteLength)));
  }
  return chunks;
}

function safeNotionFileName(fileName) {
  const parsed = path.parse(String(fileName || "meeting-audio.mp3"));
  const extension = parsed.ext || ".mp3";
  const name = (parsed.name || "meeting-audio")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return `${name || "meeting-audio"}${extension}`.slice(0, 220);
}

function getAudioContentType(fileName, fallback = "") {
  const normalized = String(fallback || "").toLowerCase();
  const aliases = {
    "audio/mp3": "audio/mpeg",
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
    "audio/mp4a-latm": "audio/mp4",
    "audio/x-wav": "audio/wav"
  };
  if (aliases[normalized]) return aliases[normalized];
  if (normalized.startsWith("audio/")) return normalized;

  const extension = path.extname(fileName).toLowerCase();
  const types = {
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".oga": "audio/ogg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".webm": "audio/webm"
  };
  return types[extension] || "audio/mpeg";
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
