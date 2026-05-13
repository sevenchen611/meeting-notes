const DEFAULT_SYSTEM_PROMPT_PREFIX = "你是「會議記錄助理」，任務是把單一會議音檔轉成結構化會議記錄，輸出必須可直接寫入 Notion。";
const SYSTEM_TEMPLATE_EDITABLE_MARKER = "請在下方補充你會議分析的輸出要求：";

const SCHEMA_PLACEHOLDER = "{schema}";
const DEFAULT_PROMPT_TEMPLATE = `請在下方補充你會議分析的輸出要求

- 你必須將輸出使用「繁體中文」為主，不可改變成其他語言。  
- 句中若需使用專有名詞、品牌、產品名、英文縮寫、姓名或代號，可保留英文，但語句本體需維持繁體中文。  
- 請依照會議逐步紀錄，產生「會議紀錄」「與會者重點」「爭議與決議」「待辦事項」。
- 若有待辦事項，請輸出任務內容、負責人、截止日（若有）與信心度。`;

const DEFAULT_PROMPT_VERSION = {
  id: "default",
  name: "系統預設 Prompt",
  template: DEFAULT_PROMPT_TEMPLATE,
  isSystem: true
};

const form = document.querySelector("#meetingForm");
const statusRow = document.querySelector("#statusRow");
const analyzeButton = document.querySelector("#analyzeButton");
const progressText = document.querySelector("#progressText");
const resultWrap = document.querySelector("#resultWrap");
const resultTitle = document.querySelector("#resultTitle");
const structuredResult = document.querySelector("#structuredResult");
const markdownResult = document.querySelector("#markdownResult");
const copyMarkdownButton = document.querySelector("#copyMarkdownButton");
const writeNotionButton = document.querySelector("#writeNotionButton");
const toggleMarkdownEditButton = document.querySelector("#toggleMarkdownEditButton");
const uploadNotionButton = document.querySelector("#uploadNotionButton");
const attachAudioToNotion = document.querySelector("#attachAudioToNotion");
const meetingDate = document.querySelector("#meetingDate");
const meetingHost = document.querySelector("#meetingHost");
const participantsField = document.querySelector("#participants");
const participantPresetSelect = document.querySelector("#participantPresetSelect");
const participantInput = document.querySelector("#participantInput");
const participantSuggestions = document.querySelector("#participantSuggestions");
const addParticipantButton = document.querySelector("#addParticipantButton");
const participantChips = document.querySelector("#participantChips");
const settingsForm = document.querySelector("#settingsForm");
const notionSettingsForm = document.querySelector("#notionSettingsForm");
const settingsMessage = document.querySelector("#settingsMessage");
const saveSettingsButton = document.querySelector("#saveSettingsButton");
const testGeminiButton = document.querySelector("#testGeminiButton");
const testNotionButton = document.querySelector("#testNotionButton");
const geminiModel = document.querySelector("#geminiModel");
const notionTargetSelect = document.querySelector("#notionTargetSelect");
const notionTargetLabel = document.querySelector("#notionTargetLabel");
const notionTargetHint = document.querySelector("#notionTargetHint");
const notionDatabaseIdOrUrl = document.querySelector("#notionDatabaseIdOrUrl");
const notionHostPersonId = document.querySelector("#notionHostPersonId");
const promptVersionId = document.querySelector("#promptVersionId");
const promptVersionSelect = document.querySelector("#promptVersionSelect");
const promptVersionName = document.querySelector("#promptVersionName");
const promptTemplate = document.querySelector("#promptTemplate");
const updatePromptButton = document.querySelector("#updatePromptButton");
const createPromptButton = document.querySelector("#createPromptButton");
const promptMessage = document.querySelector("#promptMessage");
const collapseToggles = document.querySelectorAll("[data-collapse-toggle]");

let currentResult = null;
let currentConfig = null;
let promptVersions = [DEFAULT_PROMPT_VERSION];
let participantHistory = [];
let isMarkdownEditing = false;

markdownResult.readOnly = true;
if (toggleMarkdownEditButton) {
  toggleMarkdownEditButton.textContent = "編輯";
}
let selectedParticipants = [];
const API_BASE = window.location.protocol === "file:" ? "http://localhost:5178" : "";
const PARTICIPANT_HISTORY_KEY = "meeting-notes-participant-history";
const SETTINGS_CACHE_KEY = "meeting-notes-settings-v2";
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
const FALLBACK_MODEL = "gemini-2.5-flash";
const DEFAULT_PARTICIPANT_HISTORY = [
  "與會者",
  "與會者是 Seven 跟昱晴 Maggie。",
  "Attendee",
  "Host",
  "主講人",
  "主持人",
  "主持人/與會者",
  "發言人1",
  "發言人2",
  "發言者1",
  "發言者2",
  "主持人/主講人",
  "主講人/與會者",
  "Attendee / GongWu Team",
  "GongWu Team",
  "Helper",
  "Seven（聖文，男）",
  "Maggie（昱晴，女）",
  "周澤文",
  "哲雯",
  "鍾哥",
  "David",
  "Davy",
  "HoYu",
  "Yi-Ching",
  "Maggie（昱晴）",
  "Maggie",
  "Seven",
  "Seven（聖文）",
  "Seven（聖文,男）",
  "Seven & 哲雯",
  "Seven、Maggie",
  "Maggie（Maggie）",
  "Maggie.",
  "Speaker 1",
  "Speaker 2",
  "Speaker A",
  "Speaker B",
  "Speaker A and Speaker B",
  "Presenter",
  "User",
  "主持人 ID"
];

