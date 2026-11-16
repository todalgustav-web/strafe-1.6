# STRAFE 1.6

A small browser FPS in the spirit of Counter-Strike 1.6: GoldSrc-style movement (bunny hopping, air strafing, crouch jumps), bomb defusal on a two-site desert map (`de_dunes`), grenades, radio commands, 5v5 against bots on either side, and LAN multiplayer.

No build step and no external downloads: three.js is included in `lib/`.

## Play locally

Browsers block ES modules from `file://`, so start a tiny local server in this folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Put it on GitHub Pages

1. Upload everything in this folder to a GitHub repository (keep the `lib/` folder).
2. **Settings → Pages → Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
3. After a minute it is live at `https://<your-username>.github.io/<repo-name>/`.

## The game

- **New Game** asks you to pick Terrorists or Counter-Terrorists. Bots fill both teams (5v5 by default).
- **Map de_dunes:** two bombsites. **A** is in the north-east (reach it via Long A through the long doors, or Short A up the catwalk from mid). **B** is in the north-west (via the B tunnels, or mid → CT mid → B doors). Lower tunnels link the B tunnels to mid. One spawn per team.
- **Bomb:** Terrorists plant at A or B (E, 40 s timer). Counter-Terrorists defuse (10 s, 5 s with a kit). The T bots pick a site each round.
- **Rounds:** 15 s freeze time to buy, plus 20 s more buy time once the round starts. Round time is 2:15.
- **Weapons:** real CS names, team restrictions and spray patterns.
- **Grenades** (buy menu → Equipment, select with 4): HE grenade, flashbang (blinds you if you look at it), smoke grenade (blocks vision, bots too). Bots throw them as well.
- **Dropping weapons:** G drops your gun. Walk over a gun to pick it up if that slot is empty, or look at it and press E to swap. Bots drop their gun when they die.
- **Radio commands:** Z, X, C, like in 1.6. Your bot teammates obey "Follow me", "Hold this position", "Go go go", "Team, fall back" and more.
- **Spray logo** with T. Shell casings fly out of your gun.
- **Crosshair editor** (main menu → Crosshair).

## Playing on a trackpad

Turn on **Trackpad mode** in Options (the game suggests it if it notices a trackpad):

- Two-finger scrolling no longer makes you jump (use Space).
- **F** fires and **V** scopes or does the knife stab, so you never have to click and move your finger at the same time.
- Fast swipes turn faster (trackpad acceleration slider), so you can turn around without running out of trackpad.
- Optional light aim assist: the aim slows down a little over enemies and is gently pulled toward them while you move it.
- The arrow keys also turn.

## LAN multiplayer

- **Create LAN Server** hosts a game in your browser. Your browser runs the server (bots, rounds, bomb). Every empty slot is a bot, and when a friend joins they take a bot's place.
- **Find LAN Servers** only shows servers on the **same Wi-Fi / network** as you. Players connect directly over the local network (WebRTC with no STUN/TURN servers). Public Nostr relays are only used so the browsers can say hello.
- The host must keep their tab open.
- Some school or office Wi-Fi blocks devices from talking to each other. Then LAN games won't connect on that network.
- **Network → "This browser only"** lets you test with two tabs on one computer.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse / arrow keys | Aim / turn |
| Left mouse (F in trackpad mode) | Fire / throw grenade |
| Right mouse (V in trackpad mode) | Scope or knife stab |
| Space / mouse wheel | Jump (wheel is off in trackpad mode) |
| Ctrl | Duck |
| Shift | Walk |
| R | Reload |
| 1 / 2 / 3 / 4 / 5, Q | Primary / pistol / knife / grenades / bomb, last weapon |
| E | Plant / defuse, pick up the gun you look at |
| G | Drop weapon (or the bomb) |
| B | Buy menu |
| Z / X / C | Radio commands |
| T | Spray logo |
| M | Change team |
| Tab | Scoreboard |
| ~ (key left of 1) | Console (type `help`) |
| Esc | Main menu |

## Console

Some useful commands: `sv_airaccelerate 100`, `sv_gravity 400`, `bot_quota 3`, `bot_difficulty 2`, `mp_freezetime 5`, `mp_buytime 60`, `mp_restartgame 1`, `cl_showfps 1`, `buy ak47`, `buy hegren`, `jointeam ct`. Cheats need `sv_cheats 1` first: `noclip`, `god`, `impulse 101`, `give awp`.

## Bunny hopping

Friction is skipped on the tick you jump, so jumping the instant you land keeps your speed. In the air, let go of W, then hold A while turning left (or D while turning right) to gain speed. Auto-bhop (hold Space) is on by default.

## Editing the map

The map is painted with rectangles at the top of `game.js` (`paint(...)` / `put(...)`). Each cell is 128×128 units.

`three.js` r170 is MIT licensed.
