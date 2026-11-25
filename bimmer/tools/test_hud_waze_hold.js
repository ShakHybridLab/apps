'use strict';
// node tools/test_hud_waze_hold.js : ShakHUD se cache pendant la carte Waze (« Cacher tout le HUD quand la carte Waze est affichée ») et le
// reste quand le flux cale une seconde (« frozen ») ou que le fichier d'état est lu à moitié écrit. Avant 0.6.59 le HUD réapparaissait à
// chaque fois : au banc, 54 couches refaites en 20 s de flux qui cale. Waze éteint (« off ») ou parti : le HUD revient tout de suite.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hudwz-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const WZ = path.join(tmp, 'status.json');
process.env.WAZE_STATUS = WZ;
const H = require(path.join(tmp, 'shared', 'hud.js'));
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + e.message); } };
const h = Object.create(H.prototype);
const put = (t) => fs.writeFileSync(WZ, t);
let t = 1000000;
const at = (dt) => { t += dt; return h._wazeShowing(t); };
check('la carte s\'affiche : caché', () => { put('{"state":"showing"}'); assert.strictEqual(at(0), true); });
check('le flux cale une seconde : toujours caché', () => { put('{"state":"frozen"}'); assert.strictEqual(at(1000), true); });
check('fichier lu à moitié écrit : toujours caché', () => { put('{"state":"sho'); assert.strictEqual(at(1000), true); });
check('le flux cale plus de 10 s : le HUD revient', () => { put('{"state":"frozen"}'); at(5000); assert.strictEqual(at(5000), false); });
check('Waze éteint : le HUD revient tout de suite', () => { put('{"state":"showing"}'); assert.strictEqual(at(1000), true); put('{"state":"off"}'); assert.strictEqual(at(1000), false); });
check('Waze parti (plus de fichier) : le HUD revient tout de suite', () => { put('{"state":"showing"}'); at(1000); fs.unlinkSync(WZ); assert.strictEqual(at(1000), false); });
console.log(bad ? bad + ' échec(s)' : 'HUD et carte Waze : tout passe');
process.exit(bad ? 1 : 0);
