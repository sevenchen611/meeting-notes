import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { analyzeMeetingAudio } from "./gemini.js";
import { buildMeetingMarkdown, normalizeAnalysisForKnownParticipants, normalizeSpeakerLabelsInText } from "./markdown.js";
import { appendAudioToMeetingPage, createMeetingPage, isNotionConfigured } from "./notion.js";
import { getPublicConfig, saveSettings, testGeminiSettings, testNotionSettings } from "./settings.js";
import { getPromptTemplateById, upsertPromptTemplate, getPromptTemplates } from "./promptTemplates.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const uploadsDir = path.join(rootDir, "uploads");
const outputsDir = path.join(rootDir, "outputs");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 5178);
const AUTO_UPLOAD_TO_NOTION = false;

await mkdir(uploadsDir, { recursive: true });
await mkdir(outputsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname || ".mp3");
    callback(null, `${Date.now()}-${randomId()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024
  },
  fileFilter: (_request, file, callback) => {
    const allowed = [".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".webm"];
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!allowed.includes(extension)) {
      callback(new Error("請上傳支援的音訊格式：MP3、M4A、WAV、AAC、FLAC、OGG 或 WEBM"));
      return;
    }
    callback(null, true);
  }
});

const app = express();
app.use((request, response, next) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.header("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.static(publicDir));

app.get("/api/config", async (_request, response, next) => {
  try {
    response.json(await getPublicConfig(rootDir));
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings", async (request, response, next) => {
  try {
    response.json(await saveSettings(rootDir, request.body));
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/test-gemini", async (_request, response, next) => {
  try {
    response.json(await testGeminiSettings());
  } catch (error) {
    next(error);
  }
});

app.post("/api/settings/test-notion", async (_request, response, next) => {
  try {
    response.json(await testNotionSettings());
  } catch (error) {
    next(error);
  }
});

app.post("/api/analyze", upload.single("audio"), async (request, response, next) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: "請上傳音訊檔案" });
      return;
    }

    request.file.originalname = normalizeOriginalName(request.file.originalname);

    const input = {
      meetingDate: request.body.meetingDate || "",
      host: request.body.meetingHost || "",
      participants: request.body.participants || "",
      context: request.body.context || "",
      originalName: request.file.originalname
    };
    const attachAudioToNotion = parseBooleanInput(request.body.attachAudioToNotion);
    const selectedPromptId = request.body.promptVersionId || null;
    const promptInfo = await getPromptTemplateById(rootDir, selectedPromptId);
    const { template: promptTemplate, versionName, versionId: resolvedPromptVersionId } = promptInfo;

    const analysis = normalizeAnalysisForKnownParticipants(
      await analyzeMeetingAudio(request.file, input, { promptTemplate }),
      input.participants,
      input.host
    );
    const markdown = buildMeetingMarkdown(analysis, {
      ...input,
      fallbackTitle: path.basename(request.file.originalname, path.extname(request.file.originalname))
    });

    const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomId()}`;
    const baseName = safeFileName(analysis?.meeting?.title || input.originalName || id);
    const jsonPath = path.join(outputsDir, `${id}-${baseName}.json`);
    const markdownPath = path.join(outputsDir, `${id}-${baseName}.md`);
    const payload = {
      id,
      createdAt: new Date().toISOString(),
      sourceFile: {
        originalName: request.file.originalname,
        mimetype: request.file.mimetype,
        size: request.file.size,
        storedPath: request.file.path
      },
      input,
      analysis,
      markdown,
      files: {
        jsonPath,
        markdownPath
      },
      notion: {
        configured: isNotionConfigured(),
        attachAudioToNotion,
        page: null,
        error: null
      },
      prompt: {
        versionId: resolvedPromptVersionId || "default",
      versionName: versionName || "系統預設"
      }
    };

    await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
    await writeFile(markdownPath, markdown, "utf8");

    if (AUTO_UPLOAD_TO_NOTION && isNotionConfigured()) {
      try {
        payload.notion.page = await createMeetingPage({
          analysis,
          markdown,
          sourceFileName: payload.sourceFile.originalName,
          sourceFile: payload.sourceFile,
          attachAudio: attachAudioToNotion
        });
      } catch (error) {
        payload.notion.error = error.message || "寫入 Notion 失敗，請稍後再試。";
      }

      await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
    }

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/results/:id/notion", async (request, response, next) => {
  try {
    if (!isNotionConfigured()) {
      throw new Error("Notion 尚未設定，請先完成設定。");
    }

    const result = await readResult(request.params.id);
    const submittedMarkdown = request.body?.markdown;
    const attachAudioToNotion = parseBooleanInput(request.body?.attachAudioToNotion);
    const normalizedSubmittedMarkdown = typeof submittedMarkdown === "string"
      ? normalizeSpeakerLabelsInText(submittedMarkdown, result.input?.participants, result.input?.host)
      : null;
    if (typeof normalizedSubmittedMarkdown === "string" && normalizedSubmittedMarkdown !== result.markdown) {
      result.markdown = normalizedSubmittedMarkdown;
      await writeFile(result.files.markdownPath, normalizedSubmittedMarkdown, "utf8");
    }
    result.notion = {
      ...(result.notion || {}),
      configured: true,
      attachAudioToNotion
    };
    const markdownToUpload = typeof normalizedSubmittedMarkdown === "string"
      ? normalizedSubmittedMarkdown
      : normalizeSpeakerLabelsInText(result.markdown, result.input?.participants, result.input?.host);
    let page = result.notion?.page?.id ? result.notion.page : null;
    if (attachAudioToNotion && page?.id && !page?.audio) {
      page = await appendAudioToMeetingPage({
        page: result.notion.page,
        sourceFile: result.sourceFile
      });
    }
    if (!page) {
      page = await createMeetingPage({
        analysis: result.analysis,
        markdown: markdownToUpload,
        sourceFileName: result.sourceFile?.originalName,
        sourceFile: result.sourceFile,
        attachAudio: attachAudioToNotion
      });
    }

    result.notion = {
      configured: true,
      attachAudioToNotion,
      page
    };

    await writeFile(result.files.jsonPath, JSON.stringify(result, null, 2), "utf8");
    response.json({ page, markdown: markdownToUpload });
  } catch (error) {
    next(error);
  }
});