setDefaultMeetingDate();
loadParticipantHistory();
setSelectedParticipants(parseParticipantEntries(participantsField.value));
renderParticipantHistory();
renderParticipantPresetOptions();
renderParticipantChips();
syncHostSelect();

renderPromptSelectors(DEFAULT_PROMPT_VERSION.id);
initCollapsiblePanels();
loadConfig();
loadPromptTemplates();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  addParticipantFromInput();
  syncParticipantsField();

  const formData = new FormData(form);
  const file = formData.get("audio");
  if (!file || file.size === 0) {
    showProgress("請先上傳音檔", true);
    return;
  }

  setBusy(true, "分析中，請稍候...");

  try {
    const response = await fetch(apiUrl("/api/analyze"), {
      method: "POST",
      body: formData
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "分析失敗，請稍後再試。")
    }

    currentResult = payload;
    renderResult(payload);
  } catch (error) {
    showProgress(error.message || "發生錯誤，請稍後再試。", true);
  } finally {
    setBusy(false);
  }
});

addParticipantButton.addEventListener("click", () => {
  addParticipantFromInput();
});

participantPresetSelect?.addEventListener("change", () => {
  const selectedValue = participantPresetSelect.value?.trim();
  if (!selectedValue) return;
  addParticipantFromInput(selectedValue);
  participantPresetSelect.value = "";
});

participantInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addParticipantFromInput();
    return;
  }

  if ((event.key === "Backspace" || event.key === "Delete") && !participantInput.value.trim() && selectedParticipants.length) {
    removeParticipant(selectedParticipants[selectedParticipants.length - 1]);
  }
});

async function handleSettingsSubmit(event) {
  event.preventDefault();
  setSettingsBusy(true, "儲存設定中...");
  const apiSettingsValues = settingsForm ? Object.fromEntries(new FormData(settingsForm)) : {};
  const notionSettingsValues = notionSettingsForm ? Object.fromEntries(new FormData(notionSettingsForm)) : {};
  const formValues = {
    ...apiSettingsValues,
    ...notionSettingsValues
  };

  try {
    const response = await fetch(apiUrl("/api/settings"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formValues)
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "儲存設定失敗。")
    }

    currentConfig = normalizePublicConfig(payload, { fromApi: true });
    renderStatus(currentConfig);
    persistSettingsToLocal(currentConfig);
    clearSecretFields();
    showSettingsMessage("設定已儲存。");
  } catch (error) {
    const fallbackConfig = buildSettingsFromForm(formValues, currentConfig);
    currentConfig = normalizePublicConfig(fallbackConfig, { fromApi: false });
    persistSettingsToLocal(currentConfig);
    renderStatus(currentConfig);
    showSettingsMessage(error.message || "儲存失敗，已改為暫存本機設定。", true);
  } finally {
    setSettingsBusy(false);
  }
}

settingsForm?.addEventListener("submit", handleSettingsSubmit);
notionSettingsForm?.addEventListener("submit", handleSettingsSubmit);

testGeminiButton.addEventListener("click", () => testSetting("/api/settings/test-gemini", "Gemini 測試成功"));
testNotionButton.addEventListener("click", () => testSetting("/api/settings/test-notion", "Notion 測試成功"));
notionTargetSelect?.addEventListener("change", syncNotionTargetFieldsFromSelection);

function initCollapsiblePanels() {
  for (const toggle of collapseToggles) {
    const panelId = toggle.dataset.collapseToggle;
    const content = panelId ? document.getElementById(panelId) : null;
    if (!content) continue;

    setCollapsibleState(toggle, content, !content.hidden);
    toggle.addEventListener("click", () => {
      setCollapsibleState(toggle, content, content.hidden);
    });
  }
}

function setCollapsibleState(toggle, content, shouldOpen) {
  content.hidden = !shouldOpen;
  toggle.textContent = shouldOpen ? "收起" : "展開";
  toggle.setAttribute("aria-expanded", String(shouldOpen));
  const panel = toggle.closest(".settings-panel");
  panel?.classList.toggle("is-collapsed", !shouldOpen);
}

copyMarkdownButton.addEventListener("click", async () => {
  const draftMarkdown = markdownResult.value || "";
  if (!draftMarkdown.trim()) {
    return;
  }

  await navigator.clipboard.writeText(draftMarkdown);
  if (currentResult) {
    currentResult.markdown = draftMarkdown;
  }
  copyMarkdownButton.textContent = "已複製";
  setTimeout(() => {
    copyMarkdownButton.textContent = "複製 Markdown";
  }, 1400);
});

toggleMarkdownEditButton.addEventListener("click", () => {
  if (!currentResult) return;

  if (!isMarkdownEditing) {
    isMarkdownEditing = true;
    setMarkdownEditMode(true);
    toggleMarkdownEditButton.textContent = "儲存";
    return;
  }

  isMarkdownEditing = false;
  setMarkdownEditMode(false);
  saveMarkdownToResult();
});

function setMarkdownEditMode(isEditing) {
  markdownResult.readOnly = !isEditing;
  if (isEditing) {
    markdownResult.focus();
  }
  if (toggleMarkdownEditButton) {
    toggleMarkdownEditButton.textContent = isEditing ? "儲存" : "編輯";
  }
}

