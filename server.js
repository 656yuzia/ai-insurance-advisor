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

  if (profile.incomeRole && !["primary", "not_primary", "shared"].includes(profile.incomeRole)) {
    return "請選擇有效的家庭收入責任。";
  }

  if (profile.longTermLoan && !["none", "mortgage", "car_loan", "mortgage_and_car_loan", "other"].includes(profile.longTermLoan)) {
    return "請選擇有效的長期貸款狀況。";
  }

  if (
    profile.currentMonthlyPremium &&
    !["under_2000", "2000_4000", "4000_6000", "over_6000"].includes(profile.currentMonthlyPremium)
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
    married: "已婚",
    other: "其他"
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
          content: `請根據使用者資料，提供初步保障分析。

使用者資料：
- 年齡：${profile.age} 歲
- 性別：${genderText(profile.gender)}
- 婚姻狀況：${maritalStatusText(profile.maritalStatus)}
- 是否有小孩：${profile.hasChildren ? "有" : "沒有"}
- 職業：${profile.occupation}
- 年收入：新台幣 ${profile.income.toLocaleString("zh-TW")} 元
- 是否為家庭主要收入來源：${incomeRoleText(profile.incomeRole)}
- 是否有長期貸款：${longTermLoanText(profile.longTermLoan)}
- 目前每月已繳保費：${currentMonthlyPremiumText(profile.currentMonthlyPremium)}
- 補充說明：${profile.additionalInfo || "未提供"}

請固定使用以下格式，標題必須完全相同，不能新增、刪除或改名：

【目前狀況】
用 2～3 句話說明使用者目前的家庭責任、收入責任與可能面臨的壓力。

【主要風險】
列出 3 點。
每點 1～2 句即可。

【優先確認的保障】
列出 3 點。
請用「需要確認」的語氣，不要直接說使用者一定缺保障。

【重要提醒】
用 1～2 句話提醒：這只是初步分析，不代表正式投保建議，實際保障內容仍需依保單條款、額度與健康告知確認。

硬性規則：
- 只能使用上述四個標題。
- 不得新增其他標題或改用其他標題。
- 不得引用使用者資料清單以外的欄位。
- 不得推論使用者曾做過保障程度評估。
- 不得使用 Markdown 粗體符號。
- 不得輸出星號組合。
- 全文一律使用「您」。
- 回覆要精簡，不要像長篇報告。
- 每個區塊最多 3 點。
- 每點最多 1～2 句。
- 不要長篇報告。
- 不要一直重複「根據您的資料」。
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
- 目前每月已繳保費：${currentMonthlyPremiumText(payload.profile.currentMonthlyPremium)}
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
- 已具備：${yesCount} 項
- 尚未具備：${noCount} 項
- 不確定：${unsureCount} 項

接著加入一段肯定語氣，請依照已具備數量調整：
- 如果已具備 1～3 項，請表達：「您已經有注意到部分保障，這是很好的開始。」
- 如果已具備 4 項，請表達：「您目前四個方向都有初步準備，這是很完整的起點。」
- 如果已具備 0 項，請溫和說明這次自我檢查可以先幫助您看見需要確認的方向。
- 肯定語氣請短一點，不要寫太長。

【優先確認項目】
請依照使用者回答整理：
- 有回答「沒有」或「不確定」的項目，列為優先確認。
- 如果使用者回答「有」，請先肯定，再提醒確認額度與條款即可。
- 每個項目最多 2 句。
- 第一句說明為什麼這個項目值得確認。
- 第二句說明可以確認什麼，例如保障額度、給付方式、是否涵蓋常見支出、是否符合目前責任。
- 不要說使用者一定缺保障，不要恐嚇，不要太像資深財務規劃師。
- 語氣要自然、低壓力、好懂，並一律使用「您」。
- 可參考以下語氣，但請依使用者回答挑選相關項目：
  - 醫療保障：這一項主要是確認住院、手術或自費醫療發生時，是否有保險可以協助分擔支出。可以再看一下目前額度、給付方式，以及是否涵蓋常見自費項目。
  - 重大疾病保障：重大疾病通常會影響治療費、休養期收入與照顧支出，因此值得確認是否有一筆一次性給付可以支應。可以再看保額是否足夠，以及理賠條件是否清楚。
  - 家庭責任保障：如果目前有配偶、小孩、房貸或主要收入責任，這一塊會影響家人生活費是否有緩衝。可以確認壽險或相關保障額度是否跟目前責任相符。
  - 長照/失能保障：這一項常被忽略，但真正影響的是長期現金流。可以確認如果未來需要長期照顧或無法工作，目前保障能支撐多久、每月大約能提供多少。

【為什麼建議保單健檢】
請短一點，用自然語氣寫：
很多人其實有買保險，但不一定清楚每張保單是保什麼、保多少、什麼情況會賠。保單健檢不是否定原本的保險，而是先把現有保障整理清楚，避免重複花錢，也確認重要風險有沒有被照顧到。

【下一步建議】
請用年輕保險顧問、低壓力、自然好懂的語氣寫：
「如果您願意，可以直接預約陳奕丞保單健檢。
如果暫時找不到保單也沒關係，奕丞可以協助您一步一步整理，先把目前有哪些保障、哪些地方不確定、哪些項目需要再確認看清楚。」
請保留這句提醒：「以上內容為初步整理，不代表正式投保建議；實際仍需依保單條款、額度與健康告知確認。」

語氣要求：
- 一律使用「您」。
- 可以稱呼自己為「奕丞」。
- 低壓力、自然、好懂。
- 先肯定，再提醒，再引導。
- 不要否定使用者回答「有」的項目。
- 不要說使用者一定缺保障。
- 不要恐嚇。
- 不要強迫成交。
- 不要太像推銷。
- 不要太像資深專家、講師或大型財務規劃。
- 不要寫得太長。
- 不要使用以下語氣：聊聊您的家庭責任、完整財務規劃、家庭風險配置、太像資深專家或講師、太像推銷、太恐嚇、太長。
- 不要要求使用者現在上傳或提供保單。
- 不要要求使用者準備保單年度摘要。
- 不要要求使用者拍照保障內容頁。
- 不要讓使用者覺得很麻煩。
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
