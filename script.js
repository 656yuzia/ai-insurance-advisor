// TODO: 改成陳奕丞的正式連結
const contactLinks = {
  line: "https://line.me/ti/p/-IWbb93IQv",
  instagram: "https://www.instagram.com/yuzia_656?igsh=MW9yNWtyNTdkb3l3bg%3D%3D&utm_source=qr",
  booking: "https://line.me/ti/p/-IWbb93IQv"
};

const advisorForm = document.querySelector("#advisorForm");
const chatWindow = document.querySelector("#chatWindow");
const emptyState = document.querySelector("#emptyState");
const gapCheckSection = document.querySelector("#gapCheckSection");
const gapCheckForm = document.querySelector("#gapCheckForm");
const gapResultSection = document.querySelector("#gapResultSection");
const gapResultWindow = document.querySelector("#gapResultWindow");
const summarizeGapsButton = document.querySelector("#summarizeGapsButton");
const bookingSection = document.querySelector("#bookingSection");
const faqSection = document.querySelector("#faqSection");
const mainFlow = document.querySelector("#mainFlow");
const revealFlowButton = document.querySelector("#revealFlowButton");

let latestProfile = null;
let latestAnalysis = "";

function revealMainFlow() {
  if (mainFlow) {
    mainFlow.hidden = false;
  }

  advisorForm.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

if (revealFlowButton) {
  revealFlowButton.addEventListener("click", revealMainFlow);
}

const gapCheckItems = [
  {
    key: "medical",
    label: "醫療保障",
    description: "如果住院、手術或自費醫療費用發生時，你是否有保險可以協助負擔？"
  },
  {
    key: "criticalIllness",
    label: "重大疾病保障",
    description: "如果罹患癌症、重大傷病或需要長時間治療，你是否有一次性給付的保障可以支應收入中斷與照護支出？"
  },
  {
    key: "familyResponsibility",
    label: "家庭責任保障",
    description: "如果你因疾病或意外無法繼續提供收入，家人是否仍有足夠的生活費、房貸、教育費或其他必要支出來源？"
  },
  {
    key: "longTermCare",
    label: "長照／失能保障",
    description: "如果未來因疾病、意外或老化需要長期照顧，是否有相關保障可以減輕自己與家人的照顧壓力？"
  }
];

function applyContactLinks() {
  Object.entries(contactLinks).forEach(([key, url]) => {
    const link = document.querySelector(`[data-contact-link="${key}"]`);

    if (!link) {
      return;
    }

    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
}

function getProfile() {
  const currentMonthlyPremium = document.querySelector("#premiumBudget").value;

  return {
    age: Number(document.querySelector("#age").value),
    gender: "prefer_not_to_say",
    maritalStatus: document.querySelector("#maritalStatus").value,
    hasChildren: document.querySelector("#hasChildren").value === "yes",
    occupation: document.querySelector("#occupation").value.trim(),
    income: Number(document.querySelector("#income").value),
    incomeRole: document.querySelector("#incomeRole").value,
    longTermLoan: document.querySelector("#longTermLoan").value,
    currentMonthlyPremium,
    premiumBudget: currentMonthlyPremium,
    additionalInfo: document.querySelector("#additionalInfo").value.trim()
  };
}

applyContactLinks();

function normalizeSectionTitle(title) {
  const normalizedTitle = title.replace(/[【】\[\]]/g, "").replace(/\s+/g, " ").trim();
  return /^AI\s*總結$/.test(normalizedTitle) ? "AI 總結" : normalizedTitle;
}

function normalizeAnalysisHeadings(text) {
  return String(text)
    .replace(/【\s*(人生階段|主要風險|優先確認的保障|重要提醒)\s*】\s*/g, "\n【$1】\n")
    .trim();
}

function parseAnalysisSections(text) {
  const sectionNames = ["人生階段", "主要風險", "優先確認的保障", "重要提醒"];
  const normalizedText = normalizeAnalysisHeadings(text);
  const pattern = /^\s*【?(人生階段|主要風險|優先確認的保障|重要提醒)】?\s*$/gm;
  const matches = Array.from(normalizedText.matchAll(pattern));

  if (matches.length === 0) {
    console.warn("STEP 2 缺少人生階段區塊");
    return [{ title: "AI 初步保障分析", content: text }];
  }

  const sections = matches.map((match, index) => {
    const title = normalizeSectionTitle(match[1]);
    const start = match.index + match[0].length;
    const end = matches[index + 1] ? matches[index + 1].index : normalizedText.length;
    const content = normalizedText.slice(start, end).trim();

    return {
      title,
      content: content || "目前沒有提供此段內容。"
    };
  }).sort((a, b) => sectionNames.indexOf(a.title) - sectionNames.indexOf(b.title));

  if (!sections.some((section) => section.title === "人生階段")) {
    console.warn("STEP 2 缺少人生階段區塊");
  }

  return sections;
}

function parseGapSections(text) {
  const sectionNames = ["自我檢查摘要", "優先確認項目", "AI 總結", "為什麼建議保單健檢", "下一步建議"];
  const pattern = /(?:^|\n)\s*【?(自我檢查摘要|優先確認項目|AI\s*總結|為什麼建議保單健檢|下一步建議)】?\s*\n/g;
  const matches = Array.from(text.matchAll(pattern));

  if (matches.length === 0) {
    return [{ title: "AI 整理缺口結果", content: text }];
  }

  return matches.map((match, index) => {
    const title = normalizeSectionTitle(match[1]);
    const start = match.index + match[0].length;
    const end = matches[index + 1] ? matches[index + 1].index : text.length;
    const content = text.slice(start, end).trim();

    return {
      title,
      content: content || "目前沒有提供此段內容。"
    };
  }).sort((a, b) => sectionNames.indexOf(a.title) - sectionNames.indexOf(b.title));
}

function addAiSummarySection(sections, aiSummary) {
  const summary = String(aiSummary || "").trim();

  if (!summary || sections.some((section) => section.title === "AI 總結")) {
    return sections;
  }

  const nextSections = [...sections];
  const priorityIndex = nextSections.findIndex((section) => section.title === "優先確認項目");
  const insertIndex = priorityIndex >= 0 ? priorityIndex + 1 : nextSections.findIndex((section) => section.title === "為什麼建議保單健檢");

  nextSections.splice(insertIndex >= 0 ? insertIndex : nextSections.length, 0, {
    title: "AI 總結",
    content: summary
  });

  return nextSections;
}

function isAnalysisListLine(line) {
  return /^(\d+[.．、]|[-•])\s+/.test(line.trim());
}

function appendAnalysisBlock(container, lines, className) {
  if (lines.length === 0) {
    return;
  }

  const block = document.createElement("div");
  block.className = className;
  block.textContent = lines.join("\n");
  container.appendChild(block);
}

function renderAnalysisContent(text) {
  const container = document.createElement("div");
  container.className = "analysis-content";

  const lines = String(text).split(/\r?\n/);
  let currentLines = [];
  let currentType = "paragraph";

  lines.forEach((line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      appendAnalysisBlock(container, currentLines, currentType === "list" ? "analysis-list-item" : "analysis-paragraph");
      currentLines = [];
      currentType = "paragraph";
      return;
    }

    if (isAnalysisListLine(trimmedLine)) {
      appendAnalysisBlock(container, currentLines, currentType === "list" ? "analysis-list-item" : "analysis-paragraph");
      currentLines = [trimmedLine];
      currentType = "list";
      return;
    }

    currentLines.push(trimmedLine);
  });

  appendAnalysisBlock(container, currentLines, currentType === "list" ? "analysis-list-item" : "analysis-paragraph");

  return container;
}

function renderAnalysis(text) {
  const grid = document.createElement("div");
  grid.className = "analysis-grid";

  parseAnalysisSections(text).forEach((section) => {
    const card = document.createElement("article");
    const title = document.createElement("h3");
    const content = renderAnalysisContent(section.content);

    card.className = "analysis-section";
    title.textContent = section.title;

    card.appendChild(title);
    card.appendChild(content);
    grid.appendChild(card);
  });

  chatWindow.appendChild(grid);
}

function renderGapResult(text, aiSummary = "") {
  const grid = document.createElement("div");
  grid.className = "analysis-grid";

  addAiSummarySection(parseGapSections(text), aiSummary).forEach((section) => {
    const card = document.createElement("article");
    const title = document.createElement("h3");
    const content = renderAnalysisContent(section.content);

    card.className = "analysis-section";
    title.textContent = section.title;

    card.appendChild(title);
    card.appendChild(content);
    grid.appendChild(card);
  });

  gapResultWindow.appendChild(grid);
}

function renderStatus(text) {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  const content = document.createElement("p");
  const dots = document.createElement("span");

  card.className = "analysis-section is-loading";
  title.textContent = "AI 正在分析";
  content.textContent = text;
  dots.className = "loading-dots";
  dots.setAttribute("aria-hidden", "true");
  content.appendChild(dots);

  card.appendChild(title);
  card.appendChild(content);
  chatWindow.appendChild(card);
}

function renderGapStatus(text) {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  const content = document.createElement("p");
  const dots = document.createElement("span");

  card.className = "analysis-section is-loading";
  title.textContent = "AI 正在整理";
  content.textContent = text;
  dots.className = "loading-dots";
  dots.setAttribute("aria-hidden", "true");
  content.appendChild(dots);

  card.appendChild(title);
  card.appendChild(content);
  gapResultWindow.appendChild(card);
}

function renderError(text) {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  const content = document.createElement("p");

  card.className = "analysis-section";
  title.textContent = "分析暫時失敗";
  content.textContent = text;

  card.appendChild(title);
  card.appendChild(content);
  chatWindow.appendChild(card);
}

function renderGapError(text) {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  const content = document.createElement("p");

  card.className = "analysis-section";
  title.textContent = "缺口整理暫時失敗";
  content.textContent = text;

  card.appendChild(title);
  card.appendChild(content);
  gapResultWindow.appendChild(card);
}

function setLoading(isLoading) {
  const submitButton = advisorForm.querySelector("button[type='submit']");
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "分析中..." : "開始分析";
}

function setGapLoading(isLoading) {
  summarizeGapsButton.disabled = isLoading || !isGapCheckComplete();
  summarizeGapsButton.textContent = isLoading ? "整理中..." : "整理缺口結果";
}

function resetGapFlow() {
  latestAnalysis = "";
  gapCheckForm.reset();
  gapCheckSection.hidden = true;
  gapResultSection.hidden = true;
  bookingSection.hidden = true;
  faqSection.hidden = true;
  gapResultWindow.textContent = "";
  summarizeGapsButton.disabled = true;
}

function showGapCheck() {
  gapCheckSection.hidden = false;
  gapResultSection.hidden = false;
  bookingSection.hidden = true;
  faqSection.hidden = true;
  gapResultWindow.textContent = "";
  summarizeGapsButton.disabled = !isGapCheckComplete();
}

function isGapCheckComplete() {
  return gapCheckItems.every((item) => {
    return Boolean(gapCheckForm.querySelector(`input[name="${item.key}"]:checked`));
  });
}

function getGapAnswers() {
  return gapCheckItems.map((item) => {
    const selectedInput = gapCheckForm.querySelector(`input[name="${item.key}"]:checked`);

    return {
      key: item.key,
      label: item.label,
      description: item.description,
      answer: selectedInput ? selectedInput.value : ""
    };
  });
}

async function requestAnalysis(profile) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(profile)
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "AI 分析失敗，請稍後再試。");
  }

  return result.analysis;
}

