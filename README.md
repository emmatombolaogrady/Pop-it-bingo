# Pop-It Bingo

A mobile-friendly bingo-style game prototype with a silicone pop-it look.

- 4x4 ticket (16 unique numbers, 1–30)
- 30-ball universe, 20 numbers called every 3s
- Manual mark with optional Auto-mark
- Pop sound on mark + light haptics
- Lines detected: rows, columns, diagonals (9 lines total)
- Prize Key: 2L Free Play, 3L Stake Back, 4L x2, 5L x5, 6L x10, 7L x25, 8L x50, 9L Full House x100
- Pause and Reset controls
- Stake selection modal at start; payout shown on end-of-game

## Run locally
Open `index.html` in a browser.

## Deploy (GitHub Pages)
This repo includes a GitHub Actions workflow that deploys the site to GitHub Pages on every push to `main`.
- Workflow: `.github/workflows/deploy.yml`
- Pages URL: `https://<your-username>.github.io/<repo-name>/`

If you prefer the classic Pages setting, set Source = GitHub Actions in Settings → Pages.# POP IT Bingo (Prototype)

A mobile-friendly bingo-style prototype with a silicone “pop-it” ticket. One 4x4 ticket (16 unique numbers), 30-ball universe, 20 calls, one call every 3 seconds. Default is manual marking; an Auto Mark toggle can be enabled.

## Features
- 4x4 ticket (16 unique numbers, no repeats) from 1–30
- 20 numbers called, one every 3s, with call history
- Manual mark by tapping bubbles (default)
- Auto Mark toggle to automatically pop matching called numbers
- Satisfying “pop” sound using WebAudio on each mark
- Prizes: 2L, 3L, 4L, 5L, 6L, 7L, 8L, Full House
  - Lines are rows, columns, or diagonals fully marked
- Mobile-first responsive UI with a silicone pop-it look

## Run locally
Just open `index.html` in a modern browser (Chrome, Edge, Safari, Firefox). No build needed.

If you prefer a local server on macOS:

```bash
# Python 3
python3 -m http.server 8080
# Then open http://localhost:8080 in your browser and navigate to the folder
```

## How to play
1. Press “Start Game” to generate a new ticket and begin calling numbers.
2. Default is manual marking. Tap a called number on your ticket to pop it.
3. Toggle “Auto Mark” to automatically pop matches as they’re called.
4. Watch the prize list as you complete lines (rows/cols/diagonals). Full House is all 16 popped.

## Notes
- Audio contexts on mobile browsers require user interaction; clicking Start/Toggle primes audio.
- A number can only be marked after it’s been called.
- The game calls 20 numbers total; you can still manually pop any of those called numbers after the calls finish.