import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.System;
import Toybox.Lang;

// AOD (Always-On Display) — pantalla de bajo consumo
// Solo muestra hora en grande sobre fondo negro
class MiWatchFaceBackground extends WatchUi.WatchFaceBackground {

    function initialize() {
        WatchFaceBackground.initialize();
    }

    function onUpdate(dc as Dc) as Void {
        var w  = dc.getWidth();
        var h  = dc.getHeight();
        var cx = w / 2;

        // Fondo completamente negro (conserva batería en MIP display)
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // Hora mínima: solo HH:MM sin segundos
        var clockTime = System.getClockTime();
        var settings  = System.getDeviceSettings();
        var hours     = clockTime.hour;
        if (!settings.is24Hour) {
            hours = hours % 12;
            if (hours == 0) { hours = 12; }
        }
        var timeStr = hours.format("%02d") + ":" + clockTime.min.format("%02d");

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h / 2 - 28, Graphics.FONT_NUMBER_THAI_HOT, timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Minibatería (solo si < 20%)
        var bat = System.getSystemStats().battery.toNumber();
        if (bat < 20) {
            dc.setColor(Graphics.COLOR_RED, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h / 2 + 26, Graphics.FONT_TINY, bat.toString() + "%", Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}
