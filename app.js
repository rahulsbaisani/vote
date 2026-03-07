/* ══════════════════════════════════════════════
   DSATM VOTING SYSTEM — app.js
   Storage: Firebase Firestore (cross-device, persistent)
══════════════════════════════════════════════ */

"use strict";

// ─────────────────────────────────────────────
//  FIREBASE CONFIG
//  ⚠️  Replace these values with YOUR Firebase project config
//  Steps: console.firebase.google.com → New Project → Firestore → Web App
// ─────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDn0GUI8E5M1cCt_KLXiuIv1XS_z4aZhfU",
  authDomain:        "dsatm-voting.firebaseapp.com",
  projectId:         "dsatm-voting",
  storageBucket:     "dsatm-voting.firebasestorage.app",
  messagingSenderId: "35971135486",
  appId:             "1:35971135486:web:3148e80ba1ca9069f532af"
};

// ─────────────────────────────────────────────
//  APP STATE (in-memory mirror of Firestore)
// ─────────────────────────────────────────────
const STATE = {
  electionName:     "Class Representative Election",
  electionYear:     "2026",
  electionLocation: "DSATM",
  ADMIN_PASSWORD:   "team16",
  VOTING_START:     9,
  VOTING_END:       23,
  votingOpen:       true,
  adminLoggedIn:    false,
  candidates:       {},
  voters:           {},
  voterNames:       new Set(),
  logs:             []
};

const DEFAULT_CANDIDATES = {
  "Pranathi M S":    0,
  "Mehek":           0,
  "Theju":           0,
  "Rahul S Baisani": 0,
  "Swathi":          0,
  "Suchitra S S":    0,
  "Aishwarya":       0,
  "Chaitanya":       0
};

