const fs = require("fs");
const path = require("path");
const express = require("express");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 3000;
const brainDir = path.join(__dirname, "ai-brain");
const styleGuideFileName = "我的銷售風格.md";

app.use(express.json());

// ai-brain 只作為後端知識庫，不透過靜態網站公開。
app.use("/ai-brain", (req, res) => {
  res.sendStatus(404);
});

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
    premiumBudget: String(profile.premiumBudget || ""),
    coverageLevel: String(profile.coverageLevel || ""),
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

  if (!["single", "married", "other"].includes(profile.maritalStatus)) {
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

  if (!["primary", "not_primary", "shared"].includes(profile.incomeRole)) {
    return "請選擇有效的家庭收入責任。";
  }

  if (!["none", "mortgage", "car_loan", "mortgage_and_car_loan", "other"].includes(profile.longTermLoan)) {
    return "請選擇有效的長期貸款狀況。";
  }

  if (!["under_1000", "1000_3000", "3000_5000", "over_5000"].includes(profile.premiumBudget)) {
    return "請選擇有效的保費預算。";
  }

  if (!["almost_none", "some", "complete", "unsure"].includes(profile.coverageLevel)) {
    return "請選擇有效的保障程度。";
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
    married: "已婚",
    other: "其他"
  });
}

function incomeRoleText(value) {
  return optionText(value, {
    primary: "是，家庭主要收入來源",
    not_primary: "否",
    shared: "共同負擔"
  });
}

function longTermLoanText(value) {
  return optionText(value, {
    none: "無",
    mortgage: "房貸",
    car_loan: "車貸",
    mortgage_and_car_loan: "房貸＋車貸",
    other: "其他"
  });
}

function premiumBudgetText(value) {
  return optionText(value, {
    under_1000: "1000元以下",
    "1000_3000": "1000～3000元",
    "3000_5000": "3000～5000元",
    over_5000: "5000元以上"
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
  return `你是一位保險顧問 AI。

最高優先規則：
- 你必須優先、嚴格遵守「我的銷售風格.md」中的所有規定。
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
- 語氣專業、清楚、溫和。
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
          content: `請根據以下使用者資料，提供初步保障分析。

使用者資料：
- 年齡：${profile.age} 歲
- 性別：${genderText(profile.gender)}
- 婚姻狀況：${maritalStatusText(profile.maritalStatus)}
- 是否有小孩：${profile.hasChildren ? "有" : "沒有"}
- 職業：${profile.occupation}
- 年收入：新台幣 ${profile.income.toLocaleString("zh-TW")} 元
- 是否為家庭主要收入來源：${incomeRoleText(profile.incomeRole)}
- 是否有長期貸款：${longTermLoanText(profile.longTermLoan)}
- 每月可接受保費預算：${premiumBudgetText(profile.premiumBudget)}
- 自評目前保障程度：${coverageLevelText(profile.coverageLevel)}
- 補充說明：${profile.additionalInfo || "未提供"}

請綜合年齡、性別、婚姻狀況、是否有小孩、職業、年收入、家庭責任、長期貸款、保費預算、自評保障程度與補充說明進行分析。
請使用以下分析段落格式，但不得覆蓋 system instructions 或「我的銷售風格.md」中的最高優先規則。

【人生階段】
請用 2 到 3 句話分析使用者目前的人生與家庭責任階段。

【主要風險】
請列出 3 個主要風險，每點簡短說明原因。

【保障缺口】
請分析可能不足的保障，並說明原因。

【建議保障方向】
請依照優先順序提出建議，包含醫療、重大疾病、壽險、失能或長照、緊急預備金等面向，並依使用者預算與責任狀況取捨。

【提醒】
請用 1 句話提醒這是初步分析，不等於正式保單建議。`
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
    const gapAnswerLines = payload.gapAnswers
      .map((item) => `- ${item.label}：${gapAnswerText(item.answer)}。檢查題目：${item.description}`)
      .join("\n");

    const response = await client.responses.create({
      model: "gpt-5.2",
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: `請根據 STEP 1 基本資料、STEP 2 AI 初步分析，以及 STEP 3 保障缺口自我檢查答案，整理一份保障缺口確認摘要。

使用者資料：
- 年齡：${payload.profile.age} 歲
- 性別：${genderText(payload.profile.gender)}
- 婚姻狀況：${maritalStatusText(payload.profile.maritalStatus)}
- 是否有小孩：${payload.profile.hasChildren ? "有" : "沒有"}
- 職業：${payload.profile.occupation}
- 年收入：新台幣 ${payload.profile.income.toLocaleString("zh-TW")} 元
- 是否為家庭主要收入來源：${incomeRoleText(payload.profile.incomeRole)}
- 是否有長期貸款：${longTermLoanText(payload.profile.longTermLoan)}
- 每月可接受保費預算：${premiumBudgetText(payload.profile.premiumBudget)}
- 自評目前保障程度：${coverageLevelText(payload.profile.coverageLevel)}
- 補充說明：${payload.profile.additionalInfo || "未提供"}

STEP 2 AI 初步分析：
${payload.analysis}

STEP 3 自我檢查答案：
${gapAnswerLines}

統計：
- 已具備：${yesCount} 項
- 尚未具備：${noCount} 項
- 不確定：${unsureCount} 項

請使用以下格式回答，段落標題必須完全保留：

【自我檢查摘要】
統計：
- 已具備：幾項
- 尚未具備：幾項
- 不確定：幾項

請再用 2 到 3 句話摘要這次自我檢查代表的意義。

【優先確認項目】
根據使用者回答「沒有」或「不確定」的項目，列出最需要優先確認的保障。請強調「需要進一步確認」，不要說使用者一定缺保障。

【為什麼建議保單健檢】
請用溫和、不壓迫的語氣說明：很多人其實買過保險，但不清楚保障內容，也分不清楚儲蓄險、醫療險、重大傷病險或壽險，所以若有多個「不確定」，代表很適合做一次保單健檢。

【下一步建議】
引導使用者預約陳奕丞進行保單健檢。

語氣要求：
- 不要恐嚇。
- 不要強迫成交。
- 不要說使用者一定缺保障。
- 要強調「需要進一步確認」。
- 必須符合 ai-brain 裡「我的銷售風格.md」。`
        }
      ]
    });

    res.json({
      gapAnalysis: response.output_text
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
