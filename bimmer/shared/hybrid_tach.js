'use strict';
/**
 * The hybrid rev counter's decision, for the layers that ask for it ("hybridTach": M Blade's blade, Sport's rev bracket). Inputs: the
 * battery's power in kW that eDrive Live shares (negative while charging; null when nobody shares it, or when its last read is only
 * held) and the engine's rpm. Output { kw, engineOff, ev, chg }:
 *   engineOff  the rpm is known and under ENGINE_RPM (a plug-in hybrid's engine at rest turns 0 rpm)
 *   ev         the battery alone drives: engine off, power >= 0 (the layer draws the power, in blue)
 *   chg        0..1, the power going back into the battery over CHARGE_KW (recuperation or the engine charging it), 0 under CHARGE_MIN_KW
 * With no shared power, ev is false and chg 0: the rpm shows alone, as on a combustion car. An unknown rpm never counts as engine off.
 */
const ENGINE_RPM = 400, CHARGE_KW = 60, CHARGE_MIN_KW = 1;

function state(kw, rpm) {
    const num = (v) => typeof v === 'number' && isFinite(v);
    const engineOff = num(rpm) && rpm < ENGINE_RPM;
    return {
        kw: num(kw) ? kw : null,
        engineOff,
        ev: num(kw) && engineOff && kw >= 0,
        chg: num(kw) && kw <= -CHARGE_MIN_KW ? Math.min(1, -kw / CHARGE_KW) : 0,
    };
}

module.exports = { state, ENGINE_RPM, CHARGE_KW, CHARGE_MIN_KW };
