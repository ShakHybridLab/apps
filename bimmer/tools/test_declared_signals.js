'use strict';
// The signals the apps declare in app.json against the list the car has accepted (tools/car_accepted_signals.json).
// The car's app manager refuses the WHOLE installation when one declared signal does not match its catalog (ShakTheme 0.21.12: "UPDATE_FAILED;
// the previous version was kept", over CarPlayManager.projectedGuidanceActive, the one signal not seen accepted before), and the owner cannot read
// the reason on the car. So a new signal goes in the list only after a test install has shown it accepted. node tools/test_declared_signals.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const ROOT = path.join(__dirname, '..');
const accepted = JSON.parse(fs.readFileSync(path.join(__dirname, 'car_accepted_signals.json'), 'utf8')).signals;

['shaktheme', 'shakhud', 'shakpark'].forEach((app) => {
    check(app + ': every declared signal is one the car accepted, with the same flags', () => {
        const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'app.json'), 'utf8'));
        Object.keys(spec.signals || {}).forEach((i) => {
            assert(accepted[i], app + ' declares the interface ' + i + ', not seen accepted by the car');
            Object.keys(spec.signals[i]).filter((k) => k[0] !== '_').forEach((k) => {
                assert(accepted[i][k], app + ' declares ' + i + '.' + k + ', not seen accepted by the car');
                const have = spec.signals[i][k], got = accepted[i][k];
                assert(have === got || (have === 's' && got === 'rs'), app + ' declares ' + i + '.' + k + ' as "' + have + '", accepted as "' + got + '"');
            });
        });
    });
});
check('the list holds only well-formed entries (flags rs, r or s)', () => {
    Object.keys(accepted).forEach((i) => Object.keys(accepted[i]).forEach((k) => assert(/^(rs|r|s)$/.test(accepted[i][k]), i + '.' + k)));
});
if (failed) { console.log('declared signals: ' + failed + ' failed'); process.exit(1); }
console.log('declared signals: all checks pass');
