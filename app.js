/* ══════════════════════════════════════════════
   DSATM VOTING SYSTEM — app.js
   Full client-side equivalent of the Python system
══════════════════════════════════════════════ */

"use strict";

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
const STATE = {
  electionName:     "Class Representative Election",
  electionYear:     "2026",
  electionLocation: "DSATM",

  ADMIN_PASSWORD: "team16",

  VOTING_START: 9,   // 09:00
  VOTING_END:   23,  // 23:00

  votingOpen: true,
  adminLoggedIn: false,

  candidates: {
    "Pranathi M S":  0,
    "Mehek":         0,
    "Theju":         0,
    "Rahul S Baisani": 0,
    "Swathi":        0,
    "Suchitra S S":  0,
    "Aishwarya":     0,
    "Chaitanya":     0
  },

  voters:     {},   // { voterId: { name, age, gender } }
  voterNames: new Set(), // lowercase names
  logs:       []
};

// Persist to localStorage
function saveState() {
  try {
    const data = {
      candidates:  STATE.candidates,
      voters:      STATE.voters,
      voterNames:  [...STATE.voterNames],
      logs:        STATE.logs,
      votingOpen:  STATE.votingOpen
    };
    localStorage.setItem("dsatm_voting", JSON.stringify(data));
  } catch(e) { /* silent */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem("dsatm_voting");
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.candidates) {
      Object.keys(STATE.candidates).forEach(k => delete STATE.candidates[k]);
      Object.assign(STATE.candidates, data.candidates);
    }
    if (data.voters)      Object.assign(STATE.voters, data.voters);
    if (data.voterNames)  data.voterNames.forEach(n => STATE.voterNames.add(n));
    if (data.logs)        STATE.logs = data.logs;
    if (typeof data.votingOpen === "boolean") STATE.votingOpen = data.votingOpen;
  } catch(e) { /* silent */ }
}

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────
function writeLog(msg) {
  const now = new Date().toLocaleString("en-IN", { hour12: false });
  STATE.logs.push({ time: now, msg });
  saveState();
}

function isVotingTimeAllowed() {
  const h = new Date().getHours();
  return h >= STATE.VOTING_START && h < STATE.VOTING_END;
}

function totalVotes() {
  return Object.values(STATE.candidates).reduce((a, b) => a + b, 0);
}

function getInitials(name) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

// ─────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = "toast"; }, 3200);
}

// ─────────────────────────────────────────────
//  CLOCK
// ─────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById("clock");
  if (!el) return;
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  el.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
setInterval(updateClock, 1000);
updateClock();

// ─────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

  const screen = document.getElementById(`screen-${id}`);
  if (screen) { screen.classList.add("active"); }

  const btn = document.querySelector(`.nav-btn[data-screen="${id}"]`);
  if (btn) btn.classList.add("active");

  if (id === "results") renderResults();
  if (id === "admin" && STATE.adminLoggedIn) renderAdminDashboard();
  if (id === "vote") resetVoteForm();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => showScreen(btn.dataset.screen));
});

document.querySelectorAll("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => showScreen(btn.dataset.goto));
});

// ─────────────────────────────────────────────
//  HOME — TICKER
// ─────────────────────────────────────────────
function buildTicker() {
  const track = document.getElementById("ticker");
  const names = Object.keys(STATE.candidates);
  // Duplicate for seamless loop
  const all = [...names, ...names];
  track.innerHTML = all.map((n, i) =>
    `<span class="${i % 3 === 0 ? "highlight" : ""}">${n.toUpperCase()}</span>`
  ).join("");
}

// ─────────────────────────────────────────────
//  VOTE SCREEN
// ─────────────────────────────────────────────
let selectedCandidate = null;
let currentVoterData  = null;

