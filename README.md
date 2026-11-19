# Galaxy Idle Clicker - Save Editor

A save editor for Galaxy Idle Clicker with a floating in-game panel: quick cheat buttons, an editor for **any** value in your save, an amount toggle (+1 / +10 / +100 / MAX), a queue that shows what will change, and automatic backups with one-click restore.

> **Warning:** This game has online leaderboard features. Block the game's internet access via your firewall before using cheats to avoid any issues.

<img width="501" height="655" alt="image" src="https://github.com/user-attachments/assets/5c2cfeab-76e9-4008-9ffa-50b90b434599" />

---

## Features

- **Quick buttons** for resources, level, buffs, time warps, achievements, prestige and more
- **Editor tab** to search and edit any number, switch or text value in the save
- **Amount toggle** `+1` / `+10` / `+100` / `MAX` for quick buttons and the editor
- **Queue tab** with an old → new diff for every staged change, with per-item removal
- **Automatic backups** before every Apply and Restore (last 10 kept), restorable from the Backups tab
- **Resizable, draggable window** that remembers its size and position
- Type checks: values with the wrong type are skipped instead of corrupting the save

---

## Setup

### 1. Enable Remote Debugging

Right-click **Galaxy Idle Clicker** in Steam → Properties → General → Launch Options, and paste:

```
GalaxyIdleClicker.exe --remote-allow-origins=* --remote-debugging-port=1234
```

Launch the game.

### 2. Open the Debug Interface

Open Chrome and go to:

```
http://localhost:1234
```

Click the **Galaxy Idle Clicker** debug target. The DevTools panel should open automatically on the right.

### 3. Load the Script (one-time setup)

The easiest way is to save it as a **Chrome Snippet** so you never paste again:

