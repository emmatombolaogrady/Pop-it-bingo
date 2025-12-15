// Pop-It Bingo core logic
const BOARD_SIZE = 4; // 4x4
const TOTAL_TICKET_NUMBERS = 16;
const UNIVERSE_MAX = 30;
const TOTAL_CALLS = 20;
const CALL_INTERVAL_MS = 3000;

// Prize key mapping: lines -> descriptor/multiplier
const PRIZE_KEY = {
  2: { label: "2 Lines", reward: "Free Play", multiplier: 0 },
  3: { label: "3 Lines", reward: "Stake Back", multiplier: 1 },
  4: { label: "4 Lines", reward: "x2 stake", multiplier: 2 },
  5: { label: "5 Lines", reward: "x5 stake", multiplier: 5 },
  6: { label: "6 Lines", reward: "x10 stake", multiplier: 10 },
  7: { label: "7 Lines", reward: "x25 stake", multiplier: 25 },
  8: { label: "8 Lines", reward: "x50 stake", multiplier: 50 },
  9: { label: "Full House (9 lines)", reward: "x100 stake", multiplier: 100 },
};

// State
let ticketNumbers = [];
let marked = new Set();
let calledNumbers = [];
let toCall = [];
let callTimer = null;
let nextCallTimeout = null;
let isPaused = false;
let hasStarted = false;
let autoMark = false;
let selectedStake = 1; // default £1
let endGraceTimeout = null;
const highlightTimeouts = new Map();
const completedLineIds = new Set();
let lastPrizeLinesAwarded = 0;

// Audio
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}
function playPop() {
  ensureAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, audioCtx.currentTime);
  gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.15);
}

// Haptics
function triggerHaptic(kind = "tap") {
  const supportsVibrate = "vibrate" in navigator;
  if (supportsVibrate) {
    if (kind === "line") navigator.vibrate([8, 12, 8]);
    else navigator.vibrate(10);
  } else {
    // visual fallback bump
    document.body.classList.add("haptic-bump");
    setTimeout(() => document.body.classList.remove("haptic-bump"), 140);
  }
}

// DOM refs
const boardEl = document.getElementById("board");
const prizeKeyEl = document.getElementById("prizeKey");
const calledStreamEl = document.getElementById("calledStream");
const numbersCalledCountEl = document.getElementById("numbersCalledCount");
const lastCallEl = document.getElementById("lastCall");
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const autoMarkToggle = document.getElementById("autoMarkToggle");
const autoMarkState = document.getElementById("autoMarkState");
const stakeModal = document.getElementById("stakeModal");
const endModal = document.getElementById("endModal");
const endSummaryEl = document.getElementById("endSummary");
const playAgainBtn = document.getElementById("playAgainBtn");

function formatGBP(amount) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amount);
}

function showStakeModal() { stakeModal.classList.remove("hidden"); }
function hideStakeModal() { stakeModal.classList.add("hidden"); }
function showEndModal() { endModal.classList.remove("hidden"); }
function hideEndModal() { endModal.classList.add("hidden"); }

function generateTicket() {
  const nums = new Set();
  while (nums.size < TOTAL_TICKET_NUMBERS) {
    nums.add(1 + Math.floor(Math.random() * UNIVERSE_MAX));
  }
  ticketNumbers = Array.from(nums);
}

function renderPrizeKey() {
  prizeKeyEl.innerHTML = "";
  const items = [2,3,4,5,6,7,8,9];
  for (const lines of items) {
    const li = document.createElement("li");
    li.id = `key-${lines}`;
    const left = document.createElement("span"); left.textContent = PRIZE_KEY[lines].label;
    const right = document.createElement("strong"); right.textContent = PRIZE_KEY[lines].reward;
    li.appendChild(left); li.appendChild(right);
    prizeKeyEl.appendChild(li);
  }
}

function renderBoard() {
  boardEl.innerHTML = "";
  ticketNumbers.forEach((num, idx) => {
    const btn = document.createElement("button");
    btn.className = "cell";
    btn.textContent = String(num);
    btn.setAttribute("role", "gridcell");
    btn.addEventListener("click", () => markCell(idx, true));
    boardEl.appendChild(btn);
  });
}

