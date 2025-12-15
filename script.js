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
// POP IT Bingo Prototype
// 4x4 ticket, 30-ball universe, 20 calls, numbers called every 3s

(function () {
  // State
  const BOARD_SIZE = 4; // 4x4
  const TOTAL_TICKET_NUMBERS = 16;
  const UNIVERSE_MAX = 30;
  const TOTAL_CALLS = 20;
  const CALL_INTERVAL_MS = 3000;

  let ticketNumbers = []; // 16 unique numbers
  let marked = new Set(); // indices 0..15 that are marked
  let calledNumbers = []; // called numbers sequence
  let toCall = []; // queue of numbers to call
  let callTimer = null; // repeating interval for calls after the next one
  let timeLeft = 0;
  let countdownTimer = null;
  let nextCallTimeout = null; // one-shot timeout used when resuming
  let endGraceTimeout = null; // wait before ending to allow final mark
  let autoMark = false;
  let lastPrizeLinesAwarded = 0;
  let awardedFullHouse = false;
  let hasStarted = false;
  let isPaused = false;
  // Delayed highlight timers for called-but-unmarked numbers
  const highlightTimeouts = new Map(); // number -> timeoutId
  // Track completed lines to trigger glow only once per line
  const completedLineIds = new Set(); // e.g., 'row-0', 'col-2', 'diag-0'

  // DOM
  const boardEl = document.getElementById('board');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resetBtn = document.getElementById('resetBtn');
  const autoMarkToggle = document.getElementById('autoMarkToggle');
  const prizeList = document.getElementById('prizeList');
  const calledStream = document.getElementById('calledStream');
  const callStatus = document.getElementById('callStatus');
  const lastCall = document.getElementById('lastCall');
  const prizeKeyList = document.getElementById('prizeKey');
  const stakeModal = document.getElementById('stakeModal');
  const stakeButtons = () => Array.from(document.querySelectorAll('.stake-btn'));
  const endModal = document.getElementById('endModal');
  const endTitle = document.getElementById('endTitle');
  const endBody = document.getElementById('endBody');
  const endAmountWrap = document.getElementById('endAmountWrap');
  const endAmount = document.getElementById('endAmount');
  const playAgainBtn = document.getElementById('playAgainBtn');

  let selectedStake = null; // pounds

  // Prize Key mapping
  const PRIZE_KEY = {
    2: 'Free Play',
    3: 'Stake Back',
    4: 'x4 stake',
    5: 'x5 stake',
    6: 'x10 stake',
    7: 'x20 stake',
    8: 'x50 stake',
    9: 'x100 stake',
  };

  // Audio (synth pop)
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        audioCtx = new Ctx();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }
  function playPop() {
    try {
      ensureAudio();
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime + 0.001;

      // Short click/pop: filtered noise + sine blip with downward sweep
      const master = audioCtx.createGain();
      master.gain.value = 0.6;
      master.connect(audioCtx.destination);

      // Sine blip
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(700, t0);
      osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.09);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(gain).connect(master);
      osc.start(t0);
      osc.stop(t0 + 0.14);

      // Tiny noise burst for tactile click
      const bufferSize = 2 * audioCtx.sampleRate * 0.05; // 50ms
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * 0.5;
      }
      const noise = audioCtx.createBufferSource();
      noise.buffer = noiseBuffer;
      const nGain = audioCtx.createGain();
      nGain.gain.setValueAtTime(0.25, t0);
      nGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
      noise.connect(nGain).connect(master);
      noise.start(t0);
      noise.stop(t0 + 0.06);
    } catch (_) {
      // ignore audio errors
    }
    // Light haptic feedback on pop (if supported)
    triggerHaptic('pop');
  }

  // Utils
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function sampleUniqueIntegers(count, maxInclusive) {
    const pool = Array.from({ length: maxInclusive }, (_, i) => i + 1);
    shuffle(pool);
    return pool.slice(0, count);
  }

  // Ticket generation
  function generateTicket() {
    ticketNumbers = sampleUniqueIntegers(TOTAL_TICKET_NUMBERS, UNIVERSE_MAX);
  }

  // Render board
  function renderBoard() {
    boardEl.innerHTML = '';
    ticketNumbers.forEach((num, idx) => {
      const cell = document.createElement('button');
      cell.className = 'cell';
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Number ${num}`);
      cell.dataset.index = String(idx);
      cell.dataset.num = String(num);
      cell.innerHTML = `<span class="num">${num}</span>`;

      cell.addEventListener('click', () => {
        ensureAudio();
        const n = Number(cell.dataset.num);
        const i = Number(cell.dataset.index);
        const isCalled = calledNumbers.includes(n);
        const isMarked = marked.has(i);
        if (!isCalled || isMarked) {
          // invalid click
          cell.classList.add('invalid');
          setTimeout(() => cell.classList.remove('invalid'), 220);
          return;
        }
        markCell(i, true);
      });

      boardEl.appendChild(cell);
    });

    updateCalledHighlights();
  }

  function updateCalledHighlights() {
    const cells = boardEl.querySelectorAll('.cell');
    cells.forEach((cell) => {
      const i = Number(cell.dataset.index);
      const isMarked = marked.has(i);
      // Maintain marked state
      cell.classList.toggle('marked', isMarked);
      // If marked, ensure called highlight is removed
      if (isMarked) cell.classList.remove('called');
      // Do not auto-add 'called' highlight here; it is applied after 3s via timeout
    });
  }

  // Mark logic
  function markCell(index, play = false) {
    if (marked.has(index)) return;
    const n = ticketNumbers[index];
    if (!calledNumbers.includes(n)) return; // must be called

    marked.add(index);
    const cell = boardEl.querySelector(`.cell[data-index="${index}"]`);
    if (cell) {
      cell.classList.add('marked');
      cell.classList.remove('called');
    }
    // Cancel any pending delayed highlight for this number
    const ht = highlightTimeouts.get(n);
    if (ht) {
      clearTimeout(ht);
      highlightTimeouts.delete(n);
    }
  if (play) playPop();
  else triggerHaptic('mark');

    const lines = countCompletedLines();
    // Determine new completed lines and glow them
    const ids = listCompletedLineIds();
    ids.forEach((id) => {
      if (!completedLineIds.has(id)) {
        completedLineIds.add(id);
        glowLine(id);
      }
    });
    maybeAwardPrizes(lines);
    updateCalledHighlights();
  }

  // Line detection
  function getMarkedGrid() {
    const grid = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(false));
    for (let idx of marked) {
      const r = Math.floor(idx / BOARD_SIZE);
      const c = idx % BOARD_SIZE;
      grid[r][c] = true;
    }
    return grid;
  }

  function countCompletedLines() {
    const g = getMarkedGrid();
    let lines = 0;
    // Rows
    for (let r = 0; r < BOARD_SIZE; r++) {
      if (g[r].every(Boolean)) lines++;
    }
    // Cols
    for (let c = 0; c < BOARD_SIZE; c++) {
      let ok = true;
      for (let r = 0; r < BOARD_SIZE; r++) if (!g[r][c]) { ok = false; break; }
      if (ok) lines++;
    }
    // Diagonals
    let d1 = true, d2 = true;
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (!g[i][i]) d1 = false;
      if (!g[i][BOARD_SIZE - 1 - i]) d2 = false;
    }
    if (d1) lines++;
    if (d2) lines++;
    return lines;
  }

  function listCompletedLineIds() {
    const g = getMarkedGrid();
    const ids = [];
    // Rows
    for (let r = 0; r < BOARD_SIZE; r++) {
      if (g[r].every(Boolean)) ids.push(`row-${r}`);
    }
    // Cols
    for (let c = 0; c < BOARD_SIZE; c++) {
      let ok = true;
      for (let r = 0; r < BOARD_SIZE; r++) if (!g[r][c]) { ok = false; break; }
      if (ok) ids.push(`col-${c}`);
    }
    // Diagonals
    let d1 = true, d2 = true;
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (!g[i][i]) d1 = false;
      if (!g[i][BOARD_SIZE - 1 - i]) d2 = false;
    }
    if (d1) ids.push('diag-0');
    if (d2) ids.push('diag-1');
    return ids;
  }

  function glowLine(lineId) {
    // Apply a pulsing glow to the cells in the given line for 3 seconds
    const cellsToGlow = [];
    if (lineId.startsWith('row-')) {
      const r = Number(lineId.split('-')[1]);
      for (let c = 0; c < BOARD_SIZE; c++) cellsToGlow.push(r * BOARD_SIZE + c);
    } else if (lineId.startsWith('col-')) {
      const c = Number(lineId.split('-')[1]);
      for (let r = 0; r < BOARD_SIZE; r++) cellsToGlow.push(r * BOARD_SIZE + c);
    } else if (lineId === 'diag-0') {
      for (let i = 0; i < BOARD_SIZE; i++) cellsToGlow.push(i * BOARD_SIZE + i);
    } else if (lineId === 'diag-1') {
      for (let i = 0; i < BOARD_SIZE; i++) cellsToGlow.push(i * BOARD_SIZE + (BOARD_SIZE - 1 - i));
    }
    cellsToGlow.forEach((idx) => {
      const cell = boardEl.querySelector(`.cell[data-index="${idx}"]`);
      if (cell) {
        cell.classList.add('line-glow');
        setTimeout(() => cell.classList.remove('line-glow'), 3000);
      }
    });
    // Medium haptic for completed line
    triggerHaptic('line');
  }

  function maybeAwardPrizes(lines) {
    // Award when reaching thresholds (from prize key)
    const thresholds = Object.keys(PRIZE_KEY).map(Number).sort((a,b)=>a-b);
    for (const t of thresholds) {
      if (lines >= t && lastPrizeLinesAwarded < t) {
        const descriptor = PRIZE_KEY[t];
        addPrize(`${t}L${descriptor ? ' – ' + descriptor : ''}`);
        highlightPrizeKey(t);
        lastPrizeLinesAwarded = t;
        // Stronger haptic when a prize is awarded
        triggerHaptic('prize');
      }
    }
    // Full House when all numbers marked
    if (!awardedFullHouse && marked.size === TOTAL_TICKET_NUMBERS) {
      addPrize('Full House', true);
      awardedFullHouse = true;
      triggerHaptic('prize');
    }
  }

  function addPrize(label, celebrate = false) {
    const li = document.createElement('li');
    li.textContent = label;
    if (celebrate) li.classList.add('celebrate');
    prizeList.appendChild(li);
  }

  // Calling logic
  function prepareCalls() {
    const pool = Array.from({ length: UNIVERSE_MAX }, (_, i) => i + 1);
    shuffle(pool);
    toCall = pool.slice(0, TOTAL_CALLS);
  }

  function startCalling() {
    // Clear previous timers
    haltTimers();

    timeLeft = CALL_INTERVAL_MS;
    updateCountdown();
    countdownTimer = setInterval(() => {
      timeLeft -= 100;
      if (timeLeft < 0) timeLeft = 0;
      updateCountdown();
    }, 100);

    // Immediately call first number
    callNextNumber();
    timeLeft = CALL_INTERVAL_MS;

    callTimer = setInterval(() => {
      callNextNumber();
      timeLeft = CALL_INTERVAL_MS;
    }, CALL_INTERVAL_MS);
    updateControlsUI();
  }

  function updateCountdown() {
    // Next call timer UI removed; this remains a no-op to keep logic simple.
  }

  function callNextNumber() {
    if (calledNumbers.length >= TOTAL_CALLS) {
      stopCalling();
      scheduleEndGrace();
      return;
    }
    const n = toCall[calledNumbers.length];
    calledNumbers.push(n);
    lastCall.textContent = `Last call: ${n}`;
    callStatus.querySelector('strong').textContent = String(calledNumbers.length);

    // Stream update
    const chip = document.createElement('span');
    chip.className = 'chip latest';
    chip.textContent = String(n);
    // remove previous latest
    const prev = calledStream.querySelector('.chip.latest');
    if (prev) prev.classList.remove('latest');
    calledStream.prepend(chip);

    // Highlight on board and auto-mark if enabled
    updateCalledHighlights();
    // Schedule delayed highlight only if not marked within 3 seconds
    // If player marks before timeout, markCell cancels this
    const idxForN = ticketNumbers.indexOf(n);
    if (idxForN !== -1) {
      const existing = highlightTimeouts.get(n);
      if (existing) clearTimeout(existing);
      const tid = setTimeout(() => {
        // If still unmarked, add highlight
        if (!marked.has(idxForN)) {
          const cell = boardEl.querySelector(`.cell[data-index="${idxForN}"]`);
          if (cell) cell.classList.add('called');
        }
        highlightTimeouts.delete(n);
      }, 3000);
      highlightTimeouts.set(n, tid);
    }
    if (autoMark) {
      const idx = ticketNumbers.indexOf(n);
      if (idx !== -1 && !marked.has(idx)) {
        markCell(idx, true);
      }
    }

    // If finished
    if (calledNumbers.length >= TOTAL_CALLS) {
      stopCalling();
      scheduleEndGrace();
    }
    updateControlsUI();
  }

  function stopCalling() {
    haltTimers();
    isPaused = false;
    updateControlsUI();
  }

  function haltTimers() {
    if (callTimer) { clearInterval(callTimer); callTimer = null; }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (nextCallTimeout) { clearTimeout(nextCallTimeout); nextCallTimeout = null; }
    if (endGraceTimeout) { clearTimeout(endGraceTimeout); endGraceTimeout = null; }
  }

  // Controls
  function resetGame() {
    haltTimers();
    isPaused = false;
    hasStarted = false;
    ensureAudio(); // prime audio on user interaction
    // State reset
    // Clear any pending delayed highlights
    for (const [, t] of highlightTimeouts) clearTimeout(t);
    highlightTimeouts.clear();
    completedLineIds.clear();
    marked.clear();
    calledNumbers = [];
    lastPrizeLinesAwarded = 0;
    awardedFullHouse = false;
    prizeList.innerHTML = '';
    calledStream.innerHTML = '';
    callStatus.querySelector('strong').textContent = '0';
    lastCall.textContent = 'Last call: —';
    // Next call timer UI removed
  hideEndModal();

    // Ticket + calls
    generateTicket();
    renderBoard();
    prepareCalls();
    updateControlsUI();
  }

  function startGame() {
    resetGame();
    hasStarted = true;
    isPaused = false;
    startCalling();
  }

  function ensureStakeThenStart() {
    if (selectedStake == null) {
      showStakeModal();
      return;
    }
    startGame();
  }

  function getStake() {
    return selectedStake ?? 1;
  }

  function formatGBP(amount) {
    try {
      return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);
    } catch (_) {
      return `£${amount.toFixed(2)}`;
    }
  }

  function getPrizeMultiplier(lines) {
    // From PRIZE_KEY, return numeric multiplier, or 0 for Free Play / no cash
    const desc = PRIZE_KEY[lines];
    if (!desc) return 0;
    if (/^Stake Back$/i.test(desc)) return 1;
    const m = desc.match(/^x(\d+) stake$/i);
    return m ? parseInt(m[1], 10) : 0; // Free Play or unknown
  }

  function showEndModal() {
    if (!endModal) return;
    const lines = countCompletedLines();
    const stake = getStake();
    const multiplier = getPrizeMultiplier(lines);

    if (lines <= 1) {
      endTitle.textContent = 'No win this time!';
      endBody.textContent = 'Better luck next round.';
      endAmountWrap.classList.add('hidden');
    } else {
      endTitle.textContent = `Congratulations, you won the ${lines} line prize!`;
      const desc = PRIZE_KEY[lines];
      if (desc && /^x\d+ stake$/i.test(desc)) {
        const payout = stake * multiplier;
        endBody.textContent = `Your prize pays ${desc}.`;
        endAmount.textContent = `Payout: ${formatGBP(payout)}`;
        endAmountWrap.classList.remove('hidden');
      } else if (desc && /^Stake Back$/i.test(desc)) {
        const payout = stake * 1;
        endBody.textContent = 'Your prize returns your stake.';
        endAmount.textContent = `Payout: ${formatGBP(payout)}`;
        endAmountWrap.classList.remove('hidden');
      } else {
        // Free Play or unspecified
        endBody.textContent = desc ? `Your prize: ${desc}.` : 'Prize awarded.';
        endAmountWrap.classList.add('hidden');
      }
    }
    endModal.classList.remove('hidden');
    // Gentle haptic to draw attention to end-of-game modal
    triggerHaptic('modal');
  }

  function hideEndModal() {
    if (!endModal) return;
    endModal.classList.add('hidden');
  }

  function scheduleEndGrace() {
    if (endGraceTimeout) { clearTimeout(endGraceTimeout); }
    endGraceTimeout = setTimeout(() => {
      endGraceTimeout = null;
      showEndModal();
    }, 3000);
  }

  function showStakeModal() {
    if (!stakeModal) return;
    stakeModal.classList.remove('hidden');
  }

  function hideStakeModal() {
    if (!stakeModal) return;
    stakeModal.classList.add('hidden');
  }

  function isFinished() {
    return calledNumbers.length >= TOTAL_CALLS;
  }

  function pauseGame() {
    if (!hasStarted || isFinished() || isPaused) return;
    haltTimers();
    isPaused = true;
    updateCountdown();
    updateControlsUI();
  }

  function resumeGame() {
    if (!hasStarted || isFinished() || !isPaused) return;
    // Resume countdown and schedule next call after remaining timeLeft
    updateCountdown();
    countdownTimer = setInterval(() => {
      timeLeft -= 100;
      if (timeLeft < 0) timeLeft = 0;
      updateCountdown();
    }, 100);

    nextCallTimeout = setTimeout(() => {
      nextCallTimeout = null;
      callNextNumber();
      timeLeft = CALL_INTERVAL_MS;
      callTimer = setInterval(() => {
        callNextNumber();
        timeLeft = CALL_INTERVAL_MS;
      }, CALL_INTERVAL_MS);
      updateControlsUI();
    }, Math.max(0, timeLeft));

    isPaused = false;
    updateControlsUI();
  }

  function setAutoMark(value) {
    autoMark = value;
    // If turning on auto-mark, immediately auto-pop any already called numbers
    if (autoMark) {
      ticketNumbers.forEach((n, idx) => {
        if (calledNumbers.includes(n) && !marked.has(idx)) {
          markCell(idx, false);
        }
      });
    }
    updateCalledHighlights();
  }

  function updateControlsUI() {
    // Pause button
    if (pauseBtn) {
      pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
      const disablePause = !hasStarted || isFinished();
      pauseBtn.disabled = disablePause;
    }
    // Reset button
    if (resetBtn) {
      resetBtn.disabled = false; // always available
    }
  }

  // Wire up
  startBtn.addEventListener('click', () => {
    ensureStakeThenStart();
  });

  pauseBtn.addEventListener('click', () => {
    ensureAudio();
    if (isPaused) resumeGame(); else pauseGame();
  });

  resetBtn.addEventListener('click', () => {
    ensureAudio();
    resetGame();
  });

  playAgainBtn?.addEventListener('click', () => {
    hideEndModal();
    // Prompt for stake selection at the start of a new game
    selectedStake = null;
    showStakeModal();
  });

  // Stake selection
  stakeButtons().forEach((btn) => {
    btn.addEventListener('click', () => {
      const v = parseFloat(btn.dataset.stake || '1');
      if (Number.isFinite(v) && v > 0) {
        selectedStake = v;
        hideStakeModal();
        startGame();
      }
    });
  });


  autoMarkToggle.addEventListener('change', (e) => {
    ensureAudio();
    setAutoMark(!!e.target.checked);
  });

  // Initialize default state
  (function init() {
    generateTicket();
    renderBoard();
    prepareCalls();
    setAutoMark(false); // default manual mark
    renderPrizeKey();
    updateControlsUI();
    // Show stake selection when user presses Start; or uncomment to auto-show on load:
    // showStakeModal();
  })();

  function renderPrizeKey() {
    if (!prizeKeyList) return;
    prizeKeyList.innerHTML = '';
    const entries = Object.entries(PRIZE_KEY)
      .map(([k, v]) => [Number(k), v])
      .sort((a, b) => a[0] - b[0]);
    for (const [lines, label] of entries) {
      const li = document.createElement('li');
      li.textContent = `${lines}L – ${label}`;
      li.dataset.lines = String(lines);
      prizeKeyList.appendChild(li);
    }
  }

  function highlightPrizeKey(lines) {
    if (!prizeKeyList) return;
    const li = prizeKeyList.querySelector(`li[data-lines="${lines}"]`);
    if (li) {
      li.classList.add('key-highlight');
      setTimeout(() => li.classList.remove('key-highlight'), 3000);
    }
  }

  // Haptics: simple patterns via navigator.vibrate (Android/Chrome; limited iOS support)
  function triggerHaptic(kind) {
    const vib = navigator && typeof navigator.vibrate === 'function' ? navigator.vibrate.bind(navigator) : null;
    if (vib) {
      // Android/Chrome and some platforms
      switch (kind) {
        case 'pop': vib([10]); break;
        case 'mark': vib([8]); break;
        case 'line': vib([14, 30, 14]); break;
        case 'prize': vib([20, 30, 20, 40, 30]); break;
        case 'modal': vib([12]); break;
        default: vib([8]);
      }
    } else {
      // iOS Safari doesn't support navigator.vibrate. Use a brief visual bump.
      const lastChip = calledStream.querySelector('.chip.latest');
      // Bump the last called chip and any currently interacted cells for feedback.
      if (lastChip) {
        lastChip.style.transform = 'scale(1.05)';
        lastChip.style.transition = 'transform 120ms ease';
        setTimeout(() => { lastChip.style.transform = ''; }, 140);
      }
      const activeCell = boardEl.querySelector('.cell.called');
      if (activeCell) {
        activeCell.classList.add('haptic-bump');
        setTimeout(() => activeCell.classList.remove('haptic-bump'), 140);
      }
    }
  }
})();