// ─────────────────────────────────────────────
//  FIREBASE REFERENCES (set after init)
// ─────────────────────────────────────────────
let db            = null;
let settingsRef   = null;
let candidatesRef = null;
let votersRef     = null;

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────
function totalVotes() {
  return Object.values(STATE.candidates).reduce((a, b) => a + b, 0);
}
function getInitials(name) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}
function isVotingTimeAllowed() {
  const h = new Date().getHours();
  return h >= STATE.VOTING_START && h < STATE.VOTING_END;
}
function safeId(name) {
  return encodeURIComponent(name);
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
//  LOADING OVERLAY
// ─────────────────────────────────────────────
function setLoading(on) {
  const el = document.getElementById("loading-overlay");
  if (el) el.style.display = on ? "flex" : "none";
}

// ─────────────────────────────────────────────
//  FIREBASE: WRITE HELPERS
// ─────────────────────────────────────────────
async function fbWriteLog(msg) {
  const now   = new Date().toLocaleString("en-IN", { hour12: false });
  const entry = { time: now, msg, ts: Date.now() };
  STATE.logs.unshift(entry);
  try {
    await db.collection("logs").add(entry);
  } catch(e) { console.warn("Log write failed", e); }
}

async function fbSaveCandidate(name, votes) {
  await candidatesRef.doc(safeId(name)).set({ name, votes });
}

async function fbDeleteCandidate(name) {
  await candidatesRef.doc(safeId(name)).delete();
}

async function fbSaveVoter(vid, name, age, gender, candidate) {
  await votersRef.doc(vid).set({ vid, name, age, gender, candidate, ts: Date.now() });
}

async function fbSaveSettings() {
  await settingsRef.set({ votingOpen: STATE.votingOpen, updatedAt: Date.now() }, { merge: true });
}

// ─────────────────────────────────────────────
//  FIREBASE: REAL-TIME LISTENERS
// ─────────────────────────────────────────────
function attachListeners() {

  // Candidates — live sync across all devices
  candidatesRef.onSnapshot(snap => {
    Object.keys(STATE.candidates).forEach(k => delete STATE.candidates[k]);
    snap.forEach(doc => {
      const d = doc.data();
      STATE.candidates[d.name] = d.votes;
    });
    buildTicker();
    renderCandidatesGrid();
    renderResults();
    if (STATE.adminLoggedIn) renderAdminDashboard();
  });

  // Voters — live sync
  votersRef.onSnapshot(snap => {
    STATE.voters    = {};
    STATE.voterNames = new Set();
    snap.forEach(doc => {
      const d = doc.data();
      STATE.voters[d.vid] = { name: d.name, age: d.age, gender: d.gender };
      STATE.voterNames.add(d.name.toLowerCase());
    });
    if (STATE.adminLoggedIn) renderAdminStats();
  });

  // Settings (voting open/closed) — live sync
  settingsRef.onSnapshot(doc => {
    if (doc.exists) {
      const d = doc.data();
      if (typeof d.votingOpen === "boolean") STATE.votingOpen = d.votingOpen;
      updateVotingToggle();
    }
  });

  // Logs — live sync
  db.collection("logs").orderBy("ts", "desc").limit(100)
    .onSnapshot(snap => {
      STATE.logs = [];
      snap.forEach(doc => STATE.logs.push(doc.data()));
      if (STATE.adminLoggedIn) renderLogViewer();
    });
}

// ─────────────────────────────────────────────
//  FIRST-RUN SEED
// ─────────────────────────────────────────────
async function seedDefaultsIfEmpty() {
  const snap = await candidatesRef.get();
  if (snap.empty) {
    const batch = db.batch();
    Object.entries(DEFAULT_CANDIDATES).forEach(([name, votes]) => {
      batch.set(candidatesRef.doc(safeId(name)), { name, votes });
    });
    await settingsRef.set({ votingOpen: true, updatedAt: Date.now() });
    await batch.commit();
    await fbWriteLog("Election system initialized");
  }
}

// ─────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const screen = document.getElementById(`screen-${id}`);
  if (screen) screen.classList.add("active");
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
//  HOME TICKER
// ─────────────────────────────────────────────
function buildTicker() {
  const track = document.getElementById("ticker");
  if (!track) return;
  const names = Object.keys(STATE.candidates);
  const all   = [...names, ...names];
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
  if (!STATE.votingOpen)      { showToast("Voting has been closed by admin.", "error"); return; }
  if (!isVotingTimeAllowed()) { showToast("Voting allowed only between 09:00 – 23:00.", "error"); return; }

  currentVoterData = { name, age: parseInt(age), gender, vid };
  showStep("step-2");
});

document.getElementById("btn-back").addEventListener("click", () => showStep("step-1"));

document.getElementById("btn-confirm").addEventListener("click", async () => {
  if (!selectedCandidate || !currentVoterData) return;
  if (!STATE.candidates.hasOwnProperty(selectedCandidate)) {
    showToast("That candidate no longer exists. Please reselect.", "error");
    selectedCandidate = null;
    renderCandidatesGrid();
    return;
  }

  const btn = document.getElementById("btn-confirm");
  btn.disabled    = true;
  btn.textContent = "SUBMITTING…";

  try {
    const newVotes = (STATE.candidates[selectedCandidate] || 0) + 1;
    await Promise.all([
      fbSaveCandidate(selectedCandidate, newVotes),
      fbSaveVoter(currentVoterData.vid, currentVoterData.name,
                  currentVoterData.age, currentVoterData.gender, selectedCandidate)
    ]);
    await fbWriteLog(`${currentVoterData.name} voted for ${selectedCandidate}`);

    const msgEl = document.getElementById("success-msg");
    if (msgEl) msgEl.textContent =
      `Your vote for ${selectedCandidate} has been recorded. Thank you, ${currentVoterData.name}!`;

    showStep("step-3");
    showToast("Vote cast successfully! 🎉", "success");
  } catch(e) {
    showToast("Something went wrong. Please try again.", "error");
    console.error(e);
    btn.disabled    = false;
    btn.textContent = "CONFIRM VOTE";
  }
});

