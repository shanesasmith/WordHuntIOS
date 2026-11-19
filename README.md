# Word Hunt

A swipe-the-letters word game built for iPhone. Play a 4×4 board for 80 seconds, then send the link to friends. Everyone who opens it plays the **same board**, and scores travel back and forth inside the link. No server or accounts needed.

## Put it on GitHub Pages

1. Create a new repository on GitHub (for example `word-hunt`).
2. Upload every file in this folder to the root of the repo (`index.html`, `app.js`, `style.css`, `words.txt`, `manifest.json`, the icons).
3. In the repo, go to **Settings → Pages**, set **Source: Deploy from a branch**, branch `main`, folder `/ (root)`, and save.
4. After a minute your game is live at `https://<your-username>.github.io/word-hunt/`.

**Tip:** open that link in Safari, tap **Share → Add to Home Screen**, and it launches full-screen like an app.

**Optional:** for a nicer iMessage link preview, change `og:image` in `index.html` to the full URL, e.g. `https://<your-username>.github.io/word-hunt/icon-512.png`.

## How multiplayer works

- **New Game** makes a random board seed. When time's up, **Challenge friends** opens the iOS share sheet with a link like `…/#g=<data>`.
- The link holds the seed plus every player's name and found words. Scores are recalculated from the words, and words that aren't on the board are dropped.
- A friend opens the link, plays the same board, then taps **Send results** to send back a link with both scores. Any number of people can join the same board.
- Recent games and your name are saved on your phone (localStorage).

## Files

| File | What it is |
|---|---|
| `index.html` | Screens: home, invite, game, results |
| `style.css` | iPhone-first styling (safe areas, big touch targets) |
| `app.js` | Game logic, seeded boards, solver, swipe input, sharing |
| `words.txt` | ~272k-word English dictionary (3–16 letters) |

Scoring: 3 letters = 100, 4 = 400, 5 = 800, 6 = 1,400, 7 = 1,800, 8+ = 2,200 (+400 per extra letter).

Note: if you change `words.txt` or the board settings in `app.js`, old links will make different boards.
