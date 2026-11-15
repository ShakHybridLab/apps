'use strict';
// L'horloge des thèmes : la voiture donne l'heure UTC, le fuseau par défaut est l'Europe centrale (heure d'été automatique).
// Photos du 15 nov. 2026 : 19:36 chez nous, 20:36 sur la bande de BMW. node tools/test_clock_tz.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const tz = require('../shared/tz');
const fr = require('../shared/fr');
// hud.js attend le dossier tel que l'appli l'installe (shared/ à côté de kit/) : copie temporaire
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clock-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const app = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'apps', n, 'app.json'), 'utf8'));

['shaktheme', 'shakhud'].forEach((n) => {
    check(n + ' : le fuseau par défaut est l\'Europe centrale (et fait partie des choix)', () => {
        const s = app(n).settings.find((x) => x.key === 'timeZone');
        assert.strictEqual(s.default, 10012);
        assert(s.steps.indexOf(10012) >= 0);
        assert.strictEqual(tz.ZONES[10012][0], 'Central Europe');
    });
});

check('Europe centrale : +1 h en hiver, +2 h en été, changement le dernier dimanche de mars et d\'octobre à 1 h UTC', () => {
    assert.strictEqual(tz.offset(10012, Date.UTC(2026, 10, 15, 19, 36)), 60);
    assert.strictEqual(tz.offset(10012, Date.UTC(2026, 6, 15, 12, 0)), 120);
    assert.strictEqual(tz.offset(10012, Date.UTC(2026, 2, 29, 0, 59)), 60);     // dimanche 29 mars 2026, 1 h UTC : on passe à l'été
    assert.strictEqual(tz.offset(10012, Date.UTC(2026, 2, 29, 1, 0)), 120);
    assert.strictEqual(tz.offset(10012, Date.UTC(2026, 9, 25, 0, 59)), 120);   // dimanche 25 octobre 2026
    assert.strictEqual(tz.offset(10012, Date.UTC(2026, 9, 25, 1, 0)), 60);
});

check('l\'horloge de HudApp : 19:36 UTC donne 20:36 avec le réglage par défaut, 21:36 en été', () => {
    const real = Date.now;
    try {
        const fake = (setting) => ({ ctx: { settings: { item: () => true } }, setting: () => setting, config: {} });
        Date.now = () => Date.UTC(2026, 10, 15, 19, 36);
        let t = HudApp.prototype._now.call(fake(10012));
        assert.deepStrictEqual([t.getHours(), t.getMinutes()], [20, 36]);
        Date.now = () => Date.UTC(2026, 6, 15, 19, 36);
        t = HudApp.prototype._now.call(fake(10012));
        assert.deepStrictEqual([t.getHours(), t.getMinutes()], [21, 36]);
    } finally { Date.now = real; }
});

check('les noms des fuseaux et « Automatique » sont en français', () => {
    Object.keys(tz.ZONES).forEach((k) => { const nm = tz.ZONES[k][0]; assert(fr.tr(nm) !== nm || nm === 'Alaska' || nm === 'Arizona', nm + ' : pas de français'); });
    assert.strictEqual(fr.tr('Automatic'), 'Automatique');
    assert.strictEqual(fr.tr(tz.name(10012)), 'Europe centrale');
});

fs.rmSync(tmp, { recursive: true, force: true });
if (failed) { console.log(failed + ' en échec'); process.exit(1); }
console.log('tout est bon');