function getMarkedGrid() {
  const grid = [];
  for (let r=0; r<BOARD_SIZE; r++) {
    const row = [];
    for (let c=0; c<BOARD_SIZE; c++) {
      const idx = r*BOARD_SIZE + c;
      row.push(marked.has(idx));
    }
    grid.push(row);
  }
  return grid;
}

function listCompletedLineIds() {
  const grid = getMarkedGrid();
  const ids = [];
  for (let r=0; r<BOARD_SIZE; r++) {
    if (grid[r].every(Boolean)) ids.push(`row-${r}`);
  }
  for (let c=0; c<BOARD_SIZE; c++) {
    let colFull = true;
    for (let r=0; r<BOARD_SIZE; r++) colFull &= grid[r][c];
    if (colFull) ids.push(`col-${c}`);
  }
  // diagonals
  let d1 = true, d2 = true;
  for (let i=0; i<BOARD_SIZE; i++) { d1 &= grid[i][i]; d2 &= grid[i][BOARD_SIZE-1-i]; }
  if (d1) ids.push("diag-main");
  if (d2) ids.push("diag-anti");
  return ids;
}

function countCompletedLines() { return listCompletedLineIds().length; }

function glowLine(lineId) {
  // crude effect: add glow to all cells in that line
  const coords = [];
  if (lineId.startsWith("row-")) {
    const r = Number(lineId.split("-")[1]);
    for (let c=0; c<BOARD_SIZE; c++) coords.push([r,c]);
  } else if (lineId.startsWith("col-")) {
    const c = Number(lineId.split("-")[1]);
    for (let r=0; r<BOARD_SIZE; r++) coords.push([r,c]);
  } else if (lineId === "diag-main") {
    for (let i=0; i<BOARD_SIZE; i++) coords.push([i,i]);
  } else if (lineId === "diag-anti") {
    for (let i=0; i<BOARD_SIZE; i++) coords.push([i,BOARD_SIZE-1-i]);
  }
  coords.forEach(([r,c]) => {
    const idx = r*BOARD_SIZE + c;
    const cell = boardEl.children[idx];
    cell.classList.add("line-glow");
    setTimeout(() => cell.classList.remove("line-glow"), 1600);
  });
}

function highlightPrizeKey(lines) {
  const li = document.getElementById(`key-${lines}`);
  if (li) {
    li.classList.add("key-highlight");
    setTimeout(() => li.classList.remove("key-highlight"), 1400);
  }
}

function addPrize(lines) {
  const prize = PRIZE_KEY[lines];
  if (!prize) return;
  lastPrizeLinesAwarded = Math.max(lastPrizeLinesAwarded, lines);
  highlightPrizeKey(lines);
}

function maybeAwardPrizes(currentLines) {
  for (let l = lastPrizeLinesAwarded + 1; l <= currentLines; l++) {
    if (PRIZE_KEY[l]) {
      addPrize(l);
      triggerHaptic("line");
    }
  }
}

function updateCalledHighlights() {
  // mark cells with .called if their number is in calledNumbers and not marked
  ticketNumbers.forEach((num, idx) => {
    const cell = boardEl.children[idx];
    const isCalled = calledNumbers.includes(num);
    const isMarked = marked.has(idx);
    if (isCalled && !isMarked) cell.classList.add("called");
    else cell.classList.remove("called");
  });
}

function markCell(index, playEffects = false) {
  if (marked.has(index)) return; // already marked
  marked.add(index);
  boardEl.children[index].classList.add("marked");
  if (playEffects) { playPop(); triggerHaptic("tap"); }
  const lines = countCompletedLines();
  maybeAwardPrizes(lines);
}

function prepareCalls() {
  const universe = Array.from({length: UNIVERSE_MAX}, (_,i) => i+1);
  const shuffled = universe.sort(() => Math.random() - 0.5);
  toCall = shuffled.slice(0, TOTAL_CALLS);
  calledNumbers = [];
  numbersCalledCountEl.textContent = "0";
  lastCallEl.textContent = "-";
  calledStreamEl.innerHTML = "";
  // clear any pending highlight timeouts
  highlightTimeouts.forEach(t => clearTimeout(t));
  highlightTimeouts.clear();
  // reset called state visuals
  updateCalledHighlights();
}

