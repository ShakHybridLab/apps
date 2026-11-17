'use strict';
/**
 * ShakManette : appli d'essai, lecture seule (shared/signal_probe.js, noms dans shared/probe_sets.js). Ne touche à aucun thème.
 */
const mgu = require('./kit/mgu');
const probe = require('./signal_probe');
const SET = require('./probe_sets').shakmanette;

mgu.run({
    start(ctx) {
        try {
            probe.start(ctx, SET);
        } catch (e) {
            ctx.log.error('ShakManette failed to start: ' + (e && e.stack || e));
        }
    }
});
