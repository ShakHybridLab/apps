'use strict';
/**
 * ShakHUD: a HUD of its own on the iDrive 7 windshield, drawn through cluster-render (the engine is shared/hud.js, as HUD Widgets').
 * Its layout, M Style, is a bent rev bar that leaves Waze's HUD map readable; the HUD is shared with other kit apps
 * (kit hud_claim): one holds it, the others step aside.
 *
 * The center screen is the app's own page (shared/page.js, a canvas screen). It keeps running after the page is closed
 * (OAP apps stay up in the background), so the page is only needed for changes.
 */
const mgu = require('./kit/mgu');
const HudApp = require('./hud');
const Page = require('./page');

mgu.run({
    start(ctx) {
        require('./survive').install(ctx.log);       // une erreur que personne n'a rattrapée ne ferme pas l'appli (shared/survive.js)
        let hud;
        try {
            hud = new HudApp(ctx);
        } catch (e) {
            // nothing drawn, but stay up: an exit here would count as a crash on the car
            ctx.log.error('ShakHUD failed to start: ' + (e && e.stack || e));
            return;
        }
        hud.start();
        new Page(ctx, hud, {
            title: ctx.spec.title, what: 'HUD',
            look: { name: 'Layouts', style: 'cards', tags: { mstyle: 'bent rev bar · hybrid colours' } },
            tabs: ['look', 'position', 'colours', 'signals', 'settings'],
            settings: ['units', 'clock', 'timeZone', 'redline', 'shiftBefore', 'shiftLights', 'showBattery', 'dangerAlert', 'hideWithWaze', 'shiftLightRed', 'shiftLightFlash', 'hybridRev', 'reserveKm', 'reservePct', 'tyreLow', 'launchReady', 'launchRpm', 'startupSweep', 'warnOil', 'oilCold', 'warnCoolant', 'coolantCold', 'demo'],
        }).start();
        process.on('exit', () => { try { hud.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
