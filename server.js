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

function extractAiSummary(text) {
  const match = String(text || "").match(
    /(?:^|\n)\s*【?\s*AI\s*總結\s*】?\s*\n([\s\S]*?)(?=\n\s*【?\s*(為什麼建議保單健檢|下一步建議)\s*】?\s*\n|$)/
  );

  return match ? match[1].trim() : "";
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
          content: `請根據使用者資料，提供初步保障分析。

使用者資料：
${analyzeProfileLines.join("\n")}

請固定使用以下格式，標題必須完全相同，不能新增、刪除或改名：
第一個區塊必須是【人生階段】。
不得省略任何一個區塊。
即使資料不足，也必須輸出【人生階段】，並根據目前已有資料做初步判斷。

【人生階段】
根據使用者提供的資料，做初步人生階段判斷。
請寫 2～3 句，語氣自然，不要太長，不要太壓迫。
要根據使用者的年齡、婚姻狀況、是否有小孩、職業、年收入、家庭責任、是否為家庭主要收入來源、是否有長期貸款、目前每月已繳保費，以及補充說明去判斷。
如果進階資料沒有填，就不要硬推論。
語氣可以接近：「35 歲、已婚且有小孩，代表目前家庭責任正在增加。若您同時是家庭主要收入來源，收入中斷與醫療支出對家庭現金流的影響會比較明顯。這個階段可以先確認醫療、收入中斷與家庭責任相關保障是否清楚。」

【主要風險】
列出 2～3 點。
每點 1～2 句。
要結合基本資料與補充說明判斷，不要太罐頭。
可從收入中斷風險、醫療支出風險、家庭責任風險、長照/失能風險、職業或運動相關風險等方向，依照使用者狀況挑最適合的 3 點。

【優先確認的保障】
列出 2～3 點。
語氣要是「優先確認」，不要直接說使用者一定缺保障。
每點 1～2 句。
可以提到醫療、重大疾病、壽險/家庭責任、失能/長照、緊急預備金、公司團保或既有保單整理等方向，但請依使用者資料與補充說明取捨。

【重要提醒】
用 1～2 句話提醒：這只是初步分析，不代表正式投保建議，實際保障內容仍需依保單條款、額度與健康告知確認。

硬性規則：
- 只能使用上述四個標題。
- 第一個區塊必須是【人生階段】。
- 不得省略任何一個區塊。
- 不得新增其他標題或改用其他標題。
- 不得引用使用者資料清單以外的欄位。
- 進階資料為選填。若使用者未填寫進階資料，請不要主動提到未填寫、未提供、資料不足或建議補上；只根據已提供的資料做初步整理。
- 若使用者資料清單沒有出現是否為家庭主要收入來源、是否有長期貸款、目前每月已繳保費或補充說明，就不要提到尚未填寫、未提供、建議補上、資料不足、主要收入來源不明、貸款不明或每月保費不明。
- 只有使用者有填進階資料時，才可以把那些資料納入分析。
- 補充說明是使用者主動提供的背景資料，優先級高於一般推測。只要補充說明有內容，請務必閱讀並納入分析，不可以忽略。
- 補充說明可能包含家庭狀況、收入穩定性、公司團保、既有保單、貸款壓力、固定支出、未來規劃、退休金或其他現金流、照顧責任、健康狀況、預算壓力，或其他使用者認為重要的資訊。
- 如果補充說明有內容，不需要逐字重複，也不要生硬地一直寫「根據您的補充說明」，但至少要在【人生階段】、【主要風險】或【優先確認的保障】其中一個區塊自然反映其意思。
- 如果補充說明與基本資料有關聯，請整合判斷；如果補充說明與基本資料看起來有衝突，不要直接否定使用者，請溫和提醒後續可再確認。
- 如果補充說明是空白，不要提到「未填寫」、「未提供」、「資料不足」或「建議補上」。
- 不得推論使用者曾做過保障程度評估。
- 不得使用 Markdown 粗體符號。
- 不得輸出 ** 符號。
- 全文一律使用「您」。
- 不要使用「你」。
- 若提到「身故」，請寫成「萬一發生身故」，不要寫成「若發生身故」。
- 類似風險請使用柔和語氣，例如「萬一發生身故或長期失能」、「萬一收入中斷」、「萬一發生重大狀況」。
- 回覆要精簡，不要像長篇報告。
- 每個區塊最多 3 點。
- 每點最多 1～2 句。
- 不要長篇報告。
- 不要一直重複「根據您的資料」。
- 不要恐嚇。
- 不要強迫成交。
- 不要提到「自評不確定」。
- 不要提到「目前保障程度」。
- 不要提到 coverageLevel。
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
          content: `請根據 STEP 1 基本資料、STEP 2 AI 初步分析，以及 STEP 3 保障缺口自我檢查答案，整理一份保障缺口確認摘要。

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

請使用以下格式回答，段落標題必須完全保留：

【自我檢查摘要】
統計：
- 已具備：${yesCount} 項
- 尚未具備：${noCount} 項
- 不確定：${unsureCount} 項

接著加入一段肯定語氣，請依照已具備數量調整：
- 如果已具備 0 項，請使用類似語氣：「您願意先檢查這些保障，其實已經是很好的開始。這次結果不代表您一定沒有保險，而是代表目前幾個重要方向還不夠清楚，很適合先做一次整理。」
- 如果已具備 1 項，請使用類似語氣：「您已經有注意到其中一項保障，這是好的開始。接下來可以先把尚未具備或不確定的部分整理清楚，避免真正需要時才發現保障方向不完整。」
- 如果已具備 2 項，請使用類似語氣：「您目前已經有一半的保障方向被照顧到，代表您不是完全沒有規劃。接下來重點不是全部重買，而是確認剩下幾項風險是否也有基本安排。」
- 如果已具備 3 項，請使用類似語氣：「您目前大多數保障方向都有注意到，這是很不錯的基礎。接下來比較重要的是確認剩下那一項，以及已具備項目的額度、條款與給付方式是否真的符合現在的狀況。」
- 如果已具備 4 項，請使用類似語氣：「太好了！您擁有很高的風險管理意識。」
- 這段只出現在【自我檢查摘要】統計後面。
- 不要讓 0 項已具備聽起來像責備。
- 不要讓 4 項已具備聽起來像還是有很多問題。
- 肯定語氣請低壓力、自然、好懂，不要寫太長。

【優先確認項目】
請依照使用者回答整理：
- 原則上只列使用者回答「沒有」或「不確定」的項目，列為優先確認。
- 使用者回答「有」的項目，不要列進「優先確認項目」。
- 如果有些回答「有」的項目仍然值得日後確認，請不要放進優先確認項目，而是在該區塊最後用一小段補充：「其他您已具備的保障，之後可以再確認額度、條款與給付方式是否符合目前需求，不需要一開始全部重新檢查。」
- 如果四項都回答「有」，請不要硬列缺口，優先確認項目請改成「建議後續確認方向」，並用肯定語氣寫：「下一步不是重新購買，而是確認額度、條款與給付方式是否符合目前需求。」
- 每個項目最多 2 句。
- 第一句說明為什麼這個項目值得確認。
- 第二句說明可以確認什麼，例如保障額度、給付方式、是否涵蓋常見支出、是否符合目前責任。
- 不要說使用者一定缺保障，不要恐嚇，不要太像資深財務規劃師。
- 避免出現「您回答有，但仍然要優先確認」、「即使您都有，也可能不足」、「代表您缺保障」這類語氣。
- 語氣要自然、低壓力、好懂，並一律使用「您」。
- 可參考以下語氣，但請依使用者回答挑選相關項目：
  - 醫療保障：這一項主要是確認住院、手術或自費醫療發生時，是否有保險可以協助分擔支出。可以再看一下目前額度、給付方式，以及是否涵蓋常見自費項目。
  - 重大疾病保障：重大疾病通常會影響治療費、休養期收入與照顧支出，因此值得確認是否有一筆一次性給付可以支應。可以再看保額是否足夠，以及理賠條件是否清楚。
  - 家庭責任保障：家庭責任保障不一定要追求高額度，但可以確認目前額度是否符合您的家庭責任與保費負擔。
  - 長照/失能保障：這一項常被忽略，但真正影響的是長期現金流。可以確認如果未來需要長期照顧或無法工作，目前保障能支撐多久、每月大約能提供多少。

【AI 總結】
請寫 3～5 句，建議 4 句左右。
請綜合 STEP 1 基本資料、使用者有填的進階選項、補充說明、STEP 2 初步分析與 STEP 3 自我檢查答案，像年輕保險顧問一樣做一段白話整理。
不要只是重複統計數字，也不要只是說「您有幾項有、幾項沒有」。
AI 總結可以有風險意識，但請用「保障檢視」語氣，不要像在預測使用者未來一定會受傷、生病、失能或發生身故。
請避免「很容易發生」、「高機率發生」、「一定會面臨」、「勢必造成」、「立刻影響」、「風險很高」、「很危險」這類強烈預測或恐嚇語氣。
不要寫「您很可能會受傷」、「您未來容易生病」、「您發生意外的機率較高」、「您身故後家人會怎樣」、「一旦您失能，家裡會立刻陷入壓力」這類句子。
請改用「可以一併確認」、「可以先檢視」、「建議先整理清楚」、「後續可以確認」、「若未來遇到相關狀況，是否有基本協助」、「主要是確認現有保障是否能對應目前責任」這類低壓力語氣。
如果提到意外保障，請用「日常生活中若有短期醫療支出，是否有基本協助」這種檢視語氣，不要暗示使用者很可能發生意外。
如果提到收入責任，請用「若短期收入受影響時，家庭固定支出是否有基本緩衝」這種檢視語氣，不要暗示家庭會立刻陷入壓力。
如果提到長照/失能，請用「長照/失能屬於比較容易被忽略的長期保障方向，可以先確認目前是否已有相關安排」這種語氣，不要誇大長期現金流壓力。
如果提到家庭責任或身故，請用「若未來遇到重大狀況，家人的生活費、房貸或教育費是否有基本緩衝」這種語氣，不要描述身故後家人會遭遇的負面情境。
寫作邏輯請依序做到：先肯定使用者已經注意到的保障方向，再整理家庭責任、收入來源或補充資料中值得關注的地方，再用「如果未來遇到相關狀況，保障能不能協助」的語氣提醒，最後收在「先整理現有保障、額度、條款與給付方式，再決定優先順序」。
如果補充說明有內容，請自然納入 AI 總結；如果補充說明空白，不要提到未填寫、未提供或資料不足。
如果進階選項空白，請不要硬提未填進階資料，也不要推論主要收入來源、貸款或保費狀況不明。
如果自我檢查有任何一項回答「有」，請先肯定使用者已經注意到的保障。
如果四項都回答「有」，請給予最高肯定，並溫和提醒下一步重點是確認額度、條款、理賠條件與給付方式是否符合目前責任。
如果有回答「沒有」或「不確定」，請溫和提醒這些項目值得優先確認，不要說使用者一定缺保障。
可以引導「先整理清楚」，不要直接暗示一定要買保險或立刻補齊。
不要輸出 Markdown 符號。

【為什麼建議保單健檢】
請短一點，用自然語氣寫：
很多人其實有買保險，但不一定清楚每張保單是保什麼、保多少、什麼情況會賠。保單健檢不是否定原本的保險，而是先把現有保障整理清楚，避免重複花錢，也確認重要風險有沒有被照顧到。

【下一步建議】
請用年輕保險顧問、低壓力、自然好懂的語氣寫：
「如果您願意，可以直接預約陳奕丞進行實體保單健檢。
如果暫時找不到保單也沒關係，奕丞可以協助您一步一步整理，先把目前有哪些保障、哪些地方不確定、哪些項目需要再確認看清楚。」


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
- 不要提到 coverageLevel、自評目前保障程度或目前保障程度。
- 必須符合 ai-brain 裡「我的銷售風格.md」。`
        }
      ]
    });

    res.json({
      gapAnalysis: response.output_text,
      aiSummary: extractAiSummary(response.output_text)
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
