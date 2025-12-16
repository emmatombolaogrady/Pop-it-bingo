// Pop-It Bingo core logic
const BOARD_SIZE = 4; // 4x4
const TOTAL_TICKET_NUMBERS = 16;
const UNIVERSE_MAX = 30;
const TOTAL_CALLS = 20;
const CALL_INTERVAL_MS = 3000;

// Prize key mapping: lines -> label + reward text (multiplier kept for potential payouts)
const PRIZE_KEY = {
  1: { label: "1L", reward: "No win", multiplier: 0 },
  2: { label: "2L", reward: "Free Play", multiplier: 0 },
  3: { label: "3L", reward: "x1 Stake", multiplier: 1 },
  4: { label: "4L", reward: "x2 Stake", multiplier: 2 },
  5: { label: "5L", reward: "x5 Stake", multiplier: 5 },
  6: { label: "6L", reward: "x10 Stake", multiplier: 10 },
  7: { label: "7L", reward: "x25 Stake", multiplier: 25 },
  8: { label: "8L", reward: "x50 Stake", multiplier: 50 },
  10: { label: "Full House", reward: "x100 Stake", multiplier: 100 },
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
  // Bubble-wrap style pop: click transient + short pitch blip + tiny noise burst
  ensureAudio();

  const now = audioCtx.currentTime;
  const master = audioCtx.createGain();
  master.gain.setValueAtTime(0.8, now);
  master.connect(audioCtx.destination);

  // Slight randomization to avoid identical pops
  const detune = (Math.random() * 80) - 40; // +/- 40 Hz
  const blipStart = 700 + detune;
  const blipEnd = 360 + detune * 0.6;

  // Click transient (very short highpass noise)
  const clickBuf = audioCtx.createBuffer(1, 256, audioCtx.sampleRate);
  const cdata = clickBuf.getChannelData(0);
  for (let i = 0; i < 256; i++) cdata[i] = (Math.random() * 2 - 1);
  const click = audioCtx.createBufferSource();
  click.buffer = clickBuf;
  const hp = audioCtx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.setValueAtTime(1800, now);
  const clickGain = audioCtx.createGain();
  clickGain.gain.setValueAtTime(0.0, now);
  clickGain.gain.linearRampToValueAtTime(0.18, now + 0.003);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
  click.connect(hp); hp.connect(clickGain); clickGain.connect(master);
  click.start(now);
  click.stop(now + 0.03);

  // Tone blip (square/saw mix for brightness)
  const tone = audioCtx.createOscillator();
  const toneGain = audioCtx.createGain();
  const toneMix = audioCtx.createGain();
  const tone2 = audioCtx.createOscillator(); // mix two waveforms for texture
  tone.type = "square";
  tone2.type = "sawtooth";
  tone.frequency.setValueAtTime(blipStart, now);
  tone.frequency.exponentialRampToValueAtTime(blipEnd, now + 0.055);
  tone2.frequency.setValueAtTime(blipStart, now);
  tone2.frequency.exponentialRampToValueAtTime(blipEnd, now + 0.055);
  toneGain.gain.setValueAtTime(0.0, now);
  toneGain.gain.linearRampToValueAtTime(0.22, now + 0.004);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
  tone.connect(toneMix); tone2.connect(toneMix);
  toneMix.gain.setValueAtTime(0.7, now);
  toneMix.connect(toneGain); toneGain.connect(master);
  tone.start(now); tone2.start(now);
  tone.stop(now + 0.11); tone2.stop(now + 0.11);

  // Tiny noise puff (bandpass for the "air")
  const bufferSize = 1024;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * 0.5;
  const noise = audioCtx.createBufferSource(); noise.buffer = noiseBuffer;
  const bp = audioCtx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.setValueAtTime(1700, now); bp.Q.setValueAtTime(0.8, now);
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.0, now);
  noiseGain.gain.linearRampToValueAtTime(0.16, now + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
  noise.connect(bp); bp.connect(noiseGain); noiseGain.connect(master);
  noise.start(now);
  noise.stop(now + 0.05);
}

// Subtle audio tick used as fallback for iOS where Vibration API isn't available
function playTick(freq = 340, durationMs = 60, volume = 0.08) {
  ensureAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + durationMs / 1000);
}