function resetVoteForm() {
  selectedCandidate = null;
  currentVoterData  = null;
  showStep("step-1");

  ["voter-name","voter-age","voter-id"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const sel = document.getElementById("voter-gender");
  if (sel) sel.value = "";

  renderCandidatesGrid();
  updateConfirmBtn();
}

function showStep(id) {
  document.querySelectorAll(".step").forEach(s => s.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

function renderCandidatesGrid() {
  const grid = document.getElementById("candidates-grid");
  if (!grid) return;
  // If previously selected candidate no longer exists, clear it
  if (selectedCandidate && !STATE.candidates.hasOwnProperty(selectedCandidate)) {
    selectedCandidate = null;
    updateConfirmBtn();
  }
  grid.innerHTML = Object.keys(STATE.candidates).map(name => `
    <div class="candidate-card" data-name="${name}">
      <div class="check-icon">✓</div>
      <div class="candidate-avatar">${getInitials(name)}</div>
      <div class="candidate-name">${name}</div>
    </div>
  `).join("");

  grid.querySelectorAll(".candidate-card").forEach(card => {
    card.addEventListener("click", () => {
      grid.querySelectorAll(".candidate-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedCandidate = card.dataset.name;
      updateConfirmBtn();
    });
  });
}

function updateConfirmBtn() {
  const btn = document.getElementById("btn-confirm");
  if (btn) btn.disabled = !selectedCandidate;
}

// NEXT button — validate step 1
document.getElementById("btn-next").addEventListener("click", () => {
  const name   = document.getElementById("voter-name").value.trim();
  const age    = document.getElementById("voter-age").value.trim();
  const gender = document.getElementById("voter-gender").value;
  const vid    = document.getElementById("voter-id").value.trim();

  if (!name)   { showToast("Please enter your name.", "error"); return; }
  if (STATE.voterNames.has(name.toLowerCase())) { showToast("You have already voted!", "error"); return; }
  if (!age || isNaN(age) || parseInt(age) < 18) { showToast("Must be 18 or older.", "error"); return; }
  if (!gender) { showToast("Please select your gender.", "error"); return; }
  if (!vid || !/^\d+$/.test(vid)) { showToast("Voter ID must be numbers only.", "error"); return; }
  if (STATE.voters[vid]) { showToast("This Voter ID has already voted!", "error"); return; }

  if (!STATE.votingOpen)   { showToast("Voting has been closed by admin.", "error"); return; }
  if (!isVotingTimeAllowed()) { showToast("Voting is only allowed between 09:00 – 23:00.", "error"); return; }

  currentVoterData = { name, age: parseInt(age), gender, vid };
  showStep("step-2");
});

// BACK button
document.getElementById("btn-back").addEventListener("click", () => showStep("step-1"));

// CONFIRM button
document.getElementById("btn-confirm").addEventListener("click", () => {
  if (!selectedCandidate || !currentVoterData) return;
  // Guard: candidate may have been removed by admin between steps
  if (!STATE.candidates.hasOwnProperty(selectedCandidate)) {
    showToast("That candidate no longer exists. Please go back and reselect.", "error");
    selectedCandidate = null;
    renderCandidatesGrid();
    showStep("step-2");
    return;
  }
  STATE.candidates[selectedCandidate]++;
  STATE.voters[currentVoterData.vid] = {
    name:   currentVoterData.name,
    age:    currentVoterData.age,
    gender: currentVoterData.gender
  };
  STATE.voterNames.add(currentVoterData.name.toLowerCase());

  writeLog(`${currentVoterData.name} voted for ${selectedCandidate}`);
  saveState();

  const msgEl = document.getElementById("success-msg");
  if (msgEl) msgEl.textContent = `Your vote for ${selectedCandidate} has been recorded. Thank you, ${currentVoterData.name}!`;

  showStep("step-3");
  showToast("Vote cast successfully! 🎉", "success");
});

// ─────────────────────────────────────────────
//  RESULTS SCREEN
// ─────────────────────────────────────────────
function renderResults() {
  const board = document.getElementById("results-board");
  const totalEl = document.getElementById("results-total");
  if (!board) return;

  const total = totalVotes();
  if (totalEl) totalEl.textContent = `Total votes cast: ${total}`;

  const sorted = Object.entries(STATE.candidates)
    .sort((a, b) => b[1] - a[1]);

  const maxVotes = sorted[0]?.[1] || 1;

  board.innerHTML = sorted.map(([name, votes], i) => {
    const pct     = total > 0 ? ((votes / total) * 100).toFixed(1) : "0.0";
    const barPct  = total > 0 ? ((votes / maxVotes) * 100).toFixed(1) : "0";
    const isTop   = i === 0 && votes > 0;
    return `
      <div class="result-row ${isTop ? "top" : ""}" style="animation-delay:${i * 0.06}s">
        <div class="result-rank">${String(i+1).padStart(2,"0")}</div>
        <div class="result-info">
          <div class="result-name">${name}</div>
          <div class="result-votes">${votes} vote${votes !== 1 ? "s" : ""}</div>
        </div>
        <div class="result-bar-wrap">
          <div class="result-bar-bg">
            <div class="result-bar-fill" style="width:0%" data-target="${barPct}%"></div>
          </div>
        </div>
        <div class="result-percent">${pct}%</div>
      </div>
    `;
  }).join("");

  // Animate bars
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      board.querySelectorAll(".result-bar-fill").forEach(el => {
        el.style.width = el.dataset.target;
      });
    });
  });
}

