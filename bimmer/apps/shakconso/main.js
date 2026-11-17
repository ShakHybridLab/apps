'use strict';
/**
 * ShakConso : appli d'essai, lecture seule (shared/signal_probe.js, noms dans shared/probe_sets.js). Ne touche à aucun thème.
 */
const mgu = require('./kit/mgu');
const probe = require('./signal_probe');
const SET = require('./probe_sets').shakconso;

mgu.run({
    start(ctx) {
        try {
            probe.start(ctx, SET);
        } catch (e) {
            ctx.log.error('ShakConso failed to start: ' + (e && e.stack || e));
        }
    }
});
