export function normalizeAnalysisForKnownParticipants(result, participantsText = "", hostText = "") {
  const profiles = parseParticipantProfiles(participantsText);
  const hostProfile = parseHostProfile(hostText, profiles);
  if (!profiles.length && !hostProfile) {
    return replaceSpeakerLabels(result, [], null);
  }

  const normalized = replaceSpeakerLabels(result, profiles, hostProfile);
  normalized.participants = mergeKnownParticipants(normalized.participants, profiles, hostProfile);
  return normalized;
}

export function normalizeSpeakerLabelsInText(text, participantsText = "", hostText = "") {
  const profiles = parseParticipantProfiles(participantsText);
  const hostProfile = parseHostProfile(hostText, profiles);
  return replaceSpeakerLabels(String(text || ""), profiles, hostProfile);
}

export function buildMeetingMarkdown(result, input = {}) {
  const normalized = normalizeAnalysisForKnownParticipants(result, input.participants, input.host);
  const meeting = normalized.meeting ?? {};
  const standard = normalized.standard_minutes ?? {};
  const title = meeting.title || input.fallbackTitle || "會議紀錄";
  const date = meeting.date || input.meetingDate || "";
  const lines = [];

  lines.push(`# ${formatMeetingTitle(title, date)}`);
  lines.push("");
  lines.push(`這是一份針對 ${formatMeetingSubject(title, date)} 的結構化會議紀錄。`);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("### 會議資訊");
  lines.push(`- 日期：${formatChineseDate(date) || "未填寫"}`);
  lines.push(`- 預估與會人數：${meeting.estimated_attendee_count ?? "未提供"}`);
  lines.push(`- 會議摘要：${meeting.summary || "未提供"}`);
  appendMeetingRecord(lines, standard, normalized);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("### 人員重點");
  appendSpeakerSummaries(lines, standard, normalized);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("### 共同決議");
  appendConclusions(lines, standard, normalized);
  lines.push("");
  lines.push("---");
  lines.push("");

  lines.push("### 待辦事項");
  appendActionGroups(lines, standard, normalized);
  lines.push("");
  lines.push("---");
  lines.push("");

  appendNextMeeting(lines, standard);
  lines.push("");
  lines.push("---");
  lines.push("");

  appendTranscript(lines, normalized);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

export function createDemoAnalysis(input = {}) {
  const titleFromFile = input.originalName ? input.originalName.replace(/\.[^.]+$/, "") : "會議記錄 檔案";
  const names = parseParticipantNames(input.participants);

  return {
    meeting: {
      title: titleFromFile,
      date: input.meetingDate || null,
      estimated_attendee_count: names.length || null,
      confidence: "low",
      summary: "尚未取得 API 金鑰，暫用 Demo 結果。"
    },
    standard_minutes: {
      meeting_record_sections: [
        {
          title: "基本內容",
          items: [
            {
              label: "會議檔案",
              detail: "尚未同步至 Gemini，請先完成 API Key 設定。"
            },
            {
              label: "Notion 串接",
              detail: "尚未同步 Notion，請先完成 Notion 設定。"
            }
          ]
        }
      ],
      speaker_summaries: names.map((name) => ({
        name,
        focus_points: [
          {
            label: "重點",
            detail: "此為示例資料，請完成 API 連線後重新分析。"
          }
        ]
      })),
      conclusions: [
        {
          label: "Demo 模式",
          detail: "待 API 設定完成後重新產生正式結論。",
          owner: null
        }
      ],
      action_groups: [
        {
          group_title: "會議行動",
          owner: null,
          tasks: [
            {
              task: "設定 Google AI Studio API Key",
              detail: "以便啟動正式會議分析流程",
              due_date: null
            },
            {
              task: "設定 Notion integration",
              detail: "啟用自動寫入會議紀錄",
              due_date: null
            }
          ]
        }
      ],
      next_meeting: {
        time: null,
        location: null,
        preparation: ["請先完成 API 與 Notion 設定，並重新上傳會議音檔。"]
      }
    },
    participants: names.map((name) => ({
      name_or_label: name,
      role_or_context: null,
      key_points: ["待補"],
      notable_quotes: []
    })),
    discussion: {
      controversies: [],
      decisions: []
    },
    action_items: [],
    follow_ups: [],
    risks_and_unknowns: [],
    transcript_segments: [
      {
        speaker: names[0] || "未識別（待確認）",
        timestamp: "00:00:00",
        text: "尚未取得 API 金鑰，這裡會在正式分析後顯示逐字稿。",
        confidence: "low"
      }
    ],
    raw_transcript_outline: []
  };
}

function appendMeetingRecord(lines, standard, result) {
  const sections = asArray(standard.meeting_record_sections);
  if (sections.length) {
    sections.forEach((section, index) => {
      lines.push(`**${index + 1}. ${section.title || "會議內容"}**`);
      for (const item of asArray(section.items)) {
        lines.push(`- **${item.label || "項目"}** ${item.detail || "尚無內容"}`);
      }
    });
    return;
  }

  const summary = result.meeting?.summary;
  if (summary) {
    lines.push(`- ${summary}`);
  } else {
    lines.push("- 尚無會議紀錄內容。");
  }
}

function appendSpeakerSummaries(lines, standard, result) {
  const summaries = asArray(standard.speaker_summaries);
  if (summaries.length) {
    for (const person of summaries) {
      lines.push(`- **${person.name || "未識別（待確認）"}**`);
      for (const point of asArray(person.focus_points)) {
        lines.push(`  - **${point.label || "重點"}** ${point.detail || "未提供"}`);
      }
    }
    return;
  }

  const participants = asArray(result.participants);
  if (!participants.length) {
    lines.push("- 尚無人員摘要。");
    return;
  }

  for (const person of participants) {
    lines.push(`- **${person.name_or_label || "未識別（待確認）"}**`);
    for (const point of asArray(person.key_points).slice(0, 5)) {
      lines.push(`  - ${point}`);
    }
  }
}

function appendConclusions(lines, standard, result) {
  const conclusions = asArray(standard.conclusions);
  if (conclusions.length) {
    conclusions.forEach((item, index) => {
      const owner = item.owner ? `（負責人：${item.owner}）` : "";
      lines.push(`${index + 1}. **${item.label || "決議"}** ${item.detail || "尚未定稿"}${owner}`);
    });
    return;
  }

  const decisions = asArray(result.discussion?.decisions);
  if (!decisions.length) {
    lines.push("1. **既有結論** 尚未整理，請補齊待確認項目。");
    return;
  }

  decisions.slice(0, 8).forEach((item, index) => {
    const owner = item.owner ? `（負責人：${item.owner}）` : "";
    const detail = item.rationale ? `${item.decision}，原因：${item.rationale}` : item.decision;
    lines.push(`${index + 1}. **決議 ${index + 1}** ${detail || "尚未定稿"}${owner}`);
  });
}

function appendActionGroups(lines, standard, result) {
  const groups = asArray(standard.action_groups);
  if (groups.length) {
    for (const group of groups) {
      lines.push(`#### ${group.group_title || formatActionGroupTitle(group.owner)}`);
      for (const task of asArray(group.tasks)) {
        const detail = task.detail ? ` ${task.detail}` : "";
        const due = task.due_date ? `（截止：${task.due_date}）` : "";
        lines.push(`- [ ] **${task.task || "待辦事項"}**${detail}${due}`);
      }
    }
    return;
  }

  const actionItems = asArray(result.action_items);
  if (!actionItems.length) {
    lines.push("- [ ] **尚無待辦事項**");
    return;
  }

  const grouped = groupByOwner(actionItems);
  for (const [owner, items] of grouped) {
    lines.push(`#### ${formatActionGroupTitle(owner)}`);
    for (const item of items) {
      const reason = item.source_or_reason ? ` ${item.source_or_reason}` : "";
      const due = item.due_date ? `（截止：${item.due_date}）` : "";
      lines.push(`- [ ] **${item.task || "待辦事項"}**${reason}${due}`);
    }
  }
}

function appendNextMeeting(lines, standard) {
  const next = standard.next_meeting || {};
  const preparation = asArray(next.preparation);

  lines.push("### 後續追蹤");
  if (!next.time && !next.location && !preparation.length) {
    lines.push("- 尚無後續追蹤資訊。");
    return;
  }

  if (next.time) lines.push(`- 時間：${next.time}`);
  if (next.location) lines.push(`- 地點：${next.location}`);
  if (preparation.length) {
    lines.push(`- 準備事項：${preparation.join("；")}`);
  }
}

function appendTranscript(lines, result) {
  lines.push("### 逐字稿");

  const transcriptSegments = collectTranscriptSegments(result);
  if (!transcriptSegments.length) {
    lines.push("- 尚未產生逐字稿。");
    return;
  }

  for (const segment of transcriptSegments) {
    const speaker = segment.speaker || "未識別（待確認）";
    const timestamp = segment.timestamp ? `[${segment.timestamp}] ` : "";
    const text = segment.text || segment.summary || "";
    const confidence = segment.confidence ? `（信心：${segment.confidence}）` : "";
    lines.push(`- **${timestamp}${speaker}**：${text || "無可辨識內容"}${confidence}`);
  }
}

function collectTranscriptSegments(result = {}) {
  const directSegments = asArray(result.transcript_segments)
    .map((segment) => ({
      speaker: segment?.speaker,
      timestamp: segment?.timestamp,
      text: segment?.text,
      confidence: segment?.confidence
    }))
    .filter((segment) => segment.text);

  if (directSegments.length) return directSegments;

  const nestedSegments = asArray(result.transcript?.segments)
    .map((segment) => ({
      speaker: segment?.speaker,
      timestamp: segment?.timestamp,
      text: segment?.text,
      confidence: segment?.confidence
    }))
    .filter((segment) => segment.text);

  if (nestedSegments.length) return nestedSegments;

  return asArray(result.raw_transcript_outline)
    .map((segment) => ({
      speaker: segment?.speaker,
      timestamp: segment?.timestamp,
      text: segment?.summary,
      confidence: segment?.confidence
    }))
    .filter((segment) => segment.text);
}

function groupByOwner(items) {
  const map = new Map();
  for (const item of items) {
    const owner = item.owner || "未指定";
    if (!map.has(owner)) map.set(owner, []);
    map.get(owner).push(item);
  }
  return map;
}

function formatActionGroupTitle(owner) {
  return owner && owner !== "未指定" ? `負責人：${owner}` : "未指定負責人";
}

function formatMeetingTitle(title, date) {
  if (!date) return title;
  return `${formatChineseDate(date)} 的 ${title}`;
}

function formatMeetingSubject(title, date) {
  if (!date) return `「${title}」`;
  return `${formatChineseDate(date)} 的「${title}」`;
}

function formatChineseDate(date) {
  const match = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return date;
  return `${match[1]} 年 ${Number(match[2])} 月 ${Number(match[3])} 日`;
}

function replaceSpeakerLabels(value, profiles, hostProfile = null) {
  if (typeof value === "string") {
    const replacements = buildLabelReplacements(profiles, hostProfile);
    let text = replacements.reduce((current, { pattern, target }) => current.replace(pattern, target), value);
    text = replaceUnmappedAnonymousLabels(text);

    for (const profile of profiles) {
      for (const alias of profile.aliases) {
        if (!alias || alias === profile.displayName) continue;
        text = replaceWholeWord(text, alias, profile.displayName);
      }
    }

    return text;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceSpeakerLabels(item, profiles, hostProfile));
  }

  if (value && typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = replaceSpeakerLabels(item, profiles, hostProfile);
    }
    return next;
  }

  return value;
}

