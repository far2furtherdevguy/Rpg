// Arena RPG server: static files + WebSocket game logic. Only dependency: ws.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');
const PORT = process.env.PORT || 3000;
const DBF = path.join(__dirname, 'data.json');

// ---------- storage (JSON file; resets on Render free tier restarts, see README) ----------
let db = { users: {} };
try { db = JSON.parse(fs.readFileSync(DBF, 'utf8')); } catch {}
const save = () => { try { fs.writeFileSync(DBF, JSON.stringify(db)); } catch {} };
setInterval(save, 30000);
['SIGTERM', 'SIGINT'].forEach(s => process.on(s, () => { save(); process.exit(0); }));

// ---------- game data (edit freely) ----------
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const CLS = {
  warrior:  { hp: 140, def: 8, spd: 150, dmg: 12, cd: 500, range: 55, melee: 1 },
  mage:     { hp: 80,  def: 2, spd: 140, dmg: 24, cd: 900, range: 320 },
  ranger:   { hp: 95,  def: 4, spd: 175, dmg: 11, cd: 450, range: 380 },
  assassin: { hp: 75,  def: 3, spd: 200, dmg: 20, cd: 350, range: 45, melee: 1 }
};
// skills (Q): warrior=shield, mage=blast, ranger=trap, assassin=dash
const MOBS = {
  slime:    { hp: 30,  dmg: 5,  spd: 50,  xp: 8,   tier: 0 },
  wolf:     { hp: 55,  dmg: 9,  spd: 110, xp: 15,  tier: 2 },
  goblin:   { hp: 90,  dmg: 14, spd: 80,  xp: 28,  tier: 4 },
  skeleton: { hp: 160, dmg: 22, spd: 85,  xp: 50,  tier: 7 },
  ogre:     { hp: 900, dmg: 45, spd: 60,  xp: 400, tier: 11, boss: 1 }
};
const WN = ['Rusty Blade','Iron Sword','Steel Blade','Hunter Edge','Silver Fang','Knight Blade','Flame Edge','Storm Blade','Shadow Fang','Dragon Edge','Void Blade','Godslayer'];
const AN = ['Cloth Tunic','Leather Vest','Chain Shirt','Hide Armor','Iron Plate','Steel Plate','Knight Plate','Mithril Mail','Shadow Garb','Dragon Scale','Void Plate','Titan Aegis'];
const ITEMS = {};
for (let t = 0; t < 12; t++) {
  ITEMS['w' + t] = { id: 'w' + t, slot: 'w', name: WN[t], tier: t, val: 3 + t * 3, req: Math.ceil(1 + t * 1.6) };
  ITEMS['a' + t] = { id: 'a' + t, slot: 'a', name: AN[t], tier: t, val: Math.round(1 + t * 2.5), req: Math.ceil(1 + t * 1.6) };
}
const MAXLVL = 20, ARENA_LVL = 10; // ranked PvP uses level-10 stats and no gear

// ---------- zones ----------
const Z = {};
let aid = 1, mid = 1, pid = 1, Q = null, tickN = 0;
const sess = {};
function mkZone(name, w, h, safe) { return Z[name] = { name, w, h, safe, players: [], mobs: [], projs: [], traps: [], fx: [] }; }
function place(z, m) { m.x = 100 + Math.random() * (z.w - 200); m.y = 100 + Math.random() * (z.h - 200); m.hp = m.mh; }
function addMobs(z, k, n) { for (let i = 0; i < n; i++) { const m = { id: mid++, k, mh: MOBS[k].hp, dead: 0, at: 0, respawn: 0 }; place(z, m); z.mobs.push(m); } }
mkZone('town', 900, 600, true);
mkZone('field', 1800, 1200, false); addMobs(Z.field, 'slime', 6); addMobs(Z.field, 'wolf', 5); addMobs(Z.field, 'goblin', 4);
mkZone('dungeon', 1400, 1000, false); addMobs(Z.dungeon, 'skeleton', 8); addMobs(Z.dungeon, 'ogre', 1);

