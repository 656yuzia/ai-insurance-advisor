const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("請先設定環境變數 OPENAI_API_KEY");
  }

  const response = await client.responses.create({
    model: "gpt-5.2",
    input: "請用繁體中文介紹自己是一位 AI 保障顧問"
  });

  console.log(response.output_text);
}

main().catch((error) => {
  console.error("執行失敗：", error.message);
  process.exit(1);
});
