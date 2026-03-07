/* ══════════════════════════════════════════════
   DSATM VOTING SYSTEM — app.js
   Features: Firebase Firestore, Face Detection,
             Charts, Voter Photos, Reset Votes
══════════════════════════════════════════════ */
"use strict";

// ─────────────────────────────────────────────
//  FIREBASE CONFIG
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
//  STATE
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
  voters:           {},   // { vid: { name, age, gender, photoDataUrl } }
  voterNames:       new Set(),
  logs:             []
};

const DEFAULT_CANDIDATES = {
  "Pranathi M S":    0, "Mehek":           0,
  "Theju":           0, "Rahul S Baisani": 0,
  "Swathi":          0, "Suchitra S S":    0,
  "Aishwarya":       0, "Chaitanya":       0
};

// ─────────────────────────────────────────────
//  FIREBASE REFS
// ─────────────────────────────────────────────
let db, settingsRef, candidatesRef, votersRef;

// ─────────────────────────────────────────────
//  CHARTS
// ─────────────────────────────────────────────
let barChart = null;
let pieChart = null;

// ─────────────────────────────────────────────
//  FACE DETECTION STATE
// ─────────────────────────────────────────────
let faceStream        = null;
let faceDetectTimer   = null;
let faceModelsLoaded  = false;
let capturedPhotoUrl  = null;
let faceDetected      = false;

// ─────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────
const totalVotes   = () => Object.values(STATE.candidates).reduce((a,b)=>a+b,0);
const getInitials  = name => name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
const isTimeOk     = () => { const h=new Date().getHours(); return h>=STATE.VOTING_START && h<STATE.VOTING_END; };
const safeId       = name => encodeURIComponent(name);

// ─────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────
let toastTimer;
function showToast(msg, type="info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.className="toast"; }, 3400);
}

