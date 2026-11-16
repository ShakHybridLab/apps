'use strict';
/**
 * ShakCamDiag - read-only discovery app for iDrive 7 camera access.
 * It deliberately does not open camera devices, start/stop BMW services, alter AVB,
 * or claim that a discovered node is a usable front/rear video stream.
 */
const mgu = require('./kit/mgu');
const fs = require('fs');
const path = require('path');
const Diag = require('./shakcamdiag');

mgu.run({
    start(ctx) {
        let diag;
        try {
            diag = new Diag({ fs, path, log: ctx.log });
            const speedSignal = (v) => {
                const raw = v && v.speedVehicleCentreOfGravity;
                diag.speed(typeof raw === 'number' && raw !== 65535 ? raw * 0.015625 : null);
            };
            const gearSignal = (v) => {
                const raw = v && v.statusActualStageDrive;
                diag.gear(Diag.stageOf(raw));
            };
            const selectSignal = (v) => {
                const raw = v && v.statusGearSelectionDrive;
                const s = Diag.selectionOf(raw);
                if (s) diag.gear(s.stage);
            };
            ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
                statusCarSpeed2: speedSignal
            }, ctx.log, { pollMs: 1000 }).then((s) => ctx.log.info('ShakCamDiag speed signal: ' + (s && s.error ? s.error : 'subscribed')));
            ctx.signals.watch('de.bmw.infrastructure.VehicleInformation', '1', {
                statusGearboxDrive: gearSignal,
                DataPowerTrain2: selectSignal
            }, ctx.log).then((s) => ctx.log.info('ShakCamDiag gear signals: ' + (s && s.error ? s.error : 'subscribed')));

            let loop;
            const render = () => {
                const cv = ctx.canvas(1600, 520);
                const s = diag.snapshot();
                cv.clear('#090c12');
                cv.text('SHAK CAM DIAGNOSTIC', 48, 62, 32, '#ffffff', { font: 'bold' });
                cv.text('iDrive 7 · découverte en lecture seule', 48, 94, 18, '#91a0b4');
                cv.text('VITESSE', 48, 154, 16, '#91a0b4');
                cv.text(s.speedText, 48, 202, 38, '#ffffff', { font: 'bold' });
                cv.text('RAPPORT', 410, 154, 16, '#91a0b4');
                cv.text(s.gear || 'INCONNU', 410, 202, 38, '#ffffff', { font: 'bold' });
                cv.text('CAMERA AVANT', 48, 274, 18, '#ffffff', { font: 'bold' });
                cv.text(s.front.label, 48, 308, 22, s.front.color);
                cv.text('CAMERA ARRIERE', 820, 274, 18, '#ffffff', { font: 'bold' });
                cv.text(s.rear.label, 820, 308, 22, s.rear.color);
                cv.text('NŒUDS / SERVICES DETECTES', 48, 374, 16, '#91a0b4');
                cv.text(s.summary, 48, 408, 18, '#dce4ef');
                cv.text('Aucun flux n’est ouvert ni modifié par cette application.', 48, 474, 16, '#91a0b4');
                return ctx.ui.image('MAIN_GFX', cv);
            };
            loop = ctx.loop('MAIN', 10, render);
            diag.onChange = () => { if (loop && loop.kick) loop.kick(); };
            diag.scan();
            diag.timer = setInterval(() => { try { diag.scan(); } catch (e) { ctx.log.warn('ShakCamDiag scan: ' + e.message); } }, 5000);
            if (diag.timer.unref) diag.timer.unref();
            render();
            process.on('exit', () => { try { diag.stop(); } catch (e) { /* exiting */ } });
        } catch (e) {
            ctx.log.error('ShakCamDiag failed to start: ' + (e && e.stack || e));
        }
    }
});