// ─────────────────────────────────────────────
//  RESULTS SCREEN
// ─────────────────────────────────────────────
function renderResults() {
  const board   = document.getElementById("results-board");
  const totalEl = document.getElementById("results-total");
  if (!board) return;
  const total    = totalVotes();
  if (totalEl) totalEl.textContent = `Total votes cast: ${total}`;
  const sorted   = Object.entries(STATE.candidates).sort((a, b) => b[1] - a[1]);
  const maxVotes = sorted[0]?.[1] || 1;

  board.innerHTML = sorted.map(([name, votes], i) => {
    const pct    = total > 0 ? ((votes / total) * 100).toFixed(1) : "0.0";
    const barPct = total > 0 ? ((votes / maxVotes) * 100).toFixed(1) : "0";
    const isTop  = i === 0 && votes > 0;
    return `
      <div class="result-row ${isTop ? "top" : ""}" style="animation-delay:${i*0.06}s">
        <div class="result-rank">${String(i+1).padStart(2,"0")}</div>
        <div class="result-info">
          <div class="result-name">${name}</div>
          <div class="result-votes">${votes} vote${votes!==1?"s":""}</div>
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

  requestAnimationFrame(() => requestAnimationFrame(() => {
    board.querySelectorAll(".result-bar-fill").forEach(el => { el.style.width = el.dataset.target; });
  }));
}

// ─────────────────────────────────────────────
//  ADMIN LOGIN
// ─────────────────────────────────────────────
document.getElementById("btn-admin-login").addEventListener("click", () => {
  const pw    = document.getElementById("admin-pw").value;
  const errEl = document.getElementById("admin-err");
  if (pw === STATE.ADMIN_PASSWORD) {
    STATE.adminLoggedIn = true;
    document.getElementById("admin-login").classList.add("hidden");
    document.getElementById("admin-dashboard").classList.remove("hidden");
    renderAdminDashboard();
    fbWriteLog("Admin logged in");
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
  document.getElementById("admin-pw").value       = "";
  document.getElementById("admin-err").textContent = "";
  document.getElementById("admin-login").classList.remove("hidden");
  document.getElementById("admin-dashboard").classList.add("hidden");
  fbWriteLog("Admin logged out");
  showToast("Logged out.", "info");
});

// ─────────────────────────────────────────────
//  ADMIN DASHBOARD
// ─────────────────────────────────────────────
function renderAdminDashboard() {
  renderAdminStats();
  renderAdminResultsTable();
  renderCandidateManageList();
  renderLogViewer();
  updateVotingToggle();
  renderCandidatesGrid();
}

function renderAdminStats() {
  const total    = totalVotes();
  const numCands = Object.keys(STATE.candidates).length;
  const leader   = total > 0
    ? Object.entries(STATE.candidates).sort((a,b)=>b[1]-a[1])[0][0].split(" ")[0]
    : "—";
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setVal("stat-total",      total);
  setVal("stat-candidates", numCands);
  setVal("stat-leader",     leader);
}

function renderAdminResultsTable() {
  const container = document.getElementById("admin-results-table");
  if (!container) return;
  const total  = totalVotes();
  const sorted = Object.entries(STATE.candidates).sort((a,b) => b[1]-a[1]);
  const maxV   = sorted[0]?.[1] || 1;
  container.innerHTML = sorted.map(([name, votes]) => {
    const barPct = total > 0 ? ((votes/maxV)*100).toFixed(1) : "0";
    return `
      <div class="admin-results-row">
        <div class="admin-candidate-name">${name}</div>
        <div class="admin-bar-wrap">
          <div class="admin-bar-bg"><div class="admin-bar-fill" style="width:${barPct}%"></div></div>
        </div>
        <div class="admin-vote-count">${votes} / ${total>0?((votes/total)*100).toFixed(1):"0.0"}%</div>
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
    btn.addEventListener("click", async () => {
      const name = btn.dataset.name;
      if (confirm(`Remove candidate "${name}"?`)) {
        await fbDeleteCandidate(name);
        await fbWriteLog(`Admin removed candidate: ${name}`);
        showToast(`${name} removed.`, "info");
      }
    });
  });
}

