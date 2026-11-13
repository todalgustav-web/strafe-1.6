# STRAFE 1.6

A small browser FPS in the spirit of Counter-Strike 1.6: GoldSrc-style movement (bunny hopping, air strafing, crouch jumps), bomb defusal on a one-site desert map (`de_dunes`), and 5v5 rounds against bots on either side.

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

- **New Game** asks you to pick Terrorists or Counter-Terrorists. Bots fill both teams (5v5 by default; change it in Options or with `bot_quota`).
- **One spawn per team, one bombsite (A).** Terrorists plant the bomb (40 s timer), and Counter-Terrorists defuse it (10 s, or 5 s with a defuse kit).
- **Rounds:** 15 s freeze time to buy, then 20 s more buy time (CS:GO timings). You start with $800.
- **Weapons** use the real CS names and team restrictions (AK-47 and Galil for T, M4A1 and FAMAS for CT, and so on).
- **Spray patterns:** automatic weapons have fixed recoil patterns. The view kicks half as far as the bullets go, like CS:GO, so pull down and sideways to control them.
- **Crosshair editor** (main menu → Crosshair): presets, size, gap, thickness, outline, dot, T-style, circle and colour. It also accepts CS:GO console commands like `cl_crosshairsize 3`.
- After you die, click to spectate your teammates.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse / arrow keys | Aim / turn |
| Left mouse | Fire |
| Right mouse | Scope (Scout, AWP, SG 550, G3SG1, AUG, SG 552) or knife stab |
| Space / mouse wheel | Jump |
| Ctrl / C | Duck |
| Shift | Walk |
| R | Reload |
| 1 / 2 / 3 / 5, Q | Primary / pistol / knife / bomb, last weapon |
| E | Plant the bomb (T, on site) / defuse (CT) |
| G | Drop the bomb |
| B | Buy menu (in your spawn during buy time) |
| M | Change team |
| Tab | Scoreboard |
| ~ (key left of 1) | Console (type `help`) |
| Esc | Main menu |

## Console

Some useful commands: `sv_airaccelerate 100`, `sv_gravity 400`, `bot_quota 3`, `bot_difficulty 2`, `mp_freezetime 5`, `mp_buytime 60`, `mp_restartgame 1`, `cl_showfps 1`, `buy ak47`, `jointeam ct`. Cheats need `sv_cheats 1` first: `noclip`, `god`, `impulse 101`, `give awp`.

## Bunny hopping

Friction is skipped on the tick you jump, so jumping the instant you land keeps your speed. In the air, let go of W, then hold A while turning left (or D while turning right) to gain speed. Auto-bhop (hold Space) is on by default.

## Editing the map

The map is painted with rectangles at the top of `game.js` (`paint(...)` / `put(...)`). Each cell is 128×128 units.

`three.js` r170 is MIT licensed.