function callNextNumber() {
  if (toCall.length === 0) {
    stopCalling();
    // 3s grace before end modal
    endGraceTimeout = setTimeout(() => finishGame(), 3000);
    return;
  }
  const num = toCall.shift();
  calledNumbers.push(num);
  numbersCalledCountEl.textContent = String(calledNumbers.length);
  lastCallEl.textContent = String(num);

  const chip = document.createElement("span"); chip.className = "chip"; chip.textContent = String(num);
  calledStreamEl.appendChild(chip);

  // delayed called highlight on board for unmarked cells
  ticketNumbers.forEach((n, idx) => {
    if (n === num) {
      if (highlightTimeouts.has(idx)) clearTimeout(highlightTimeouts.get(idx));
      const t = setTimeout(() => updateCalledHighlights(), 3000);
      highlightTimeouts.set(idx, t);
      // auto-mark if enabled
      if (autoMark) markCell(idx, true);
    }
  });
}

function startCalling() {
  if (callTimer) return;
  callTimer = setInterval(() => {
    if (!isPaused) callNextNumber();
  }, CALL_INTERVAL_MS);
}

function stopCalling() {
  if (callTimer) { clearInterval(callTimer); callTimer = null; }
  if (nextCallTimeout) { clearTimeout(nextCallTimeout); nextCallTimeout = null; }
}

function resetGame() {
  stopCalling();
  if (endGraceTimeout) { clearTimeout(endGraceTimeout); endGraceTimeout = null; }
  hasStarted = false; isPaused = false; marked.clear(); completedLineIds.clear(); lastPrizeLinesAwarded = 0;
  // rerender ticket
  generateTicket(); renderBoard();
  // clear highlights and chips
  calledNumbers = []; toCall = []; numbersCalledCountEl.textContent = "0"; lastCallEl.textContent = "-"; calledStreamEl.innerHTML = ""; updateCalledHighlights();
  // buttons state
  startBtn.disabled = false; pauseBtn.disabled = true; pauseBtn.textContent = "Pause";
}

function finishGame() {
  const lines = countCompletedLines();
  let msg = "No lines this time.";
  if (lines === 1) msg = "1 line – close!";
  else if (lines >= 2) {
    const prize = PRIZE_KEY[Math.min(lines, 9)];
    const multiplier = prize?.multiplier ?? 0;
    const payout = selectedStake * multiplier;
    msg = `${prize.label}: ${prize.reward}. Payout ${formatGBP(payout)}.`;
  }
  endSummaryEl.textContent = msg;
  showEndModal();
}

function startGame() {
  if (hasStarted) return;
  hasStarted = true; isPaused = false; startBtn.disabled = true; pauseBtn.disabled = false; pauseBtn.textContent = "Pause";
  prepareCalls(); startCalling();
}

function pauseGame() { isPaused = true; pauseBtn.textContent = "Resume"; }
function resumeGame() { isPaused = false; pauseBtn.textContent = "Pause"; }

// Event wiring
startBtn.addEventListener("click", () => {
  if (!hasStarted) showStakeModal();
});

pauseBtn.addEventListener("click", () => {
  if (!hasStarted) return;
  if (isPaused) resumeGame(); else pauseGame();
});

resetBtn.addEventListener("click", () => { resetGame(); hideEndModal(); });
playAgainBtn.addEventListener("click", () => { hideEndModal(); resetGame(); showStakeModal(); });

autoMarkToggle.addEventListener("change", (e) => {
  autoMark = e.target.checked;
  if (autoMarkState) autoMarkState.textContent = autoMark ? "On" : "Off";
});

// Initialize toggle state text on load
if (autoMarkState) autoMarkState.textContent = autoMark ? "On" : "Off";

// Stake option handlers
function wireStakeButtons() {
  const buttons = Array.from(document.getElementsByClassName("stake-option"));
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedStake = Number(btn.dataset.stake);
      hideStakeModal();
      startGame();
    });
  });
}

// Init
(function init() {
  renderPrizeKey();
  generateTicket();
  renderBoard();
  updateCalledHighlights();
  wireStakeButtons();
})();