function saveMarkdownToResult() {
  if (!currentResult) return;
  const updatedMarkdown = markdownResult.value || "";
  currentResult.markdown = updatedMarkdown;
  renderStructuredPreview(updatedMarkdown, currentResult);
}

function renderResultFromMarkdown(markdownText) {
  renderStructuredPreview(markdownText, null);
}

function renderStructuredPreview(markdownText, contextPayload = null) {
  if (!structuredResult) return;

  const sourcePayload = contextPayload || currentResult || {};
  structuredResult.innerHTML = "";

  const nodes = parseMarkdownSections(markdownText || "");
  const renderedNodes = nodes.length
    ? nodes
    : [{ type: "section", level: 1, title: "會議內容", blocks: [{ type: "paragraph", text: "尚無內容" }] }];
  const metadataSection = buildMetadataPreviewSection({
    sourceFile: sourcePayload.sourceFile,
    host: sourcePayload.input?.host,
    date: sourcePayload.input?.meetingDate,
    attachAudio: Boolean(sourcePayload.notion?.attachAudioToNotion),
    notionUrl: sourcePayload.notion?.page?.url,
    promptVersionName: sourcePayload.prompt?.versionName
  });
  const allNodes = [metadataSection, ...renderedNodes];

  for (const node of allNodes) {
    structuredResult.append(renderMarkdownNode(node));
  }
}

function parseMarkdownSections(markdownText) {
  const normalized = String(markdownText || "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const virtualRoot = { type: "virtual", level: 0, blocks: [] };
  const defaultSection = { type: "section", level: 1, title: "會議內容", blocks: [] };
  virtualRoot.blocks.push(defaultSection);

  const sectionStack = [virtualRoot, defaultSection];
  let paragraphLines = [];
  let listTokens = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const text = paragraphLines
      .join("\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    if (!text) {
      paragraphLines = [];
      return;
    }

    const currentSection = sectionStack[sectionStack.length - 1];
    currentSection.blocks.push({ type: "paragraph", text: normalizeMarkdownInline(text) });
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listTokens.length) return;
    const currentSection = sectionStack[sectionStack.length - 1];
    currentSection.blocks.push(buildMarkdownList(listTokens));
    listTokens = [];
  };

  const getCurrentSection = () => sectionStack[sectionStack.length - 1];

  const startSection = (level, title) => {
    const normalizedTitle = normalizeMarkdownInline(title.trim()) || "未命名段落";

    if (sectionStack.length === 2 && sectionStack[1] === defaultSection && defaultSection.blocks.length === 0) {
      virtualRoot.blocks = [];
      sectionStack.pop();
    }

    while (sectionStack.length > 1 && sectionStack[sectionStack.length - 1].level >= level) {
      sectionStack.pop();
    }
    const parent = getCurrentSection();
    const sectionNode = { type: "section", level, title: normalizedTitle, blocks: [] };
    parent.blocks.push(sectionNode);
    sectionStack.push(sectionNode);
  };

  const headingPattern = /^(\s{0,})(#{1,6})\s+(.*)$/;
  const listPattern = /^(\s*)(?:[-*+]|(\d+)\.)\s+(\[[ xX]?\]\s+)?(.*)$/;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, "");
    const headingMatch = line.match(headingPattern);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[2].length;
      const title = headingMatch[3] || "";
      startSection(level, title);
      continue;
    }

    const listMatch = line.match(listPattern);
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (listMatch) {
      flushParagraph();
      const indentWidth = listMatch[1].replace(/\t/g, "    ").length;
      const indent = Math.floor(indentWidth / 2);
      const checkboxRaw = (listMatch[3] || "").trim();
      const contentText = (listMatch[4] || "").trim();
      const isChecked = checkboxRaw === "[x]" || checkboxRaw === "[X]";
      const unchecked = checkboxRaw === "[ ]";
      const itemText = normalizeMarkdownInline(contentText);

      listTokens.push({
        indent,
        checked: isChecked ? "checked" : unchecked ? "unchecked" : "none",
        text: itemText
      });
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return virtualRoot.blocks;
}

function buildMarkdownList(listTokens) {
  const rootList = { type: "list", ordered: false, items: [] };
  const listStack = [rootList];
  const itemStack = [];

  for (const token of listTokens) {
    const targetDepth = Math.max(0, Number(token.indent || 0));

    while (listStack.length - 1 > targetDepth) {
      listStack.pop();
      itemStack.pop();
    }

    while (listStack.length - 1 < targetDepth) {
      const parentItem = itemStack[itemStack.length - 1];
      if (!parentItem) {
        break;
      }
      const childList = { type: "list", ordered: false, items: [] };
      parentItem.children = childList;
      listStack.push(childList);
      itemStack.push(null);
    }

    const currentList = listStack[listStack.length - 1];
    const itemNode = {
      type: "list-item",
      text: token.text,
      checked: token.checked,
      children: null
    };

    currentList.items.push(itemNode);
    itemStack[listStack.length - 1] = itemNode;
  }

  return rootList;
}

