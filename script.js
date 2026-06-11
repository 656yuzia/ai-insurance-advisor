const advisorForm = document.querySelector("#advisorForm");
const chatWindow = document.querySelector("#chatWindow");
const emptyState = document.querySelector("#emptyState");

let latestProfile = null;

function getProfile() {
  return {
    age: Number(document.querySelector("#age").value),
    income: Number(document.querySelector("#income").value),
    maritalStatus: document.querySelector("#maritalStatus").value,
    hasChildren: document.querySelector("#hasChildren").checked
  };
}

function addMessage(text, type) {
  const message = document.createElement("div");
  const content = document.createElement("div");
  message.className = `message ${type}-message`;
  content.className = "message-content";
  content.textContent = text;

  if (type === "ai") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = "AI";
    message.appendChild(avatar);
  }

  message.appendChild(content);
  chatWindow.appendChild(message);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function setLoading(isLoading) {
  const submitButton = advisorForm.querySelector("button[type='submit']");
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? "分析中..." : "開始分析";
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

advisorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  latestProfile = getProfile();

  if (emptyState) {
    emptyState.remove();
  }

  chatWindow.textContent = "";
  addMessage("正在整理你的基本資料，請稍候...", "ai");
  setLoading(true);

  try {
    const analysis = await requestAnalysis(latestProfile);
    chatWindow.textContent = "";
    addMessage(analysis, "ai");
  } catch (error) {
    chatWindow.textContent = "";
    addMessage(error.message, "ai");
  } finally {
    setLoading(false);
  }
});
