# STRAFE 1.6

A small browser FPS in the spirit of classic 1.6-era shooters: GoldSrc-style movement (bunny hopping, air strafing, crouch jumps), a two-site desert map (`de_dunes`) with long, mid, catwalk and tunnels, and Terrorist bots to fight.

No build step and no external downloads: three.js is included in `lib/`.

## Play locally

Browsers block ES modules from `file://`, so start a tiny local server in this folder:

```
python3 -m http.server 8000
```

Then open http://localhost:8000

## Put it on GitHub Pages

1. Create a new repository on GitHub and upload everything in this folder (keep the `lib/` folder and the `.nojekyll` file).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then click **Save**.
4. After a minute your game is live at `https://<your-username>.github.io/<repo-name>/`.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse / arrow keys | Aim / turn; left click shoots |
| Right mouse | Scope (Scout, AWP, SG550, AUG) or knife stab |
| B | Buy menu (in the CT spawn buy zone, first 90 s of a round) |
| Tab | Scoreboard |
| ~ (key left of 1) | Console (type `help`) |
| Space / mouse wheel | Jump |
| Ctrl / C | Crouch |
| Shift | Walk |
| R | Reload |
| 1 / 2 / 3, Q | Primary / pistol / knife, last weapon |
| Esc | Main menu |

## Money and buying

You start with $800 and a pistol. Kills pay $300, a round win $3250 and a loss $1400 or more. Weapons are kept if you survive the round.

## Console

Some useful commands: `sv_airaccelerate 100`, `sv_gravity 400`, `bot_add`, `bot_kick`, `bot_difficulty 2`, `mp_restartgame 1`, `cl_showfps 1`, `buy awp`. Cheats need `sv_cheats 1` first: `noclip`, `god`, `impulse 101`, `give ak47`.

## Bunny hopping

Friction is skipped on the tick you jump, so if you jump the instant you land you keep your speed. In the air, let go of W, then hold A while moving the mouse left (or D while moving it right) to gain speed. The speed meter at the bottom turns green above 280 u/s and blue above 450.

Auto-bhop (holding Space) is on by default. Turn it off in the menu for the old-school way: scroll the mouse wheel as you land. `sv_airaccelerate` defaults to 10 like the original; turn it up to 100 for kz-server style air control.

## Files

- `index.html`: page, HUD and menu
- `style.css`: styling
- `game.js`: map, physics, weapons, bots, rendering
- `lib/three.module.min.js`: three.js r170 (MIT license)

## Editing the map

The map is the `MAP` grid at the top of `game.js`. Each character is a 128×128 unit cell: `#` wall, `.` floor, `1` raised floor, `t` roofed tunnel, `n/s/e/w` stairs, `c`/`C`/`p` crates.