function renderMarkdownNode(node, levelOffset = 0) {
  const wrapper = document.createElement("div");
  if (!node) return wrapper;

  if (node.type === "paragraph") {
    const paragraph = document.createElement("p");
    paragraph.className = "section-paragraph";
    paragraph.textContent = node.text || "（無內容）";
    wrapper.append(paragraph);
    return wrapper;
  }

  if (node.type === "list") {
    const list = node.ordered ? document.createElement("ol") : document.createElement("ul");
    list.className = "markdown-list";
    for (const item of node.items || []) {
      const listItem = document.createElement("li");
      if (item.checked === "checked") {
        listItem.classList.add("checked");
      } else if (item.checked === "unchecked") {
        listItem.classList.add("unchecked");
      }
      listItem.textContent = item.text || "";

      if (item.children) {
        listItem.appendChild(renderMarkdownNode(item.children, levelOffset + 1));
      }
      list.append(listItem);
    }
    wrapper.append(list);
    return wrapper;
  }

  if (node.type === "section") {
    const sectionEl = document.createElement("div");
    sectionEl.className = `section markdown-section level-${Math.min(Math.max(node.level, 1), 4)}`;

    const header = document.createElement(`h${Math.min(Math.max(node.level + 2, 2), 6)}`);
    header.className = `section-title`;
    header.dataset.level = String(node.level);
    header.textContent = node.title || "未命名段落";
    sectionEl.append(header);

    if (!node.blocks || !node.blocks.length) {
      const emptyTip = document.createElement("p");
      emptyTip.className = "section-paragraph empty";
      emptyTip.textContent = "尚無內容";
      sectionEl.append(emptyTip);
      wrapper.append(sectionEl);
      return wrapper;
    }

    for (const child of node.blocks) {
      sectionEl.appendChild(renderMarkdownNode(child, levelOffset + 1));
    }
    wrapper.append(sectionEl);
    return wrapper;
  }

  return wrapper;
}

function normalizeMarkdownInline(value) {
  return String(value || "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`{1,3}(.*?)`{1,3}/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/^\s*>\s*/, "")
    .trim();
}

writeNotionButton.addEventListener("click", async () => {
  await uploadCurrentResultToNotion();
});

uploadNotionButton.addEventListener("click", async () => {
  await uploadCurrentResultToNotion();
});

async function uploadCurrentResultToNotion() {
  if (!currentResult) return;
  if (!currentConfig?.notionConfigured) {
    showProgress("Notion 尚未設定，請先到設定頁完成配置。", true);
    return;
  }

  setNotionUploadState(true, "上傳 Notion 中…");
  showProgress("上傳 Notion 中...");

  try {
    const response = await fetch(apiUrl(`/api/results/${encodeURIComponent(currentResult.id)}/notion`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: markdownResult.value || "",
        attachAudioToNotion: attachAudioToNotion.checked
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "上傳 Notion 失敗。")
    }

    const normalizedMarkdown = typeof payload.markdown === "string" ? payload.markdown : (markdownResult.value || "");
    currentResult.notion.page = payload.page;
    currentResult.notion.error = null;
    currentResult.markdown = normalizedMarkdown;
    markdownResult.value = normalizedMarkdown;
    renderStructuredPreview(normalizedMarkdown, currentResult);
    currentResult.notion.attachAudioToNotion = attachAudioToNotion.checked;
    showProgress(`已寫入 Notion：${payload.page.url}`);
    setNotionUploadState(true, "已上傳 Notion");
  } catch (error) {
    showProgress(error.message || "上傳 Notion 失敗。", true);
    setNotionUploadState(false, "上傳 Notion");
    return;
  }

  setNotionUploadState(true, "已上傳 Notion");
}

promptVersionSelect.addEventListener("change", () => {
  syncPromptEditorFromSelection(promptVersionSelect.value);
});

updatePromptButton.addEventListener("click", async () => {
  await savePrompt("update");
});

createPromptButton.addEventListener("click", async () => {
  await savePrompt("create");
});

async function loadConfig() {
  try {
    const response = await fetch(apiUrl("/api/config"));
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "擷取設定失敗。");
    }
    currentConfig = normalizePublicConfig(payload, { fromApi: true });
    persistSettingsToLocal(currentConfig);
    renderStatus(currentConfig);
    statusRow.append(pill("狀態：已同步雲端設定", "ok"));
  } catch {
    const fallbackConfig = getCachedSettings();
    currentConfig = normalizePublicConfig(fallbackConfig, { fromApi: false });
    renderStatus(currentConfig);
    statusRow.append(pill("狀態：擷取失敗，使用本機設定", "warn"));
  }
}

function normalizePublicConfig(raw = {}, options = {}) {
  const serverTargets = Array.isArray(raw?.notionTargets) ? raw.notionTargets : null;
  const selectedTargetFromTargets = serverTargets?.find((target) => target?.selected)?.id;
  const selectedTargetIdHint = raw.selectedTargetId || selectedTargetFromTargets || "";
  const normalizedTargets = normalizeNotionTargets(
    serverTargets,
    selectedTargetIdHint
  );
  const selectedTargetId = resolveSelectedTargetId(normalizedTargets, selectedTargetIdHint || "");
  const selectedTarget = normalizedTargets.find((target) => target.id === selectedTargetId) || null;

  const notionConfigured = Boolean(
    options.fromApi
      ? raw.notionConfigured
      : raw.notionConfigured || Boolean(raw.notionToken && selectedTargetId)
  );

  return {
    geminiConfigured: Boolean(raw.geminiConfigured || raw.geminiApiKey),
    notionConfigured,
    notionHostPersonId: String(raw.notionHostPersonId || ""),
    model: String(raw.model || FALLBACK_MODEL),
    notionDatabaseId: selectedTargetId,
    notionTargetLabel: selectedTarget?.label || "",
    notionTargets: normalizedTargets,
    selectedTargetId,
    notionToken: String(raw.notionToken || "")
  };
}

