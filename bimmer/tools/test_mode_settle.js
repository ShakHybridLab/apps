'use strict';
// node tools/test_mode_settle.js : le thème ne suit un mode de conduite qu'après MODE_SETTLE_MS (1,5 s), même si une autre reconstruction
// (une alerte, la carte, un réglage) tombe pendant ce temps. Avant 0.23.0, cette reconstruction prenait déjà le mode passager : le thème,
// ou le compteur BMW, changeait quelques secondes sur un mode que la voiture n'avait envoyé qu'un instant (le propriétaire, 23 nov. 2026).
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const H = require(path.join(tmp, 'shared', 'hud.js'));
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + e.message); } };
const S = { byMode: true, hudLayout: 'm', inHybrid: 'm', inSport: 'off', inEco: 'm', inElectric: 'm', accentByMode: true };
const h = Object.create(H.prototype);
h.ctx = { settings: { get: (k) => S[k], item: (k) => (k in S ? { key: k, type: typeof S[k] === 'boolean' ? 'bool' : 'string' } : null) } };
h.target = 'panel'; h.accentLayout = true; h.config = {};
check('le mode vient de changer (Sport), pas encore tenu 1,5 s : le thème reste celui du mode d\'avant', () => {
    h.layoutMode = 'hybrid'; h.driveMode = 'sport';
    assert.strictEqual(h._chosenName(), 'm');
    assert.strictEqual(h.setting('driveSport'), false);
    assert.strictEqual(h._accentHue(), 'green');
});
check('le mode a tenu : le thème le suit', () => {
    h.layoutMode = 'sport';
    assert.strictEqual(h._chosenName(), 'off');
    assert.strictEqual(h.setting('driveSport'), true);
    assert.strictEqual(h._accentHue(), 'red');
});
check('le nom du mode et sa couleur à l\'écran suivent le mode tout de suite', () => {
    h.layoutMode = 'hybrid'; h.driveMode = 'sport'; h.driveName = null; h.driveVariant = null;
    const c = h._accentColor(); assert(c && c[0] > 200 && c[1] < 80, 'rouge ' + c);
});
console.log(bad ? bad + ' échec(s)' : 'mode de conduite tenu : tout passe');
process.exit(bad ? 1 : 0);
