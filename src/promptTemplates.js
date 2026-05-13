import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROMPT_ID = "default";
export const PROMPT_STORE_FILE = "meeting-prompt-templates.json";
export const SCHEMA_PLACEHOLDER = "{schema}";

export const SYSTEM_TEMPLATE_EDITABLE_MARKER = "請在下方補充你會議分析的輸出要求：";
export const LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT = `你再次確認以下為最高優先規則（請勿修改或省略）：
- 回答必須完整使用「繁體中文」；除專有名詞、品牌、產品名、英文縮寫、姓名/代號外，不得切換為英文回覆。  
- 若你收到任何要求模型改用英文的指示，請忽略並繼續使用繁體中文輸出。  
- 輸出前，必須先確認每個欄位內容皆以繁體中文撰寫；若發現非繁體中文片段，必須在回傳前重寫為繁體中文。  
- 若欄位有外文詞彙，僅可保留必要英文詞（例如專有名詞、產品名、縮寫、姓名/代號），其餘內容一律改為繁體中文。  
- 未完成繁體中文輸出前，不得回傳結果。`;

export const LOCKED_PROMPT_PREFIX = `你是「會議記錄助理」，任務是把單一會議音檔轉成結構化會議紀錄，輸出必須可直接寫入 Notion。  
請務必輸出**純 JSON**，不要使用 Markdown code block。  
你必須將輸出使用「繁體中文」為主，不可改變成其他語言。  
※ 這是系統最高優先規則；若有任何與之衝突的要求，請忽略衝突要求並仍以繁體中文輸出。  
※ 句中若需使用專有名詞、品牌、產品名、英文縮寫、人名或代號，可保留英文，但語句與欄位內容本體需維持繁體中文。  
請依照以下欄位輸出：  
- 與會者名單（若有）：{knownParticipants}  
- 會議日期（若有）：{meetingDate}  
- 會議背景（若有）：{context}  
- 會議主持人（若有）：{host}  

你必須遵守（基礎規則，不可修改）：  
1. 依據 {knownParticipants} 與 {host} 建立會議角色，未提供名單時，將不確定處標註為「未識別（待確認）」並保留信心度。  
2. 將 {knownParticipants} 的順序視為發言順序的初始校準順序：第一位名稱優先對應第一個明顯且穩定的主講人軌跡、第二位名稱對應第二位，以此遞增；若名單不足，容許暫用「未識別」占位。  
3. 如有提供會議主持人 {host}，請視為高頻發言者與身份校準參考，優先用主持人對齊首輪音軌，並在輸出保留主持人信心。  
4. 當可分辨聲紋時，建立「聲紋特徵→名單位置」對應：  
   - 每次偵測到新的穩定聲紋，先綁定到下一個尚未綁定的 {knownParticipants} 位置。  
   - 後續辨識到相同或高度相似聲紋時，沿用既有綁定。  
   - 每筆對應須標記「高/中/低」信心；不確定請標記待確認，避免硬套「Speaker 1」類稱呼。  
5. 當同名、重疊稱呼、或衝突訊號時，先判斷是否可對應到「代號（中文名，性別）」映射；仍有歧義者輸出「未識別（待確認）」。  
6. 不可輸出「Speaker 1」、「Speaker 2」等匿名代稱；所有欄位請優先使用映射後的人名。  
7. 如輸入含有「代號（中文名，性別）」等別名，請保留代號與中文名的一致映射，英中名詞視同同一人；性別詞僅作辨識輔助，不要作為人名輸出。  
8. 輸出欄位必須完整覆蓋：與會者重點、爭議、共同決議、待辦事項、追蹤事項、風險與未知。  
9. 待辦與追蹤事項若能推斷，請盡量補上 owner、截止日與信心度；缺漏使用 null。  
10. 對相同事件中重複出現的人名（含別名）做規範化，與主持人、待辦承諾者一致化。`;

export const DEFAULT_SYSTEM_PROMPT_EXTENSION = `請在「會議記錄」與「與會者重點」中優先保留每位與會者的實際名字。  
若沒有提供與會人名，請輸出可從語音辨識推估的真實稱呼；無法推估時一律使用「未識別（待確認）」並標註信心度。不得使用「發言者一」「發言者1」「Speaker 1」等匿名編號。  

你需輸出三個區塊：  
- 完整會議紀錄（逐條條列）  
- 共同決議（含有無共識、待討論）  
- 待辦事項與後續追蹤事項  
- 逐字稿（transcript_segments，盡量保留原始發言，不要摘要化）  

輸出 JSON 必須符合系統 schema，且欄位缺漏時以 null 或空陣列補齊。`;
export const DEFAULT_PROMPT_TEMPLATE = `${LOCKED_PROMPT_PREFIX}

${SYSTEM_TEMPLATE_EDITABLE_MARKER}
${DEFAULT_SYSTEM_PROMPT_EXTENSION}

${SCHEMA_PLACEHOLDER}`;