1. In DevTools, go to **Sources** → **Snippets** (left sidebar)
2. Click **+ New snippet**
3. Paste the contents of [Edit User Data_cmd.js](https://raw.githubusercontent.com/official-notfishvr/Galaxy-Idle-Clicker-Cheats/refs/heads/main/Edit%20User%20Data_cmd.js)
4. Press `Ctrl+S` to save, give it a name
5. From now on: just press `Ctrl+Enter` (or right-click → Run) to load the panel

---

## How It Works

The script edits your save file through the game's own IPC calls (`list-user-data`, `load-user-data`, `save-user-data`).

The game keeps its state in memory and **autosaves it over the file**, so a plain file edit gets overwritten after a short time. To avoid that, every **Apply** writes your changes to the save and **reloads the page right away**, so the game loads the edited save.

**Workflow:**

1. Launch the game and wait until it has loaded
2. Go to `http://localhost:1234` in Chrome
3. Run the snippet (Ctrl+Enter) — the cheat panel appears
4. **Save your game in-game** first (to not lose progress)
5. Click the commands you want in the panel
6. **Quit without saving** — ALT+F4 or close the window
7. Relaunch the game — your changes are now active

> After quitting, the browser tab will show an error. That's normal. Go back, refresh (F5), and click the debug target again.

---

## The Panel

| Part               | What it does                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Amount**         | `+1` / `+10` / `+100` add that amount to numbers. `MAX` raises numbers to their max (it never lowers a value).                                                                                                      |
| **Quick**          | Cheat buttons grouped by category. They stage changes, nothing is written until you Apply.                                                                                                                          |
| **Editor**         | Search any key in the save. Filter by context (`game`, `meteor`, `extra`) and type. Numbers have `−N` / `+N` buttons (or `0` / `MAX`) and a text field, switches have a checkbox. Objects and arrays are read-only. |
| **Queue (N)**      | Every staged change as `key: old → new (+difference)`. Remove single items with ✕ or use **Clear all**.                                                                                                             |
| **Backups**        | Automatic copies made before every Apply and Restore (last 10, stored in IndexedDB of the page). Restore, download as `.json`, delete, or create one manually.                                                      |
| **Apply & reload** | Writes all staged changes to the save and reloads the page.                                                                                                                                                         |
| **Discard**        | Drops all staged changes.                                                                                                                                                                                           |
| **↻**              | Re-reads the values from the save file.                                                                                                                                                                             |
| **Export**         | Downloads your full save as `userData.txt`.                                                                                                                                                                         |
| **Auto**           | Applies and reloads after every click.                                                                                                                                                                              |

**Window:** drag the header to move it, drag the corner at the bottom right to resize, double-click the corner to reset size and position, `–` minimizes.

---

## Quick Buttons

Behavior by amount: with `MAX` numbers are raised to the max listed below, with `+1` / `+10` / `+100` that amount is added. Switches are always turned on. Time and object entries (marked _MAX only_) only work in `MAX` mode.

| Button                     | Description                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Resources**              |                                                                                                                        |
| `Max Multipliers`          | Supernova tab multipliers (including the new seventh tab)                                                              |
| `All Resources`            | Junk, plasma, energy, garbage, scrap, quarks, antimatter, cosmic dust, supernova essence, light years and their totals |
| `Meteorite & Minerals`     | Meteorite and minerals counts                                                                                          |
| `Radiations`               | Radiation counts                                                                                                       |
| `Special Meteorites`       | Diamond, gold, satellite, amethyst meteorites _(MAX only)_                                                             |
| `Cosmic Dust Levels`       | Extra cosmic dust level multipliers                                                                                    |
| `Army Tab Levels`          | Army tab multipliers (capped at 1999 to avoid crashes)                                                                 |
| **Player**                 |                                                                                                                        |
| `Level & Skill Points`     | Level and skill points (99999)                                                                                         |
| `Unlock Difficulties`      | Normal, hard and hell difficulty milestones                                                                            |
| `Activate Buffs`           | All buff and cooldown flags                                                                                            |
| `Potion Timers` (ms)       | All potion timers (300 days on MAX)                                                                                    |
| `Ship Stats`               | Ship HP and bullet damage                                                                                              |
| `Mech Tokens`              | Mech tokens and mission tokens                                                                                         |
| `Complete Mech` Missions   | All mech upgrade missions for mechs 1-4 _(MAX only)_                                                                   |
| `Auto Features`            | Auto-buy, auto-play, homing, turrets, clone ship, multi-shot unlocks                                                   |
| `Turrets Level`            | Turrets level                                                                                                          |
| **Combat**                 |                                                                                                                        |
| `Ships Killed & KPS`       | Total ships killed and kills per second                                                                                |
| `Enemies Killed` (all)     | All numbered enemy kill counters, including the newer ones                                                             |
| `Shot Upgrade Counts`      | All shot upgrade counts                                                                                                |
| `Mech Multipliers`         | Mech and buff multipliers                                                                                              |
| `Planets Completed`        | Planets completed count                                                                                                |
| **Time**                   |                                                                                                                        |
| `Time Warps`               | All time warp counts, including the day-long ones                                                                      |
| `Offline Bonus` (1 day)    | Offline time set to 1 day ago _(MAX only)_                                                                             |
| `LY Run Time` (5 days)     | LY run start set to 5 days ago (max x25 bonus) _(MAX only)_                                                            |
| `Black Hole` Time (5 days) | Black hole timer set to 5 days ago _(MAX only)_                                                                        |
| **Achievements**           |                                                                                                                        |
| `Achievement Points`       | All achievement categories                                                                                             |
| `Light Travel Points`      | Light travel, black hole travel and all-time light year points                                                         |
| **Prestige**               |                                                                                                                        |
| `Supernova Unlocks`        | Unlock supernova and its tab upgrades                                                                                  |
| `Black Hole Stats`         | Black hole travel count and points, unlock all black hole passives                                                     |

> For potion timers, only change timers for potions you have already unlocked.

---

## Editing Anything Else

Use the **Editor** tab for anything not covered by a button:

1. Type part of the key name in the search box (for example `potion`, `timeskip` or `shot`)
2. Change the value: type a number, use the `−` / `+` buttons, or flip the checkbox
3. Check the **Queue** tab, then press **Apply & reload**

Numbers that are shown empty are `null` in the save, typing a number sets them. Values keep their original type, a switch stays a switch, a number stays a number.

---

## Troubleshooting

- **Values reset after a while:** the game overwrote the file with its in-memory state. Use **Apply & reload**, it reloads the page immediately so the game loads the edited file.
- **The panel is gone after Apply:** that's normal, the page reloaded. Run the snippet again.
- **`Backup FAILED` message:** IndexedDB is unavailable. Press Apply again to continue without a backup, or use **Export** first.
- **A button stages 0 changes:** the values are already at the max, or the keys have a different type in your save (the browser console shows the skipped keys).
- **Something broke:** open the **Backups** tab and restore the last copy.
- **After a game update some keys are missing:** use the **Editor** tab to search for the new key names.

---

## Credits

Based on the original save editor by [official-notfishvr](https://github.com/official-notfishvr/Galaxy-Idle-Clicker-Cheats).

## Disclaimer

Unofficial tool, not affiliated with the game's developers. Use at your own risk and keep backups of your save.