function parseParticipantNames(participants = "") {
  return parseParticipantProfiles(participants).map((profile) => profile.displayName);
}

function parseParticipantProfiles(participants = "") {
  const source = String(participants || "")
    .replace(/\uFF08/g, "(")
    .replace(/\uFF09/g, ")")
    .replace(/\uFF0C/g, ",")
    .split(/\r?\n|;|；|\|/)
    .map((item) => item.trim())
    .filter(Boolean);

  const profiles = [];
  const seen = new Set();

  for (const rawEntry of source) {
    const normalized = rawEntry.replace(/\s+/g, " ").trim();
    if (!normalized) continue;

    const match = normalized.match(/^(.+?)\(([^)]*)\)$/);
    const displayName = (match?.[1] || normalized).trim();
    const aliasText = (match?.[2] || "").trim();

    const aliases = uniqueStrings([
      displayName,
      ...aliasText
        .split(/[，,]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .filter((part) => !isGenderWord(part)),
      ...(match ? [normalized] : [])
    ]);

    const profile = {
      displayName,
      aliases
    };

    const key = profile.displayName.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push(profile);
  }

  return profiles;
}

function isGenderWord(value = "") {
  const normalized = String(value).trim().toLocaleLowerCase();
  return ["男", "女", "先生", "女士", "小姐", "男生", "女生", "male", "female", "man", "woman"].includes(normalized);
}

