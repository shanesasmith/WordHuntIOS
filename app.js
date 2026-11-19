/* Word Hunt — a static, link-based multiplayer word game.
   Everyone who opens the same link plays the same board (seeded RNG).
   Scores travel inside the link itself, so no server is needed. */
(() => {
'use strict';

const N = 4, DURATION = 80, MIN_LEN = 3, MIN_BOARD_WORDS = 90;
const $ = s => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const fmt = n => n.toLocaleString('en-US');
const points = len => len < 3 ? 0 : len === 3 ? 100 : len === 4 ? 400 : len === 5 ? 800 : len === 6 ? 1400 : len === 7 ? 1800 : 2200 + 400 * (len - 8);
const scoreOf = words => words.reduce((a, w) => a + points(w.length), 0);

/* ---------- storage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('wh_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wh_' + k, JSON.stringify(v)); } catch {} }
};
const randId = (len = 8) => { const a = new Uint8Array(len); crypto.getRandomValues(a); return Array.from(a, b => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join(''); };
const me = store.get('me', null) || { id: randId(6), name: '' };
store.set('me', me);
let soundOn = store.get('sound', true);

function games() { return store.get('games', {}); }
function getGame(seed) { return games()[seed]; }
function saveGame(g) {
  const all = games(); all[g.seed] = g;
  const keys = Object.keys(all).sort((a, b) => all[b].updated - all[a].updated);
  keys.slice(40).forEach(k => delete all[k]);           // keep the 40 most recent
  store.set('games', all);
}
function mergeGame(incoming) {
  const g = getGame(incoming.seed) || { seed: incoming.seed, players: [], created: Date.now() };
  for (const p of incoming.players) {
    const i = g.players.findIndex(q => q.id === p.id);
    if (i < 0) g.players.push(p);
    else if (p.id !== me.id && p.w.length > g.players[i].w.length) g.players[i] = p;
  }
  g.updated = Date.now();
  saveGame(g);
  return g;
}

/* ---------- link encoding ---------- */
function b64e(str) { let bin = ''; new TextEncoder().encode(str).forEach(b => bin += String.fromCharCode(b)); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64d(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); }
function encodeGame(g) { return b64e(JSON.stringify({ v: 1, s: g.seed, p: g.players.map(p => [p.id, p.n, p.w.join(' ')]) })); }
function decodeGame(str) {
  const o = JSON.parse(b64d(str));
  if (!o || typeof o.s !== 'string' || !Array.isArray(o.p)) throw new Error('bad');
  return {
    seed: o.s.replace(/[^a-z0-9]/g, '').slice(0, 16),
    players: o.p.slice(0, 30).map(a => {
      const w = String(a[2] || '').toLowerCase().split(' ').filter(x => /^[a-z]{3,16}$/.test(x)).slice(0, 400);
      return { id: String(a[0]).slice(0, 12), n: String(a[1] || 'Player').slice(0, 16), w: [...new Set(w)] };
    })
  };
}
const shareUrl = g => location.origin + location.pathname + '#g=' + encodeGame(g);

/* ---------- dictionary ---------- */
let WORDS = null, dictP = null;
function loadDict() {
  if (!dictP) dictP = fetch('words.txt').then(r => { if (!r.ok) throw new Error('dict'); return r.text(); })
    .then(t => { WORDS = t.split('\n').map(s => s.trim()).filter(Boolean); })
    .catch(e => { dictP = null; throw e; });
  return dictP;
}
function lb(p) { let lo = 0, hi = WORDS.length; while (lo < hi) { const m = (lo + hi) >> 1; if (WORDS[m] < p) lo = m + 1; else hi = m; } return lo; }
const isWord = w => w.length >= MIN_LEN && WORDS[lb(w)] === w;
const hasPrefix = p => { const i = lb(p); return i < WORDS.length && WORDS[i].startsWith(p); };

/* ---------- seeded board ---------- */
function hashStr(s) { let h = 1779033703 ^ s.length; for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; }
function rng(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const POOL = 'E12A9I8O8N6R6T6S6L4U4D4G3B2C3M2P2F2H3V1W2Y2K1J1X1Z1'.match(/[A-Z]\d+/g)
  .flatMap(m => Array(+m.slice(1)).fill(m[0]));
const ADJ = Array.from({ length: N * N }, (_, i) => {
  const r = Math.floor(i / N), c = i % N, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const rr = r + dr, cc = c + dc;
    if ((dr || dc) && rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
  }
  return out;
});
const isAdj = (a, b) => ADJ[a].includes(b);

function solve(letters) {
  const L = letters.map(c => c.toLowerCase()), used = Array(N * N).fill(false), found = new Set();
  const dfs = (i, s) => {
    if (s.length >= MIN_LEN && isWord(s)) found.add(s);
    for (const j of ADJ[i]) if (!used[j]) { const t = s + L[j]; if (hasPrefix(t)) { used[j] = true; dfs(j, t); used[j] = false; } }
  };
  for (let i = 0; i < N * N; i++) { used[i] = true; dfs(i, L[i]); used[i] = false; }
  return [...found].sort((a, b) => b.length - a.length || a.localeCompare(b));
}
const boardCache = {};
function makeBoard(seed) {
  if (boardCache[seed]) return boardCache[seed];
  let best = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const r = rng(hashStr(seed + ':' + attempt));
    const b = Array.from({ length: N * N }, () => POOL[Math.floor(r() * POOL.length)]);
    const vowels = b.filter(c => 'AEIOU'.includes(c)).length;
    const rare = b.filter(c => 'JKVXZW'.includes(c)).length;
    const counts = {}; b.forEach(c => counts[c] = (counts[c] || 0) + 1);
    if (vowels < 4 || vowels > 7 || rare > 2 || Math.max(...Object.values(counts)) > 3) continue;
    const sol = solve(b);
    if (!best || sol.length > best.solution.length) best = { letters: b, solution: sol };
    if (sol.length >= MIN_BOARD_WORDS) break;
  }
  return boardCache[seed] = best;
}

/* ---------- sound ---------- */
let actx = null;
function beep(freq, dur = .07, type = 'sine', vol = .08) {
  if (!soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch {}
}
const buzz = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

/* ---------- UI helpers ---------- */
function show(id) { document.querySelectorAll('.screen').forEach(s => s.hidden = s.id !== id); window.scrollTo(0, 0); }
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200); }
function openSheet(id) { $('#sheetBackdrop').hidden = false; $(id).hidden = false; }
function closeSheets() { $('#sheetBackdrop').hidden = true; document.querySelectorAll('.sheet').forEach(s => s.hidden = true); }
const initial = n => (n || '?').trim().charAt(0).toUpperCase() || '?';
const nameFor = p => p.id === me.id ? 'You' : p.n;
function ranked(g) {
  return g.players.map(p => ({ ...p, score: scoreOf(p.w) })).sort((a, b) => b.score - a.score);
}
function setName(v) { me.name = v.trim().slice(0, 16); store.set('me', me); $('#nameInput').value = me.name; }
function needName(input) {
  const v = input.value.trim();
  if (v) { setName(v); return true; }
  input.focus(); toast('Enter your name first'); return false;
}

/* ---------- HOME ---------- */
function renderHome() {
  $('#nameInput').value = me.name;
  $('#soundBtn').textContent = 'Sound: ' + (soundOn ? 'On' : 'Off');
  const list = $('#recentList'); list.innerHTML = '';
  const all = Object.values(games()).sort((a, b) => b.updated - a.updated).slice(0, 15);
  $('#recentTitle').hidden = !all.length;
  for (const g of all) {
    const r = ranked(g), mine = r.find(p => p.id === me.id), others = r.filter(p => p.id !== me.id);
    const li = el('li');
    li.append(el('div', 'avatar', others.length ? initial(others[0].n) : initial(me.name)));
    const info = el('div', 'info');
    info.append(el('div', 't', others.length ? 'vs ' + others.map(p => p.n).join(', ') : 'Waiting for friends'));
    info.append(el('div', 's', mine ? `You: ${fmt(mine.score)} · ${mine.w.length} words` : `${others[0].n}: ${fmt(others[0].score)}`));
    li.append(info);
    let badge;
    if (!mine) badge = el('span', 'badge play', 'Your turn');
    else if (!others.length) badge = el('span', 'badge wait', 'Sent');
    else if (r[0].id === me.id && (r.length < 2 || r[1].score < r[0].score)) badge = el('span', 'badge win', '1st');
    else { const pos = r.findIndex(p => p.id === me.id); badge = el('span', 'badge ' + (pos === 0 ? 'win' : 'lose'), pos === 0 ? 'Tie' : ordinal(pos + 1)); }
    li.append(badge);
    li.onclick = () => mine ? showResults(g.seed) : showInvite(g.seed);
    list.append(li);
  }
  show('home');
}
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/* ---------- INVITE ---------- */
function showInvite(seed) {
  const g = getGame(seed); if (!g) return renderHome();
  const r = ranked(g), host = g.players[0];
  $('#inviteAvatar').textContent = initial(host.n);
  $('#inviteTitle').textContent = `${host.n} challenged you!`;
  $('#inviteSub').textContent = r.length > 1 ? `${r.length} players so far. Can you top the board?` : `${host.n} scored ${fmt(r[0].score)}. Can you beat it?`;
  const ul = $('#inviteBoard'); ul.innerHTML = '';
  r.forEach((p, i) => ul.append(lbRow(p, i)));
  $('#inviteNameField').hidden = !!me.name;
  $('#inviteNameInput').value = me.name;
  $('#acceptBtn').onclick = () => {
    if (!me.name && !needName($('#inviteNameInput'))) return;
    startGame(seed);
  };
  show('invite');
}
function lbRow(p, i) {
  const li = el('li', (i === 0 ? 'first ' : '') + (p.id === me.id ? 'me' : ''));
  li.append(el('span', 'rank', i + 1));
  const nm = el('span', 'name', nameFor(p)); nm.append(el('small', null, `${p.w.length} word${p.w.length === 1 ? '' : 's'}`));
  li.append(nm, el('span', 'pts', fmt(p.score)));
  return li;
}

/* ---------- GAME ---------- */
let G = null; // live game state
const boardEl = $('#board'), trailLine = $('#trail polyline');

async function startGame(seed) {
  const existing = getGame(seed);
  if (existing && existing.players.some(p => p.id === me.id)) return showResults(seed);
  $('#loading').hidden = false;
  try { await loadDict(); }
  catch { $('#loading').hidden = true; toast("Couldn't load the dictionary. Check your connection."); return; }
  const { letters, solution } = makeBoard(seed);
  $('#loading').hidden = true;
  beep(1, .01, 'sine', .0001); // unlock iOS audio on this tap

  // register the game (so a reload mid-game still counts what you found)
  const g = existing || { seed, players: [], created: Date.now() };
  g.players.push({ id: me.id, n: me.name || 'Player', w: [] }); g.updated = Date.now(); saveGame(g);

  G = { seed, letters, valid: new Set(solution), found: [], score: 0, path: [], end: 0, running: false, raf: 0 };
  buildBoard(letters);
  $('#hudWords').textContent = '0'; $('#hudScore').textContent = '0'; $('#hudTime').textContent = clock(DURATION);
  $('.hud-box:last-child').classList.remove('low');
  setWord();
  show('game');
  await countdown();
  G.end = Date.now() + DURATION * 1000; G.running = true; tick();
}
function buildBoard(letters) {
  boardEl.querySelectorAll('.tile').forEach(t => t.remove());
  letters.forEach((ch, i) => { const t = el('div', 'tile', ch); t.dataset.i = i; boardEl.insertBefore(t, $('#trail')); });
  trailLine.setAttribute('points', '');
  boardEl.className = 'board';
}
function countdown() {
  return new Promise(res => {
    const ov = $('#countdown'), num = $('#countNum'); ov.hidden = false; let n = 3;
    const step = () => {
      if (n === 0) { num.textContent = 'Go!'; beep(880, .15); setTimeout(() => { ov.hidden = true; res(); }, 450); return; }
      num.textContent = n; num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
      beep(520, .1); n--; setTimeout(step, 750);
    };
    step();
  });
}
const clock = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function tick() {
  if (!G || !G.running) return;
  const left = Math.max(0, Math.ceil((G.end - Date.now()) / 1000));
  const t = $('#hudTime'); if (t.textContent !== clock(left)) { t.textContent = clock(left); if (left <= 10 && left > 0) beep(300, .05, 'square', .03); }
  $('.hud-box:last-child').classList.toggle('low', left <= 10);
  if (left <= 0) return endGame();
  G.raf = requestAnimationFrame(tick);
}
function endGame() {
  G.running = false; cancelAnimationFrame(G.raf); clearPath();
  beep(440, .2, 'triangle'); setTimeout(() => beep(330, .3, 'triangle'), 180); buzz(80);
  $('#timesUp').hidden = false;
  const seed = G.seed;
  setTimeout(() => { $('#timesUp').hidden = true; G = null; showResults(seed); }, 1400);
}

// --- touch / pointer tracing ---
let rects = [];
function cacheRects() {
  const b = boardEl.getBoundingClientRect();
  rects = [...boardEl.querySelectorAll('.tile')].map(t => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, rad: r.width * .46, bx: (r.left + r.width / 2 - b.left) / b.width * 400, by: (r.top + r.height / 2 - b.top) / b.height * 400 }; });
}
function tileAt(x, y) { // inner circle of each tile -> diagonals are easy to hit
  for (let i = 0; i < rects.length; i++) { const r = rects[i]; if (Math.hypot(x - r.x, y - r.y) < r.rad) return i; }
  return -1;
}
function currentWord() { return G.path.map(i => G.letters[i]).join('').toLowerCase(); }
function setWord() {
  const pill = $('#wordPill'), w = G ? currentWord() : '';
  $('#wordText').textContent = w.toUpperCase();
  let state = '';
  if (w.length >= MIN_LEN && G.valid.has(w)) state = G.found.includes(w) ? 'dupe' : 'ok';
  $('#wordPts').textContent = state === 'ok' ? '+' + fmt(points(w.length)) : '';
  pill.className = 'word-pill' + (w ? ' show' : '') + (state ? ' ' + state : '');
  boardEl.className = 'board' + (state ? ' ' + state : '');
  boardEl.querySelectorAll('.tile').forEach(t => t.classList.toggle('sel', G ? G.path.includes(+t.dataset.i) : false));
  // trail
  const pts = G && rects.length ? G.path.map(i => `${rects[i].bx},${rects[i].by}`).join(' ') : '';
  trailLine.setAttribute('points', G && G.path.length > 1 ? pts : '');
}
function addTile(i) {
  if (i < 0) return;
  const p = G.path;
  if (p.length && p[p.length - 1] === i) return;
  if (p.length > 1 && p[p.length - 2] === i) { p.pop(); setWord(); beep(300 + p.length * 60, .04); return; } // backtrack
  if (p.includes(i)) return;
  if (p.length && !isAdj(p[p.length - 1], i)) return;
  p.push(i); buzz(8); beep(330 + p.length * 70, .05, 'sine', .05); setWord();
}
function clearPath() { if (!G) return; G.path = []; setWord(); }
function submit() {
  const w = currentWord(), pill = $('#wordPill');
  if (w.length >= MIN_LEN) {
    if (G.valid.has(w) && !G.found.includes(w)) {
      G.found.push(w); const pts = points(w.length); G.score += pts;
      $('#hudScore').textContent = fmt(G.score); $('#hudWords').textContent = G.found.length;
      [660, 880, 1100].slice(0, Math.min(3, w.length - 2)).forEach((f, k) => setTimeout(() => beep(f, .12, 'triangle', .07), k * 70));
      buzz(20); floatPts(pts); persistProgress();
    } else if (!G.valid.has(w)) { pill.classList.remove('bad'); void pill.offsetWidth; pill.classList.add('bad'); beep(160, .12, 'sawtooth', .03); }
  }
  setTimeout(() => { if (G) { G.path = []; setWord(); } }, w.length >= MIN_LEN ? 160 : 0);
}
function floatPts(pts) {
  const f = el('div', 'float', '+' + fmt(pts)); const r = boardEl.getBoundingClientRect();
  f.style.left = (r.width / 2 - 40) + 'px'; f.style.top = '-10px'; boardEl.append(f); setTimeout(() => f.remove(), 900);
}
function persistProgress() {
  const g = getGame(G.seed); if (!g) return;
  const p = g.players.find(q => q.id === me.id); if (p) { p.w = G.found.slice(); g.updated = Date.now(); saveGame(g); }
}
let tracing = false;
boardEl.addEventListener('pointerdown', e => {
  if (!G || !G.running) return; e.preventDefault(); tracing = true;
  try { boardEl.setPointerCapture(e.pointerId); } catch {}
  cacheRects(); G.path = []; addTile(tileAt(e.clientX, e.clientY));
});
boardEl.addEventListener('pointermove', e => {
  if (!tracing || !G || !G.running) return; e.preventDefault();
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  (evs.length ? evs : [e]).forEach(ev => addTile(tileAt(ev.clientX, ev.clientY)));
});
const up = () => { if (!tracing) return; tracing = false; if (G && G.running) submit(); };
boardEl.addEventListener('pointerup', up);
boardEl.addEventListener('pointercancel', up);
document.addEventListener('touchmove', e => { if (G && G.running) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());

/* ---------- RESULTS ---------- */
async function showResults(seed) {
  const g = getGame(seed); if (!g) return renderHome();
  const r = ranked(g), mine = r.find(p => p.id === me.id), others = r.filter(p => p.id !== me.id);
  const pos = r.findIndex(p => p.id === me.id);
  let title = 'Nice hunt!';
  if (others.length) {
    if (pos === 0 && r[1].score === r[0].score) title = "It's a tie!";
    else if (pos === 0) title = 'You win! 🏆';
    else title = `${r[0].n} wins`;
  }
  $('#resTitle').textContent = title;
  $('#resSub').textContent = mine ? `${fmt(mine.score)} points · ${mine.w.length} words` : '';
  const ul = $('#resBoard'); ul.innerHTML = ''; r.forEach((p, i) => ul.append(lbRow(p, i)));
  $('#shareBtn').textContent = others.length ? 'Send results' : 'Challenge friends';
  $('#shareNote').textContent = others.length
    ? 'Send the link back so everyone sees the final scores — or invite more people.'
    : 'Send the link by iMessage — everyone plays the same board.';
  $('#shareBtn').onclick = () => share(seed);
  $('#againBtn').onclick = () => { if (me.name || $('#nameInput').value.trim()) startGame(randId(8)); else renderHome(); };
  show('results');

  // board + word lists (need the dictionary to list every possible word)
  const mini = $('#miniBoard'); mini.innerHTML = '';
  const tabs = $('#wordTabs'); tabs.innerHTML = ''; $('#wordList').innerHTML = '';
  try { await loadDict(); } catch { return; }
  const { letters, solution } = makeBoard(seed);
  letters.forEach(c => mini.append(el('span', null, c)));
  // drop any words that aren't really on this board (e.g. an edited link)
  const ok = new Set(solution); let changed = false;
  g.players.forEach(p => { const w = p.w.filter(x => ok.has(x)); if (w.length !== p.w.length) { p.w = w; changed = true; } });
  if (changed) { saveGame(g); return showResults(seed); }
  const myWords = new Set(mine ? mine.w : []);
  const views = [];
  if (mine) views.push({ label: 'Your words', words: [...mine.w] });
  others.forEach(p => views.push({ label: p.n, words: [...p.w] }));
  views.push({ label: `All ${solution.length}`, words: solution, all: true });
  const render = (v, btn) => {
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    const list = $('#wordList'); list.innerHTML = '';
    const ws = [...v.words].sort((a, b) => b.length - a.length || a.localeCompare(b));
    if (!ws.length) list.append(el('li', 'empty', 'No words'));
    ws.slice(0, 400).forEach(w => {
      const li = el('li', v.all && myWords.has(w) ? 'found' : '', w);
      li.append(el('em', null, fmt(points(w.length)))); list.append(li);
    });
  };
  views.forEach((v, i) => { const b = el('button', null, v.label); b.onclick = () => render(v, b); tabs.append(b); if (i === 0) render(v, b); });
}

async function share(seed) {
  const g = getGame(seed); if (!g) return;
  const url = shareUrl(g), r = ranked(g), mine = r.find(p => p.id === me.id);
  const text = r.length > 1
    ? `Word Hunt: ${r.map(p => `${p.n} ${fmt(p.score)}`).join(' · ')}`
    : `I scored ${fmt(mine ? mine.score : 0)} in Word Hunt. Think you can beat me? 🔠`;
  if (navigator.share) {
    try { await navigator.share({ title: 'Word Hunt', text, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  $('#linkText').value = url;
  openSheet('#linkSheet');
}

/* ---------- wiring ---------- */
$('#nameInput').addEventListener('change', e => setName(e.target.value));
$('#nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#inviteNameInput').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('#newGameBtn').onclick = () => { if (needName($('#nameInput'))) startGame(randId(8)); };
$('#howBtn').onclick = () => openSheet('#howSheet');
$('#soundBtn').onclick = () => { soundOn = !soundOn; store.set('sound', soundOn); $('#soundBtn').textContent = 'Sound: ' + (soundOn ? 'On' : 'Off'); };
$('#sheetBackdrop').onclick = closeSheets;
document.querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheets);
document.querySelectorAll('[data-go="home"]').forEach(b => b.onclick = renderHome);
$('#copyBtn').onclick = async () => {
  const ta = $('#linkText');
  try { await navigator.clipboard.writeText(ta.value); }
  catch { ta.focus(); ta.select(); try { document.execCommand('copy'); } catch {} }
  toast('Link copied!');
};

function route() {
  const m = location.hash.match(/g=([A-Za-z0-9_-]+)/);
  if (!m) return renderHome();
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const g = mergeGame(decodeGame(m[1]));
    if (g.players.some(p => p.id === me.id)) showResults(g.seed);
    else if (g.players.length) showInvite(g.seed);
    else renderHome();
  } catch { toast('That game link looks broken'); renderHome(); }
}
window.addEventListener('hashchange', route);
route();
loadDict().catch(() => {}); // warm up in the background
})();