app.get("/api/prompt-templates", async (_request, response, next) => {
  try {
    response.json(await getPromptTemplates(rootDir));
  } catch (error) {
    next(error);
  }
});

app.post("/api/prompt-templates", async (request, response, next) => {
  try {
    const payload = await upsertPromptTemplate(rootDir, request.body || {});
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    error: error.message || "伺服器發生錯誤"
  });
});

app.listen(port, () => {
  console.log(`Meeting Notes is running at http://localhost:${port}`);
});

async function readResult(id) {
  const files = await import("node:fs/promises").then((fs) => fs.readdir(outputsDir));
  const match = files.find((file) => file.startsWith(`${id}-`) && file.endsWith(".json"));
  if (!match) {
    throw new Error("找不到結果檔，請重新分析後再試。");
  }

  const jsonPath = path.join(outputsDir, match);
  if (!existsSync(jsonPath)) {
    throw new Error("結果資料不存在，請重新分析後再試。");
  }

  return JSON.parse(await readFile(jsonPath, "utf8"));
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function safeFileName(value) {
  return String(value)
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function normalizeOriginalName(name) {
  if (!name || !looksLikeMojibake(name)) return name;
  const candidate = Buffer.from(name, "latin1").toString("utf8");
  return candidate.includes("\uFFFD") ? name : candidate;
}

function looksLikeMojibake(name) {
  return name.includes("\uFFFD");
}

function parseBooleanInput(value) {
  return value === true || value === "true" || value === "on" || value === "1";
}

