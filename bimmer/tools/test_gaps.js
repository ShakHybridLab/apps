'use strict';
// node tools/test_gaps.js : le journal des moments où le compteur d'origine a pu revenir (shared/hud.js _gap, gaps.json) et sa ligne d'état en
// français. Le propriétaire, 23 nov. 2026 : « un retour du compteur d'origine pendant quelques secondes, deux fois pendant un trajet ».
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gaps-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));
const fr = require('../shared/fr.js');
let bad = 0;
const check = (name, fn) => { try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + e.message); } };

const h = Object.create(HudApp.prototype);
h.target = 'panel'; h.gaps = []; h.gapsFile = path.join(tmp, 'gaps.json');
h.log = { warn() {}, info() {} };
h._now = () => ({ getHours: () => 9, getMinutes: () => 41 });
check('un trou est noté, gardé dans gaps.json et montré sur la ligne d\'état', () => {
    h._gap('connection stalled, made again [connection 2] (no answer for 6 s)');
    assert.strictEqual(JSON.parse(fs.readFileSync(h.gapsFile, 'utf8')).length, 1);
    const line = 'Cluster on (Electric): Navi theme, 14 layers' + h._lastGap();
    assert.strictEqual(fr.tr(line), 'Cluster actif (Electric) : thème Navi, 14 couches, dernier trou 09:41 (connexion figée refaite [connexion 2] : pas de réponse pendant 6 s)');
});
check('au plus 8 gardés, le dernier montré', () => {
    for (let i = 0; i < 12; i++) h._gap('app started');
    assert.strictEqual(h.gaps.length, 8);
    assert(/dernier trou 09:41 \(appli démarrée\)/.test(fr.tr('Cluster on: Navi theme' + h._lastGap())));
});
check('le mode de conduite qui rend le cluster à BMW, en français', () => {
    h._gap("drive mode Hybrid: BMW's own cluster in that mode");
    assert(/\(mode Hybrid : compteur d'origine dans ce mode\)/.test(fr.tr('Cluster on: Navi theme' + h._lastGap())));
});
check('la même perte sur deux connexions = un seul trou, avec ce qui se passait et sa durée (photo du 26 nov. 2026)', () => {
    const n = h.gaps.length;
    h.car = { data: () => ({ speed: 0 }) }; h.driveName = 'Electric Individual'; h.waze = { st: { state: 'showing' } };
    h._gap('target waiting (none): taken: fetch removed [connection 4]');
    h._gap('target waiting (none): taken: fetch removed [connection 3]');
    assert.strictEqual(h.gaps.length, Math.min(8, n + 1));
    let t = fr.tr('Cluster on: Navi theme' + h._lastGap());
    assert(/; 0 km\/h, carte affichée\) pas encore revenu/.test(t), t);
    h.gaps[h.gaps.length - 1].t -= 4200; h._gapBack();
    t = fr.tr('Cluster on: Navi theme' + h._lastGap());
    assert(/BMW a lâché le thème \[connexion 4\]; 0 km\/h, carte affichée\) : 4\.2 s/.test(t), t);
    h.car = undefined; h.waze = undefined;
});
check('le HUD ne note rien (le cluster seulement)', () => {
    const n = h.gaps.length; h.target = 'hud'; h._gap('x'); h.target = 'panel';
    assert.strictEqual(h.gaps.length, n);
});
console.log(bad ? bad + ' échec(s)' : 'journal des trous : tout passe');
process.exit(bad ? 1 : 0);
