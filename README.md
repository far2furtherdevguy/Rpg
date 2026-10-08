# Arena RPG (MVP v0.1)

2D browser RPG: 4 classes, town, field, dungeon, 5 monsters, 12 weapons, 12 armors, levels 1-20, chat, inventory, leaderboard, and ranked 1v1 PvP with normalized stats (everyone fights as level 10 with no gear).

Stack: Node.js + `ws` (server), Phaser 3 from a CDN (client). No build step.

## Files

```
server.js      game server + static hosting
index.html     page + UI
game.js        Phaser client
package.json
.gitignore
assets/        (you create this; optional, see below)
```

## Run locally

```
npm install
npm start
```

Open http://localhost:3000 in two browser tabs, create two accounts, and press "Ranked 1v1" in both.

## Push to GitHub from your phone

1. Create an empty repo on github.com (mobile browser, desktop mode works best).
2. Add file > Create new file. Type the file name, paste the contents, commit. Repeat for: `server.js`, `index.html`, `game.js`, `package.json`, `.gitignore`, `README.md`.
3. Or use Add file > Upload files and pick the files from your phone (the zip must be extracted first).
4. For assets: Create new file, type `assets/placeholder.txt` (typing a slash creates the folder), then Upload files into that folder.

## Deploy on Render (free tier)

1. Render dashboard > New > Web Service > connect your GitHub repo.
2. Runtime: Node. Build command: `npm install`. Start command: `npm start`. Instance type: Free.
3. Deploy. Open the `.onrender.com` URL. WebSockets work on the same URL automatically.

Free tier limits to know:
- The service sleeps after ~15 minutes without traffic; first visit afterwards takes about 30-60 seconds.
- The disk is ephemeral. `data.json` (accounts, levels, items, ratings) is wiped when the service restarts or redeploys. Fine for testing; for real persistence move accounts to PostgreSQL (e.g. a free Neon or Supabase database, since Render's free Postgres expires after 30 days). The storage code is the `db` object at the top of `server.js`.

## Controls

Move: WASD or arrows. Attack: click or Space (aims at the mouse). Skill: Q.

| Class | Attack | Skill (Q) |
|---|---|---|
| Warrior | melee arc | shield: half damage for 2.5s |
| Mage | slow high-damage bolt | blast at aim point |
| Ranger | fast arrow | place trap (max 3) |
| Assassin | quick melee | dash 150px |

## Assets

The game runs with no assets (coloured circles). To use art, drop PNGs into `assets/` using exactly these names; they load automatically:

- Characters: `warrior.png` `mage.png` `ranger.png` `assassin.png`
- Monsters: `slime.png` `wolf.png` `goblin.png` `skeleton.png` `ogre.png`
- Backgrounds (stretched to zone size): `bg_town.png` (900x600) `bg_field.png` (1800x1200) `bg_dungeon.png` (1400x1000) `bg_arena.png` (800x600)

Single static images per character for now (no animation). Square images work best.

Where to get them:
- Kenney (kenney.nl/assets): CC0, no attribution needed. Good packs: Tiny Dungeon, Tiny Town, Roguelike Characters, Roguelike/RPG pack, UI pack, plus sound packs.
- OpenGameArt.org: huge library; check each item's license (CC0, CC-BY, CC-BY-SA, GPL) and credit authors when required. Liberated Pixel Cup (LPC) characters are popular for RPGs.
- itch.io (itch.io/game-assets/free): filter by free; read each license.
- game-icons.net: item/weapon/skill icons (CC BY 3.0, credit required).
- Sound effects: freesound.org (check license), or generate your own with jsfxr (sfxr.me). Music: OpenGameArt or incompetech.com (credit required).
- AI-generated or commissioned art also works; keep a credits list for anything that requires attribution.

Add a credits section to this README once you pick assets.

## Tweaking the game

All balance lives at the top of `server.js`: `CLS` (classes), `MOBS` (monsters), `WN`/`AN` (item names), `ARENA_LVL` (PvP normalization level), `MAXLVL`. Rename items and monsters freely; add new monster art by adding its name to `SPRITES` in `game.js`.

## Known MVP limits

- One match queue slot, no rematch/friends/guilds.
- No anti-cheat beyond server authority (the server owns all positions and damage).
- No mobile touch controls yet (keyboard and mouse).
- Accounts are plain username/password with salted scrypt hashes; use HTTPS (Render gives it by default).

## Next steps

PostgreSQL persistence, touch controls, more maps/dungeons, ranked seasons, cosmetics shop.