// ─────────────────────────────────────────────
//  CLOCK
// ─────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById("clock");
  if (!el) return;
  const now=new Date(), pad=n=>String(n).padStart(2,"0");
  el.textContent=`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
setInterval(updateClock,1000); updateClock();

// ─────────────────────────────────────────────
//  LOADING
// ─────────────────────────────────────────────
function setLoading(on, msg="CONNECTING TO DATABASE…") {
  const el=document.getElementById("loading-overlay");
  const ml=document.getElementById("loading-msg");
  if(el) el.style.display=on?"flex":"none";
  if(ml) ml.textContent=msg;
}

// ─────────────────────────────────────────────
//  FIREBASE WRITES
// ─────────────────────────────────────────────
async function fbWriteLog(msg) {
  const now=new Date().toLocaleString("en-IN",{hour12:false});
  const entry={time:now,msg,ts:Date.now()};
  STATE.logs.unshift(entry);
  try { await db.collection("logs").add(entry); } catch(e){}
}
async function fbSaveCandidate(name,votes) {
  await candidatesRef.doc(safeId(name)).set({name,votes});
}
async function fbDeleteCandidate(name) {
  await candidatesRef.doc(safeId(name)).delete();
}
async function fbSaveVoter(vid,name,age,gender,candidate,photoDataUrl) {
  await votersRef.doc(vid).set({vid,name,age,gender,candidate,photoDataUrl:photoDataUrl||"",ts:Date.now()});
}
async function fbSaveSettings() {
  await settingsRef.set({votingOpen:STATE.votingOpen,updatedAt:Date.now()},{merge:true});
}

// ─────────────────────────────────────────────
//  FIREBASE LISTENERS
// ─────────────────────────────────────────────
function attachListeners() {
  // Candidates
  candidatesRef.onSnapshot(snap=>{
    Object.keys(STATE.candidates).forEach(k=>delete STATE.candidates[k]);
    snap.forEach(doc=>{ const d=doc.data(); STATE.candidates[d.name]=d.votes; });
    buildTicker(); renderCandidatesGrid(); renderResults();
    if(STATE.adminLoggedIn) renderAdminDashboard();
  });
  // Voters
  votersRef.onSnapshot(snap=>{
    STATE.voters={}; STATE.voterNames=new Set();
    snap.forEach(doc=>{
      const d=doc.data();
      STATE.voters[d.vid]={name:d.name,age:d.age,gender:d.gender,photoDataUrl:d.photoDataUrl||""};
      STATE.voterNames.add(d.name.toLowerCase());
    });
    if(STATE.adminLoggedIn){ renderAdminStats(); renderVoterPhotos(); }
  });
  // Settings
  settingsRef.onSnapshot(doc=>{
    if(doc.exists){ const d=doc.data(); if(typeof d.votingOpen==="boolean") STATE.votingOpen=d.votingOpen; updateVotingToggle(); }
  });
  // Logs
  db.collection("logs").orderBy("ts","desc").limit(100).onSnapshot(snap=>{
    STATE.logs=[]; snap.forEach(doc=>STATE.logs.push(doc.data()));
    if(STATE.adminLoggedIn) renderLogViewer();
  });
}

async function seedDefaultsIfEmpty() {
  const snap=await candidatesRef.get();
  if(snap.empty){
    const batch=db.batch();
    Object.entries(DEFAULT_CANDIDATES).forEach(([name,votes])=>{
      batch.set(candidatesRef.doc(safeId(name)),{name,votes});
    });
    await settingsRef.set({votingOpen:true,updatedAt:Date.now()});
    await batch.commit();
    await fbWriteLog("Election system initialized");
  }
}

// ─────────────────────────────────────────────
//  NAVIGATION
// ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b=>b.classList.remove("active"));
  const screen=document.getElementById(`screen-${id}`);
  if(screen) screen.classList.add("active");
  const btn=document.querySelector(`.nav-btn[data-screen="${id}"]`);
  if(btn) btn.classList.add("active");
  if(id==="results") renderResults();
  if(id==="admin"&&STATE.adminLoggedIn) renderAdminDashboard();
  if(id==="vote") resetVoteForm();
  // Stop camera if navigating away from vote
  if(id!=="vote") stopCamera();
}

document.querySelectorAll(".nav-btn").forEach(btn=>{
  btn.addEventListener("click",()=>showScreen(btn.dataset.screen));
});
document.querySelectorAll("[data-goto]").forEach(btn=>{
  btn.addEventListener("click",()=>showScreen(btn.dataset.goto));
});

// ─────────────────────────────────────────────
//  TICKER
// ─────────────────────────────────────────────
function buildTicker() {
  const track=document.getElementById("ticker"); if(!track) return;
  const names=Object.keys(STATE.candidates);
  const all=[...names,...names];
  track.innerHTML=all.map((n,i)=>`<span class="${i%3===0?"highlight":""}">${n.toUpperCase()}</span>`).join("");
}

// ─────────────────────────────────────────────
//  STEP PROGRESS PIPS
// ─────────────────────────────────────────────
function setStepPip(activeNum) {
  for(let i=1;i<=4;i++){
    const pip=document.getElementById(`pip-${i}`);
    if(!pip) continue;
    pip.classList.remove("active","done");
    if(i===activeNum) pip.classList.add("active");
    else if(i<activeNum) pip.classList.add("done");
  }
}

// ─────────────────────────────────────────────
//  VOTE FORM
// ─────────────────────────────────────────────
let selectedCandidate=null, currentVoterData=null;

function resetVoteForm() {
  selectedCandidate=null; currentVoterData=null; capturedPhotoUrl=null; faceDetected=false;
  showVoteStep("step-1"); setStepPip(1);
  ["voter-name","voter-age","voter-id"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
  const sel=document.getElementById("voter-gender"); if(sel) sel.value="";
  renderCandidatesGrid(); updateConfirmBtn();
  stopCamera();
}

function showVoteStep(id) {
  document.querySelectorAll(".step").forEach(s=>s.classList.remove("active"));
  const el=document.getElementById(id); if(el) el.classList.add("active");
}

// ─────────────────────────────────────────────
//  CANDIDATES GRID
// ─────────────────────────────────────────────
function renderCandidatesGrid() {
  const grid=document.getElementById("candidates-grid"); if(!grid) return;
  if(selectedCandidate&&!STATE.candidates.hasOwnProperty(selectedCandidate)){
    selectedCandidate=null; updateConfirmBtn();
  }
  grid.innerHTML=Object.keys(STATE.candidates).map(name=>`
    <div class="candidate-card" data-name="${name}">
      <div class="check-icon">✓</div>
      <div class="candidate-avatar">${getInitials(name)}</div>
      <div class="candidate-name">${name}</div>
    </div>
  `).join("");
  grid.querySelectorAll(".candidate-card").forEach(card=>{
    card.addEventListener("click",()=>{
      grid.querySelectorAll(".candidate-card").forEach(c=>c.classList.remove("selected"));
      card.classList.add("selected");
      selectedCandidate=card.dataset.name; updateConfirmBtn();
    });
  });
}

function updateConfirmBtn() {
  const btn=document.getElementById("btn-confirm"); if(btn) btn.disabled=!selectedCandidate;
}

// ─────────────────────────────────────────────
//  STEP 1 → FACE SCAN
// ─────────────────────────────────────────────
document.getElementById("btn-next").addEventListener("click",()=>{
  const name  =document.getElementById("voter-name").value.trim();
  const age   =document.getElementById("voter-age").value.trim();
  const gender=document.getElementById("voter-gender").value;
  const vid   =document.getElementById("voter-id").value.trim();

  if(!name)   { showToast("Please enter your name.","error"); return; }
  if(STATE.voterNames.has(name.toLowerCase())) { showToast("You have already voted!","error"); return; }
  if(!age||isNaN(age)||parseInt(age)<18) { showToast("Must be 18 or older.","error"); return; }
  if(!gender) { showToast("Please select your gender.","error"); return; }
  if(!vid||!/^\d+$/.test(vid)) { showToast("Voter ID must be numbers only.","error"); return; }
  if(STATE.voters[vid]) { showToast("This Voter ID has already voted!","error"); return; }
  if(!STATE.votingOpen)  { showToast("Voting has been closed by admin.","error"); return; }
  if(!isTimeOk())        { showToast("Voting allowed only between 09:00 – 23:00.","error"); return; }

  currentVoterData={name,age:parseInt(age),gender,vid};
  showVoteStep("step-2-face"); setStepPip(2);
  startCamera();
});

// ─────────────────────────────────────────────
//  FACE DETECTION
// ─────────────────────────────────────────────
async function loadFaceModels() {
  if(faceModelsLoaded) return true;
  try {
    const MODEL_URL="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights";
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
    faceModelsLoaded=true;
    return true;
  } catch(e) {
    console.error("Face model load failed",e);
    return false;
  }
}

async function startCamera() {
  setFaceStatus("searching","Initialising camera…");
  const btn=document.getElementById("btn-capture");
  if(btn) btn.disabled=true;

  try {
    faceStream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:"user"},audio:false});
    const video=document.getElementById("face-video");
    video.srcObject=faceStream;
    await video.play();

    setFaceStatus("searching","Loading face detection AI…");
    const loaded=await loadFaceModels();
    if(!loaded){
      setFaceStatus("error","Face AI failed to load. Please refresh.");
      return;
    }
    setFaceStatus("searching","Scanning for your face…");
    startFaceLoop();
  } catch(e) {
    if(e.name==="NotAllowedError"){
      setFaceStatus("error","Camera access denied. Please allow camera.");
      showToast("Camera permission denied.","error");
    } else {
      setFaceStatus("error","Camera error: "+e.message);
    }
  }
}

function stopCamera() {
  if(faceDetectTimer) { clearInterval(faceDetectTimer); faceDetectTimer=null; }
  if(faceStream) { faceStream.getTracks().forEach(t=>t.stop()); faceStream=null; }
  faceDetected=false;
}

function startFaceLoop() {
  const video=document.getElementById("face-video");
  const canvas=document.getElementById("face-overlay");
  const btn=document.getElementById("btn-capture");
  const hint=document.getElementById("face-hint");

  faceDetectTimer=setInterval(async()=>{
    if(!video||video.readyState<2) return;
    canvas.width=video.videoWidth; canvas.height=video.videoHeight;
    const detections=await faceapi.detectAllFaces(video,new faceapi.TinyFaceDetectorOptions({inputSize:224,scoreThreshold:0.5}));
    const ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,canvas.width,canvas.height);

    if(detections.length===0){
      faceDetected=false;
      if(btn) btn.disabled=true;
      setFaceStatus("searching","No face detected. Look directly at camera.");
      if(hint) hint.textContent="TIP: Ensure good lighting and face the camera directly.";
    } else if(detections.length>1){
      faceDetected=false;
      if(btn) btn.disabled=true;
      setFaceStatus("error","Multiple faces detected! Only one person can vote.");
      if(hint) hint.textContent="Only one voter should be in front of the camera.";
      // Draw red boxes
      detections.forEach(d=>{
        const {x,y,width,height}=d.box;
        ctx.strokeStyle="rgba(255,71,87,0.8)"; ctx.lineWidth=2;
        ctx.strokeRect(x,y,width,height);
      });
    } else {
      faceDetected=true;
      if(btn) btn.disabled=false;
      setFaceStatus("found","Face detected! Press Capture to continue.");
      if(hint) hint.textContent="Hold still while capturing your photo.";
      // Draw green box
      const {x,y,width,height}=detections[0].box;
      ctx.strokeStyle="rgba(232,255,71,0.9)"; ctx.lineWidth=2;
      ctx.strokeRect(x,y,width,height);
      // Animated corners
      const cs=12;
      ctx.strokeStyle="rgba(232,255,71,1)"; ctx.lineWidth=3;
      [[x,y],[x+width-cs,y],[x,y+height-cs],[x+width-cs,y+height-cs]].forEach(([cx,cy],i)=>{
        ctx.beginPath();
        if(i===0){ctx.moveTo(cx,cy+cs);ctx.lineTo(cx,cy);ctx.lineTo(cx+cs,cy);}
        if(i===1){ctx.moveTo(cx,cy);ctx.lineTo(cx+cs,cy);ctx.moveTo(cx+cs,cy);ctx.lineTo(cx+cs,cy+cs);}
        if(i===2){ctx.moveTo(cx,cy);ctx.lineTo(cx,cy+cs);ctx.lineTo(cx+cs,cy+cs);}
        if(i===3){ctx.moveTo(cx,cy);ctx.lineTo(cx+cs,cy);ctx.moveTo(cx+cs,cy);ctx.lineTo(cx+cs,cy+cs);}
        ctx.stroke();
      });
    }
  },600);
}

function setFaceStatus(state, text) {
  const dot=document.getElementById("face-dot");
  const txt=document.getElementById("face-status-text");
  if(dot){ dot.className=`face-dot ${state}`; }
  if(txt) txt.textContent=text;
}

function capturePhoto() {
  const video=document.getElementById("face-video");
  const canvas=document.createElement("canvas");
  canvas.width=video.videoWidth; canvas.height=video.videoHeight;
  const ctx=canvas.getContext("2d");
  // Mirror the capture to match what user sees
  ctx.translate(canvas.width,0); ctx.scale(-1,1);
  ctx.drawImage(video,0,0);
  return canvas.toDataURL("image/jpeg",0.6);
}

document.getElementById("btn-capture").addEventListener("click",()=>{
  if(!faceDetected){ showToast("No face detected. Please face the camera.","error"); return; }
  capturedPhotoUrl=capturePhoto();
  stopCamera();

  // Show tiny face preview on step 3
  const strip=document.getElementById("face-preview-strip");
  if(strip) strip.innerHTML=`<img src="${capturedPhotoUrl}" alt="Your photo"/><span>✓ FACE VERIFIED — YOUR PHOTO HAS BEEN RECORDED</span>`;

  showVoteStep("step-3-candidate"); setStepPip(3);
  showToast("Face captured! Now choose your candidate.","success");
});

document.getElementById("btn-face-back").addEventListener("click",()=>{
  stopCamera(); showVoteStep("step-1"); setStepPip(1);
});

document.getElementById("btn-back-to-face").addEventListener("click",()=>{
  showVoteStep("step-2-face"); setStepPip(2); startCamera();
});

// ─────────────────────────────────────────────
//  CONFIRM VOTE
// ─────────────────────────────────────────────
document.getElementById("btn-confirm").addEventListener("click",async()=>{
  if(!selectedCandidate||!currentVoterData) return;
  if(!STATE.candidates.hasOwnProperty(selectedCandidate)){
    showToast("That candidate no longer exists. Please reselect.","error");
    selectedCandidate=null; renderCandidatesGrid(); return;
  }
  const btn=document.getElementById("btn-confirm");
  btn.disabled=true; btn.textContent="SUBMITTING…";
  try {
    const newVotes=(STATE.candidates[selectedCandidate]||0)+1;
    await Promise.all([
      fbSaveCandidate(selectedCandidate,newVotes),
      fbSaveVoter(currentVoterData.vid,currentVoterData.name,
                  currentVoterData.age,currentVoterData.gender,
                  selectedCandidate,capturedPhotoUrl||"")
    ]);
    await fbWriteLog(`${currentVoterData.name} voted for ${selectedCandidate}`);
    const msgEl=document.getElementById("success-msg");
    if(msgEl) msgEl.textContent=`Your vote for ${selectedCandidate} has been recorded. Thank you, ${currentVoterData.name}!`;
    showVoteStep("step-4"); setStepPip(4);
    showToast("Vote cast successfully! 🎉","success");
  } catch(e) {
    showToast("Something went wrong. Please try again.","error");
    console.error(e);
    btn.disabled=false; btn.textContent="CONFIRM VOTE";
  }
});

// ─────────────────────────────────────────────
//  RESULTS
// ─────────────────────────────────────────────
function renderResults() {
  const board=document.getElementById("results-board");
  const totalEl=document.getElementById("results-total");
  if(!board) return;
  const total=totalVotes();
  if(totalEl) totalEl.textContent=`Total votes cast: ${total}`;
  const sorted=Object.entries(STATE.candidates).sort((a,b)=>b[1]-a[1]);
  const maxV=sorted[0]?.[1]||1;
  board.innerHTML=sorted.map(([name,votes],i)=>{
    const pct=total>0?((votes/total)*100).toFixed(1):"0.0";
    const barPct=total>0?((votes/maxV)*100).toFixed(1):"0";
    const isTop=i===0&&votes>0;
    return `
      <div class="result-row ${isTop?"top":""}" style="animation-delay:${i*0.06}s">
        <div class="result-rank">${String(i+1).padStart(2,"0")}</div>
        <div class="result-info">
          <div class="result-name">${name}</div>
          <div class="result-votes">${votes} vote${votes!==1?"s":""}</div>
        </div>
        <div class="result-bar-wrap">
          <div class="result-bar-bg"><div class="result-bar-fill" style="width:0%" data-target="${barPct}%"></div></div>
        </div>
        <div class="result-percent">${pct}%</div>
      </div>`;
  }).join("");
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    board.querySelectorAll(".result-bar-fill").forEach(el=>{ el.style.width=el.dataset.target; });
  }));
}

// ─────────────────────────────────────────────
//  ADMIN LOGIN
// ─────────────────────────────────────────────
document.getElementById("btn-admin-login").addEventListener("click",()=>{
  const pw=document.getElementById("admin-pw").value;
  const errEl=document.getElementById("admin-err");
  if(pw===STATE.ADMIN_PASSWORD){
    STATE.adminLoggedIn=true;
    document.getElementById("admin-login").classList.add("hidden");
    document.getElementById("admin-dashboard").classList.remove("hidden");
    renderAdminDashboard();
    fbWriteLog("Admin logged in");
    showToast("Admin access granted.","success");
  } else {
    if(errEl) errEl.textContent="Incorrect password. Access denied.";
    showToast("Wrong password.","error");
  }
});
document.getElementById("admin-pw").addEventListener("keydown",e=>{
  if(e.key==="Enter") document.getElementById("btn-admin-login").click();
});
document.getElementById("btn-logout").addEventListener("click",()=>{
  STATE.adminLoggedIn=false;
  document.getElementById("admin-pw").value="";
  document.getElementById("admin-err").textContent="";
  document.getElementById("admin-login").classList.remove("hidden");
  document.getElementById("admin-dashboard").classList.add("hidden");
  if(barChart){ barChart.destroy(); barChart=null; }
  if(pieChart){ pieChart.destroy(); pieChart=null; }
  fbWriteLog("Admin logged out");
  showToast("Logged out.","info");
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
  renderCharts();
  renderVoterPhotos();
}

function renderAdminStats() {
  const total=totalVotes();
  const numCands=Object.keys(STATE.candidates).length;
  const leader=total>0?Object.entries(STATE.candidates).sort((a,b)=>b[1]-a[1])[0][0].split(" ")[0]:"—";
  const setVal=(id,v)=>{ const el=document.getElementById(id); if(el) el.textContent=v; };
  setVal("stat-total",total); setVal("stat-candidates",numCands); setVal("stat-leader",leader);
}

// ─────────── CHARTS ───────────
function renderCharts() {
  const labels=Object.keys(STATE.candidates);
  const data=Object.values(STATE.candidates);
  const total=totalVotes();

  const COLORS=[
    "rgba(232,255,71,0.85)","rgba(58,134,255,0.85)","rgba(255,71,87,0.85)",
    "rgba(52,211,153,0.85)","rgba(251,191,36,0.85)","rgba(167,139,250,0.85)",
    "rgba(251,113,133,0.85)","rgba(94,234,212,0.85)"
  ];

  // Bar Chart
  const barCtx=document.getElementById("bar-chart");
  if(barCtx){
    if(barChart){ barChart.destroy(); barChart=null; }
    barChart=new Chart(barCtx,{
      type:"bar",
      data:{
        labels,
        datasets:[{
          label:"Votes",
          data,
          backgroundColor:COLORS,
          borderColor:COLORS.map(c=>c.replace("0.85","1")),
          borderWidth:1,
          borderRadius:4
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.parsed.y} votes (${total>0?((ctx.parsed.y/total)*100).toFixed(1):0}%)`}} },
        scales:{
          x:{ ticks:{color:"#8a9bbf",font:{family:"JetBrains Mono",size:10}}, grid:{color:"rgba(255,255,255,0.05)"} },
          y:{ ticks:{color:"#8a9bbf",font:{family:"JetBrains Mono",size:10},stepSize:1}, grid:{color:"rgba(255,255,255,0.05)"}, beginAtZero:true }
        }
      }
    });
  }

  // Pie Chart
  const pieCtx=document.getElementById("pie-chart");
  if(pieCtx){
    if(pieChart){ pieChart.destroy(); pieChart=null; }
    pieChart=new Chart(pieCtx,{
      type:"doughnut",
      data:{ labels, datasets:[{ data, backgroundColor:COLORS, borderColor:"#080a0d", borderWidth:3, hoverOffset:8 }] },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{
          legend:{ position:"bottom", labels:{color:"#8a9bbf",font:{family:"JetBrains Mono",size:10},padding:12,boxWidth:12} },
          tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${ctx.parsed} votes (${total>0?((ctx.parsed/total)*100).toFixed(1):0}%)`}}
        },
        cutout:"60%"
      }
    });
  }
}

// Voter Photos
function renderVoterPhotos() {
  const grid=document.getElementById("voter-photos-grid"); if(!grid) return;
  const voters=Object.values(STATE.voters).filter(v=>v.photoDataUrl);
  if(voters.length===0){
    grid.innerHTML=`<p class="no-photos">No voter photos yet.</p>`; return;
  }
  grid.innerHTML=voters.map(v=>`
    <div class="voter-photo-card">
      <img src="${v.photoDataUrl}" alt="${v.name}"/>
      <span>${v.name.split(" ")[0]}</span>
    </div>
  `).join("");
}

function renderAdminResultsTable() {
  const container=document.getElementById("admin-results-table"); if(!container) return;
  const total=totalVotes();
  const sorted=Object.entries(STATE.candidates).sort((a,b)=>b[1]-a[1]);
  const maxV=sorted[0]?.[1]||1;
  container.innerHTML=sorted.map(([name,votes])=>{
    const barPct=total>0?((votes/maxV)*100).toFixed(1):"0";
    return `
      <div class="admin-results-row">
        <div class="admin-candidate-name">${name}</div>
        <div class="admin-bar-wrap"><div class="admin-bar-bg"><div class="admin-bar-fill" style="width:${barPct}%"></div></div></div>
        <div class="admin-vote-count">${votes} / ${total>0?((votes/total)*100).toFixed(1):"0.0"}%</div>
      </div>`;
  }).join("");
}

function renderCandidateManageList() {
  const list=document.getElementById("candidate-manage-list"); if(!list) return;
  list.innerHTML=Object.keys(STATE.candidates).map(name=>`
    <li class="cml-item">
      <span class="cml-name">${name}</span>
      <button class="cml-del" data-name="${name}" title="Remove">✕</button>
    </li>
  `).join("");
  list.querySelectorAll(".cml-del").forEach(btn=>{
    btn.addEventListener("click",async()=>{
      const name=btn.dataset.name;
      if(confirm(`Remove candidate "${name}"?`)){
        await fbDeleteCandidate(name);
        await fbWriteLog(`Admin removed candidate: ${name}`);
        showToast(`${name} removed.`,"info");
      }
    });
  });
}

function renderLogViewer() {
  const el=document.getElementById("log-scroll"); if(!el) return;
  if(!STATE.logs.length){ el.innerHTML=`<div class="log-entry"><span class="log-txt">No activity yet.</span></div>`; return; }
  el.innerHTML=STATE.logs.map(({time,msg})=>`
    <div class="log-entry"><span class="log-time">${time}</span><span class="log-txt">${msg}</span></div>
  `).join("");
}

function updateVotingToggle() {
  const btn=document.getElementById("toggle-voting");
  const dot=document.getElementById("voting-dot");
  const label=document.getElementById("voting-label");
  if(!btn) return;
  if(STATE.votingOpen){ dot.className="dot on"; label.textContent="Voting: OPEN"; btn.classList.add("active"); }
  else { dot.className="dot off"; label.textContent="Voting: CLOSED"; btn.classList.remove("active"); }
}

document.getElementById("toggle-voting").addEventListener("click",async()=>{
  STATE.votingOpen=!STATE.votingOpen;
  const status=STATE.votingOpen?"OPENED":"CLOSED";
  await fbSaveSettings();
  await fbWriteLog(`Admin ${status} voting`);
  updateVotingToggle();
  showToast(`Voting is now ${status}.`,STATE.votingOpen?"success":"error");
});

document.getElementById("btn-add-candidate").addEventListener("click",async()=>{
  const input=document.getElementById("new-candidate-name");
  const name=input.value.trim().replace(/\b\w/g,c=>c.toUpperCase());
  if(!name){ showToast("Enter a candidate name.","error"); return; }
  if(STATE.candidates.hasOwnProperty(name)){ showToast("Candidate already exists.","error"); return; }
  await fbSaveCandidate(name,0);
  await fbWriteLog(`Admin added candidate: ${name}`);
  input.value=""; showToast(`${name} added.`,"success");
});
document.getElementById("new-candidate-name").addEventListener("keydown",e=>{
  if(e.key==="Enter") document.getElementById("btn-add-candidate").click();
});

// ─────────── RESET ALL VOTES ───────────
document.getElementById("btn-reset-confirm").addEventListener("click",async()=>{
  if(!confirm("⚠️ This will DELETE all votes and voter records. Are you sure?")) return;
  if(!confirm("FINAL WARNING: All vote data will be permanently erased. Continue?")) return;
  try {
    // Reset all candidate vote counts
    const batch=db.batch();
    Object.keys(STATE.candidates).forEach(name=>{
      batch.set(candidatesRef.doc(safeId(name)),{name,votes:0});
    });
    await batch.commit();
    // Delete all voters
    const voterSnap=await votersRef.get();
    const vBatch=db.batch();
    voterSnap.forEach(doc=>vBatch.delete(doc.ref));
    await vBatch.commit();
    // Delete all logs
    const logSnap=await db.collection("logs").get();
    const lBatch=db.batch();
    logSnap.forEach(doc=>lBatch.delete(doc.ref));
    await lBatch.commit();
    await fbWriteLog("Admin reset all votes");
    showToast("All votes have been reset.","success");
  } catch(e){ showToast("Reset failed: "+e.message,"error"); console.error(e); }
});

// ─────────── EXPORT ───────────
document.getElementById("btn-export").addEventListener("click",async()=>{
  const total=totalVotes();
  const sorted=Object.entries(STATE.candidates).sort((a,b)=>b[1]-a[1]);
  const winner=sorted[0]?.[0]||"N/A";
  let report=`ELECTION RESULTS REPORT\nElection: ${STATE.electionName}\n`;
  report+=`Year: ${STATE.electionYear} | Location: ${STATE.electionLocation}\n`;
  report+=`Generated: ${new Date().toLocaleString("en-IN")}\n${"─".repeat(50)}\n\nCANDIDATE RESULTS\n\n`;
  sorted.forEach(([name,votes],i)=>{
    const pct=total>0?((votes/total)*100).toFixed(2):"0.00";
    report+=`${String(i+1).padStart(2,"0")}. ${name.padEnd(22)} ${String(votes).padStart(3)} votes  (${pct}%)\n`;
  });
  report+=`\n${"─".repeat(50)}\nTotal Votes Cast : ${total}\nWinner : ${winner}\n\nVOTER LIST\n\n`;
  Object.values(STATE.voters).forEach(v=>{
    report+=`${v.name} | Age: ${v.age} | ${v.gender} | Voted: ${STATE.candidates[v.candidate]!==undefined?v.candidate:"?"}\n`;
  });
  report+=`\nACTIVITY LOG\n\n`;
  STATE.logs.forEach(({time,msg})=>{ report+=`[${time}] ${msg}\n`; });
  const blob=new Blob([report],{type:"text/plain"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`election_results_${STATE.electionYear}.txt`; a.click();
  URL.revokeObjectURL(url);
  await fbWriteLog("Admin exported results report");
  showToast("Report downloaded.","success");
});

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
async function init() {
  setLoading(true,"CONNECTING TO DATABASE…");
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db          =firebase.firestore();
    settingsRef =db.collection("election").doc("settings");
    candidatesRef=db.collection("candidates");
    votersRef   =db.collection("voters");
    await seedDefaultsIfEmpty();
    attachListeners();
    setLoading(false);
    showToast("Connected to live database.","success");
  } catch(e) {
    setLoading(false);
    console.error("Firebase init failed:",e);
    showToast("⚠️ Database connection failed. Check Firebase config.","error");
    Object.assign(STATE.candidates,DEFAULT_CANDIDATES);
    buildTicker(); renderCandidatesGrid();
  }
}

init();