function renderLogViewer() {
  const el = document.getElementById("log-scroll");
  if (!el) return;
  if (!STATE.logs.length) {
    el.innerHTML = `<div class="log-entry"><span class="log-txt">No activity yet.</span></div>`;
    return;
  }
  el.innerHTML = STATE.logs.map(({ time, msg }) =>
    `<div class="log-entry"><span class="log-time">${time}</span><span class="log-txt">${msg}</span></div>`
  ).join("");
}

function updateVotingToggle() {
  const btn   = document.getElementById("toggle-voting");
  const dot   = document.getElementById("voting-dot");
  const label = document.getElementById("voting-label");
  if (!btn) return;
  if (STATE.votingOpen) {
    dot.className     = "dot on";
    label.textContent = "Voting: OPEN";
    btn.classList.add("active");
  } else {
    dot.className     = "dot off";
    label.textContent = "Voting: CLOSED";
    btn.classList.remove("active");
  }
}

document.getElementById("toggle-voting").addEventListener("click", async () => {
  STATE.votingOpen = !STATE.votingOpen;
  const status = STATE.votingOpen ? "OPENED" : "CLOSED";
  await fbSaveSettings();
  await fbWriteLog(`Admin ${status} voting`);
  updateVotingToggle();
  showToast(`Voting is now ${status}.`, STATE.votingOpen ? "success" : "error");
});

document.getElementById("btn-add-candidate").addEventListener("click", async () => {
  const input = document.getElementById("new-candidate-name");
  const name  = input.value.trim().replace(/\b\w/g, c => c.toUpperCase());
  if (!name) { showToast("Enter a candidate name.", "error"); return; }
  if (STATE.candidates.hasOwnProperty(name)) { showToast("Candidate already exists.", "error"); return; }
  await fbSaveCandidate(name, 0);
  await fbWriteLog(`Admin added candidate: ${name}`);
  input.value = "";
  showToast(`${name} added.`, "success");
});

document.getElementById("new-candidate-name").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-add-candidate").click();
});

document.getElementById("btn-export").addEventListener("click", async () => {
  const total  = totalVotes();
  const sorted = Object.entries(STATE.candidates).sort((a,b) => b[1]-a[1]);
  const winner = sorted[0]?.[0] || "N/A";
  let report   = `ELECTION RESULTS REPORT\nElection: ${STATE.electionName}\n`;
  report += `Year: ${STATE.electionYear} | Location: ${STATE.electionLocation}\n`;
  report += `Generated: ${new Date().toLocaleString("en-IN")}\n${"─".repeat(50)}\n\nCANDIDATE RESULTS\n\n`;
  sorted.forEach(([name, votes], i) => {
    const pct = total > 0 ? ((votes/total)*100).toFixed(2) : "0.00";
    report += `${String(i+1).padStart(2,"0")}. ${name.padEnd(22)} ${String(votes).padStart(3)} votes  (${pct}%)\n`;
  });
  report += `\n${"─".repeat(50)}\nTotal Votes Cast : ${total}\nWinner : ${winner}\n\nACTIVITY LOG\n\n`;
  STATE.logs.forEach(({ time, msg }) => { report += `[${time}] ${msg}\n`; });

  const blob = new Blob([report], { type: "text/plain" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `election_results_${STATE.electionYear}.txt`; a.click();
  URL.revokeObjectURL(url);
  await fbWriteLog("Admin exported results report");
  showToast("Report downloaded.", "success");
});

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
async function init() {
  setLoading(true);
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db            = firebase.firestore();
    settingsRef   = db.collection("election").doc("settings");
    candidatesRef = db.collection("candidates");
    votersRef     = db.collection("voters");

    await seedDefaultsIfEmpty();
    attachListeners();
    setLoading(false);
  } catch(e) {
    setLoading(false);
    console.error("Firebase init failed:", e);
    showToast("⚠️ Database connection failed. Check Firebase config in app.js.", "error");
    Object.assign(STATE.candidates, DEFAULT_CANDIDATES);
    buildTicker();
    renderCandidatesGrid();
  }
}

init();
