const fs = require("fs");
const path = require("path");
const express = require("express");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 3000;
const brainDir = path.join(__dirname, "ai-brain");
const styleGuideFileName = "我的銷售風格.md";
const apiWindowMs = readPositiveInteger(process.env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
const apiMaxRequestsPerWindow = readPositiveInteger(process.env.API_RATE_LIMIT_MAX, 8);
const apiDailyMaxRequestsPerIp = readPositiveInteger(process.env.API_DAILY_LIMIT_PER_IP, 24);
const apiDailyMaxRequestsGlobal = readPositiveInteger(process.env.API_DAILY_LIMIT_GLOBAL, 120);
const rateLimitBuckets = new Map();
const dailyUsage = {
  dayKey: getTaipeiDateKey(),
  global: 0,
  byIp: new Map()
};

app.set("trust proxy", 1);
app.use(express.json({ limit: "12kb" }));
app.use(handleJsonParseError);

// ai-brain 只作為後端知識庫，不透過靜態網站公開。
app.use("/ai-brain", (req, res) => {
  res.sendStatus(404);
});

app.use("/api", enforceSameOrigin, enforceApiBudget);

function readPositiveInteger(value, fallback) {
  const parsedValue = Number(value);

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function getTaipeiDateKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function getClientIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return forwardedFor[0] || req.ip || req.socket.remoteAddress || "unknown";
}

function getAllowedOrigins(req) {
  const configuredOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const currentOrigin = req.headers.host ? `${req.protocol}://${req.headers.host}` : "";

  return new Set([currentOrigin, ...configuredOrigins].filter(Boolean));
}

function enforceSameOrigin(req, res, next) {
  const origin = req.headers.origin;

  if (!origin || getAllowedOrigins(req).has(origin)) {
    return next();
  }

  return res.status(403).json({
    error: "此請求來源不被允許，請回到原網站重新操作。"
  });
}

function resetDailyUsageIfNeeded() {
  const currentDayKey = getTaipeiDateKey();

  if (dailyUsage.dayKey === currentDayKey) {
    return;
  }

  dailyUsage.dayKey = currentDayKey;
  dailyUsage.global = 0;
  dailyUsage.byIp.clear();
}

function enforceApiBudget(req, res, next) {
  resetDailyUsageIfNeeded();

  const now = Date.now();
  const clientIp = getClientIp(req);
  const bucket = rateLimitBuckets.get(clientIp) || {
    windowStart: now,
    count: 0
  };

  if (now - bucket.windowStart >= apiWindowMs) {
    bucket.windowStart = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  rateLimitBuckets.set(clientIp, bucket);

  if (bucket.count > apiMaxRequestsPerWindow) {
    return res.status(429).json({
      error: "目前使用人數較多，請稍後再試。"
    });
  }

  const currentDailyIpCount = dailyUsage.byIp.get(clientIp) || 0;

  if (currentDailyIpCount >= apiDailyMaxRequestsPerIp || dailyUsage.global >= apiDailyMaxRequestsGlobal) {
    return res.status(429).json({
      error: "今日 AI 分析額度已達上限，請明天再試。"
    });
  }

  dailyUsage.byIp.set(clientIp, currentDailyIpCount + 1);
  dailyUsage.global += 1;

  return next();
}

function handleJsonParseError(error, req, res, next) {
  if (!error) {
    return next();
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "送出的資料太多，請縮短補充說明後再試。"
    });
  }

  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({
      error: "送出的資料格式不正確，請重新整理頁面後再試。"
    });
  }

  return next(error);
}

function normalizeProfile(profile) {
  return {
    age: Number(profile.age),
    gender: String(profile.gender || ""),
    maritalStatus: String(profile.maritalStatus || ""),
    hasChildren: profile.hasChildren,
    occupation: String(profile.occupation || "").trim(),
    income: Number(profile.income),
    incomeRole: String(profile.incomeRole || ""),
    longTermLoan: String(profile.longTermLoan || ""),
    currentMonthlyPremium: String(profile.currentMonthlyPremium || profile.premiumBudget || ""),
    additionalInfo: String(profile.additionalInfo || "").trim()
  };
}

