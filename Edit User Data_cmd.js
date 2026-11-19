// ============================================================
//  Galaxy Idle Clicker - Save Editor v3
//
//  Usage: DevTools (F12) > Sources > Snippets > paste > Run.
//  Run it right after the game has loaded.
//
//  How it works:
//   - Pick an amount (+1 / +10 / +100 / MAX) at the top.
//   - "Quick" tab: buttons stage changes (numbers get +amount or MAX,
//     switches get turned on).
//   - "Editor" tab: search ANY value in the save and edit it directly.
//   - Staged changes are highlighted. Press "Apply & reload" to write the
//     save and reload the page (the game autosaves from memory and would
//     overwrite the file otherwise). Tick "Auto" to apply after every click.
//
//  v3: automatic backup before every Apply/Restore (last 10 kept, stored in
//  IndexedDB of this page), "Queue" tab with old -> new diff and per-item
//  removal, "Backups" tab with restore, resizable + remembered window.
// ============================================================

(function () {
    'use strict';

    var CTXS = ['gameContext', 'meteorContext', 'extraContext'];
    var MAXI = Number.MAX_SAFE_INTEGER;
    var PANEL_ID = '__save_editor_panel';
    var STYLE_ID = '__save_editor_style';
    var MAX_ROWS = 150;

    var MODES = [
        { id: '1', label: '+1' },
        { id: '10', label: '+10' },
        { id: '100', label: '+100' },
        { id: 'max', label: 'MAX' }
    ];

    var state = {
        slots: [], slot: null, snap: null,
        pending: {},            // "ctx|key" -> { ctx, key, value }
        mode: 'max', tab: 'quick', auto: false, collapsed: false, busy: false,
        q: '', fctx: 'all', ftype: 'all',
        qq: '', skipBackup: false, token: 0
    };

    // ---------- IPC ----------
    function parseSave(raw) {
        return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    }
    async function listSlots() {
        var list = await window.ipcRenderer.invoke('list-user-data');
        var ids = [];
        list.forEach(function (name) {
            var idx = parseInt(name.split(' ')[2], 10) - 1;
            ids[idx] = name;
        });
        return ids.filter(Boolean);
    }
    async function loadUser(id) {
        return parseSave(await window.ipcRenderer.invoke('load-user-data', id));
    }
    async function saveUser(id, data) {
        await window.ipcRenderer.invoke('save-user-data', id, data);
    }
    async function refreshSnap() {
        state.slots = await listSlots();
        if (!state.slot || state.slots.indexOf(state.slot) < 0) state.slot = state.slots[0] || null;
        state.snap = state.slot ? await loadUser(state.slot) : null;
    }

    // ---------- backups (IndexedDB) ----------
    var DB_NAME = '__galaxy_save_editor', STORE = 'backups', KEEP = 10;
    function dbOpen() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () {
                req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }
    function dbTx(mode, fn) {
        return dbOpen().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE, mode), res;
                var r = fn(tx.objectStore(STORE));
                if (r) r.onsuccess = function () { res = r.result; };
                tx.oncomplete = function () { db.close(); resolve(res); };
                tx.onerror = tx.onabort = function () { db.close(); reject(tx.error); };
            });
        });
    }
    function deleteBackup(id) {
        return dbTx('readwrite', function (s) { return s.delete(id); });
    }
    async function listBackups() {
        var all = await dbTx('readonly', function (s) { return s.getAll(); });
        return (all || []).sort(function (a, b) { return b.ts - a.ts; });
    }
    async function addBackup(slot, json, note) {
        await dbTx('readwrite', function (s) { return s.add({ ts: Date.now(), slot: slot, note: note, json: json }); });
        var all = await listBackups();
        for (var i = KEEP; i < all.length; i++) await deleteBackup(all[i].id);
    }

    // ---------- value helpers ----------
    function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function hasKey(ctx, k) { return !!(state.snap && state.snap[ctx] && hasOwn(state.snap[ctx], k)); }
    function pk(ctx, k) { return ctx + '|' + k; }
    function isPending(ctx, k) { return hasOwn(state.pending, pk(ctx, k)); }
    function getVal(ctx, k) {
        var p = pk(ctx, k);
        return hasOwn(state.pending, p) ? state.pending[p].value : state.snap[ctx][k];
    }
    function pendingCount() { return Object.keys(state.pending).length; }
    function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
    function clone(v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)); }
    function amount() { return parseInt(state.mode, 10); }
    function category(v) {
        if (typeof v === 'number' || v === null) return 'number';
        if (typeof v === 'boolean') return 'boolean';
        if (typeof v === 'string') return 'text';
        return 'other';
    }

    function stage(ctx, k, value) {
        var p = pk(ctx, k);
        if (same(value, state.snap[ctx][k])) delete state.pending[p];
        else state.pending[p] = { ctx: ctx, key: k, value: value };
    }

    // ---------- quick commands (ops) ----------
    // kind 'num'  : number, +amount or MAX (MAX never lowers a value)
    // kind 'bool' : switch, turned on
    // kind 'abs'  : time / object, MAX mode only
    function N(keys, max) { return { kind: 'num', keys: keys, max: max }; }
    function NRE(re, max) { return { kind: 'num', re: re, max: max }; }
    function B(keys) { return { kind: 'bool', keys: keys }; }
    function A(key, fn) { return { kind: 'abs', keys: [key], fn: fn }; }

    function matchKeys(re) {
        var out = {};
        CTXS.forEach(function (ctx) {
            Object.keys(state.snap[ctx] || {}).forEach(function (k) {
                if (re.test(k) && typeof state.snap[ctx][k] === 'number') out[k] = true;
            });
        });
        return Object.keys(out);
    }

    function runOp(op) {
        var changed = 0, skipped = 0;
        var keys = op.keys || matchKeys(op.re);
        keys.forEach(function (k) {
            var found = false;
            CTXS.forEach(function (ctx) {
                if (!hasKey(ctx, k)) return;
                found = true;
                var cur = getVal(ctx, k), next;
                if (op.kind === 'bool') {
                    if (typeof cur !== 'boolean') { skipped++; return; }
                    next = true;
                } else if (op.kind === 'num') {
                    if (cur !== null && typeof cur !== 'number') { skipped++; return; }
                    var base = cur || 0;
                    next = state.mode === 'max' ? Math.max(base, op.max) : Math.min(MAXI, base + amount());
                } else {
                    if (state.mode !== 'max') { skipped++; return; }
                    next = op.fn(clone(cur));
                    if (cur !== null && typeof cur !== typeof next) { skipped++; return; }
                }
                if (!same(next, cur)) { stage(ctx, k, next); changed++; }
            });
            if (!found) skipped++;
        });
        return { changed: changed, skipped: skipped };
    }

    var COMMANDS = [
        {
            group: 'Resources', label: 'Max Multipliers', ops: [
                N(['multiplyMinigamesSupernovaTab', 'multiplyResourcesSupernovaSevenTab'], 999999999),
                N(['multiplyResroucesSupernovaTab', 'multiplyLYSupernovaTab'], 999999999)]
        },
        {
            group: 'Resources', label: 'All Resources', ops: [
                N(['junkCount', 'plasmaCount', 'energyCount', 'garbageCount', 'scrapCount', 'quarkCount',
                    'antimatterCount', 'cosmicDustCount', 'supernovaEssenceCount', 'lightYearsTravelCount',
                    'totalAntimatterCount', 'antimatterMeteoriteCount', 'totalCosmicDustCount',
                    'totalQuarkCount', 'totalScrapCount'], MAXI)]
        },
        {
            group: 'Resources', label: 'Meteorite & Minerals', ops: [
                N(['meteoriteCount', 'totalMeteoriteCount', 'mineralsCount', 'totalMineralsCount'], MAXI)]
        },
        {
            group: 'Resources', label: 'Radiations', ops: [
                N(['baseValueRadiations', 'totalRadiationCount', 'radiationCount'], MAXI)]
        },
        {
            group: 'Resources', label: 'Special Meteorites', ops: [
                A('specialMeteoriteCount', function (cur) {
                    var want = { diamond: 199990, gold: 749990, satellite: 19999, amethyst: 49999 };
                    cur = cur || {};
                    Object.keys(want).forEach(function (k) {
                        cur[k] = Math.max(typeof cur[k] === 'number' ? cur[k] : 0, want[k]);
                    });
                    return cur;
                })]
        },
        {
            group: 'Resources', label: 'Cosmic Dust Levels', ops: [
                N(['extraCosmicDustResourcesMultiplier', 'extraCosmicDustDmgHpMultiplier',
                    'extraCosmicDustMinigamesMultiplier', 'extraCosmicDustItemsMultiplier',
                    'extraCosmicDustCurrentRunLYMultiplier'], MAXI)]
        },
        {
            group: 'Resources', label: 'Army Tab Levels', ops: [
                N(['junkExtraMultiplierArmyTab', 'expExtraMultiplierArmyTab', 'plasmaExtraMultiplierArmyTab',
                    'prisonersExtraMultiplierArmyTab', 'garbageExtraMultiplierArmyTab', 'dmgHpExtraMultiplierArmyTab',
                    'energyExtraMultiplierArmyTab', 'citizensExtraMultiplierArmyTab', 'scrapExtraMultiplierArmyTab',
                    'mineralsExtraMultiplierArmyTab', 'radiationsExtraMultiplierArmyTab',
                    'meteoriteExtraMultiplierArmyTab', 'lightYearsExtraMultiplierArmyTab'], 1999)]
        },

        { group: 'Player', label: 'Level & Skill Points', ops: [N(['level', 'skillPoints'], 99999)] },
        {
            group: 'Player', label: 'Unlock Difficulties', ops: [
                B(['normalDifficultyUnlockedMilestone', 'hardDifficultyUnlockedMilestone', 'hellDifficultyUnlockedMilestone'])]
        },
        {
            group: 'Player', label: 'Activate Buffs', ops: [
                B(['canRefund', 'timeSkipBlackMatter', 'shockwaveCDHalved', 'shieldPassiveCDHalved', 'cloneShipCDHalved',
                    'hpBuffActive', 'damageBuffActive', 'autoMineDamageBoost', 'junkBuffActive', 'plasmaBuffActive',
                    'energyBuffActive', 'expBuffActive', 'garbageBuffActive', 'prisonersBuffActive',
                    'citizensBuffActive', 'itemsDropRarityBlackMatter'])]
        },
        {
            group: 'Player', label: 'Potion Timers (ms)', ops: [
                N(['damagePotionTimer', 'hpPotionTimer', 'junkPotionTimer', 'plasmaPotionTimer', 'garbagePotionTimer',
                    'expPotionTimer', 'prisonersPotionTimer', 'citizensPotionTimer', 'meteoritePotionTimer',
                    'mineralsPotionTimer'], 25920000000)]
        },
        {
            group: 'Player', label: 'Ship Stats', ops: [
                N(['playerShipMaxHP', 'maxPlayerShipMaxHP', 'bulletDamage', 'maxBulletDamage'], 999999999)]
        },
        { group: 'Player', label: 'Mech Tokens', ops: [N(['mechTokens', 'mechMissionTokens'], 99999)] },
        {
            group: 'Player', label: 'Complete Mech Missions', ops: [
                A('mechMissions', function (cur) {
                    var mechs = ['One', 'Two', 'Three', 'Four'];
                    var types = ['JunkUpgradeMission', 'PlasmaUpgradeMission', 'ExpUpgradeMission', 'DmgUpgradeMission',
                        'HpUpgradeMission', 'PrisonersUpgradeMission', 'CitizensUpgradeMission', 'GarbageUpgradeMission',
                        'LightYearsUpgradeMission', 'EnergyUpgradeMission', 'MeteoriteUpgradeMission',
                        'MineralsUpgradeMission', 'MinigamesUpgradeMission', 'RadiationsUpgradeMission',
                        'ResourcesOneUpgradeMission', 'ResourcesTwoUpgradeMission'];
                    cur = cur || {};
                    mechs.forEach(function (m) {
                        types.forEach(function (t) {
                            cur['mech' + m + t] = { inMission: false, inPause: false, missionsCompleted: 9999 };
                        });
                    });
                    return cur;
                })]
        },
        {
            group: 'Player', label: 'Auto Features', ops: [
                B(['autoBuyEnergyAcquired', 'autoBuyGarbageAcquired', 'autoClickShotAcquired',
                    'autoMoveRadiationAcquired', 'autoPlayRadiationAcquired', 'autoPlayMeteoriteAcquired',
                    'autoPlayMeteoriteShopAcquired', 'autoPlayRadiationShopAcquired', 'autoProgressionAcquired',
                    'autoLootPrisonersAcquired', 'autoMoveUpgradeAcquired', 'smokeTrailAcquired', 'turretsAcquired',
                    'homingUpgradeAcquired', 'doubleHomingUpgradeAcquired', 'tripleHomingUpgradeAcquired',
                    'quadHomingUpgradeAcquired', 'cloneShipAcquired', 'newDoubleShotAcquired',
                    'newTripleShotAcquired', 'newQuadShotAcquired'])]
        },
        { group: 'Player', label: 'Turrets Level', ops: [N(['turretsLevel'], 99999)] },

        {
            group: 'Combat', label: 'Ships Killed & KPS', ops: [
                N(['totalEnemyShipsKilledCountEver'], 999999999999999), N(['killsPerSecond'], 999999.999)]
        },
        {
            group: 'Combat', label: 'Enemies Killed (all)', ops: [
                NRE(/^enemiesKilled(?!.*Shooter$)[A-Z]\w*$/, 999999999999999)]
        },
        {
            group: 'Combat', label: 'Shot Upgrade Counts', ops: [
                N(['newNormalShotUpgradeCount', 'newDoubleShotUpgradeCount', 'newTripleShotUpgradeCount',
                    'newQuadShotUpgradeCount', 'clickShotUpgradeCount'], 99999)]
        },
        {
            group: 'Combat', label: 'Mech Multipliers', ops: [
                N(['firstMechMultiplierScrapTab', 'secondMechMultiplierScrapTab', 'thirdMechMultiplierScrapTab',
                    'fourthMechMultiplierScrapTab', 'fifthMechMultiplierScrapTab', 'buffsMultiplierSixthMech'], 999999999),
                B(['mechsMultiplierBlackMatter'])]
        },
        { group: 'Combat', label: 'Planets Completed', ops: [N(['planetsCompletedCount'], 999999999)] },

        {
            group: 'Time', label: 'Time Warps', ops: [
                N(['thirtyMinTimeSkipBlackMatter', 'oneHTimeskipBlackMatter', 'threeHTimeskipBlackMatter',
                    'sixHTimeskipBlackMatter', 'nineHTimeskipBlackMatter', 'twelveHTimeskipBlackMatter',
                    'oneDTimeskipBlackMatter', 'twoDTimeskipBlackMatter', 'threeDTimeskipBlackMatter',
                    'thirtyMinTimeSkip', 'oneHTimeskip', 'threeHTimeskip', 'sixHTimeskip', 'nineHTimeskip',
                    'twelveHTimeskip', 'oneDTimeskip', 'twoDTimeskip', 'threeDTimeskip'], 9999)]
        },
        { group: 'Time', label: 'Offline Bonus (1 day)', ops: [A('offlineTime', function () { return Date.now() - 86400000; })] },
        { group: 'Time', label: 'LY Run Time (5 days)', ops: [A('startGameTime', function () { return Date.now() - 86400000 * 5; })] },
        { group: 'Time', label: 'Black Hole Time (5 days)', ops: [A('blackHoleTime', function () { return Date.now() - 86400000 * 5; })] },

        {
            group: 'Achievements', label: 'Achievement Points', ops: [
                N(['killsAchievement', 'levelAchievement', 'mechsAchievement', 'mechUpgradesAchievement',
                    'junkAchievement', 'plasmaAchievement', 'energyAchievement', 'garbageAchievement',
                    'prisonersAchievement', 'citizensAchievement', 'armyAchievement', 'meteoriteAchievement',
                    'mineralsAchievement', 'radiationsAchievement', 'itemsAchievement', 'lightYearAchievement',
                    'blackHoleAchievement', 'supernovaAchievement', 'zoneAchievement', 'bigBangAchievement',
                    'antimatterGeneratedAchievement', 'antimatterMeteoriteAchievement'], 999999999)]
        },
        {
            group: 'Achievements', label: 'Light Travel Points', ops: [
                N(['lightTravelPoints', 'totalLightTravelPoints', 'totalRunLightTravelPoints',
                    'blackHoleTravelPoints', 'allTimeLightYearsPoints'], 999999999)]
        },

        {
            group: 'Prestige', label: 'Supernova Unlocks', ops: [
                B(['supernovaUnlocked', 'tripleCosmicDustSupernovaTab', 'shieldDecreaseSupernovaTab',
                    'reduceCorrosiveDamageSupernovaTab', 'enemyStunShotsDisabledSupernovaTab'])]
        },
        {
            group: 'Prestige', label: 'Black Hole Stats', ops: [
                N(['blackHoleTravelCount', 'blackHoleTravelPoints'], 999999999),
                B(['keepLevelsBlackMatter', 'areaSkipBlackMatter', 'armyBlackMatter', 'bossDelayBlackMatter',
                    'itemsDropRarityBlackMatter', 'timeSkipBlackMatter'])]
        }
    ];

    // ---------- DOM helpers ----------
    function el(tag, props, kids) {
        var e = document.createElement(tag);
        Object.keys(props || {}).forEach(function (k) {
            var v = props[k];
            if (k === 'text') e.textContent = v;
            else if (k === 'className') e.className = v;
            else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2).toLowerCase(), v);
            else e[k] = v;
        });
        (kids || []).forEach(function (c) {
            if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
        return e;
    }
    function $(id) { return document.getElementById(id); }

    var CSS =
        '#' + PANEL_ID + '{position:fixed;top:10px;right:10px;width:400px;max-height:92vh;display:flex;flex-direction:column;' +
        'background:#14141f;border:1px solid #3a3a55;border-radius:10px;color:#e8e8f0;' +
        'font:12px/1.35 system-ui,"Segoe UI",sans-serif;z-index:999999;box-shadow:0 8px 30px rgba(0,0,0,.65);user-select:none}' +
        '#' + PANEL_ID + ' *{box-sizing:border-box}' +
        '#' + PANEL_ID + ' button{font:inherit;cursor:pointer;color:#e8e8f0;background:#2a2a40;border:1px solid #3d3d5c;border-radius:5px;padding:4px 8px}' +
        '#' + PANEL_ID + ' button:hover:not(:disabled){background:#35354f}' +
        '#' + PANEL_ID + ' button:disabled{opacity:.45;cursor:default}' +
        '#' + PANEL_ID + ' input[type=text],#' + PANEL_ID + ' select{font:inherit;color:#fff;background:#0d0d16;border:1px solid #3d3d5c;border-radius:5px;padding:4px 6px;user-select:text}' +
        '#' + PANEL_ID + ' .se-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #2c2c44;cursor:move}' +
        '#' + PANEL_ID + ' .se-title{font-weight:700;font-size:13px;flex:1}' +
        '#' + PANEL_ID + ' .se-x{background:#7a2230!important;border-color:#a33!important}' +
        '#' + PANEL_ID + ' .se-bar{display:flex;align-items:center;gap:8px;padding:8px 10px 0}' +
        '#' + PANEL_ID + ' .se-seg{display:flex;flex:1}' +
        '#' + PANEL_ID + ' .se-seg button{flex:1;border-radius:0;margin-left:-1px}' +
        '#' + PANEL_ID + ' .se-seg button:first-child{border-radius:5px 0 0 5px;margin-left:0}' +
        '#' + PANEL_ID + ' .se-seg button:last-child{border-radius:0 5px 5px 0}' +
        '#' + PANEL_ID + ' .se-seg button.on{background:#6c4ff0;border-color:#8a73ff;font-weight:700}' +
        '#' + PANEL_ID + ' .se-hint{padding:4px 10px 0;color:#9a9ab5;font-size:11px}' +
        '#' + PANEL_ID + ' .se-tabs{display:flex;gap:4px;padding:8px 10px 0}' +
        '#' + PANEL_ID + ' .se-tabs button{flex:1}' +
        '#' + PANEL_ID + ' .se-tabs button.on{background:#1f1f33;border-bottom-color:#6c4ff0;border-bottom-width:2px}' +
        '#' + PANEL_ID + ' .se-body{flex:1;min-height:120px;overflow-y:auto;padding:8px 10px}' +
        '#' + PANEL_ID + ' .se-foot{padding:8px 10px;border-top:1px solid #2c2c44}' +
        '#' + PANEL_ID + ' .se-status{min-height:16px;margin-bottom:6px;color:#aaa;font-size:11px}' +
        '#' + PANEL_ID + ' .se-status.ok{color:#5fd06b}#' + PANEL_ID + ' .se-status.warn{color:#ffd24a}#' + PANEL_ID + ' .se-status.err{color:#ff6b6b}' +
        '#' + PANEL_ID + ' .se-actions{display:flex;gap:4px;align-items:center}' +
        '#' + PANEL_ID + ' .se-apply{flex:1;background:#2e7d32!important;border-color:#4caf50!important;font-weight:700}' +
        '#' + PANEL_ID + ' .se-apply.dirty{background:#c77800!important;border-color:#ffb300!important}' +
        '#' + PANEL_ID + ' details{margin-bottom:6px}' +
        '#' + PANEL_ID + ' summary{cursor:pointer;color:#b9b9d6;text-transform:uppercase;letter-spacing:1px;font-size:10px;padding:3px 0}' +
        '#' + PANEL_ID + ' .se-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:3px}' +
        '#' + PANEL_ID + ' .se-grid button{text-align:left;min-height:28px}' +
        '#' + PANEL_ID + ' .se-all{width:100%;margin-bottom:8px;background:linear-gradient(135deg,#8e1b1b,#4a1d96)!important;font-weight:700;padding:7px}' +
        '#' + PANEL_ID + ' .se-filters{display:flex;gap:4px;margin-bottom:6px}' +
        '#' + PANEL_ID + ' .se-filters input{flex:1;min-width:0}' +
        '#' + PANEL_ID + ' .se-count{color:#8a8aa5;font-size:11px;margin-bottom:4px}' +
        '#' + PANEL_ID + ' .se-row{padding:5px 6px;margin-bottom:4px;background:#1b1b2c;border:1px solid #2c2c44;border-left:3px solid #2c2c44;border-radius:5px}' +
        '#' + PANEL_ID + ' .se-row.se-changed{border-left-color:#ffb300;background:#262214}' +
        '#' + PANEL_ID + ' .se-key{font:11px ui-monospace,Consolas,monospace;word-break:break-all;margin-bottom:4px}' +
        '#' + PANEL_ID + ' .se-ctx{margin-left:6px;color:#7d7da0;font-size:10px}' +
        '#' + PANEL_ID + ' .se-ctl{display:flex;gap:3px;align-items:center}' +
        '#' + PANEL_ID + ' .se-ctl input[type=text]{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace}' +
        '#' + PANEL_ID + ' .se-ro{color:#8a8aa5;font-family:ui-monospace,Consolas,monospace}' +
        '#' + PANEL_ID + ' .se-head,#' + PANEL_ID + ' .se-bar,#' + PANEL_ID + ' .se-hint,#' + PANEL_ID + ' .se-tabs,#' + PANEL_ID + ' .se-foot{flex:none}' +
        '#' + PANEL_ID + ' .se-tabs button{padding:4px 2px}' +
        '#' + PANEL_ID + ' .se-grip{position:absolute;right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;border-radius:0 0 10px 0;background:linear-gradient(135deg,transparent 50%,#6c4ff0 50%);opacity:.85}' +
        '#' + PANEL_ID + '.se-min{height:auto!important}' +
        '#' + PANEL_ID + '.se-min .se-grip{display:none}' +
        '#' + PANEL_ID + ' .se-qrow,#' + PANEL_ID + ' .se-brow{display:flex;gap:6px;align-items:center;padding:5px 6px;margin-bottom:4px;border:1px solid #2c2c44;border-radius:5px}' +
        '#' + PANEL_ID + ' .se-qrow{background:#262214;border-left:3px solid #ffb300}' +
        '#' + PANEL_ID + ' .se-brow{background:#1b1b2c}' +
        '#' + PANEL_ID + ' .se-qmain{flex:1;min-width:0}' +
        '#' + PANEL_ID + ' .se-qold,#' + PANEL_ID + ' .se-qnew,#' + PANEL_ID + ' .se-qdelta{font:11px ui-monospace,Consolas,monospace;word-break:break-all}' +
        '#' + PANEL_ID + ' .se-qold{color:#8a8aa5}#' + PANEL_ID + ' .se-qnew{color:#ffd24a}#' + PANEL_ID + ' .se-qdelta{color:#7be07f}' +
        '#' + PANEL_ID + ' .se-bbtns{display:flex;gap:3px}' +
        '#' + PANEL_ID + ' .se-hint2{color:#9a9ab5;font-size:11px;margin-bottom:6px}' +
        '#' + PANEL_ID + ' .se-wide{width:100%;margin-bottom:8px;padding:6px}' +
        '#' + PANEL_ID + '.se-min .se-bar,#' + PANEL_ID + '.se-min .se-hint,#' + PANEL_ID + '.se-min .se-tabs,' +
        '#' + PANEL_ID + '.se-min .se-body,#' + PANEL_ID + '.se-min .se-foot{display:none}';

    // ---------- status / footer ----------
    function setStatus(msg, kind) {
        var s = $('se-status');
        if (!s) return;
        s.textContent = msg;
        s.className = 'se-status' + (kind ? ' ' + kind : '');
    }
    function updateFooter() {
        var n = pendingCount();
        var b = $('se-apply');
        if (!b) return;
        b.textContent = 'Apply & reload (' + n + ')';
        b.disabled = n === 0 || state.busy;
        b.className = 'se-apply' + (n ? ' dirty' : '');
        var qt = $('se-tab-queue');
        if (qt) qt.textContent = 'Queue (' + n + ')';
    }
    function updateHint() {
        var h = $('se-hint');
        if (!h) return;
        h.textContent = state.mode === 'max'
            ? 'MAX: numbers are raised to their max (never lowered). Switches are turned on.'
            : 'Quick buttons add ' + MODES.filter(function (m) { return m.id === state.mode; })[0].label +
            ' to numbers. Switches are turned on. Time/special entries need MAX.';
    }

    function afterStage(msg, kind) {
        updateFooter();
        setStatus(msg, kind);
        if (state.tab === 'editor') renderEditor(true);
        else if (state.tab === 'queue') renderQueueList(true);
        if (state.auto && pendingCount()) apply();
    }

    // ---------- actions ----------
    async function runCommands(cmds, name) {
        if (state.busy) return;
        if (!state.snap) { setStatus('No save loaded.', 'err'); return; }
        await refreshSnap();
        var changed = 0, skipped = 0;
        cmds.forEach(function (c) {
            c.ops.forEach(function (op) {
                var r = runOp(op);
                changed += r.changed; skipped += r.skipped;
            });
        });
        afterStage(name + ': ' + changed + ' staged' + (skipped ? ', ' + skipped + ' skipped' : ''),
            changed ? 'ok' : 'warn');
    }

    async function apply() {
        if (state.busy || !pendingCount()) return;
        state.busy = true; updateFooter();
        try {
            var fresh = await loadUser(state.slot);
            if (!state.skipBackup) {
                try {
                    await addBackup(state.slot, JSON.stringify(fresh), 'before apply (' + pendingCount() + ' changes)');
                } catch (be) {
                    console.error('[SaveEditor] backup failed', be);
                    state.skipBackup = true;
                    state.busy = false; updateFooter();
                    setStatus('Backup FAILED. Press Apply again to continue without a backup.', 'err');
                    return;
                }
            }
            state.skipBackup = false;
            var applied = 0;
            Object.keys(state.pending).forEach(function (p) {
                var e = state.pending[p];
                if (fresh[e.ctx] && hasOwn(fresh[e.ctx], e.key)) { fresh[e.ctx][e.key] = e.value; applied++; }
            });
            await saveUser(state.slot, fresh);
            setStatus('Saved ' + applied + ' values. Reloading...', 'ok');
            // reload right away, before the game's own autosave overwrites the file
            setTimeout(function () { location.reload(); }, 150);
        } catch (err) {
            console.error('[SaveEditor]', err);
            setStatus('Apply FAILED - see console', 'err');
            state.busy = false; updateFooter();
        }
    }

    function discard() {
        state.pending = {};
        updateFooter();
        setStatus('Staged changes discarded.', 'warn');
        render();
    }

    async function reloadSnap() {
        await refreshSnap();
        setStatus('Reloaded values from the save file.', 'ok');
        render();
    }

    async function backup() {
        var ids = await listSlots();
        var out = '';
        for (var i = 0; i < ids.length; i++) {
            var d = await loadUser(ids[i]);
            if (d) out += 'User Data for ' + ids[i] + ':\n' + JSON.stringify(d, null, 2) + '\n\n';
        }
        if (!out) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([out], { type: 'text/plain' }));
        a.download = 'userData.txt';
        a.click();
        setStatus('Backup downloaded.', 'ok');
    }

    // ---------- quick tab ----------
    function renderQuick(host) {
        host.appendChild(el('button', {
            className: 'se-all', text: 'STAGE ALL COMMANDS',
            onClick: function () { runCommands(COMMANDS, 'All'); }
        }));
        var order = [], groups = {};
        COMMANDS.forEach(function (c) {
            if (!groups[c.group]) { groups[c.group] = []; order.push(c.group); }
            groups[c.group].push(c);
        });
        order.forEach(function (g) {
            var grid = el('div', { className: 'se-grid' });
            groups[g].forEach(function (c) {
                grid.appendChild(el('button', {
                    text: c.label, onClick: function () { runCommands([c], c.label); }
                }));
            });
            host.appendChild(el('details', { open: g === 'Resources' || g === 'Player' },
                [el('summary', { text: g }), grid]));
        });
    }

    // ---------- editor tab ----------
    function setNumber(ctx, k, val) {
        if (typeof val !== 'number' || !isFinite(val)) { setStatus('Not a valid number.', 'err'); return false; }
        stage(ctx, k, val);
        return true;
    }

    function rowEl(ctx, k) {
        var v = getVal(ctx, k);
        var cat = category(v);
        var row = el('div', { className: 'se-row' + (isPending(ctx, k) ? ' se-changed' : '') });
        row.appendChild(el('div', { className: 'se-key' }, [el('span', { text: k }), el('span', { className: 'se-ctx', text: ctx.replace('Context', '') })]));
        var ctl = el('div', { className: 'se-ctl' });

        function redraw() { row.replaceWith(rowEl(ctx, k)); updateFooter(); }
        function num() { var c = getVal(ctx, k); return typeof c === 'number' ? c : 0; }

        if (cat === 'number') {
            var input = el('input', {
                type: 'text', value: v === null ? '' : String(v), placeholder: 'null',
                onChange: function () {
                    var t = input.value.trim().replace(',', '.');
                    if (t !== '' && setNumber(ctx, k, Number(t))) { redraw(); if (state.auto) apply(); }
                    else redraw();
                }
            });
            var n = amount(), isMax = state.mode === 'max';
            ctl.appendChild(el('button', {
                text: isMax ? '0' : '\u2212' + n, title: isMax ? 'Set to 0' : 'Subtract ' + n,
                onClick: function () { if (setNumber(ctx, k, isMax ? 0 : num() - n)) { redraw(); if (state.auto) apply(); } }
            }));
            ctl.appendChild(input);
            ctl.appendChild(el('button', {
                text: isMax ? 'MAX' : '+' + n, title: isMax ? 'Set to max safe integer' : 'Add ' + n,
                onClick: function () { if (setNumber(ctx, k, isMax ? MAXI : Math.min(MAXI, num() + n))) { redraw(); if (state.auto) apply(); } }
            }));
        } else if (cat === 'boolean') {
            var cb = el('input', {
                type: 'checkbox', checked: v,
                onChange: function () { stage(ctx, k, cb.checked); redraw(); if (state.auto) apply(); }
            });
            ctl.appendChild(el('label', { style: 'cursor:pointer;display:flex;align-items:center;gap:6px' },
                [cb, el('span', { text: v ? 'true' : 'false' })]));
        } else if (cat === 'text') {
            var ti = el('input', {
                type: 'text', value: v,
                onChange: function () { stage(ctx, k, ti.value); redraw(); if (state.auto) apply(); }
            });
            ctl.appendChild(ti);
        } else {
            var txt = Array.isArray(v) ? '[array, ' + v.length + ' items]' : '{object, ' + Object.keys(v).length + ' keys}';
            ctl.appendChild(el('span', { className: 'se-ro', text: txt + (isPending(ctx, k) ? ' *' : '') + ' (read-only)' }));
        }
        row.appendChild(ctl);
        return row;
    }

    function renderEditor(keepScroll) {
        var host = $('se-list');
        var body = $('se-body');
        if (!host || !state.snap) return;
        var scroll = body.scrollTop;
        host.innerHTML = '';
        var q = state.q.toLowerCase(), rows = [];
        CTXS.forEach(function (ctx) {
            if (state.fctx !== 'all' && state.fctx !== ctx) return;
            Object.keys(state.snap[ctx] || {}).forEach(function (k) {
                if (q && k.toLowerCase().indexOf(q) < 0) return;
                if (state.ftype !== 'all' && category(getVal(ctx, k)) !== state.ftype) return;
                rows.push({ ctx: ctx, k: k });
            });
        });
        rows.sort(function (a, b) {
            var pa = isPending(a.ctx, a.k) ? 0 : 1, pb = isPending(b.ctx, b.k) ? 0 : 1;
            return pa - pb || a.k.localeCompare(b.k);
        });
        $('se-count').textContent = rows.length + ' keys' + (rows.length > MAX_ROWS ? ' (showing first ' + MAX_ROWS + ', refine the search)' : '') +
            ' \u2022 staged ones are listed first';
        rows.slice(0, MAX_ROWS).forEach(function (r) { host.appendChild(rowEl(r.ctx, r.k)); });
        if (keepScroll) body.scrollTop = scroll;
    }

    function buildEditorShell(host) {
        var qi = el('input', {
            type: 'text', placeholder: 'Search key...', value: state.q,
            onInput: function () { state.q = qi.value; renderEditor(false); }
        });
        var cs = el('select', { onChange: function () { state.fctx = cs.value; renderEditor(false); } },
            [['all', 'All'], ['gameContext', 'game'], ['meteorContext', 'meteor'], ['extraContext', 'extra']]
                .map(function (o) { return el('option', { value: o[0], text: o[1], selected: state.fctx === o[0] }); }));
        var ts = el('select', { onChange: function () { state.ftype = ts.value; renderEditor(false); } },
            [['all', 'Any type'], ['number', 'Numbers'], ['boolean', 'Switches'], ['text', 'Text'], ['other', 'Objects']]
                .map(function (o) { return el('option', { value: o[0], text: o[1], selected: state.ftype === o[0] }); }));
        host.appendChild(el('div', { className: 'se-filters' }, [qi, cs, ts]));
        host.appendChild(el('div', { className: 'se-count', id: 'se-count' }));
        host.appendChild(el('div', { id: 'se-list' }));
    }

    // ---------- queue tab ----------
    function fmtVal(v) {
        if (v === null) return 'null';
        if (Array.isArray(v)) return '[' + v.length + ' items]';
        if (typeof v === 'object') return '{' + Object.keys(v).length + ' keys}';
        if (typeof v === 'string') return JSON.stringify(v.length > 24 ? v.slice(0, 24) + '\u2026' : v);
        return String(v);
    }
    function deltaText(a, b) {
        if (typeof a !== 'number' || typeof b !== 'number') return '';
        var d = Number((b - a).toPrecision(15));
        return (d >= 0 ? '+' : '') + d;
    }
    function queueItems() {
        var q = state.qq.toLowerCase();
        return Object.keys(state.pending).map(function (p) { return state.pending[p]; })
            .filter(function (e) { return !q || e.key.toLowerCase().indexOf(q) >= 0; })
            .sort(function (a, b) { return a.key.localeCompare(b.key) || a.ctx.localeCompare(b.ctx); });
    }
    function queueRow(e) {
        var oldV = state.snap[e.ctx][e.key], d = deltaText(oldV, e.value);
        return el('div', { className: 'se-qrow' }, [
            el('div', { className: 'se-qmain' }, [
                el('div', { className: 'se-key' }, [
                    el('span', { text: e.key }),
                    el('span', { className: 'se-ctx', text: e.ctx.replace('Context', '') })]),
                el('div', {}, [
                    el('span', { className: 'se-qold', text: fmtVal(oldV) }),
                    el('span', { className: 'se-qarrow', text: ' \u2192 ' }),
                    el('span', { className: 'se-qnew', text: fmtVal(e.value) }),
                    d ? el('span', { className: 'se-qdelta', text: ' (' + d + ')' }) : null
                ])
            ]),
            el('button', {
                text: '\u2715', title: 'Remove from queue',
                onClick: function () {
                    delete state.pending[pk(e.ctx, e.key)];
                    updateFooter(); renderQueueList(true);
                }
            })
        ]);
    }
    function renderQueueList(keepScroll) {
        var host = $('se-qlist'), body = $('se-body');
        if (!host || !state.snap) return;
        var scroll = body.scrollTop;
        host.innerHTML = '';
        var items = queueItems();
        var total = pendingCount();
        $('se-qcount').textContent = total
            ? items.length + ' of ' + total + ' staged changes (old values = last read of the save file)'
            : 'Nothing staged. Use the Quick or Editor tab to add changes.';
        items.slice(0, 300).forEach(function (e) { host.appendChild(queueRow(e)); });
        if (items.length > 300) host.appendChild(el('div', { className: 'se-count', text: '... ' + (items.length - 300) + ' more, refine the search' }));
        if (keepScroll) body.scrollTop = scroll;
    }
    function buildQueueShell(host) {
        var qi = el('input', {
            type: 'text', placeholder: 'Filter queue...', value: state.qq,
            onInput: function () { state.qq = qi.value; renderQueueList(false); }
        });
        host.appendChild(el('div', { className: 'se-filters' }, [qi, el('button', { text: 'Clear all', onClick: discard })]));
        host.appendChild(el('div', { className: 'se-count', id: 'se-qcount' }));
        host.appendChild(el('div', { id: 'se-qlist' }));
    }

    // ---------- backups tab ----------
    function downloadText(name, text) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        a.download = name;
        a.click();
    }
    async function manualBackup() {
        try {
            var d = await loadUser(state.slot);
            await addBackup(state.slot, JSON.stringify(d), 'manual');
            setStatus('Backup created.', 'ok');
            if (state.tab === 'backups') render();
        } catch (e) {
            console.error('[SaveEditor]', e);
            setStatus('Backup FAILED - see console', 'err');
        }
    }
    async function restoreBackup(b) {
        if (state.busy) return;
        state.busy = true; updateFooter();
        try {
            try {
                await addBackup(b.slot, JSON.stringify(await loadUser(b.slot)), 'before restore');
            } catch (be) { console.warn('[SaveEditor] pre-restore backup failed', be); }
            await saveUser(b.slot, JSON.parse(b.json));
            setStatus('Backup restored. Reloading...', 'ok');
            setTimeout(function () { location.reload(); }, 150);
        } catch (e) {
            console.error('[SaveEditor]', e);
            setStatus('Restore FAILED - see console', 'err');
            state.busy = false; updateFooter();
        }
    }
    function backupRow(b) {
        var row;
        var restoreBtn = el('button', {
            text: 'Restore', title: 'Write this backup to the save and reload',
            onClick: function () {
                if (restoreBtn.getAttribute('data-arm') !== '1') {
                    restoreBtn.setAttribute('data-arm', '1');
                    restoreBtn.textContent = 'Sure?';
                    setTimeout(function () { restoreBtn.removeAttribute('data-arm'); restoreBtn.textContent = 'Restore'; }, 3000);
                    return;
                }
                restoreBackup(b);
            }
        });
        row = el('div', { className: 'se-brow' }, [
            el('div', { className: 'se-qmain' }, [
                el('div', { text: new Date(b.ts).toLocaleString() }),
                el('div', { className: 'se-ctx', style: 'margin-left:0', text: b.slot + ' \u2022 ' + b.note + ' \u2022 ' + Math.round(b.json.length / 1024) + ' KB' })
            ]),
            el('div', { className: 'se-bbtns' }, [
                restoreBtn,
                el('button', {
                    text: '\u2B07', title: 'Download this backup (.json)', onClick: function () {
                        downloadText('backup-' + b.slot.replace(/\s+/g, '_') + '-' + b.ts + '.json', b.json);
                    }
                }),
                el('button', {
                    text: '\u2715', title: 'Delete this backup', onClick: function () {
                        deleteBackup(b.id).then(function () { row.remove(); });
                    }
                })
            ])
        ]);
        return row;
    }
    function renderBackups(host) {
        var token = state.token;
        host.appendChild(el('div', {
            className: 'se-hint2', text:
                'Stored in this browser profile (IndexedDB), last ' + KEEP + ' kept. A backup is made automatically before every Apply and Restore.'
        }));
        host.appendChild(el('button', { className: 'se-wide', text: 'Create backup now', onClick: manualBackup }));
        var list = el('div', { id: 'se-blist' }, [el('div', { className: 'se-count', text: 'Loading...' })]);
        host.appendChild(list);
        listBackups().then(function (all) {
            if (token !== state.token) return;
            list.innerHTML = '';
            if (!all.length) { list.appendChild(el('div', { className: 'se-count', text: 'No backups yet.' })); return; }
            all.forEach(function (b) { list.appendChild(backupRow(b)); });
        }).catch(function (e) {
            if (token !== state.token) return;
            list.textContent = 'Could not read backups: ' + e;
        });
    }

    // ---------- window geometry ----------
    var GEOM_KEY = '__se_geom';
    function saveGeom(panel) {
        try {
            localStorage.setItem(GEOM_KEY, JSON.stringify({
                left: panel.offsetLeft, top: panel.offsetTop,
                w: panel.offsetWidth, h: parseInt(panel.style.height, 10) || null
            }));
        } catch (e) { /* storage may be unavailable */ }
    }
    function restoreGeom(panel) {
        try {
            var g = JSON.parse(localStorage.getItem(GEOM_KEY) || 'null');
            if (!g) return;
            var left = Math.max(0, Math.min(g.left, window.innerWidth - 120));
            var top = Math.max(0, Math.min(g.top, window.innerHeight - 60));
            panel.style.left = left + 'px'; panel.style.top = top + 'px'; panel.style.right = 'auto';
            if (g.w) panel.style.width = Math.max(320, Math.min(g.w, window.innerWidth - left - 4)) + 'px';
            if (g.h) {
                panel.style.height = Math.max(280, Math.min(g.h, window.innerHeight - top - 4)) + 'px';
                panel.style.maxHeight = 'none';
            }
        } catch (e) { /* ignore broken saved geometry */ }
    }
    function resetGeom(panel) {
        panel.style.width = ''; panel.style.height = ''; panel.style.maxHeight = '';
        panel.style.left = ''; panel.style.right = '10px'; panel.style.top = '10px';
        try { localStorage.removeItem(GEOM_KEY); } catch (e) { /* ignore */ }
    }

    // ---------- shell ----------
    function render() {
        var body = $('se-body');
        if (!body) return;
        state.token++;
        body.innerHTML = '';
        [].forEach.call(document.querySelectorAll('#' + PANEL_ID + ' .se-tabs button'), function (b) {
            b.className = b.getAttribute('data-tab') === state.tab ? 'on' : '';
        });
        [].forEach.call(document.querySelectorAll('#' + PANEL_ID + ' .se-seg button'), function (b) {
            b.className = b.getAttribute('data-mode') === state.mode ? 'on' : '';
        });
        updateHint();
        updateFooter();
        if (!state.snap) { body.appendChild(el('div', { text: 'No save found.' })); return; }
        if (state.tab === 'quick') renderQuick(body);
        else if (state.tab === 'editor') { buildEditorShell(body); renderEditor(false); }
        else if (state.tab === 'queue') { buildQueueShell(body); renderQueueList(false); }
        else renderBackups(body);
    }

    function build() {
        var old = $(PANEL_ID); if (old) old.remove();
        var oldStyle = $(STYLE_ID); if (oldStyle) oldStyle.remove();
        document.head.appendChild(el('style', { id: STYLE_ID, textContent: CSS }));

        var slotSel = el('select', {
            id: 'se-slot', style: 'display:none',
            onChange: async function () {
                state.slot = $('se-slot').value; state.pending = {};
                await refreshSnap(); render();
                setStatus('Switched save slot; staged changes cleared.', 'warn');
            }
        });

        var head = el('div', { className: 'se-head', id: 'se-head' }, [
            el('span', { className: 'se-title', text: 'Save Editor v3' }),
            slotSel,
            el('button', { text: '\u2013', title: 'Minimize', onClick: function () { panel.classList.toggle('se-min'); } }),
            el('button', { className: 'se-x', text: 'X', title: 'Close', onClick: function () { panel.remove(); } })
        ]);

        var seg = el('div', { className: 'se-seg' }, MODES.map(function (m) {
            return el('button', {
                text: m.label, onClick: function () { state.mode = m.id; render(); }
            }, []);
        }));
        [].forEach.call(seg.children, function (b, i) { b.setAttribute('data-mode', MODES[i].id); });
        var bar = el('div', { className: 'se-bar' }, [el('span', { text: 'Amount' }), seg]);

        var TAB_DEFS = [['quick', 'Quick'], ['editor', 'Editor'], ['queue', 'Queue (0)'], ['backups', 'Backups']];
        var tabs = el('div', { className: 'se-tabs' }, TAB_DEFS.map(function (t) {
            var b = el('button', { id: 'se-tab-' + t[0], text: t[1], onClick: function () { state.tab = t[0]; render(); } });
            b.setAttribute('data-tab', t[0]);
            return b;
        }));

        var autoCb = el('input', { type: 'checkbox', onChange: function () { state.auto = autoCb.checked; } });
        var foot = el('div', { className: 'se-foot' }, [
            el('div', { className: 'se-status', id: 'se-status', text: 'Loading save...' }),
            el('div', { className: 'se-actions' }, [
                el('button', { className: 'se-apply', id: 'se-apply', text: 'Apply & reload (0)', onClick: apply }),
                el('button', { text: 'Discard', onClick: discard }),
                el('button', { text: '\u21BB', title: 'Re-read values from the save file', onClick: reloadSnap }),
                el('button', { text: 'Export', title: 'Download the save as .txt', onClick: backup }),
                el('label', { title: 'Apply & reload after every click', style: 'display:flex;gap:3px;align-items:center;cursor:pointer' },
                    [autoCb, 'Auto'])
            ])
        ]);

        var grip = el('div', { className: 'se-grip', title: 'Drag to resize, double-click to reset size and position' });
        var panel = el('div', { id: PANEL_ID }, [
            head, bar, el('div', { className: 'se-hint', id: 'se-hint' }), tabs,
            el('div', { className: 'se-body', id: 'se-body' }), foot, grip
        ]);

        // keep game hotkeys from firing while typing in the panel
        ['keydown', 'keyup', 'keypress'].forEach(function (t) {
            panel.addEventListener(t, function (e) { e.stopPropagation(); });
        });

        // dragging (addEventListener, the game's own handlers stay untouched)
        var dragging = false, ox = 0, oy = 0;
        head.addEventListener('mousedown', function (e) {
            if (/BUTTON|SELECT|OPTION/.test(e.target.tagName)) return;
            dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            panel.style.left = (e.clientX - ox) + 'px';
            panel.style.top = (e.clientY - oy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', function () {
            if (dragging) { dragging = false; saveGeom(panel); }
        });

        // resizing (grip in the bottom-right corner)
        var rs = null;
        grip.addEventListener('mousedown', function (e) {
            e.preventDefault(); e.stopPropagation();
            var r = panel.getBoundingClientRect();
            panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px'; panel.style.right = 'auto';
            rs = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
        });
        document.addEventListener('mousemove', function (e) {
            if (!rs) return;
            var w = Math.max(320, Math.min(rs.w + e.clientX - rs.x, window.innerWidth - panel.offsetLeft - 4));
            var h = Math.max(280, Math.min(rs.h + e.clientY - rs.y, window.innerHeight - panel.offsetTop - 4));
            panel.style.width = w + 'px';
            panel.style.height = h + 'px';
            panel.style.maxHeight = 'none';
        });
        document.addEventListener('mouseup', function () {
            if (rs) { rs = null; saveGeom(panel); }
        });
        grip.addEventListener('dblclick', function () { resetGeom(panel); });

        document.body.appendChild(panel);
        restoreGeom(panel);
        return panel;
    }

    async function init() {
        build();
        try {
            await refreshSnap();
            var sel = $('se-slot');
            if (state.slots.length > 1) {
                state.slots.forEach(function (s) { sel.appendChild(el('option', { value: s, text: s, selected: s === state.slot })); });
                sel.style.display = '';
            }
            render();
            setStatus(state.snap ? 'Ready: ' + state.slot : 'No save found.', state.snap ? 'ok' : 'err');
        } catch (err) {
            console.error('[SaveEditor]', err);
            setStatus('Could not read the save - see console', 'err');
        }
    }

    init();
})();
