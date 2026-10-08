// Arena RPG client (Phaser 3). Works with zero assets (coloured circles).
// Drop PNGs into /assets with these names to replace them automatically.
const SPRITES = ['warrior', 'mage', 'ranger', 'assassin', 'slime', 'wolf', 'goblin', 'skeleton', 'ogre'];
const BGS = ['town', 'field', 'dungeon', 'arena']; // optional: assets/bg_town.png etc.
const COL = { warrior: 0xc0392b, mage: 0x8e44ad, ranger: 0x27ae60, assassin: 0x34495e, slime: 0x2ecc71, wolf: 0x95a5a6, goblin: 0x7dcea0, skeleton: 0xecf0f1, ogre: 0xd35400 };
const BGCOL = { town: 0x3b5a3b, field: 0x2f6b2f, dungeon: 0x2a2a3a, arena: 0x4a3a2a };
const RAD = { ogre: 34, skeleton: 18, goblin: 15, wolf: 14, slime: 12 };

const $ = id => document.getElementById(id);
let ws, items = {}, me = null, snap = null, myId = 0, game = null, lbOn = false, invOn = false;

const say = (x, c) => {
  const d = document.createElement('div'); d.textContent = x; if (c) d.style.color = c;
  const l = $('log'); l.appendChild(d); while (l.childNodes.length > 40) l.removeChild(l.firstChild); l.scrollTop = l.scrollHeight;
};
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

// ---------- network ----------
$('go').onclick = () => {
  $('err').textContent = '';
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => send({ t: 'auth', name: $('name').value, pass: $('pass').value, cls: $('cls').value });
  ws.onmessage = e => onMsg(JSON.parse(e.data));
  ws.onclose = () => { snap = null; $('hud').style.display = 'none'; $('login').style.display = 'flex'; if (!$('err').textContent) $('err').textContent = 'Disconnected'; };
};
function onMsg(m) {
  if (m.t === 'auth') {
    if (m.err) { $('err').textContent = m.err; return; }
    items = m.items; me = m.me; myId = m.id;
    $('login').style.display = 'none'; $('hud').style.display = 'block'; $('log').innerHTML = '';
    renderMe(); send({ t: 'lb' });
    if (!game) game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', backgroundColor: '#111', scale: { mode: Phaser.Scale.RESIZE, width: innerWidth, height: innerHeight }, scene: Main });
  } else if (m.t === 's') snap = m;
  else if (m.t === 'me') { me = m.d; renderMe(); }
  else if (m.t === 'chat') say(m.n + ': ' + m.x);
  else if (m.t === 'msg') say(m.x, '#ffd966');
  else if (m.t === 'lb') {
    const el = $('lb'); el.innerHTML = '<b>Top 10 (rating)</b>';
    m.d.forEach((r, i) => { const d = document.createElement('div'); d.textContent = (i + 1) + '. ' + r[0] + ' - ' + r[1] + ' (' + r[2] + 'W)'; el.appendChild(d); });
  }
}

// ---------- UI ----------
function renderMe() {
  const inv = $('inv'); inv.innerHTML = '<b>Inventory</b>';
  me.inv.forEach(id => {
    const it = items[id]; if (!it) return;
    const d = document.createElement('div'), eq = me.eq[it.slot] === id;
    d.textContent = (it.slot === 'w' ? 'ATK +' : 'DEF +') + it.val + ' ' + it.name + ' (Lv' + it.req + ') ';
    const b = document.createElement('button'); b.textContent = eq ? 'Equipped' : 'Equip'; b.disabled = eq || me.lvl < it.req;
    b.onclick = () => send({ t: 'equip', id }); d.appendChild(b); inv.appendChild(d);
  });
}
document.querySelectorAll('[data-z]').forEach(b => b.onclick = () => send({ t: 'go', zone: b.dataset.z }));
$('q').onclick = () => send({ t: 'queue' });
$('uq').onclick = () => send({ t: 'unqueue' });
$('binv').onclick = () => { invOn = !invOn; $('inv').style.display = invOn ? 'block' : 'none'; };
$('blb').onclick = () => { lbOn = !lbOn; $('lb').style.display = lbOn ? 'block' : 'none'; if (lbOn) send({ t: 'lb' }); };
$('msg').onkeydown = e => { if (e.key === 'Enter') { send({ t: 'chat', x: e.target.value }); e.target.value = ''; e.target.blur(); } e.stopPropagation(); };
setInterval(() => { if (lbOn) send({ t: 'lb' }); }, 15000);