function mergeKnownParticipants(existingParticipants, profiles, hostProfile = null) {
  const current = asArray(existingParticipants).map((item) => ({
    ...item,
    name_or_label: item?.name_or_label || item?.name || "未識別（待確認）"
  }));

  const seen = new Set(current.map((item) => String(item.name_or_label).toLocaleLowerCase()));
  if (hostProfile) {
    const hostKey = hostProfile.displayName.toLocaleLowerCase();
    if (!seen.has(hostKey)) {
      seen.add(hostKey);
      current.unshift({
        name_or_label: hostProfile.displayName,
        role_or_context: hostProfile.aliases.length > 1 ? `代號/別名：${hostProfile.aliases.slice(1).join("、")}` : null,
        key_points: [],
        notable_quotes: []
      });
    }
  }

  for (const profile of profiles) {
    const key = profile.displayName.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    current.push({
      name_or_label: profile.displayName,
      role_or_context: profile.aliases.length > 1 ? `代號/別名：${profile.aliases.slice(1).join("、")}` : null,
      key_points: [],
      notable_quotes: []
    });
  }

  return current;
}

function replaceWholeWord(text, source, target) {
  const escaped = escapeRegExp(source);
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, "gu");
  return text.replace(pattern, (match, prefix) => `${prefix}${target}`);
}

