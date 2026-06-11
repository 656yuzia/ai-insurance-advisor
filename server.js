const express = require("express");
const OpenAI = require("openai");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

function normalizeProfile(profile) {
  return {
    age: Number(profile.age),
    income: Number(profile.income),
    maritalStatus: String(profile.maritalStatus || ""),
    hasChildren: Boolean(profile.hasChildren)
  };
}

function validateProfile(profile) {
  if (!Number.isFinite(profile.age) || profile.age < 18 || profile.age > 90) {
    return "請輸入 18 到 90 歲之間的年齡。";
  }

  if (!Number.isFinite(profile.income) || profile.income < 0) {
    return "請輸入有效的年收入。";
  }

  if (!["single", "married", "other"].includes(profile.maritalStatus)) {
    return "請選擇有效的婚姻狀況。";
  }

  return null;
}

function maritalStatusText(value) {
  if (value === "single") {
    return "未婚";
  }

  if (value === "married") {
    return "已婚";
  }

  return "其他";
}

app.post("/api/analyze", async (req, res) => {
  const profile = normalizeProfile(req.body);
  const validationError = validateProfile(profile);

  if (validationError) {
    return res.status(400).json({ error: validationError });
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
      input: [
        {
          role: "system",
          content:
            "你是一位熟悉台灣保險市場的保險顧問。請用繁體中文回答，語氣專業、清楚、溫和。不要推薦特定保險公司或商品名稱。這不是正式投保建議，需提醒使用者仍應與合格保險顧問確認。"
        },
        {
          role: "user",
          content: `請根據以下使用者資料，提供初步保障分析。

使用者資料：
- 年齡：${profile.age} 歲
- 年收入：新台幣 ${profile.income.toLocaleString("zh-TW")} 元
- 婚姻狀況：${maritalStatusText(profile.maritalStatus)}
- 是否有小孩：${profile.hasChildren ? "有" : "沒有"}

請固定使用以下格式：

人生階段
請用 2 到 3 句話分析使用者目前的人生與家庭責任階段。

主要風險
請列出 3 個主要風險，每點簡短說明原因。

建議保障方向
請列出 3 到 5 個保障方向，包含醫療、重大疾病、壽險、失能或長照、緊急預備金等面向，依使用者情況取捨。

提醒
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

app.listen(port, () => {
  console.log(`AI保障顧問已啟動：http://localhost:${port}`);
});
