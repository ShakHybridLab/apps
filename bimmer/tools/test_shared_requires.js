'use strict';
// Every file an app ships from shared/ ("shared" in app.json) may only require files that app ships too: a file left out of the list makes
// the app fail to start on the car (nothing in the bench or the unit tests says so, as they run from the repository). node tools/test_shared_requires.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let failed = 0;
['shaktheme', 'shakhud', 'shakpark'].forEach((app) => {
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', app, 'app.json'), 'utf8'));
    const shipped = new Set(spec.shared);
    const missing = [];
    spec.shared.forEach((f) => {
        const p = path.join(ROOT, 'shared', f);
        if (!/\.js$/.test(f) || !fs.existsSync(p)) return;
        const re = /require\('\.\/([A-Za-z_0-9./-]+)'\)/g;
        let m;
        const src = fs.readFileSync(p, 'utf8');
        while ((m = re.exec(src))) {
            const n = /\.(js|json)$/.test(m[1]) ? m[1] : m[1] + '.js';
            if (!shipped.has(n) && !/^kit\//.test(n) && !fs.existsSync(path.join(ROOT, 'apps', app, n))) missing.push(f + ' -> ' + n);
        }
    });
    if (missing.length) { failed++; console.log('FAIL ' + app + ': not in "shared": ' + missing.join(', ')); } else console.log('ok   ' + app + ': every required shared file is shipped');
});
if (failed) process.exit(1);
console.log('shared requires: all checks pass');