// ---------- helpers ----------
const tx = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const say = (p, x) => tx(p.ws, { t: 'msg', x });
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
function calc(p) {
  const u = p.u, c = CLS[u.cls], ar = !!p.zone.arena, L = ar ? ARENA_LVL : u.lvl;
  const wa = ar ? 0 : (ITEMS[u.eq.w] || {}).val || 0, ad = ar ? 0 : (ITEMS[u.eq.a] || {}).val || 0;
  p.mh = c.hp + (L - 1) * 10; p.atk = c.dmg + (L - 1) * 2 + wa; p.def = c.def + (L - 1) * 0.5 + ad; p.spd = c.spd;
}
function enter(p, z, pos) {
  if (p.zone) p.zone.players = p.zone.players.filter(q => q !== p);
  p.zone = z; z.players.push(p); calc(p); p.hp = p.mh;
  p.x = pos ? pos[0] : z.w / 2; p.y = pos ? pos[1] : z.h / 2; p.dx = p.dy = 0;
}
function meInfo(p) {
  const u = p.u;
  return { n: u.name, cls: u.cls, lvl: u.lvl, xp: u.xp, need: u.lvl * 50, inv: u.inv, eq: u.eq, rating: u.rating, w: u.wins, l: u.losses };
}
const sendMe = p => tx(p.ws, { t: 'me', d: meInfo(p) });

function addXp(p, n) {
  const u = p.u; let up = 0;
  if (u.lvl >= MAXLVL) return;
  u.xp += n;
  while (u.lvl < MAXLVL && u.xp >= u.lvl * 50) { u.xp -= u.lvl * 50; u.lvl++; up = 1; }
  if (u.lvl >= MAXLVL) u.xp = 0;
  if (up) { calc(p); p.hp = p.mh; say(p, 'Level up! You are level ' + u.lvl); }
  sendMe(p);
}
function drop(p, d) {
  if (!d.boss && Math.random() > 0.3) return;
  const tier = clamp(d.tier + Math.floor(Math.random() * 3) - 1, 0, 11);
  const id = (Math.random() < 0.5 ? 'w' : 'a') + tier;
  if (p.u.inv.length < 60) { p.u.inv.push(id); say(p, 'Loot: ' + ITEMS[id].name); }
}
function killMob(z, m, a, now) {
  const d = MOBS[m.k]; m.dead = 1; m.respawn = now + (d.boss ? 60000 : 6000);
  if (a && a.u) { addXp(a, d.xp); drop(a, d); }
}
function endMatch(z, w, l) {
  if (z.over) return; z.over = true;
  w.u.rating += 25; w.u.wins++; l.u.rating = Math.max(0, l.u.rating - 25); l.u.losses++;
  say(w, 'Victory! +25 rating'); say(l, 'Defeat. -25 rating'); sendMe(w); sendMe(l);
  setTimeout(() => {
    for (const p of [w, l]) if (p.zone === z && sess[p.key] === p) { enter(p, Z.town); sendMe(p); }
    delete Z[z.name];
  }, 3000);
}
function die(z, p, a) {
  if (z.arena) { p.hp = 0; if (a && a.u) endMatch(z, a, p); return; }
  say(p, 'You died. Back to town.'); enter(p, Z.town); sendMe(p);
}
function hurt(z, a, t, raw, now) {
  const isP = !!t.u; let d = raw;
  if (isP) { d -= t.def * 0.5; if (now < t.sh) d *= 0.5; }
  t.hp -= Math.max(1, Math.round(d));
  if (t.hp > 0) return;
  if (isP) die(z, t, a); else killMob(z, t, a, now);
}
function targets(z, o, now) {
  if (z.safe) return [];
  const t = z.mobs.filter(m => !m.dead);
  if (z.arena && !z.over && now >= z.startAt) for (const q of z.players) if (q !== o) t.push(q);
  return t;
}
const canAct = (z, now) => !z.safe && !(z.arena && (now < z.startAt || z.over));

function attack(p, aim, now) {
  const z = p.zone, c = CLS[p.u.cls];
  if (!canAct(z, now) || now < p.cd) return; p.cd = now + c.cd;
  if (c.melee) {
    z.fx.push({ x: p.x + Math.cos(aim) * 30, y: p.y + Math.sin(aim) * 30, r: c.range * 0.6, c: 0xffffff });
    for (const e of targets(z, p, now)) {
      const dx = e.x - p.x, dy = e.y - p.y;
      if (Math.hypot(dx, dy) > c.range + 16) continue;
      let da = Math.abs(Math.atan2(dy, dx) - aim); if (da > Math.PI) da = 2 * Math.PI - da;
      if (da < 1.05) hurt(z, p, e, p.atk, now);
    }
  } else {
    z.projs.push({ x: p.x, y: p.y, vx: Math.cos(aim) * 450, vy: Math.sin(aim) * 450, o: p, dmg: p.atk, life: c.range / 450 });
  }
}
function skill(p, aim, now) {
  const z = p.zone, k = p.u.cls;
  if (!canAct(z, now) || now < p.sk) return;
  const cx = Math.cos(aim), cy = Math.sin(aim);
  if (k === 'warrior') { p.sh = now + 2500; p.sk = now + 8000; }
  else if (k === 'mage') {
    p.sk = now + 6000; const bx = clamp(p.x + cx * 200, 0, z.w), by = clamp(p.y + cy * 200, 0, z.h);
    z.fx.push({ x: bx, y: by, r: 80, c: 0xff7b00 });
    for (const e of targets(z, p, now)) if (Math.hypot(e.x - bx, e.y - by) < 80) hurt(z, p, e, p.atk * 1.6, now);
  } else if (k === 'ranger') {
    p.sk = now + 5000; z.traps = z.traps.filter(t => t.o !== p || now < t.exp);
    if (z.traps.filter(t => t.o === p).length >= 3) z.traps.splice(z.traps.findIndex(t => t.o === p), 1);
    z.traps.push({ x: clamp(p.x + cx * 60, 0, z.w), y: clamp(p.y + cy * 60, 0, z.h), o: p, exp: now + 30000 });
  } else if (k === 'assassin') {
    p.sk = now + 5000; p.x = clamp(p.x + cx * 150, 20, z.w - 20); p.y = clamp(p.y + cy * 150, 20, z.h - 20);
  }
}

