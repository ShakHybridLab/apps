'use strict';
/**
 * ShakGPS : appli d'essai, lecture seule (shared/signal_probe.js, noms dans shared/probe_sets.js). Ne touche à aucun thème.
 */
const mgu = require('./kit/mgu');
const probe = require('./signal_probe');
const SET = require('./probe_sets').shakgps;

mgu.run({
    start(ctx) {
        require('./survive').install(ctx.log);       // une erreur que personne n'a rattrapée ne ferme pas l'appli (shared/survive.js)
        try {
            probe.start(ctx, SET);
        } catch (e) {
            ctx.log.error('ShakGPS failed to start: ' + (e && e.stack || e));
        }
    }
});
