import { GoogleGenAI, createPartFromUri, createUserContent } from "@google/genai";
import { createDemoAnalysis } from "./markdown.js";
import {
  DEFAULT_PROMPT_TEMPLATE,
  LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT,
  renderPromptTemplate
} from "./promptTemplates.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const MIN_CHINESE_RATIO = 0.45;
const MIN_MEANINGFUL_CHARS = 40;
const DEFAULT_MAX_OUTPUT_TOKENS = 32768;
const TRANSCRIPT_PROMPT_APPENDIX = `逐字稿輸出要求（不可省略）：
- 請把音訊中可辨識的發言轉成 transcript_segments 陣列。
- 每一段 transcript_segments 必須包含 speaker、timestamp、text、confidence。
- text 是逐字稿內容：保留口語語氣與原意，只修正明顯辨識錯字、斷句與標點；不要改寫成摘要。
- 若同一位發言者連續說話太長，請依自然停頓拆成多段。
- timestamp 能推估時使用 HH:MM:SS，無法推估時填 null。
- 若音質或重疊發言導致無法完整辨識，仍輸出可辨識段落，並在 risks_and_unknowns 註明限制。`;

export async function analyzeMeetingAudio(file, input = {}, options = {}) {
  if (!process.env.GEMINI_API_KEY) {
    return createDemoAnalysis({
      ...input,
      originalName: file.originalname
    });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const uploadedFile = await ai.files.upload({
    file: file.path,
    config: {
      mimeType: file.mimetype || "audio/mpeg",
      displayName: file.originalname
    }
  });

  const primaryPrompt = buildPrompt(input, options.promptTemplate);
  const primaryResult = await generateMeetingAnalysis({
    ai,
    uploadedFile,
    prompt: primaryPrompt
  });

  let analysis = primaryResult.analysis;
  let repairedOnce = false;

  if (!isLikelyTraditionalChinese(analysis)) {
    repairedOnce = true;
    try {
      const repairedResult = await generateMeetingAnalysis({
        ai,
        uploadedFile,
        prompt: buildLanguageRepairPrompt(primaryResult.rawText),
        configOverrides: {
          temperature: 0.1,
          systemInstruction: `${LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT}\nYou are now repairing language only.`
        }
      });

      if (isLikelyTraditionalChinese(repairedResult.analysis)) {
        analysis = repairedResult.analysis;
      }
    } catch (error) {
      console.warn("Language repair attempt failed:", error?.message || error);
    }
  }

  return appendLanguageQualityFlag(analysis, repairedOnce);
}

function buildPrompt(input, promptTemplate = DEFAULT_PROMPT_TEMPLATE) {
  const userPrompt = renderPromptTemplate(promptTemplate, {
    participants: input?.participants || "",
    meetingDate: input?.meetingDate || "",
    context: input?.context || "",
    host: input?.host || ""
  }).trim();

  return `${LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT}\n\n${userPrompt}\n\n${TRANSCRIPT_PROMPT_APPENDIX}\n\n${LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT}`;
}

function buildLanguageRepairPrompt(rawJsonText) {
  const sanitized = String(rawJsonText || "{}").trim();
  return `${LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT}

You are a JSON language repair assistant for meeting minutes.
Please rewrite the following JSON content to Traditional Chinese (zh-TW) and keep all keys and structure unchanged.
- Keep all existing keys, do not add/remove fields.
- Keep necessary proper nouns in English, but rewrite narrative and notes in Traditional Chinese.
- Output only JSON (no markdown/code fences).

${sanitized}`;
}

async function generateMeetingAnalysis({ ai, uploadedFile, prompt, configOverrides = {} }) {
  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: createUserContent([
      createPartFromUri(uploadedFile.uri, uploadedFile.mimeType),
      prompt
    ]),
    config: {
      systemInstruction: configOverrides.systemInstruction || LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT,
      temperature: configOverrides.temperature ?? 0.2,
      maxOutputTokens: getMaxOutputTokens(),
      responseMimeType: "application/json"
    }
  });

  const rawText = String(response?.text || "").trim();
  return {
    rawText,
    analysis: parseJsonResponse(rawText)
  };
}

function getMaxOutputTokens() {
  const configured = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 0);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_OUTPUT_TOKENS;
}

function parseJsonResponse(text) {
  if (!text) {
    throw new Error("Gemini did not return any text.");
  }

  const cleaned = String(text).trim();
  const withoutFence = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(withoutFence);
  } catch (error) {
    const first = withoutFence.indexOf("{");
    const last = withoutFence.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(withoutFence.slice(first, last + 1));
    }
    throw error;
  }
}

function appendLanguageQualityFlag(analysis = {}, languageRepairAttempted = false) {
  const language = estimateChineseRatio(collectTextsForLanguageCheck(analysis));
  const quality = {
    status: language.ok ? (languageRepairAttempted ? "repaired" : "ok") : "needs-review",
    chineseRatio: language.chineseRatio,
    totalTextLength: language.total,
    reason: language.ok
      ? (languageRepairAttempted ? "Repaired once for Traditional Chinese output." : undefined)
      : "Output may contain too much English content."
  };

  return {
    ...analysis,
    _languageQuality: quality
  };
}

function collectTextsForLanguageCheck(value, collected = []) {
  if (typeof value === "string") {
    collected.push(value);
    return collected;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextsForLanguageCheck(item, collected);
    }
    return collected;
  }

  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("_")) continue;
      collectTextsForLanguageCheck(item, collected);
    }
    return collected;
  }

  return collected;
}

function estimateChineseRatio(texts = []) {
  const merged = texts.join("\n");
  const chineseMatches = merged.match(/[\u4e00-\u9fff]/gu) || [];
  const latinMatches = merged.match(/[A-Za-z]/gu) || [];
  const chineseCount = chineseMatches.length;
  const latinCount = latinMatches.length;
  const meaningful = chineseCount + latinCount;

  if (meaningful < MIN_MEANINGFUL_CHARS) {
    return { ok: true, chineseRatio: 1, total: meaningful, chineseCount, latinCount };
  }

  return {
    ok: chineseCount / meaningful >= MIN_CHINESE_RATIO,
    chineseRatio: chineseCount / meaningful,
    total: meaningful,
    chineseCount,
    latinCount
  };
}

function isLikelyTraditionalChinese(value) {
  return estimateChineseRatio(collectTextsForLanguageCheck(value)).ok;
}