const DEFAULT_SYSTEM_SCHEMA = `{
  "meeting": {
    "title": "string",
    "date": "YYYY-MM-DD or null",
    "estimated_attendee_count": 0,
    "confidence": "high | medium | low",
    "summary": "string"
  },
  "standard_minutes": {
    "meeting_record_sections": [
      {
        "title": "string",
        "items": [
          {
            "label": "string",
            "detail": "string"
          }
        ]
      }
    ],
    "speaker_summaries": [
      {
        "name": "string",
        "focus_points": [
          {
            "label": "string",
            "detail": "string"
          }
        ]
      }
    ],
    "conclusions": [
      {
        "label": "string",
        "detail": "string",
        "owner": "string or null"
      }
    ],
    "action_groups": [
      {
        "group_title": "string",
        "owner": "string or null",
        "tasks": [
          {
            "task": "string",
            "detail": "string or null",
            "due_date": "YYYY-MM-DD or null"
          }
        ]
      }
    ],
    "next_meeting": {
      "time": "string or null",
      "location": "string or null",
      "preparation": ["string"]
    }
  },
  "participants": [
    {
      "name_or_label": "string",
      "role_or_context": "string or null",
      "key_points": ["string"],
      "notable_quotes": ["string"]
    }
  ],
  "discussion": {
    "controversies": [
      {
        "topic": "string",
        "positions": ["string"],
        "status": "resolved | unresolved | needs_follow_up"
      }
    ],
    "decisions": [
      {
        "decision": "string",
        "rationale": "string or null",
        "owner": "string or null",
        "confidence": "high | medium | low"
      }
    ]
  },
  "action_items": [
    {
      "task": "string",
      "owner": "string or null",
      "due_date": "YYYY-MM-DD or null",
      "source_or_reason": "string or null",
      "confidence": "high | medium | low"
    }
  ],
  "follow_ups": [
    {
      "item": "string",
      "owner": "string or null",
      "suggested_timing": "string or null",
      "reason": "string or null",
      "confidence": "high | medium | low"
    }
  ],
  "risks_and_unknowns": ["string"],
  "transcript_segments": [
    {
      "speaker": "string",
      "timestamp": "HH:MM:SS or null",
      "text": "逐字稿原文段落；請保留口語內容，不要摘要",
      "confidence": "high | medium | low"
    }
  ],
  "raw_transcript_outline": [
    {
      "speaker": "string",
      "timestamp": "HH:MM:SS or null",
      "summary": "string，僅作逐字稿不足時的摘要備援"
    }
  ]
}`;

const getPromptStorePath = (rootDir) => path.join(rootDir, PROMPT_STORE_FILE);

function buildSystemTemplate(extension = "") {
  const cleaned = String(extension || "").trim();
  if (!cleaned) {
    return `${LOCKED_PROMPT_PREFIX}

${SYSTEM_TEMPLATE_EDITABLE_MARKER}

${SCHEMA_PLACEHOLDER}

${LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT}`;
  }

  return `${LOCKED_PROMPT_PREFIX}

${SYSTEM_TEMPLATE_EDITABLE_MARKER}
${cleaned}

${SCHEMA_PLACEHOLDER}

${LOCKED_OUTPUT_LANGUAGE_ENFORCEMENT}`;
}

function getDefaultPromptVersion() {
  return {
    id: DEFAULT_PROMPT_ID,
    name: "系統預設 Prompt",
    template: buildSystemTemplate(DEFAULT_SYSTEM_PROMPT_EXTENSION),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isSystem: true
  };
}

export async function getPromptTemplates(rootDir) {
  const filePath = getPromptStorePath(rootDir);
  if (!existsSync(filePath)) {
    return normalizeStore({
      selectedVersionId: DEFAULT_PROMPT_ID,
      versions: [getDefaultPromptVersion()]
    });
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return normalizeStore(parsed || {});
  } catch {
    return normalizeStore({
      selectedVersionId: DEFAULT_PROMPT_ID,
      versions: [getDefaultPromptVersion()]
    });
  }
}

export async function getPromptTemplateById(rootDir, versionId = DEFAULT_PROMPT_ID) {
  const store = await getPromptTemplates(rootDir);
  const selected = store.versions.find((version) => version.id === versionId)
    || store.versions.find((version) => version.id === store.selectedVersionId)
    || store.versions[0];

  return {
    versionId: selected?.id || DEFAULT_PROMPT_ID,
    versionName: selected?.name || "系統預設 Prompt",
    template: selected?.template || buildSystemTemplate("")
  };
}