function parseHostProfile(hostText = "", profiles = []) {
  const normalizedHost = normalizeParticipantEntry(hostText);
  if (!normalizedHost) return null;

  const matchedProfile = profiles.find((profile) => {
    if (sameText(profile.displayName, normalizedHost)) return true;
    return profile.aliases.some((alias) => sameText(alias, normalizedHost));
  });
  if (matchedProfile) return matchedProfile;

  const parsed = parseParticipantProfiles(normalizedHost);
  return parsed[0] || null;
}

function buildLabelReplacements(profiles, hostProfile) {
  const replacements = [];
  const participantList = dedupeProfiles(hostProfile ? [hostProfile, ...profiles] : profiles);
  const hostName = hostProfile?.displayName || participantList[0]?.displayName || "";
  const attendeeList = participantList.filter((profile) => !hostProfile || !sameText(profile.displayName, hostProfile.displayName));
  const primaryAttendeeName = attendeeList[0]?.displayName || participantList[1]?.displayName || participantList[0]?.displayName || "";

  const maxSpeakerCount = Math.max(12, participantList.length);
  for (let index = 0; index < maxSpeakerCount; index += 1) {
    const target = participantList[index]?.displayName || "未識別（待確認）";
    for (const pattern of buildAnonymousSpeakerPatterns(index + 1)) {
      replacements.push({ pattern, target });
    }
  }

  if (hostName) {
    for (const label of ["Presenter", "Host", "Moderator", "Facilitator", "Chair", "Chairperson"]) {
      replacements.push({
        pattern: new RegExp(`\\b${escapeRegExp(label)}\\b`, "gi"),
        target: hostName
      });
    }
  }

  if (primaryAttendeeName) {
    for (const label of ["Attendee", "Participant", "Guest", "Member"]) {
      replacements.push({
        pattern: new RegExp(`\\b${escapeRegExp(label)}\\b`, "gi"),
        target: primaryAttendeeName
      });
    }
  }

  attendeeList.forEach((profile, index) => {
    const number = index + 1;
    replacements.push({
      pattern: new RegExp(`\\bAttendee\\s*${number}\\b`, "gi"),
      target: profile.displayName
    });
    replacements.push({
      pattern: new RegExp(`\\bParticipant\\s*${number}\\b`, "gi"),
      target: profile.displayName
    });
  });

  return replacements;
}