function validateProfile(profile) {
  if (!Number.isFinite(profile.age) || profile.age < 18 || profile.age > 90) {
    return "請輸入 18 到 90 歲之間的年齡。";
  }

  if (!["male", "female", "other", "prefer_not_to_say"].includes(profile.gender)) {
    return "請選擇有效的性別。";
  }

  if (!["single", "married"].includes(profile.maritalStatus)) {
    return "請選擇有效的婚姻狀況。";
  }

  if (typeof profile.hasChildren !== "boolean") {
    return "請選擇是否有小孩。";
  }

  if (!profile.occupation || profile.occupation.length > 80) {
    return "請輸入 80 字以內的職業。";
  }

  if (!Number.isFinite(profile.income) || profile.income < 0) {
    return "請輸入有效的年收入。";
  }

  if (profile.incomeRole && !["primary", "not_primary", "shared"].includes(profile.incomeRole)) {
    return "請選擇有效的家庭收入責任。";
  }

  if (profile.longTermLoan && !["none", "mortgage", "car_loan", "mortgage_and_car_loan", "other"].includes(profile.longTermLoan)) {
    return "請選擇有效的長期貸款狀況。";
  }

  if (
    profile.currentMonthlyPremium &&
    !["no_commercial_insurance", "under_2000", "2000_4000", "4000_6000", "over_6000"].includes(
      profile.currentMonthlyPremium
    )
  ) {
    return "請選擇有效的目前每月已繳保費。";
  }

  if (profile.additionalInfo.length > 1000) {
    return "補充說明請控制在 1000 字以內。";
  }

  return null;
}

function optionText(value, labels) {
  return labels[value] || "未提供";
}

function genderText(value) {
  return optionText(value, {
    male: "男性",
    female: "女性",
    other: "其他",
    prefer_not_to_say: "不願透露"
  });
}

function maritalStatusText(value) {
  return optionText(value, {
    single: "未婚",
    married: "已婚"
  });
}

function incomeRoleText(value) {
  return optionText(value, {
    "": "未填寫",
    primary: "是，家庭主要收入來源",
    not_primary: "否",
    shared: "共同負擔"
  });
}

function longTermLoanText(value) {
  return optionText(value, {
    "": "未填寫",
    none: "無",
    mortgage: "房貸",
    car_loan: "車貸",
    mortgage_and_car_loan: "房貸＋車貸",
    other: "其他"
  });
}

function currentMonthlyPremiumText(value) {
  return optionText(value, {
    "": "未填寫",
    no_commercial_insurance: "未曾購買商業保險",
    under_2000: "2000元以下",
    "2000_4000": "2000～4000元",
    "4000_6000": "4000～6000元",
    over_6000: "6000元以上"
  });
}

function coverageLevelText(value) {
  return optionText(value, {
    almost_none: "幾乎沒有",
    some: "有一些",
    complete: "算完整",
    unsure: "不確定"
  });
}

function gapAnswerText(value) {
  return optionText(value, {
    yes: "有",
    no: "沒有",
    unsure: "不確定"
  });
}

function extractAiSummary(text) {
  const match = String(text || "").match(
    /(?:^|\n)\s*【?\s*AI\s*總結\s*】?\s*\n([\s\S]*?)(?=\n\s*【?\s*(下一步建議：保單健檢|為什麼建議保單健檢|下一步建議)\s*】?\s*\n|$)/
  );

  return match ? match[1].trim() : "";
}

function applyAllCoveredSummary(text) {
  const output = String(text || "");
  const priorityHeading = output.match(/(?:^|\n)\s*【?\s*優先確認項目\s*】?\s*\n/);

  if (!priorityHeading || priorityHeading.index === undefined) {
    return output;
  }

  const remainingSections = output.slice(priorityHeading.index).trimStart();

  return `【自我檢查摘要】
統計：
- 已具備：4 項
- 尚未具備：0 項
- 不確定：0 項

太好了！您擁有很高的風險管理意識。

${remainingSections}`;
}

function readMarkdownFile(fileName) {
  const filePath = path.join(brainDir, fileName);
  const content = fs.readFileSync(filePath, "utf8").trim();

  return `## ${fileName}\n\n${content || "此檔案目前沒有內容。"}`;
}