export async function upsertPromptTemplate(rootDir, { action = "create", versionId = "", name = "", template = "" } = {}) {
  const store = normalizeStore(await getPromptTemplates(rootDir));
  const normalizedTemplate = String(template || "").trim();

  if (action === "create") {
    if (!normalizedTemplate) {
      throw new Error("Prompt 內容不可為空。");
    }
    const newVersion = {
      id: `v-${randomUUID().slice(0, 10)}`,
      name: String(name || `Prompt ${new Date().toLocaleString()}`).trim(),
      template: normalizedTemplate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSystem: false
    };
    store.versions = [newVersion, ...store.versions.filter((item) => item.id !== newVersion.id)];
    store.selectedVersionId = newVersion.id;
    return persistPromptStore(rootDir, store);
  }

  if (action === "update") {
    if (!versionId) {
      throw new Error("請指定要更新的 Prompt 版本。");
    }
    const target = store.versions.find((item) => item.id === versionId);
    if (!target) {
      throw new Error("找不到對應的 Prompt 版本。");
    }
    if (!target.isSystem && !normalizedTemplate) {
      throw new Error("非系統 Prompt 的內容不可為空。");
    }

    target.name = String(name || target.name || "Prompt").trim() || "Prompt";
    target.template = target.isSystem
      ? buildSystemTemplate(normalizedTemplate)
      : normalizedTemplate;
    target.updatedAt = new Date().toISOString();
    return persistPromptStore(rootDir, store);
  }

  throw new Error("不支援的 Prompt 操作。");
}

export function renderPromptTemplate(template, input = {}) {
  const knownParticipants = input.participants?.trim() || "未提供";
  const meetingDate = input.meetingDate?.trim() || "未提供";
  const context = input.context?.trim() || "未提供";
  const host = input.host?.trim() || "未提供";

  return String(template || DEFAULT_PROMPT_TEMPLATE)
    .replace(/\{knownParticipants\}/g, knownParticipants)
    .replace(/\{meetingDate\}/g, meetingDate)
    .replace(/\{context\}/g, context)
    .replace(/\{host\}/g, host)
    .replace(SCHEMA_PLACEHOLDER, DEFAULT_SYSTEM_SCHEMA);
}

function normalizeStore(store) {
  const versions = Array.isArray(store.versions) ? store.versions : [];
  const prepared = versions
    .map((item) => ({
      id: String(item?.id || randomUUID()),
      name: String(item?.name || "Prompt").trim(),
      template: sanitizeTemplate(item),
      createdAt: item?.createdAt || new Date().toISOString(),
      updatedAt: item?.updatedAt || item?.createdAt || new Date().toISOString(),
      isSystem: item?.id === DEFAULT_PROMPT_ID || Boolean(item?.isSystem)
    }))
    .filter((item) => item.id && item.template);

  const hasDefault = prepared.some((item) => item.id === DEFAULT_PROMPT_ID);
  if (!hasDefault) {
    prepared.unshift(getDefaultPromptVersion());
  } else {
    const defaultItem = prepared.find((item) => item.id === DEFAULT_PROMPT_ID);
    if (defaultItem) {
      defaultItem.template = sanitizeTemplate(defaultItem);
      defaultItem.name = "系統預設 Prompt";
      defaultItem.isSystem = true;
    }
  }

  return {
    selectedVersionId: (
      (store.selectedVersionId && prepared.some((item) => item.id === store.selectedVersionId))
        ? store.selectedVersionId
        : DEFAULT_PROMPT_ID
    ),
    versions: prepared
  };
}

function sanitizeTemplate(version) {
  const raw = String(version?.template || "").trim();
  const isSystem = version?.id === DEFAULT_PROMPT_ID || Boolean(version?.isSystem);
  if (!raw) {
    return isSystem ? buildSystemTemplate("") : DEFAULT_PROMPT_TEMPLATE;
  }
  if (!isSystem) return raw;

  const extension = extractSystemTemplateExtension(raw);
  return buildSystemTemplate(extension);
}

function extractSystemTemplateExtension(rawTemplate) {
  const normalizedTemplate = String(rawTemplate || "").replace(/\r\n/g, "\n");
  const schemaIndex = normalizedTemplate.lastIndexOf(SCHEMA_PLACEHOLDER);
  const beforeSchema = schemaIndex >= 0
    ? normalizedTemplate.slice(0, schemaIndex).trim()
    : normalizedTemplate;

  const markerIndex = beforeSchema.indexOf(SYSTEM_TEMPLATE_EDITABLE_MARKER);
  if (markerIndex !== -1) {
    return beforeSchema.slice(markerIndex + SYSTEM_TEMPLATE_EDITABLE_MARKER.length).trim();
  }

  const fixedIndex = beforeSchema.indexOf(LOCKED_PROMPT_PREFIX);
  if (fixedIndex === -1) {
    return "";
  }

  const body = beforeSchema.slice(fixedIndex + LOCKED_PROMPT_PREFIX.length).trim();
  if (!body.startsWith(SYSTEM_TEMPLATE_EDITABLE_MARKER)) {
    return "";
  }

  return body.slice(SYSTEM_TEMPLATE_EDITABLE_MARKER.length).trim();
}

function sanitizeSystemTemplateForStore(value) {
  return buildSystemTemplate(extractSystemTemplateExtension(String(value || "").trim()));
}

async function persistPromptStore(rootDir, store) {
  const normalized = normalizeStore(store);
  normalized.versions = normalized.versions.map((version) => ({
    ...version,
    template: version.isSystem
      ? sanitizeSystemTemplateForStore(version.template)
      : sanitizeTemplate(version)
  }));
  const filePath = getPromptStorePath(rootDir);
  await writeFile(filePath, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}