function getCachedSettings() {
  try {
    const raw = window.localStorage.getItem(SETTINGS_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistSettingsToLocal(config = {}) {
  try {
    const normalized = normalizePublicConfig(config, { fromApi: true });
    const payload = {
      geminiModel: normalized.model,
      geminiConfigured: normalized.geminiConfigured,
      notionConfigured: normalized.notionConfigured,
      notionHostPersonId: normalized.notionHostPersonId,
      notionTargets: normalized.notionTargets,
      selectedTargetId: normalized.selectedTargetId,
      updatedAt: new Date().toISOString()
    };
    window.localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Intentionally ignore cache write errors.
  }
}

function buildSettingsFromForm(formValues = {}, baseConfig = {}) {
  const fallbackTargets = normalizeNotionTargets(baseConfig?.notionTargets || [], baseConfig?.selectedTargetId);
  const inputTargetId = extractNotionDatabaseId(formValues.notionDatabaseIdOrUrl || "");
  const selectedFromForm = String(formValues.notionTargetId || "").trim();
  const inputLabel = String(formValues.notionTargetLabel || "").trim();
  const hostPersonId = String(formValues.notionHostPersonId || "").trim();
  const model = String(formValues.geminiModel || "").trim() || FALLBACK_MODEL;
  let selectedTargetId = inputTargetId || selectedFromForm || baseConfig.selectedTargetId || "";

  const targets = fallbackTargets.map((target) => ({ ...target }));
  if (inputTargetId) {
    const existing = targets.find((target) => target.id === inputTargetId);
    if (existing) {
      existing.label = inputLabel || existing.label;
    } else {
      targets.push({
        id: inputTargetId,
        label: inputLabel || `未命名會議記錄`
      });
    }
  } else if (selectedFromForm && inputLabel) {
    const selectedTarget = targets.find((target) => target.id === selectedFromForm);
    if (selectedTarget) {
      selectedTarget.label = inputLabel;
    }
  }

  return {
    notionTargets: targets,
    selectedTargetId,
    notionHostPersonId: hostPersonId,
    notionToken: String(formValues.notionToken || ""),
    geminiModel: model,
    geminiConfigured: Boolean(formValues.geminiApiKey || baseConfig.geminiConfigured),
    notionConfigured: Boolean(formValues.notionToken || baseConfig.notionConfigured) && Boolean(selectedTargetId)
  };
}

function normalizeNotionTargets(rawTargets = [], selectedTargetId = "") {
  const targets = [];
  const seenIds = new Set();
  const merged = [
    ...DEFAULT_NOTION_TARGETS,
    ...rawTargets
  ];

  for (const target of merged) {
    const id = extractNotionDatabaseId(target.id || "");
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    targets.push({
      id,
      label: String(target.label || `未命名會議記錄`),
      selected: selectedTargetId ? id === selectedTargetId : false,
      maskedId: maskId(id)
    });
  }

  return targets;
}

function resolveSelectedTargetId(targets = [], selectedTargetId = "") {
  const normalizedSelectedId = extractNotionDatabaseId(selectedTargetId);
  if (normalizedSelectedId && targets.some((target) => target.id === normalizedSelectedId)) {
    return normalizedSelectedId;
  }
  return targets[0]?.id || "";
}

function extractNotionDatabaseId(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const compact = text.replace(/-/g, "");
  const match = compact.match(/[0-9a-fA-F]{32}/);
  if (!match) return text;
  const id = match[0].toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function maskId(value = "") {
  const text = String(value || "");
  if (!text || text.length <= 8) return "";
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

async function loadPromptTemplates() {
  try {
    const response = await fetch(apiUrl("/api/prompt-templates"));
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "無法讀取 Prompt 列表。")
    }

    promptVersions = normalizePromptVersions(payload.versions);
    renderPromptSelectors(payload.selectedVersionId || DEFAULT_PROMPT_VERSION.id);
    showPromptMessage("");
  } catch (error) {
    promptVersions = [DEFAULT_PROMPT_VERSION];
    renderPromptSelectors(DEFAULT_PROMPT_VERSION.id);
    showPromptMessage("載入 Prompt 版本失敗，已切換為預設版本。", true);
  }
}

function normalizePromptVersions(versions) {
  if (!Array.isArray(versions) || versions.length === 0) {
    return [DEFAULT_PROMPT_VERSION];
  }

  const normalized = versions.map((version) => ({
    id: version.id || DEFAULT_PROMPT_VERSION.id,
    name: version.name || DEFAULT_PROMPT_VERSION.name,
    template: version.template || DEFAULT_PROMPT_TEMPLATE,
    isSystem: Boolean(version.isSystem)
  }));

  if (!normalized.some((version) => version.id === DEFAULT_PROMPT_VERSION.id)) {
    normalized.unshift(DEFAULT_PROMPT_VERSION);
  }

  return normalized;
}

function renderPromptSelectors(selectedVersionId) {
  promptVersionId.innerHTML = "";
  promptVersionSelect.innerHTML = "";

  for (const version of promptVersions) {
    promptVersionId.appendChild(buildOption(version));
    promptVersionSelect.appendChild(buildOption(version));
  }

  const targetId = promptVersions.some((item) => item.id === selectedVersionId)
    ? selectedVersionId
    : promptVersions[0].id;

  promptVersionId.value = targetId;
  promptVersionSelect.value = targetId;
  syncPromptEditorFromSelection(targetId);
}

function buildOption(version) {
  const option = document.createElement("option");
  option.value = version.id;
  option.textContent = version.name;
  return option;
}

function syncPromptEditorFromSelection(versionId) {
  const selected = promptVersions.find((item) => item.id === versionId) || DEFAULT_PROMPT_VERSION;
  promptVersionId.value = selected.id;
  promptVersionSelect.value = selected.id;
  promptVersionName.value = selected.name;
  promptTemplate.value = extractEditablePromptSection(selected.template, selected.isSystem);
}

function extractEditablePromptSection(rawTemplate, isSystemTemplate = false) {
  const normalized = String(rawTemplate || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  if (!isSystemTemplate) return normalized;

  const schemaMarker = SCHEMA_PLACEHOLDER;
  const schemaIndex = normalized.lastIndexOf(schemaMarker);
  const beforeSchema = schemaIndex >= 0 ? normalized.slice(0, schemaIndex).trim() : normalized;
  const markerIndex = beforeSchema.indexOf(SYSTEM_TEMPLATE_EDITABLE_MARKER);
  if (markerIndex !== -1) {
    return beforeSchema.slice(markerIndex + SYSTEM_TEMPLATE_EDITABLE_MARKER.length).trim();
  }

  const prefixIndex = beforeSchema.indexOf(DEFAULT_SYSTEM_PROMPT_PREFIX);
  if (prefixIndex === -1) {
    return beforeSchema;
  }
  const afterPrefix = beforeSchema.slice(prefixIndex + DEFAULT_SYSTEM_PROMPT_PREFIX.length).trim();
  const afterMarker = afterPrefix.indexOf(SYSTEM_TEMPLATE_EDITABLE_MARKER);
  if (afterMarker >= 0) {
    return afterPrefix.slice(afterMarker + SYSTEM_TEMPLATE_EDITABLE_MARKER.length).trim();
  }
  return afterPrefix;
}

async function savePrompt(action) {
  const selected = promptVersions.find((item) => item.id === promptVersionSelect.value) || DEFAULT_PROMPT_VERSION;
  const name = promptVersionName.value.trim() || selected.name;
  const template = promptTemplate.value.trim();
  const isSystemSelection = Boolean(selected.isSystem);

  if (!template && !isSystemSelection) {
    showPromptMessage("Prompt 內容不可為空。", true);
    return;
  }

  updatePromptButton.disabled = true;
  createPromptButton.disabled = true;
  showPromptMessage(action === "update" ? "更新 Prompt 中..." : "新增 Prompt 中...");

  try {
    const response = await fetch(apiUrl("/api/prompt-templates"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        versionId: action === "update" ? selected.id : "",
        name,
        template
      })
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "儲存 Prompt 失敗。")
    }

    promptVersions = normalizePromptVersions(payload.versions);
    renderPromptSelectors(payload.selectedVersionId || selected.id);
    showPromptMessage(action === "update" ? "Prompt 已更新。" : "Prompt 已新增。", false);
  } catch (error) {
    showPromptMessage(error.message || "儲存 Prompt 失敗。", true);
  } finally {
    updatePromptButton.disabled = false;
    createPromptButton.disabled = false;
  }
}

async function testSetting(url, successMessage) {
  showSettingsMessage("測試中...");
  testGeminiButton.disabled = true;
  testNotionButton.disabled = true;

  try {
    const response = await fetch(apiUrl(url), { method: "POST" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "測試失敗。")
    }

    showSettingsMessage(payload.title ? `${successMessage}：${payload.title}` : successMessage);
    await loadConfig();
  } catch (error) {
    showSettingsMessage(error.message || "測試失敗。", true);
  } finally {
    testGeminiButton.disabled = false;
    testNotionButton.disabled = false;
  }
}

function renderStatus(config) {
  statusRow.innerHTML = "";
  geminiModel.value = config.model || FALLBACK_MODEL;
  renderNotionTargetControls(config);
  const targetLabel = config.notionTargetLabel ? `：${config.notionTargetLabel}` : "";
  const notionHostLabel = config.notionHostPersonId ? "已設定" : "未設定";
  if (notionHostPersonId) {
    notionHostPersonId.value = config.notionHostPersonId || "";
  }

  statusRow.append(
    pill(config.geminiConfigured ? "Gemini：已設定" : "Gemini：未設定", config.geminiConfigured ? "ok" : "warn"),
    pill(config.notionConfigured ? `Notion${targetLabel}` : "Notion：未設定", config.notionConfigured ? "ok" : "warn"),
    pill(`主持人 ID：${notionHostLabel}`, notionHostLabel === "已設定" ? "ok" : "warn"),
    pill(`模型：${config.model || FALLBACK_MODEL}`, "pending")
  );
}

function renderNotionTargetControls(config = {}) {
  if (!notionTargetSelect || !notionTargetLabel || !notionTargetHint) return;

  const targets = Array.isArray(config.notionTargets) ? config.notionTargets : [];
  notionTargetSelect.innerHTML = "";

  if (!targets.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "尚未建立目標";
    notionTargetSelect.append(option);
    notionTargetLabel.value = notionTargetLabel.value || "";
    notionTargetHint.textContent = "請輸入目標標籤，並貼上 Notion database ID 或 URL 後儲存。";
    return;
  }

  for (const target of targets) {
    const option = document.createElement("option");
    option.value = target.id;
    option.textContent = target.label || "未命名會議記錄";
    notionTargetSelect.append(option);
  }

  const selected = targets.find((target) => target.selected) || targets[0];
  notionTargetSelect.value = selected.id;
  notionTargetLabel.value = selected.label || "";
  notionTargetHint.textContent = `目前會寫入：${selected.label || "未命名會議記錄"}（${selected.maskedId || "已設定"}）`;
}

function syncNotionTargetFieldsFromSelection() {
  if (!currentConfig?.notionTargets || !notionTargetSelect || !notionTargetLabel || !notionTargetHint) return;
  const selected = currentConfig.notionTargets.find((target) => target.id === notionTargetSelect.value);
  if (!selected) {
    notionTargetLabel.value = "";
    notionTargetHint.textContent = "請輸入目標標籤，並貼上 Notion database ID 或 URL 後儲存。";
    return;
  }

  notionTargetLabel.value = selected.label || "";
  notionTargetHint.textContent = `目前會寫入：${selected.label || "未命名會議記錄"}（${selected.maskedId || "已設定"}）`;
  showSettingsMessage("已選擇目標，請按「儲存設定」套用。");
  if (notionDatabaseIdOrUrl) {
    notionDatabaseIdOrUrl.value = "";
  }
}

function renderResult(payload) {
  const meeting = payload.analysis?.meeting || {};
  const languageQuality = payload.analysis?._languageQuality;

  resultTitle.textContent = meeting.title || "會議紀錄結果";
  markdownResult.value = payload.markdown || "";
  isMarkdownEditing = false;
  setMarkdownEditMode(false);
  attachAudioToNotion.checked = Boolean(payload.notion?.attachAudioToNotion);
  renderStructuredPreview(markdownResult.value || "", payload);

  if (languageQuality?.status === "needs-review") {
    const ratioText = Math.round((languageQuality.chineseRatio || 0) * 100);
    showProgress(`注意：這份結果語言品質偏英文（繁中占比 ${ratioText}%），已嘗試重試修正，請你再確認是否完整。`, true);
  } else if (languageQuality?.status === "repaired") {
    const ratioText = Math.round((languageQuality.chineseRatio || 0) * 100);
    showProgress(`已完成語言修正（繁中占比 ${ratioText}%），請確認後再上傳 Notion。`, false);
  } else {
    showProgress("分析完成，請先確認與修改內容後，再上傳 Notion。");
  }

  const uploaded = Boolean(payload.notion?.page?.id);
  setNotionUploadState(!payload.notion?.configured || uploaded, uploaded ? "已上傳 Notion" : "上傳 Notion");
  uploadNotionButton.hidden = false;
  resultWrap.hidden = false;
  resultWrap.scrollIntoView({ behavior: "smooth", block: "start" });
}

function addParticipantFromInput() {
  const value = arguments[0] ? String(arguments[0]).trim() : participantInput.value.trim();
  if (!value) return;

  const normalized = normalizeParticipantEntry(value);
  if (!normalized) return;

  if (!selectedParticipants.some((item) => item === normalized)) {
    selectedParticipants = [...selectedParticipants, normalized];
  }

  participantHistory = mergeParticipantHistory([normalized, ...participantHistory]);
  saveParticipantHistory();
  syncParticipantsField();
  renderParticipantHistory();
  renderParticipantPresetOptions();
  renderParticipantChips();
  syncHostSelect();
  participantInput.value = "";
  participantInput.focus();
}

function removeParticipant(entry) {
  selectedParticipants = selectedParticipants.filter((item) => item !== entry);
  syncParticipantsField();
  renderParticipantChips();
  if (meetingHost?.value === entry) {
    meetingHost.value = "";
  }
  renderParticipantPresetOptions();
  syncHostSelect();
}

function loadParticipantHistory() {
  try {
    const raw = window.localStorage.getItem(PARTICIPANT_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    participantHistory = mergeParticipantHistory([
      ...DEFAULT_PARTICIPANT_HISTORY,
      ...(Array.isArray(parsed) ? parsed : [])
    ]);
  } catch {
    participantHistory = [...DEFAULT_PARTICIPANT_HISTORY];
  }
}

function saveParticipantHistory() {
  window.localStorage.setItem(PARTICIPANT_HISTORY_KEY, JSON.stringify(participantHistory));
}

function syncHostSelect() {
  if (!meetingHost) return;

  const previousHost = meetingHost.value;
  const source = mergeParticipantHistory([
    ...selectedParticipants,
    ...participantHistory
  ]);

  meetingHost.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "未指定";
  meetingHost.appendChild(defaultOption);

  for (const entry of source) {
    const option = document.createElement("option");
    option.value = entry;
    option.textContent = entry;
    meetingHost.appendChild(option);
  }

  const hasPreviousHost = source.includes(previousHost);
  if (previousHost && !hasPreviousHost) {
    const option = document.createElement("option");
    option.value = previousHost;
    option.textContent = previousHost;
    meetingHost.appendChild(option);
  }

  meetingHost.value = hasPreviousHost ? previousHost : "";
}

function renderParticipantHistory() {
  participantSuggestions.innerHTML = "";
  for (const entry of participantHistory) {
    const option = document.createElement("option");
    option.value = entry;
    participantSuggestions.append(option);
  }
}

function renderParticipantPresetOptions() {
  if (!participantPresetSelect) return;

  const previouslySelected = participantPresetSelect.value || "";
  const source = mergeParticipantHistory([...participantHistory, ...selectedParticipants]);

  participantPresetSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "從歷史紀錄帶入";
  participantPresetSelect.appendChild(defaultOption);

  for (const entry of source) {
    const option = document.createElement("option");
    option.value = entry;
    option.textContent = entry;
    participantPresetSelect.appendChild(option);
  }

  participantPresetSelect.value = previouslySelected || "";
}

function renderParticipantChips() {
  participantChips.innerHTML = "";
  if (!selectedParticipants.length) return;

  for (const entry of selectedParticipants) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "participant-chip";
    chip.dataset.entry = entry;
    chip.innerHTML = `<span>${escapeHtml(entry)}</span><strong>×</strong>`;
    chip.addEventListener("click", () => removeParticipant(entry));
    participantChips.append(chip);
  }
}

function syncParticipantsField() {
  participantsField.value = selectedParticipants.join("\n");
}

function setSelectedParticipants(entries) {
  selectedParticipants = mergeParticipantHistory(entries);
  syncParticipantsField();
  renderParticipantPresetOptions();
  syncHostSelect();
}

function mergeParticipantHistory(entries) {
  const seen = new Set();
  const merged = [];
  for (const rawEntry of entries || []) {
    const normalized = normalizeParticipantEntry(rawEntry);
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }
  return merged;
}

function parseParticipantEntries(value) {
  return String(value || "")
    .split(/\r?\n|;|；|\|/)
    .map((item) => normalizeParticipantEntry(item))
    .filter(Boolean);
}

function normalizeParticipantEntry(value) {
  return String(value || "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function flattenActionGroups(groups = []) {
  const items = [];
  for (const group of groups || []) {
    for (const task of group.tasks || []) {
      const detail = task.detail ? ` ${task.detail}` : "";
      const due = task.due_date ? `（截止：${task.due_date}）` : "";
      items.push(`${group.group_title || "待辦"}：${task.task}${detail}${due}`);
    }
  }
  return items.length ? items : ["尚無待辦事項"];
}

function section(title, items) {
  const wrapper = document.createElement("div");
  wrapper.className = "section";

  const heading = document.createElement("p");
  heading.className = "section-title";
  heading.textContent = title;
  wrapper.append(heading);

  const list = document.createElement("ul");
  const cleanItems = Array.isArray(items) && items.length > 0 ? items : ["無資料"];
  for (const item of cleanItems) {
    const li = document.createElement("li");
    li.textContent = item;
    list.append(li);
  }

  wrapper.append(list);
  return wrapper;
}

function buildMetadataPreviewSection(data) {
  const {
    sourceFile = {},
    host = "",
    date = "",
    attachAudio = false,
    notionUrl = "",
    promptVersionName = ""
  } = data || {};

  const metadataItems = [
    `音檔：${sourceFile?.originalName || "音檔名稱未提供"} (${formatBytes(sourceFile?.size)})`,
    `主持人：${host || "未指定"}`,
    `會議日期：${date || "未指定"}`,
    `錄音檔寫入 Notion：${attachAudio ? "是" : "否"}`,
    `Notion：${notionUrl || "未同步"}`,
    `Prompt 版本：${promptVersionName || "系統預設 Prompt"}`
  ];

  return {
    type: "section",
    level: 1,
    title: "會議資訊",
    blocks: [
      {
        type: "list",
        ordered: false,
        items: metadataItems.map((item) => ({
          type: "list-item",
          text: item,
          checked: "none",
          children: null
        }))
      }
    ]
  };
}

function pill(text, kind) {
  const element = document.createElement("span");
  element.className = `pill ${kind}`;
  element.textContent = text;
  return element;
}

function setBusy(isBusy, message = "") {
  analyzeButton.disabled = isBusy;
  analyzeButton.textContent = isBusy ? "分析中…" : "開始分析";
  showProgress(message);
}

function setNotionUploadState(disabled, label) {
  writeNotionButton.disabled = disabled;
  writeNotionButton.textContent = label;
  uploadNotionButton.disabled = disabled;
  uploadNotionButton.textContent = label;
}

function setSettingsBusy(isBusy, message = "") {
  saveSettingsButton.disabled = isBusy;
  saveSettingsButton.textContent = isBusy ? "儲存中…" : "儲存設定";
  showSettingsMessage(message);
}

function showProgress(message, isError = false) {
  progressText.textContent = message || "";
  progressText.className = isError ? "progress-text notice" : "progress-text";
}

function showSettingsMessage(message, isError = false) {
  settingsMessage.textContent = message || "";
  settingsMessage.className = isError ? "progress-text notice" : "progress-text";
}

function showPromptMessage(message, isError = false) {
  promptMessage.textContent = message || "";
  promptMessage.className = isError ? "progress-text notice" : "progress-text";
}

function clearSecretFields() {
  document.querySelector("#geminiApiKey").value = "";
  document.querySelector("#notionToken").value = "";
  if (notionDatabaseIdOrUrl) {
    notionDatabaseIdOrUrl.value = "";
  }
}

function setDefaultMeetingDate() {
  if (meetingDate.value) return;
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  meetingDate.value = localDate;
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (!value) return "0 KB";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