// ---------- game loop (20 ticks/s) ----------
const DT = 0.05;
function step(z, now) {
  const frozen = z.arena && (now < z.startAt || z.over);
  if (!frozen) for (const p of z.players) if (p.dx || p.dy) {
    const l = Math.hypot(p.dx, p.dy);
    p.x = clamp(p.x + p.dx / l * p.spd * DT, 20, z.w - 20); p.y = clamp(p.y + p.dy / l * p.spd * DT, 20, z.h - 20);
  }
  for (const m of z.mobs) {
    const d = MOBS[m.k];
    if (m.dead) { if (now > m.respawn) { m.dead = 0; place(z, m); } continue; }
    let t = null, bd = 260;
    for (const p of z.players) { const dd = Math.hypot(p.x - m.x, p.y - m.y); if (dd < bd) { bd = dd; t = p; } }
    if (!t) continue;
    if (bd > 26) { m.x += (t.x - m.x) / bd * d.spd * DT; m.y += (t.y - m.y) / bd * d.spd * DT; }
    else if (now > m.at) { m.at = now + 1000; hurt(z, m, t, d.dmg, now); }
  }
  for (const b of z.projs) {
    b.x += b.vx * DT; b.y += b.vy * DT; b.life -= DT;
    if (b.life <= 0) { b.done = 1; continue; }
    for (const e of targets(z, b.o, now)) if (Math.hypot(e.x - b.x, e.y - b.y) < 18) { hurt(z, b.o, e, b.dmg, now); b.done = 1; break; }
  }
  z.projs = z.projs.filter(b => !b.done);
  for (const tr of z.traps) {
    if (now > tr.exp) { tr.done = 1; continue; }
    for (const e of targets(z, tr.o, now)) if (Math.hypot(e.x - tr.x, e.y - tr.y) < 26) {
      hurt(z, tr.o, e, tr.o.atk * 2, now); z.fx.push({ x: tr.x, y: tr.y, r: 40, c: 0xe74c3c }); tr.done = 1; break;
    }
  }
  z.traps = z.traps.filter(t => !t.done);
  if (!z.players.length) return;
  const r = Math.round;
  const o = {
    t: 's', n: tickN, z: z.arena ? 'arena' : z.name, w: z.w, h: z.h,
    P: z.players.map(p => ({ i: p.id, n: p.u.name, c: p.u.cls, x: r(p.x), y: r(p.y), h: Math.max(0, Math.ceil(p.hp)), m: p.mh, l: z.arena ? ARENA_LVL : p.u.lvl, s: now < p.sh ? 1 : 0 })),
    M: z.mobs.filter(m => !m.dead).map(m => ({ i: m.id, k: m.k, x: r(m.x), y: r(m.y), h: Math.ceil(m.hp), m: m.mh })),
    B: z.projs.map(b => [r(b.x), r(b.y)]), T: z.traps.map(t => [r(t.x), r(t.y)]), F: z.fx,
    cd: z.arena ? Math.max(0, z.startAt - now) : 0, ov: z.over ? 1 : 0
  };
  z.fx = [];
  const s = JSON.stringify(o);
  for (const p of z.players) if (p.ws.readyState === 1) p.ws.send(s);
}
setInterval(() => { const now = Date.now(); tickN++; for (const z of Object.values(Z)) step(z, now); }, 50);