// ─────────────────────────────────────────────
//  ADMIN — LOGIN
// ─────────────────────────────────────────────
document.getElementById("btn-admin-login").addEventListener("click", () => {
  const pw = document.getElementById("admin-pw").value;
  const errEl = document.getElementById("admin-err");

  if (pw === STATE.ADMIN_PASSWORD) {
    STATE.adminLoggedIn = true;
    document.getElementById("admin-login").classList.add("hidden");
    document.getElementById("admin-dashboard").classList.remove("hidden");
    renderAdminDashboard();
    writeLog("Admin logged in");
    showToast("Admin access granted.", "success");
  } else {
    if (errEl) errEl.textContent = "Incorrect password. Access denied.";
    showToast("Wrong password.", "error");
  }
});

document.getElementById("admin-pw").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-admin-login").click();
});

document.getElementById("btn-logout").addEventListener("click", () => {
  STATE.adminLoggedIn = false;
  document.getElementById("admin-pw").value = "";
  document.getElementById("admin-err").textContent = "";
  document.getElementById("admin-login").classList.remove("hidden");
  document.getElementById("admin-dashboard").classList.add("hidden");
  writeLog("Admin logged out");
  showToast("Logged out.", "info");
});

// ─────────────────────────────────────────────
//  ADMIN — DASHBOARD RENDER
// ─────────────────────────────────────────────
function renderAdminDashboard() {
  renderAdminStats();
  renderAdminResultsTable();
  renderCandidateManageList();
  renderLogViewer();
  updateVotingToggle();
  renderCandidatesGrid(); // keep vote screen in sync with any candidate changes
}

function renderAdminStats() {
  const total    = totalVotes();
  const numCands = Object.keys(STATE.candidates).length;
  const leader   = total > 0
    ? Object.entries(STATE.candidates).sort((a,b) => b[1]-a[1])[0][0].split(" ")[0]
    : "—";

  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setVal("stat-total",      total);
  setVal("stat-candidates", numCands);
  setVal("stat-leader",     leader);
}

function renderAdminResultsTable() {
  const container = document.getElementById("admin-results-table");
  if (!container) return;
  const total = totalVotes();
  const sorted = Object.entries(STATE.candidates).sort((a,b) => b[1]-a[1]);
  const maxV = sorted[0]?.[1] || 1;

  container.innerHTML = sorted.map(([name, votes]) => {
    const barPct = total > 0 ? ((votes / maxV) * 100).toFixed(1) : "0";
    return `
      <div class="admin-results-row">
        <div class="admin-candidate-name">${name}</div>
        <div class="admin-bar-wrap">
          <div class="admin-bar-bg">
            <div class="admin-bar-fill" style="width:${barPct}%"></div>
          </div>
        </div>
        <div class="admin-vote-count">${votes} / ${total > 0 ? ((votes/total)*100).toFixed(1) : "0.0"}%</div>
      </div>
    `;
  }).join("");
}

function renderCandidateManageList() {
  const list = document.getElementById("candidate-manage-list");
  if (!list) return;
  list.innerHTML = Object.keys(STATE.candidates).map(name => `
    <li class="cml-item">
      <span class="cml-name">${name}</span>
      <button class="cml-del" data-name="${name}" title="Remove">✕</button>
    </li>
  `).join("");

  list.querySelectorAll(".cml-del").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.dataset.name;
      if (confirm(`Remove candidate "${name}"?`)) {
        delete STATE.candidates[name];
        writeLog(`Admin removed candidate: ${name}`);
        saveState();
        renderAdminDashboard();
        buildTicker();
        showToast(`${name} removed.`, "info");
      }
    });
  });
}