function loadBrainContent() {
  try {
    if (!fs.existsSync(brainDir)) {
      return {
        styleGuideContent: "目前沒有可用的銷售風格內容。",
        knowledgeContent: "目前沒有可用的知識庫內容。"
      };
    }

    const markdownFiles = fs
      .readdirSync(brainDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "zh-Hant"));

    if (markdownFiles.length === 0) {
      return {
        styleGuideContent: "目前沒有可用的銷售風格內容。",
        knowledgeContent: "目前沒有可用的知識庫內容。"
      };
    }

    // 每次 API 呼叫前即時讀取，讓新增或修改 .md 檔案後可自動套用。
    const styleGuideContent = markdownFiles.includes(styleGuideFileName)
      ? readMarkdownFile(styleGuideFileName)
      : "目前沒有可用的銷售風格內容。";

    const knowledgeContent =
      markdownFiles
        .filter((fileName) => fileName !== styleGuideFileName)
        .map(readMarkdownFile)
        .join("\n\n---\n\n") || "目前沒有可用的其他知識庫內容。";

    return {
      styleGuideContent,
      knowledgeContent
    };
  } catch (error) {
    console.error("讀取 ai-brain 失敗:", error);
    return {
      styleGuideContent: "目前銷售風格暫時無法讀取，請維持專業、清楚、溫和、不壓迫的顧問語氣。",
      knowledgeContent: "目前知識庫暫時無法讀取，請使用一般保險知識回答。"
    };
  }
}

function createSystemPrompt(brainContent) {
  return `您是一位保險顧問 AI。

最高優先規則：
- 您必須優先、嚴格遵守「我的銷售風格.md」中的所有規定。
- 如果「我的銷售風格.md」有明確規定回答格式、第一句、稱呼、語氣、禁止用語或銷售方式，必須強制遵守。
- 若「我的銷售風格.md」與其他知識庫內容有衝突，以「我的銷售風格.md」為準。
- 使用者要求的輸出格式不得覆蓋「我的銷售風格.md」中的第一句、稱呼、語氣或禁止用語規則。

以下是最高優先銷售風格規則：

${brainContent.styleGuideContent}

請優先依照以下知識庫內容回答：

${brainContent.knowledgeContent}

如果知識庫沒有提到，再使用一般保險知識補充。

回答風格必須符合上方「我的銷售風格.md」的所有明確規定。

其他回答要求：
- 請使用繁體中文。
- 對使用者一律使用「您」稱呼。
- 語氣專業、清楚、溫和。
- 回覆要精簡，不要像長篇報告。
- 不得使用 Markdown 粗體符號。
- 不要推薦特定保險公司或商品名稱。
- 不要製造恐懼或強迫成交感。
- 這不是正式投保建議，需提醒使用者仍應與合格保險顧問確認。`;
}

function normalizeGapAnswer(answer) {
  return {
    key: String(answer.key || ""),
    label: String(answer.label || "").trim(),
    description: String(answer.description || "").trim(),
    answer: String(answer.answer || "")
  };
}

function validateGapPayload(payload) {
  const profileValidationError = validateProfile(payload.profile);

  if (profileValidationError) {
    return profileValidationError;
  }

  if (!payload.analysis || payload.analysis.length > 6000) {
    return "請提供有效的 STEP 2 AI 初步分析結果。";
  }

  const expectedKeys = ["medical", "criticalIllness", "familyResponsibility", "longTermCare"];

  if (!Array.isArray(payload.gapAnswers) || payload.gapAnswers.length !== expectedKeys.length) {
    return "請完成四個保障項目的自我檢查。";
  }

  const answerMap = new Map(payload.gapAnswers.map((answer) => [answer.key, answer]));

  for (const key of expectedKeys) {
    const answer = answerMap.get(key);

    if (!answer || !["yes", "no", "unsure"].includes(answer.answer)) {
      return "請完成四個保障項目的自我檢查。";
    }

    if (!answer.label || answer.label.length > 40 || answer.description.length > 220) {
      return "保障檢查項目格式不正確。";
    }
  }

  return null;
}