// ---------- game scene ----------
class Main extends Phaser.Scene {
  preload() {
    SPRITES.forEach(k => this.load.image(k, 'assets/' + k + '.png'));
    BGS.forEach(k => this.load.image('bg_' + k, 'assets/bg_' + k + '.png'));
  }
  create() {
    this.ents = {}; this.fx = []; this.zn = null; this.dx = 0; this.dy = 0; this.nextAtk = 0; this.lastN = -1;
    this.keys = this.input.keyboard.addKeys('W,A,S,D,Q,SPACE,UP,DOWN,LEFT,RIGHT', false);
    this.g = this.add.graphics().setDepth(1e6);
    this.input.on('pointerdown', () => document.activeElement && document.activeElement.blur());
  }
  mk(kind, r, label) {
    const body = this.textures.exists(kind) ? this.add.image(0, 0, kind).setDisplaySize(r * 2.4, r * 2.4) : this.add.circle(0, 0, r, COL[kind]);
    const bg = this.add.rectangle(0, -r - 8, 34, 5, 0x000000);
    const fg = this.add.rectangle(-17, -r - 8, 34, 5, 0xe74c3c).setOrigin(0, 0.5);
    const tx = this.add.text(0, -r - 22, label, { font: '11px sans-serif', color: '#fff' }).setOrigin(0.5);
    const c = this.add.container(0, 0, [body, bg, fg, tx]); c.fg = fg; c.body = body; c.fresh = 1; return c;
  }
  upd(e, o) {
    if (e.fresh) { e.x = o.x; e.y = o.y; e.fresh = 0; } else { e.x += (o.x - e.x) * 0.4; e.y += (o.y - e.y) * 0.4; }
    e.setDepth(e.y); e.fg.scaleX = Math.max(0, o.h / o.m); e.body.setAlpha(o.s ? 0.5 : 1);
  }
  setZone(s) {
    Object.values(this.ents).forEach(e => e.destroy()); this.ents = {};
    if (this.bg) this.bg.destroy();
    this.bg = this.textures.exists('bg_' + s.z) ? this.add.image(0, 0, 'bg_' + s.z).setOrigin(0).setDisplaySize(s.w, s.h) : this.add.rectangle(0, 0, s.w, s.h, BGCOL[s.z]).setOrigin(0);
    this.bg.setDepth(-1);
    this.cameras.main.setBounds(0, 0, s.w, s.h); this.zn = s.z;
  }
  update(t) {
    if (!snap) return;
    const s = snap, cam = this.cameras.main;
    if (s.z !== this.zn) this.setZone(s);
    const seen = {};
    for (const p of s.P) { const k = 'p' + p.i; seen[k] = 1; const e = this.ents[k] || (this.ents[k] = this.mk(p.c, 16, p.n + ' L' + p.l)); this.upd(e, p); }
    for (const m of s.M) { const k = 'm' + m.i; seen[k] = 1; const e = this.ents[k] || (this.ents[k] = this.mk(m.k, RAD[m.k], m.k)); this.upd(e, m); }
    for (const k in this.ents) if (!seen[k]) { this.ents[k].destroy(); delete this.ents[k]; }

    // projectiles, traps, effects
    const g = this.g; g.clear();
    g.fillStyle(0xffe066, 1); s.B.forEach(b => g.fillCircle(b[0], b[1], 5));
    g.lineStyle(2, 0xe74c3c, 1); s.T.forEach(b => g.strokeCircle(b[0], b[1], 10));
    if (s.n !== this.lastN) { this.lastN = s.n; s.F.forEach(f => this.fx.push({ ...f, exp: t + 180 })); }
    this.fx = this.fx.filter(f => f.exp > t);
    this.fx.forEach(f => { g.lineStyle(3, f.c, 1); g.strokeCircle(f.x, f.y, f.r); });

    // own player: camera, HUD, input
    const own = this.ents['p' + myId], mp = s.P.find(p => p.i === myId);
    if (own) cam.centerOn(own.x, own.y);
    if (mp && me) $('stats').textContent = me.n + ' | ' + me.cls + ' Lv' + me.lvl + ' (' + me.xp + '/' + me.need + ' xp) | HP ' + mp.h + '/' + mp.m + ' | Rating ' + me.rating + ' | ' + s.z;
    $('banner').textContent = s.cd > 0 ? 'FIGHT IN ' + Math.ceil(s.cd / 1000) : (s.ov ? 'MATCH OVER' : '');

    const typing = ['INPUT', 'SELECT'].includes(document.activeElement.tagName), K = this.keys;
    let dx = 0, dy = 0;
    if (!typing) { dx = (K.D.isDown || K.RIGHT.isDown) - (K.A.isDown || K.LEFT.isDown); dy = (K.S.isDown || K.DOWN.isDown) - (K.W.isDown || K.UP.isDown); }
    if (dx !== this.dx || dy !== this.dy) { this.dx = dx; this.dy = dy; send({ t: 'in', dx, dy }); }
    const ptr = this.input.activePointer; ptr.updateWorldPoint(cam);
    const aim = own ? Math.atan2(ptr.worldY - own.y, ptr.worldX - own.x) : 0;
    if (!typing && (ptr.isDown || K.SPACE.isDown) && t > this.nextAtk) { this.nextAtk = t + 100; send({ t: 'atk', a: aim }); }
    if (!typing && Phaser.Input.Keyboard.JustDown(K.Q)) send({ t: 'sk', a: aim });
  }
}
