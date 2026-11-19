'use strict';
// node tools/test_bc_button.js : la touche BC du commodo (shared/bc_button.js) et son branchement dans ShakTheme.
const assert = require('assert'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { BcButton } = require('../shared/bc_button');
let n = 0, bad = 0;
function check(name, fn) { n++; try { fn(); } catch (e) { bad++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

check('un appui (0 puis 64 répété puis 0) compte une fois ; la valeur répétée par la voiture ne recompte pas', () => {
    let t = 0, p = 0; const b = new BcButton(() => { p++; }, () => t);
    b.value({ operationColumnStalks: 0 });
    for (let i = 0; i < 20; i++) { t += 20; b.value({ operationColumnStalks: 64 }); }
    t += 20; b.value({ operationColumnStalks: 0 });
    assert.strictEqual(p, 1);
    t += 500; b.value({ operationColumnStalks: 64 }); t += 100; b.value({ operationColumnStalks: 0 });
    assert.strictEqual(p, 2);
});
check('touche tenue au démarrage de l\'appli : pas un appui ; clignotant en même temps : compte quand même ; valeurs illisibles ignorées', () => {
    let t = 0, p = 0; const b = new BcButton(() => { p++; }, () => t);
    b.value({ operationColumnStalks: 64 }); assert.strictEqual(p, 0);
    t += 1000; b.value({ operationColumnStalks: 0 }); b.value(null); b.value({ autre: 64 }); b.value('x');
    t += 1000; b.value({ operationColumnStalks: 2 }); t += 50; b.value({ operationColumnStalks: 66 });
    assert.strictEqual(p, 1);
    t += 50; b.value(2); t += 400; b.value(64); assert.strictEqual(p, 2, 'un nombre nu est lu aussi');
});
check('deux appuis à moins de 250 ms : un seul (rebond) ; une erreur de l\'appelant ne sort pas', () => {
    let t = 1000, p = 0; const b = new BcButton(() => { p++; throw new Error('x'); }, () => t);
    b.value(0); b.value(64); t += 50; b.value(0); t += 50; b.value(64);
    assert.strictEqual(p, 1);
});
check('ShakTheme : le signal du commodo est déclaré (accepté sur la voiture), le fichier est partagé, le réglage existe et main.js appelle nextView', () => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'shaktheme', 'app.json'), 'utf8'));
    assert.strictEqual(spec.signals['de.bmw.body.Light'].IndicatorSteeringColumn, 's');
    assert(spec.shared.includes('bc_button.js'));
    const s = spec.settings.find((x) => x.key === 'bcViews'); assert(s && s.type === 'bool' && s.default === true);
    const main = fs.readFileSync(path.join(ROOT, 'apps', 'shaktheme', 'main.js'), 'utf8');
    assert(/bcViews'\) !== false/.test(main) && /hud\.nextView\(\)/.test(main) && /IndicatorSteeringColumn: \(v\) => bc\.value\(v\)/.test(main));
    const ok = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'car_accepted_signals.json'), 'utf8'));
    assert(JSON.stringify(ok).includes('IndicatorSteeringColumn'));
});
console.log(bad ? 'bc button: FAILED' : 'bc button: all ' + n + ' checks pass');
process.exit(bad ? 1 : 0);