async function requestGapSummary() {
  const response = await fetch("/api/check-gaps", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      profile: latestProfile,
      analysis: latestAnalysis,
      gapAnswers: getGapAnswers()
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "缺口整理失敗，請稍後再試。");
  }

  return {
    gapAnalysis: result.gapAnalysis || "",
    aiSummary: result.aiSummary || ""
  };
}

advisorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  latestProfile = getProfile();
  resetGapFlow();

  if (emptyState) {
    emptyState.remove();
  }

  chatWindow.textContent = "";
  renderStatus("正在整理您的基本資料，請稍候（大約 10 秒）");
  setLoading(true);

  try {
    const analysis = await requestAnalysis(latestProfile);
    latestAnalysis = analysis;
    chatWindow.textContent = "";
    renderAnalysis(analysis);
    showGapCheck();
  } catch (error) {
    chatWindow.textContent = "";
    renderError(error.message);
  } finally {
    setLoading(false);
  }
});

gapCheckForm.addEventListener("change", () => {
  summarizeGapsButton.disabled = !isGapCheckComplete();
  bookingSection.hidden = true;
  faqSection.hidden = true;
  gapResultWindow.textContent = "";
});

summarizeGapsButton.addEventListener("click", async () => {
  if (!isGapCheckComplete()) {
    gapCheckForm.reportValidity();
    return;
  }

  gapResultWindow.textContent = "";
  renderGapStatus("正在依照您的自我檢查結果，整理需要優先確認的保障（大約 10 秒）");
  setGapLoading(true);
  bookingSection.hidden = true;
  faqSection.hidden = true;

  try {
    const summary = await requestGapSummary();
    gapResultWindow.textContent = "";
    renderGapResult(summary.gapAnalysis, summary.aiSummary);
    bookingSection.hidden = false;
    faqSection.hidden = false;
  } catch (error) {
    gapResultWindow.textContent = "";
    renderGapError(error.message);
  } finally {
    setGapLoading(false);
  }
});