function buildAnonymousSpeakerPatterns(number) {
  const escapedNumberTokens = speakerNumberTokens(number).map(escapeRegExp).join("|");
  const englishLabel = "(?:Speaker|speaker|SPEAKER)";
  const chineseLabel = "(?:發言者|發言人|說話者|講者|主講人|與會者|參與者)";
  const tokenBoundary = "(?=$|[^0-9０-９一二兩三四五六七八九十A-Za-zＡ-Ｚａ-ｚ])";
  return [
    {
      pattern: new RegExp(`(^|[^\\p{L}\\p{N}_])(${englishLabel})\\s*[#＃-]?\\s*(${escapedNumberTokens})${tokenBoundary}`, "gu"),
      hasPrefix: true
    },
    {
      pattern: new RegExp(`(${chineseLabel})\\s*[#＃-]?\\s*(${escapedNumberTokens})${tokenBoundary}`, "gu"),
      hasPrefix: false
    },
    {
      pattern: new RegExp(`(^|[^\\p{L}\\p{N}_])(${englishLabel})\\s*([A-ZＡ-Ｚ])${tokenBoundary}`, "gu"),
      hasPrefix: true
    },
    {
      pattern: new RegExp(`(${chineseLabel})\\s*([A-ZＡ-Ｚ])${tokenBoundary}`, "gu"),
      hasPrefix: false
    }
  ].map(({ pattern, hasPrefix }) => ({
    [Symbol.replace](text, target) {
      return text.replace(pattern, (match, first, _labelOrToken, maybeToken) => {
        const prefix = hasPrefix ? first : "";
        const token = hasPrefix ? maybeToken : _labelOrToken;
        const tokenIndex = speakerTokenToIndex(token);
        return tokenIndex === number ? `${prefix}${target}` : match;
      });
    }
  }));
}

function replaceUnmappedAnonymousLabels(text) {
  const englishLabel = "(?:Speaker|speaker|SPEAKER)";
  const chineseLabel = "(?:發言者|發言人|說話者|講者|主講人|與會者|參與者)";
  const tokenPattern = "[0-9０-９一二兩三四五六七八九十Ａ-ＺA-Z]+";
  const tokenBoundary = "(?=$|[^0-9０-９一二兩三四五六七八九十A-Za-zＡ-Ｚａ-ｚ])";
  return String(text || "")
    .replace(
      new RegExp(`(^|[^\\p{L}\\p{N}_])(${englishLabel})\\s*[#＃-]?\\s*(${tokenPattern})${tokenBoundary}`, "gu"),
      (_match, prefix) => `${prefix}未識別（待確認）`
    )
    .replace(
      new RegExp(`(${chineseLabel})\\s*[#＃-]?\\s*(${tokenPattern})${tokenBoundary}`, "gu"),
      "未識別（待確認）"
    );
}

function speakerNumberTokens(number) {
  return uniqueStrings([
    String(number),
    toFullWidthDigits(number),
    toChineseNumber(number),
    String.fromCharCode(64 + number),
    String.fromCharCode(0xff20 + number)
  ]);
}

function speakerTokenToIndex(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return null;

  const asciiDigits = normalized.replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10));
  if (/^\d+$/.test(asciiDigits)) return Number(asciiDigits);

  const letter = normalized.normalize("NFKC");
  if (/^[A-Z]$/i.test(letter)) return letter.toUpperCase().charCodeAt(0) - 64;

  return chineseNumberToInt(normalized);
}

function toFullWidthDigits(number) {
  return String(number).replace(/[0-9]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0));
}

function toChineseNumber(number) {
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (number <= 10) return number === 10 ? "十" : digits[number];
  if (number < 20) return `十${digits[number - 10]}`;
  if (number < 100) {
    const tens = Math.floor(number / 10);
    const ones = number % 10;
    return `${digits[tens]}十${ones ? digits[ones] : ""}`;
  }
  return String(number);
}

function chineseNumberToInt(value) {
  const digits = {
    零: 0,
    一: 1,
    二: 2,
    兩: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  if (Object.hasOwn(digits, value)) return digits[value];
  if (value === "十") return 10;
  const teen = value.match(/^十([一二兩三四五六七八九])$/);
  if (teen) return 10 + digits[teen[1]];
  const tens = value.match(/^([一二兩三四五六七八九])十([一二兩三四五六七八九])?$/);
  if (tens) return digits[tens[1]] * 10 + (tens[2] ? digits[tens[2]] : 0);
  return null;
}

function dedupeProfiles(profiles) {
  const seen = new Set();
  const output = [];
  for (const profile of profiles) {
    if (!profile?.displayName) continue;
    const key = profile.displayName.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(profile);
  }
  return output;
}

function normalizeParticipantEntry(value) {
  return String(value || "")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[，]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function sameText(left, right) {
  return normalizeParticipantEntry(left).toLocaleLowerCase() === normalizeParticipantEntry(right).toLocaleLowerCase();
}

function uniqueStrings(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const normalized = String(item || "").trim();
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}