function renderLogViewer() {
  const el = document.getElementById("log-scroll");
  if (!el) return;
  if (STATE.logs.length === 0) {
    el.innerHTML = `<div class="log-entry"><span class="log-txt">No activity yet.</span></div>`;
    return;
  }
  el.innerHTML = [...STATE.logs].reverse().map(({ time, msg }) =>
    `<div class="log-entry"><span class="log-time">${time}</span><span class="log-txt">${msg}</span></div>`
  ).join("");
}

function updateVotingToggle() {
  const btn   = document.getElementById("toggle-voting");
  const dot   = document.getElementById("voting-dot");
  const label = document.getElementById("voting-label");
  if (!btn) return;
  if (STATE.votingOpen) {
    dot.className   = "dot on";
    label.textContent = "Voting: OPEN";
    btn.classList.add("active");
  } else {
    dot.className   = "dot off";
    label.textContent = "Voting: CLOSED";
    btn.classList.remove("active");
  }
}

document.getElementById("toggle-voting").addEventListener("click", () => {
  STATE.votingOpen = !STATE.votingOpen;
  const status = STATE.votingOpen ? "OPENED" : "CLOSED";
  writeLog(`Admin ${status} voting`);
  saveState();
  updateVotingToggle();
  showToast(`Voting is now ${status}.`, STATE.votingOpen ? "success" : "error");
});

// Add Candidate
document.getElementById("btn-add-candidate").addEventListener("click", () => {
  const input = document.getElementById("new-candidate-name");
  const name  = input.value.trim().replace(/\b\w/g, c => c.toUpperCase());

  if (!name) { showToast("Enter a candidate name.", "error"); return; }
  if (STATE.candidates.hasOwnProperty(name)) { showToast("Candidate already exists.", "error"); return; }

  STATE.candidates[name] = 0;
  input.value = "";
  writeLog(`Admin added candidate: ${name}`);
  saveState();
  renderAdminDashboard();
  buildTicker();
  showToast(`${name} added.`, "success");
});

document.getElementById("new-candidate-name").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-add-candidate").click();
});

// Export Results
document.getElementById("btn-export").addEventListener("click", () => {
  const total = totalVotes();
  const sorted = Object.entries(STATE.candidates).sort((a,b) => b[1]-a[1]);
  const winner = sorted[0]?.[0] || "N/A";

  let report = `ELECTION RESULTS REPORT\n`;
  report += `Election: ${STATE.electionName}\n`;
  report += `Year: ${STATE.electionYear} | Location: ${STATE.electionLocation}\n`;
  report += `Generated: ${new Date().toLocaleString("en-IN")}\n`;
  report += `${"─".repeat(50)}\n\n`;
  report += `CANDIDATE RESULTS\n\n`;

  sorted.forEach(([name, votes], i) => {
    const pct = total > 0 ? ((votes / total) * 100).toFixed(2) : "0.00";
    report += `${String(i+1).padStart(2,"0")}. ${name.padEnd(22)} ${String(votes).padStart(3)} votes  (${pct}%)\n`;
  });

  report += `\n${"─".repeat(50)}\n`;
  report += `Total Votes Cast : ${total}\n`;
  report += `Winner           : ${winner}\n`;
  report += `\nACTIVITY LOG\n\n`;
  STATE.logs.forEach(({ time, msg }) => { report += `[${time}] ${msg}\n`; });

  const blob = new Blob([report], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `election_results_${STATE.electionYear}.txt`;
  a.click();
  URL.revokeObjectURL(url);

  writeLog("Admin exported results report");
  showToast("Report downloaded.", "success");
});

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
function init() {
  loadState();
  buildTicker();
  renderCandidatesGrid();
  updateConfirmBtn();
  // Only log first-ever startup, not every page refresh
  if (STATE.logs.length === 0) {
    writeLog("Election system initialized");
  }
  saveState();
}

init();
