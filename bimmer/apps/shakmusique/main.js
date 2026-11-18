'use strict';
/**
 * Shak Musique : un lecteur de musique pour la voiture, par-dessus le service de RideTube (jap-ridetube-d), comme RideTube joue YouTube.
 * Le son sort par le lecteur multimédia de la voiture. Rien n'est gardé. shared/music_ctl.js (socket, file d'attente), shared/music_ui.js (écran).
 */
const mgu = require('./kit/mgu');
const ui = require('./music_ui');

mgu.run({
    start(ctx) {
        require('./survive').install(ctx.log);       // une erreur que personne n'a rattrapée ne ferme pas l'appli (shared/survive.js)
        try {
            ui.start(ctx);
        } catch (e) {
            ctx.log.error('Shak Musique failed to start: ' + (e && e.stack || e));
        }
    }
});