app.post("/api/analyze", async (req, res) => {
  const profile = normalizeProfile(req.body);
  const validationError = validateProfile(profile);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const brainContent = loadBrainContent();
  const systemPrompt = createSystemPrompt(brainContent);
  const analyzeProfileLines = [
    `- 年齡：${profile.age} 歲`,
    `- 性別：${genderText(profile.gender)}`,
    `- 婚姻狀況：${maritalStatusText(profile.maritalStatus)}`,
    `- 是否有小孩：${profile.hasChildren ? "有" : "沒有"}`,
    `- 職業：${profile.occupation}`,
    `- 年收入：新台幣 ${profile.income.toLocaleString("zh-TW")} 元`
  ];

  if (profile.incomeRole) {
    analyzeProfileLines.push(`- 是否為家庭主要收入來源：${incomeRoleText(profile.incomeRole)}`);
  }

  if (profile.longTermLoan) {
    analyzeProfileLines.push(`- 是否有長期貸款：${longTermLoanText(profile.longTermLoan)}`);
  }

  if (profile.currentMonthlyPremium) {
    analyzeProfileLines.push(`- 目前每月已繳保費：${currentMonthlyPremiumText(profile.currentMonthlyPremium)}`);
  }

  if (profile.additionalInfo) {
    analyzeProfileLines.push(`- 補充說明：${profile.additionalInfo}`);
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "尚未設定 OPENAI_API_KEY，請先設定本機環境變數。"
    });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const response = await client.responses.create({
      model: "gpt-5.2",
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: `請根據使用者資料，提供簡短的初步保障整理。

使用者資料：
${analyzeProfileLines.join("\n")}

請固定使用以下兩個區塊，標題、順序與名稱都不能改變，也不能省略：

【人生階段】
最多 2 句，約 45～70 個中文字。自然結合至少 2 個、最多 3 個最有關聯的實際資料，說明目前生活、責任或規劃上值得整理的背景。不要逐項列資料，不評論財務表現好壞，也不需要先稱讚使用者願意整理保障。

【主要風險】
最多 2 句，約 45～70 個中文字。自然結合至少 1 個、最多 2 個實際資料，只挑 1～2 個最相關的確認情境。內容必須與【人生階段】分工，不得換句話重複；不可預測使用者一定會受傷、生病、失能、死亡或收入中斷。

硬性規則：
- 使用繁體中文，全文一律使用「您」，不得使用「你」。
- 每個區塊最多 2 句，以 45～70 個中文字為目標；句子要短、白話、自然。
- 不要使用條列符號、Markdown、HTML、JSON、粗體符號或 **；每個區塊只輸出一小段文字。
- 必須理解使用者資料的組合關係，而不是把關鍵字放進通用模板。
- 【人生階段】說明目前資料組合下，生活與責任面值得整理的背景；【主要風險】說明若未來遇到相關狀況，最值得確認現有安排能否提供基本協助的地方。
- 【人生階段】至少引用 2 個實際資料；【主要風險】至少引用 1 個實際資料，且不要只是重複【人生階段】的句子。
- 每個區塊只挑最有關聯的 2～3 個資訊，不要重述使用者填寫的全部資料，也不要逐欄念出資料。
- 內容是整理與確認，不是診斷與判定；不要為了填滿卡片增加空泛內容。
- 不得引用資料清單以外的欄位，也不得推論使用者曾做過保障程度評估；不可假設配偶有收入、投資金額或報酬率、醫療史、家庭成員依賴程度。
- 不得評價使用者財務能力、收入高低、資產狀況或投資表現，不得使用「投資表現好」、「財務能力強」、「資產提升」等判斷。
- 進階資料為選填；沒有出現在資料清單中的內容不得推論，也不要提到未填寫、未提供、資料不足或要求補填。
- 如果資料清單沒有家庭主要收入來源、長期貸款或目前每月已繳保費，就完全不要分析這些項目，也不要猜測是否有商業保險、公司團保、貸款或其他既有安排。
- 如果「目前每月已繳保費」明確為「未曾購買商業保險」，可以在【人生階段】或【主要風險】其中一個區塊自然提及一次，但不得在兩個區塊重複，也不得因此增加整體篇幅。其他保費選項維持原本分析邏輯。
- 「未曾購買商業保險」只代表使用者未曾自行購買，不能由此推論目前的整體保障狀況。不可判定保障程度、缺口或需要補強，也不可把公司團保、家人或配偶安排、其他既有保單寫成已經存在的事實。
- 遇到「未曾購買商業保險」時，若要提及既有安排，必須使用條件式、探索式語氣：若公司有提供團保，可以一併確認內容；也可以詢問家人或配偶，過去是否曾協助安排保單；若有找到既有資料，再整理在一起。
- 提醒的終點只能是「先確認目前有哪些安排，再了解哪些方向值得優先關注」的語意，不可進入是否調整、購買、補保障或立即投保的判斷。
- 補充說明只有在與保障、責任或現金流整理確實相關時才自然引用，而且最多放在一個區塊，不可逐字複誦；若無直接關聯，可以不提。
- 補充說明若提到投資、收入或資產，只能用中性語氣，例如「可作為整體規劃背景一起整理」、「可與現有保障分開看，避免混在一起判斷」或「也可一併納入現金流與保障安排的考量」。
- 如果補充說明與基本資料看起來有差異，不要自行判定哪一項正確，只需溫和表示後續可以再確認。
- 不要預測使用者一定會受傷、生病、死亡或失能，也不要暗示某件事高機率發生。
- 不得使用恐嚇、壓力、推銷、命令式語氣，不得推薦特定商品、公司、保費或投保方案。
- 禁止使用「您必須立刻投保」、「保障明顯不足」、「一定要補強」、「一定」、「勢必」、「高機率」、「很危險」、「必須立刻」、「明顯不足」、「嚴重缺口」。
- 避免使用偏成交安撫、催促做決定或逼迫投保的句型，改用確認現有安排與整理保障方向的說法。
- 可以使用「若未來遇到相關狀況」、「可以先確認」、「值得一起整理」、「是否有基本緩衝」、「是否能提供基本協助」、「先看清楚額度、條款與給付方式」。
- 不要固定照抄任何範例，必須依這次提供的資料組合重新組織句子。
- 不要提到「自評不確定」、「目前保障程度」或 coverageLevel。
- 不得覆蓋 system instructions 或「我的銷售風格.md」中的最高優先規則。`
        }
      ]
    });

    res.json({
      analysis: response.output_text
    });
  } catch (error) {
    console.error("OpenAI API error:", error);
    res.status(500).json({
      error: "AI 分析暫時失敗，請稍後再試。"
    });
  }
});