// Haptics
function triggerHaptic(kind = "tap") {
  const supportsVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  if (supportsVibrate) {
    switch (kind) {
      case "line":
        navigator.vibrate([20, 40, 20]);
        break;
      case "win":
        navigator.vibrate([30, 60, 30, 90]);
        break;
      case "tap":
      default:
        navigator.vibrate(15);
        break;
    }
  } else {
    // iOS-friendly visual/audio fallback
    const cls = kind === "win" ? "haptic-win" : kind === "line" ? "haptic-line" : "haptic-bump";
    const dur = kind === "win" ? 500 : kind === "line" ? 220 : 140;
    document.body.classList.add(cls);
    setTimeout(() => document.body.classList.remove(cls), dur);
    // tiny audio tick to enhance perceived haptic
    if (kind === "win") {
      playTick(300, 80); setTimeout(() => playTick(280, 80), 120); setTimeout(() => playTick(260, 100), 280);
    } else if (kind === "line") {
      playTick(320, 70);
    } else {
      playTick(360, 60);
    }
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
const endTitleEl = document.getElementById("endTitle");
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
  // Show requested items including 1L and Full House
  const items = [1,2,3,4,5,6,7,8,10];
  for (const lines of items) {
    const item = PRIZE_KEY[lines];
    if (!item) continue;
    const li = document.createElement("li");
    li.id = `key-${lines}`;
    const left = document.createElement("span"); left.textContent = item.label;
    const right = document.createElement("strong"); right.textContent = item.reward;
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
    setTimeout(() => cell.classList.remove("line-glow"), 3000);
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
  // cancel delayed highlight if pending for this cell
  const pending = highlightTimeouts.get(index);
  if (pending) { clearTimeout(pending); highlightTimeouts.delete(index); }
  const cellEl = boardEl.children[index];
  if (cellEl) {
    cellEl.classList.add("marked");
    cellEl.classList.remove("called");
  }
  if (playEffects) { playPop(); triggerHaptic("tap"); }
  const lines = countCompletedLines();
  // Glow any newly completed lines for 3 seconds
  const ids = listCompletedLineIds();
  ids.forEach((id) => {
    if (!completedLineIds.has(id)) {
      completedLineIds.add(id);
      glowLine(id);
    }
  });
  maybeAwardPrizes(lines);
}

function prepareCalls() {
  const universe = Array.from({length: UNIVERSE_MAX}, (_,i) => i+1);
  const shuffled = universe.sort(() => Math.random() - 0.5);
  toCall = shuffled.slice(0, TOTAL_CALLS);
  calledNumbers = [];
  numbersCalledCountEl.textContent = `0/${TOTAL_CALLS}`;
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
    // 3s grace to allow manual marking; then auto-mark any remaining matches and finish
    endGraceTimeout = setTimeout(() => {
      autoMarkRemainingMatches();
      finishGame();
    }, 3000);
    return;
  }
  const num = toCall.shift();
  calledNumbers.push(num);
  numbersCalledCountEl.textContent = `${calledNumbers.length}/${TOTAL_CALLS}`;
  lastCallEl.textContent = String(num);

  const chip = document.createElement("span"); chip.className = "chip"; chip.textContent = String(num);
  calledStreamEl.appendChild(chip);

  // delayed called highlight on board for unmarked cells
  ticketNumbers.forEach((n, idx) => {
    if (n === num) {
      // ensure any previous timer is cleared
      if (highlightTimeouts.has(idx)) {
        clearTimeout(highlightTimeouts.get(idx));
        highlightTimeouts.delete(idx);
      }
      // after 3s, if still unmarked, add 'called' highlight to just this cell
      const t = setTimeout(() => {
        if (!marked.has(idx)) {
          const cell = boardEl.children[idx];
          if (cell) cell.classList.add("called");
        }
        highlightTimeouts.delete(idx);
      }, 3000);
      highlightTimeouts.set(idx, t);
      // auto-mark if enabled
      if (autoMark) markCell(idx, true);
    }
  });
}

// At end of game, ensure any called numbers on the ticket are marked
function autoMarkRemainingMatches() {
  ticketNumbers.forEach((num, idx) => {
    if (calledNumbers.includes(num) && !marked.has(idx)) {
      // mark silently without extra effects; cancel any pending highlight
      const pending = highlightTimeouts.get(idx);
      if (pending) { clearTimeout(pending); highlightTimeouts.delete(idx); }
      markCell(idx, false);
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
  let titleText = "";
  let msg = "";
  if (lines <= 1) {
    titleText = "Game over! No win this time";
    msg = "";
    if (endTitleEl) endTitleEl.textContent = titleText;
    endSummaryEl.textContent = msg;
    showEndModal();
    return;
  }

  // For wins: pre-highlight all completed lines for 3s, then show modal
  titleText = "Congratulations you are a winner";
  const prize = PRIZE_KEY[Math.min(lines, 10)];
  const rewardText = prize?.reward ?? "";
  msg = `You won the ${lines} line prize - ${rewardText}`;
  if (endTitleEl) endTitleEl.textContent = titleText;
  endSummaryEl.textContent = msg;

  // Trigger glow on all completed lines
  const ids = listCompletedLineIds();
  ids.forEach((id) => glowLine(id));

  // After 3s of glow, show modal and trigger win haptic
  setTimeout(() => {
    showEndModal();
    triggerHaptic("win");
  }, 3000);
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