// ---------- http + websocket ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.json': 'application/json' };
const ASSETS = path.join(__dirname, 'assets');
const server = http.createServer((req, res) => {
  let f; try { f = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  let fp;
  if (f === '/' || f === '/index.html') fp = path.join(__dirname, 'index.html');
  else if (f === '/game.js') fp = path.join(__dirname, 'game.js');
  else if (f.startsWith('/assets/')) { fp = path.join(__dirname, path.normalize(f)); if (!fp.startsWith(ASSETS + path.sep)) { res.writeHead(403); return res.end(); } }
  else { res.writeHead(404); return res.end(); }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' }); res.end(d);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 2048 });

function tryMatch(p) {
  if (Q && Q !== p && Q.ws.readyState === 1) {
    const a = Q, b = p; Q = null;
    const z = mkZone('arena' + aid++, 800, 600, false); z.arena = true; z.over = false; z.startAt = Date.now() + 3000;
    enter(a, z, [120, 300]); enter(b, z, [680, 300]);
    say(a, 'Match found vs ' + b.u.name); say(b, 'Match found vs ' + a.u.name);
  } else { Q = p; say(p, 'Searching for opponent...'); }
}

wss.on('connection', ws => {
  let p = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const now = Date.now();
    if (m.t === 'auth') {
      if (p) return;
      const name = String(m.name || ''), pass = String(m.pass || '');
      if (!/^\w{3,16}$/.test(name) || pass.length < 4 || pass.length > 64) return tx(ws, { t: 'auth', err: 'Name: 3-16 letters/numbers. Password: 4+ chars.' });
      const key = name.toLowerCase(); let u = db.users[key];
      if (!u) {
        if (!CLS[m.cls]) return tx(ws, { t: 'auth', err: 'Pick a class' });
        const salt = crypto.randomBytes(8).toString('hex');
        u = db.users[key] = { name, salt, hash: hashPw(pass, salt), cls: m.cls, lvl: 1, xp: 0, inv: ['w0', 'a0'], eq: { w: 'w0', a: 'a0' }, rating: 1000, wins: 0, losses: 0 };
      } else if (hashPw(pass, u.salt) !== u.hash) return tx(ws, { t: 'auth', err: 'Wrong password' });
      if (sess[key]) sess[key].ws.close();
      p = sess[key] = { ws, u, key, id: pid++, x: 0, y: 0, dx: 0, dy: 0, cd: 0, sk: 0, sh: 0, zone: null };
      enter(p, Z.town);
      return tx(ws, { t: 'auth', id: p.id, items: ITEMS, me: meInfo(p) });
    }
    if (!p) return;
    const z = p.zone;
    switch (m.t) {
      case 'in': p.dx = clamp(+m.dx || 0, -1, 1); p.dy = clamp(+m.dy || 0, -1, 1); break;
      case 'atk': attack(p, +m.a || 0, now); break;
      case 'sk': skill(p, +m.a || 0, now); break;
      case 'go':
        if (z.arena || !['town', 'field', 'dungeon'].includes(m.zone)) break;
        if (m.zone === 'dungeon' && p.u.lvl < 5) { say(p, 'Dungeon requires level 5'); break; }
        if (Q === p) Q = null;
        enter(p, Z[m.zone]); break;
      case 'queue': if (!z.arena && Q !== p) tryMatch(p); break;
      case 'unqueue': if (Q === p) { Q = null; say(p, 'Queue cancelled'); } break;
      case 'equip': {
        const it = ITEMS[m.id];
        if (z.arena || !it || !p.u.inv.includes(m.id) || p.u.lvl < it.req) break;
        const r = p.hp / p.mh; p.u.eq[it.slot] = it.id; calc(p); p.hp = Math.ceil(p.mh * r); sendMe(p); break;
      }
      case 'chat': {
        const x = String(m.x || '').slice(0, 120).trim();
        if (!x || now - (p.lastChat || 0) < 1000) break; p.lastChat = now;
        for (const q of Object.values(sess)) tx(q.ws, { t: 'chat', n: p.u.name, x });
        break;
      }
      case 'lb': {
        const d = Object.values(db.users).sort((a, b) => b.rating - a.rating).slice(0, 10).map(u => [u.name, u.rating, u.wins]);
        tx(ws, { t: 'lb', d }); break;
      }
    }
  });
  ws.on('close', () => {
    if (!p) return;
    if (Q === p) Q = null;
    const z = p.zone;
    if (z) { z.players = z.players.filter(q => q !== p); if (z.arena && !z.over && z.players[0]) endMatch(z, z.players[0], p); }
    if (sess[p.key] === p) delete sess[p.key];
    save();
  });
});
server.listen(PORT, () => console.log('Arena RPG on :' + PORT));