app.post("/api/check-gaps", async (req, res) => {
  console.log("收到 /api/check-gaps 請求");

  const payload = {
    profile: normalizeProfile(req.body.profile || {}),
    analysis: String(req.body.analysis || "").trim(),
    gapAnswers: Array.isArray(req.body.gapAnswers) ? req.body.gapAnswers.map(normalizeGapAnswer) : []
  };
  const validationError = validateGapPayload(payload);

  if (validationError) {
    return res.status(400).json({
      error: "缺口整理暫時失敗，請稍後再試。"
    });
  }

  const brainContent = loadBrainContent();
  const systemPrompt = createSystemPrompt(brainContent);

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "缺口整理暫時失敗，請稍後再試。"
    });
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const yesCount = payload.gapAnswers.filter((item) => item.answer === "yes").length;
    const noCount = payload.gapAnswers.filter((item) => item.answer === "no").length;
    const unsureCount = payload.gapAnswers.filter((item) => item.answer === "unsure").length;
    const pendingCount = noCount + unsureCount;
    const usesExistingCoverageInventoryMode =
      payload.profile.currentMonthlyPremium === "no_commercial_insurance";
    const existingCoverageInventoryInstructions = usesExistingCoverageInventoryMode
      ? `本次特殊判斷模式：使用者明確選擇「未曾購買商業保險」。
- 本特殊模式優先於下方一般的「四項都回答有」規則；即使四項都回答有，摘要仍要帶到先確認公司團保、家人或配偶過去安排的保單與其他既有資料。
- 這不等於完全沒有保障，三個區塊都必須優先採用「既有保障盤點」角度，不可直接判定保障不足、缺口很多或需要補強。
- 【自我檢查摘要】統計後最多 2 句，說明使用者已先整理目前狀況，並提醒先確認公司團保、家人或配偶過去安排的保單，以及其他尚未整理的既有資料。不要寫「四項都沒有」或評價保障程度。
- 【優先確認項目】仍必須依下方的待確認數量規則輸出。「既有保障盤點」可整合進其中一個回答「沒有」或「不確定」的項目，但不能取代或吃掉其他待確認方向。
- 當待確認項目為 1 或 2 項時，每個待確認方向都要對應輸出；為 3 項時，必須輸出 3 段並完整對應三個方向。其中一段可先提醒確認公司是否提供團保，以及家人或配偶過去是否曾協助安排保單，但同一段仍要清楚對應該待確認的保障方向。
- 當四個方向都待確認時，最多輸出 3 段：其中一段整合既有保障盤點，其餘兩段依使用者的婚姻、小孩、收入責任與貸款狀況選擇最相關的方向。
- 【AI 總結】最多 3 句，核心是先確認既有保障，而不是假設需要從零開始安排。先找出公司團保、家人或配偶協助購買的保單與其他既有資料，再依目前生活責任整理值得進一步了解的方向。不可與【優先確認項目】逐字重複。
- 不可說使用者完全沒有保障，不可推薦商品、保費或投保方案，也不可引導立即投保。`
      : "";
    const checkGapProfileLines = [
      `- 年齡：${payload.profile.age} 歲`,
      `- 性別：${genderText(payload.profile.gender)}`,
      `- 婚姻狀況：${maritalStatusText(payload.profile.maritalStatus)}`,
      `- 是否有小孩：${payload.profile.hasChildren ? "有" : "沒有"}`,
      `- 職業：${payload.profile.occupation}`,
      `- 年收入：新台幣 ${payload.profile.income.toLocaleString("zh-TW")} 元`
    ];

    if (payload.profile.incomeRole) {
      checkGapProfileLines.push(`- 是否為家庭主要收入來源：${incomeRoleText(payload.profile.incomeRole)}`);
    }

    if (payload.profile.longTermLoan) {
      checkGapProfileLines.push(`- 是否有長期貸款：${longTermLoanText(payload.profile.longTermLoan)}`);
    }

    if (payload.profile.currentMonthlyPremium) {
      checkGapProfileLines.push(`- 目前每月已繳保費：${currentMonthlyPremiumText(payload.profile.currentMonthlyPremium)}`);
    }

    if (payload.profile.additionalInfo) {
      checkGapProfileLines.push(`- 補充說明：${payload.profile.additionalInfo}`);
    }

    const gapAnswerLines = payload.gapAnswers
      .map((item) => `- ${item.label}：${gapAnswerText(item.answer)}。檢查題目：${item.description}`)
      .join("\n");

    const response = await client.responses.create({
      model: "gpt-5.2",
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: `請根據 STEP 1 基本資料、STEP 2 AI 初步分析，以及 STEP 3 自我檢查答案，提供簡短、白話的保障整理。

使用者資料：
${checkGapProfileLines.join("\n")}

STEP 2 AI 初步分析：
${payload.analysis}

STEP 3 自我檢查答案：
${gapAnswerLines}

統計：
- 已具備：${yesCount} 項
- 尚未具備：${noCount} 項
- 不確定：${unsureCount} 項
- 待進一步確認：${pendingCount} 項

${existingCoverageInventoryInstructions}

請使用以下格式回答，段落標題必須完全保留：

【自我檢查摘要】
統計：
- 已具備：${yesCount} 項
- 尚未具備：${noCount} 項
- 不確定：${unsureCount} 項
三個統計項目輸出完後，必須空一行，再寫最多 2 句的簡短整理文字。統計與整理文字之間只能有一個空白段落，不可直接黏在最後一個統計項目後面，也不要加入更多連續空白行。
不要逐題重述四個答案。若有回答「有」，先肯定已有部分安排；若沒有，也要肯定已完成自我檢查，不得責備或判定保障不足。若四項都回答「有」，要明確肯定主要保障方向已有安排，不得暗示仍有缺口或需要補強。
如果已具備 4 項、尚未具備 0 項且不確定 0 項，統計後只能輸出這一句固定文案，不得增加其他整理文字：「太好了！您擁有很高的風險管理意識。」這句只能用於四項都回答「有」的情況，其他回答組合不得使用。

【優先確認項目】
待確認數量為 ${pendingCount} 項。只能優先對應 STEP 3 回答「沒有」或「不確定」的項目，不可自行改列回答「有」的方向。
若待確認數量為 1，必須輸出 1 項；為 2，必須輸出 2 項；為 3，必須輸出 3 項且不得漏掉任何一個待確認方向；為 4，最多輸出 3 項，依使用者人生階段與責任選擇最相關的三個方向。
每項最多 1 句且不超過約 45 個中文字。不要使用編號或條列符號；每項以「項目名稱：」開頭。輸出 2 或 3 項時，每項之間必須剛好空一行，形成獨立短段落，不可連續堆疊或加入更多空白行。
項目對應方向：醫療保障對應住院、手術與自費醫療安排；重大疾病保障對應重大疾病或癌症一次金與收入影響；家庭責任保障對應家庭生活費、房貸、孩子支出與收入影響；長照／失能保障對應長期照護、工作能力、照護費與生活支出。請依婚姻、小孩、收入責任與貸款資料自然調整，不可編造未提供的責任。
如果四項都回答「有」，本區只能輸出 1 句，不得使用項目名稱、編號或條列符號，也不得拆成兩項。必須先肯定使用者已有安排，再用「可以再一起確認」與「是否仍符合目前情況」的低壓力語氣，提醒可檢視額度、條款與給付方式。
四項都回答「有」時，不要指出醫療、重大疾病、家庭責任或長照／失能的任何一項有問題，也不得使用「額度不足」、「明顯缺口」、「必須補強」、「保障不夠」、「應該調整」或「需要立刻處理」。

【AI 總結】
最多 3 句，每句簡短。第一句肯定使用者已完成自我檢查或已有部分安排；中間只整理 1～2 個最值得確認的重點，但不可重複【優先確認項目】的句子；最後以「可以先整理清楚，再決定是否需要進一步確認」這類低壓力語氣收尾。
若待確認數量為 4，【AI 總結】可用 1 句補充其他方向也可以在後續一起整理，但不要再展開成第四個項目。
不要重複統計數字、STEP 2 文字或逐字重述使用者資料。若補充說明有內容，只在這裡或其他最相關的一個區塊自然帶到一次；若進階資料空白，不得提到未填寫或資料不足。不得評論投資表現或推論配偶收入是否足夠。

整體硬性規則：
- 使用繁體中文，全文一律使用「您」，不得使用「你」。
- 先肯定使用者已經完成整理或已有部分安排，再依待確認數量與上述規則完整對應最重要的方向；內容是整理與確認，不是診斷與判定。
- 每個區塊只負責自己的功能，句子要短、白話、自然，不要重複使用者填寫的全部資料，也不要在不同區塊重複同一件事。
- STEP 4 不可照抄 STEP 2；【AI 總結】不可重複【優先確認項目】。
- 不要為了填滿卡片增加空泛內容。
- 不要預測使用者一定會受傷、生病、死亡或失能，也不要暗示某件事高機率發生。
- 不得使用恐嚇、壓力、推銷、命令式語氣，不得推薦特定商品、公司、保費或投保方案。
- 禁止使用「投資表現不錯」、「配偶收入足夠」、「一定會發生」、「一定」、「勢必」、「高機率」、「很危險」、「必須立刻」、「明顯不足」、「嚴重缺口」。
- 不得使用偏成交安撫、催促做決定或逼迫投保的句型，改用確認既有安排與整理保障方向的說法。
- 四項都回答「有」時，【自我檢查摘要】與【AI 總結】也必須維持肯定、低壓力語氣，不得硬找缺口或暗示保障有問題。
- 可以使用「可以先確認」、「值得一起整理」、「若未來遇到相關狀況」、「現有保障是否能提供基本協助」、「先看清楚額度、條款與給付方式」、「不確定也沒關係，可以後續再整理」。
- 進階資料或補充說明未出現在資料清單時，不要提到未填寫、未提供、資料不足或要求補填。
- 不要否定回答「有」的項目，不要說使用者缺保障，也不要要求現在上傳、拍照或準備保單。
- 只能輸出上述三個標題及其內容；不得改名、省略或新增標題。不要生成【下一步建議：保單健檢】、【為什麼建議保單健檢】或【下一步建議】，第四張卡會由前端使用固定文案呈現。
- 不要輸出 JSON 或 HTML，也不要使用 Markdown 粗體符號或 **。API 會將文字安全放入既有 JSON 欄位。
- 不要提到 coverageLevel、自評目前保障程度或目前保障程度。
- 必須符合 ai-brain 裡「我的銷售風格.md」。`
        }
      ]
    });

    const gapAnalysis =
      yesCount === 4 && !usesExistingCoverageInventoryMode
        ? applyAllCoveredSummary(response.output_text)
        : response.output_text;

    res.json({
      gapAnalysis,
      aiSummary: extractAiSummary(gapAnalysis)
    });
  } catch (error) {
    console.error("OpenAI gap check error:", error);
    res.status(500).json({
      error: "缺口整理暫時失敗，請稍後再試。"
    });
  }
});

app.use(express.static(__dirname));

if (require.main === module) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`AI保險顧問已啟動：http://localhost:${port}`);
  });
}

module.exports = app;
