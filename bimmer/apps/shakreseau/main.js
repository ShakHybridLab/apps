'use strict';
/**
 * ShakReseau : appli d'essai, lecture seule (shared/net_probe.js). Dit, sur la voiture, si une appli peut joindre internet (Spotify).
 * Ne touche à aucun thème.
 */
const mgu = require('./kit/mgu');
const probe = require('./net_probe');

mgu.run({
    start(ctx) {
        try {
            probe.start(ctx, { title: 'ShakReseau' });
        } catch (e) {
            ctx.log.error('ShakReseau failed to start: ' + (e && e.stack || e));
        }
    }
});
