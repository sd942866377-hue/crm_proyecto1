import Toybox.WatchUi;
import Toybox.Graphics;
import Toybox.System;
import Toybox.ActivityMonitor;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.Application;
import Toybox.Lang;

class MiWatchFaceView extends WatchUi.WatchFace {

    // Colores por tema: [acento, secundario]
    private const THEMES = [
        [Graphics.COLOR_DK_GREEN,  Graphics.COLOR_GREEN ],  // 0 verde
        [0xFF6600,                 0xFFAA00             ],  // 1 naranja
        [Graphics.COLOR_BLUE,      Graphics.COLOR_LT_GRAY], // 2 azul
        [Graphics.COLOR_LT_GRAY,   Graphics.COLOR_WHITE ],  // 3 blanco
    ] as Array<Array<Number>>;

    private var _theme as Number = 0;

    function initialize() {
        WatchFace.initialize();
    }

    function onLayout(dc as Dc) as Void {
        setLayout(Rez.Layouts.WatchFace(dc));
        _theme = Application.getApp().getProperty("ColorTheme") as Number;
        if (_theme == null || _theme < 0 || _theme > 3) { _theme = 0; }
    }

    function onShow() as Void {}

    function onUpdate(dc as Dc) as Void {
        var w  = dc.getWidth();   // 176 en Instinct 2
        var h  = dc.getHeight();  // 176
        var cx = w / 2;

        // Recargar tema por si el usuario lo cambió
        var t = Application.getApp().getProperty("ColorTheme") as Number;
        if (t != null && t >= 0 && t <= 3) { _theme = t; }

        var accent = THEMES[_theme][0];
        var accentSoft = THEMES[_theme][1];

        // FONDO NEGRO
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        _drawStatusBar(dc, w, cx, accent);
        _drawTime(dc, w, cx, accent);
        _drawDate(dc, w, cx, accent);
        _drawDataRow1(dc, w, cx, accent);
        _drawDataRow2(dc, w, cx, accent);
        _drawBottomBar(dc, w, cx, accent, accentSoft);
    }

    //--------------------------------------------------------------------------
    // STATUS BAR  (y 3‥16)
    //--------------------------------------------------------------------------
    private function _drawStatusBar(dc as Dc, w as Number, cx as Number, accent as Number) as Void {
        var settings = System.getDeviceSettings();
        var stats    = System.getSystemStats();
        var y = 3;

        // Bluetooth
        dc.setColor(settings.phoneConnected ? Graphics.COLOR_BLUE : Graphics.COLOR_DK_GRAY,
                    Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(5, y + 1, 4, 9);
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(6, y + 2, 2, 7);
        dc.setColor(settings.phoneConnected ? Graphics.COLOR_BLUE : Graphics.COLOR_DK_GRAY,
                    Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon([[5, y+4],[8, y+2],[8, y+7],[5, y+5]]);

        // Notificaciones
        var notif = settings.notificationCount;
        if (notif != null && notif > 0) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(14, y, Graphics.FONT_XTINY,
                        (notif > 9 ? "9+" : notif.toString()),
                        Graphics.TEXT_JUSTIFY_LEFT);
        }

        // Do Not Disturb
        if (settings.doNotDisturb) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, y, Graphics.FONT_XTINY, "DND", Graphics.TEXT_JUSTIFY_CENTER);
        }

        // Alarma activa
        if (settings.alarmCount != null && settings.alarmCount > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w - 30, y, Graphics.FONT_XTINY, "ALM", Graphics.TEXT_JUSTIFY_LEFT);
        }

        // Batería
        var batPct = stats.battery.toNumber();
        var batColor = batPct > 20
            ? (stats.charging ? accent : Graphics.COLOR_WHITE)
            : Graphics.COLOR_RED;
        dc.setColor(batColor, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w - 3, y, Graphics.FONT_XTINY, batPct.toString() + "%", Graphics.TEXT_JUSTIFY_RIGHT);
        if (stats.charging) {
            dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w - 3, y, Graphics.FONT_XTINY, "+ " + batPct.toString() + "%", Graphics.TEXT_JUSTIFY_RIGHT);
        }
    }

    //--------------------------------------------------------------------------
    // HORA GRANDE  (y 20‥78)
    //--------------------------------------------------------------------------
    private function _drawTime(dc as Dc, w as Number, cx as Number, accent as Number) as Void {
        var clockTime = System.getClockTime();
        var settings  = System.getDeviceSettings();

        var fmt = Application.getApp().getProperty("TimeFormat") as Number;
        if (fmt == null) { fmt = 0; }
        var is24 = (fmt == 1) || (fmt == 0 && settings.is24Hour);

        var hours  = clockTime.hour;
        var suffix = "";
        if (!is24) {
            suffix = hours < 12 ? "AM" : "PM";
            hours  = hours % 12;
            if (hours == 0) { hours = 12; }
        }

        var timeStr = hours.format("%02d") + ":" + clockTime.min.format("%02d");
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 20, Graphics.FONT_NUMBER_THAI_HOT, timeStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Segundos
        var showSec = Application.getApp().getProperty("ShowSeconds") as Boolean;
        if (showSec == null || showSec) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx + 52, 68, Graphics.FONT_TINY,
                        clockTime.sec.format("%02d"), Graphics.TEXT_JUSTIFY_LEFT);
        }

        // AM / PM
        if (!is24 && suffix.length() > 0) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx - 56, 68, Graphics.FONT_TINY, suffix, Graphics.TEXT_JUSTIFY_LEFT);
        }
    }

    //--------------------------------------------------------------------------
    // FECHA  (y 82‥98)
    //--------------------------------------------------------------------------
    private function _drawDate(dc as Dc, w as Number, cx as Number, accent as Number) as Void {
        var now  = Gregorian.info(Time.now(), Time.FORMAT_SHORT);
        var DAYS = ["DOM","LUN","MAR","MIÉ","JUE","VIE","SÁB"];
        var MONS = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];

        var dateStr = DAYS[now.day_of_week - 1]
                    + "  " + now.day
                    + "  " + MONS[now.month - 1]
                    + "  " + now.year;

        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(14, 82, w - 28, 1);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 84, Graphics.FONT_TINY, dateStr, Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(14, 98, w - 28, 1);
    }

    //--------------------------------------------------------------------------
    // DATOS FILA 1 — Pasos | FC | Calorías  (y 102‥128)
    //--------------------------------------------------------------------------
    private function _drawDataRow1(dc as Dc, w as Number, cx as Number, accent as Number) as Void {
        var info   = ActivityMonitor.getInfo();
        var col1   = w / 6;          // ≈ 29
        var col2   = cx;             // 88
        var col3   = w - w / 6;      // ≈ 147
        var yLabel = 102;
        var yVal   = 113;

        // Labels
        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.drawText(col1, yLabel, Graphics.FONT_XTINY, "PASOS", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(col2, yLabel, Graphics.FONT_XTINY, "FC",    Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(col3, yLabel, Graphics.FONT_XTINY, "CAL",   Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        // Pasos
        var steps = (info.steps != null) ? info.steps : 0;
        var stepsStr;
        if (steps >= 10000) {
            stepsStr = (steps / 1000).toString() + "." + ((steps % 1000) / 100).toString() + "k";
        } else if (steps >= 1000) {
            stepsStr = (steps / 1000).toString() + "." + ((steps % 1000) / 100).toString() + "k";
        } else {
            stepsStr = steps.toString();
        }
        dc.drawText(col1, yVal, Graphics.FONT_SMALL, stepsStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Frecuencia cardíaca
        var hrStr = "--";
        var hrIter = ActivityMonitor.getHeartRateHistory(1, false);
        var hrSample = hrIter.next();
        if (hrSample != null && hrSample.heartRate != ActivityMonitor.INVALID_HR_SAMPLE) {
            hrStr = hrSample.heartRate.toString();
        }
        dc.drawText(col2, yVal, Graphics.FONT_SMALL, hrStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Calorías activas
        var calStr = (info.calories != null) ? info.calories.toString() : "--";
        dc.drawText(col3, yVal, Graphics.FONT_SMALL, calStr, Graphics.TEXT_JUSTIFY_CENTER);
    }

    //--------------------------------------------------------------------------
    // DATOS FILA 2 — Distancia | Pisos | Min. activos  (y 130‥158)
    //--------------------------------------------------------------------------
    private function _drawDataRow2(dc as Dc, w as Number, cx as Number, accent as Number) as Void {
        var info   = ActivityMonitor.getInfo();
        var col1   = w / 6;
        var col2   = cx;
        var col3   = w - w / 6;
        var yLabel = 132;
        var yVal   = 143;

        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(14, 130, w - 28, 1);

        dc.drawText(col1, yLabel, Graphics.FONT_XTINY, "KM",    Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(col2, yLabel, Graphics.FONT_XTINY, "PISOS", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(col3, yLabel, Graphics.FONT_XTINY, "MIN",   Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);

        // Distancia (cm → km con 1 decimal)
        var distStr = "0.0";
        if (info.distance != null && info.distance > 0) {
            var km  = info.distance / 100000;
            var dec = (info.distance % 100000) / 10000;
            distStr = km.toString() + "." + dec.toString();
        }
        dc.drawText(col1, yVal, Graphics.FONT_SMALL, distStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Pisos subidos
        var floorsStr = (info.floorsClimbed != null) ? info.floorsClimbed.toString() : "--";
        dc.drawText(col2, yVal, Graphics.FONT_SMALL, floorsStr, Graphics.TEXT_JUSTIFY_CENTER);

        // Minutos activos (intensidad moderada+)
        var activeStr = "--";
        if (info has :activeMinutes && info.activeMinutes != null) {
            if (info.activeMinutes has :total) {
                activeStr = info.activeMinutes.total.toString();
            }
        }
        dc.drawText(col3, yVal, Graphics.FONT_SMALL, activeStr, Graphics.TEXT_JUSTIFY_CENTER);
    }

    //--------------------------------------------------------------------------
    // BARRA INFERIOR — Progreso de pasos + meta  (y 160‥174)
    //--------------------------------------------------------------------------
    private function _drawBottomBar(dc as Dc, w as Number, cx as Number,
                                    accent as Number, accentSoft as Number) as Void {
        var info = ActivityMonitor.getInfo();

        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(14, 160, w - 28, 1);

        // Meta de pasos desde propiedad o sensor
        var goal  = Application.getApp().getProperty("StepGoal") as Number;
        if (goal == null || goal <= 0) {
            goal = (info.stepGoal != null && info.stepGoal > 0) ? info.stepGoal : 10000;
        }
        var steps = (info.steps != null) ? info.steps : 0;
        var pct   = steps.toFloat() / goal.toFloat();
        if (pct > 1.0f) { pct = 1.0f; }

        var barW    = w - 28;
        var filled  = (barW * pct).toNumber();

        // Fondo gris de la barra
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(14, 162, barW, 5);

        // Relleno de progreso (azul si meta cumplida)
        var barColor = pct >= 1.0f ? Graphics.COLOR_BLUE : accent;
        dc.setColor(barColor, Graphics.COLOR_TRANSPARENT);
        if (filled > 0) { dc.fillRectangle(14, 162, filled, 5); }

        // Texto con porcentaje y meta
        var pctNum  = (pct * 100).toNumber();
        var goalStr = goal >= 1000 ? (goal / 1000).toString() + "k" : goal.toString();
        var label   = "META " + pctNum.toString() + "% · " + goalStr + " pasos";
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, 168, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_CENTER);
    }

    //--------------------------------------------------------------------------
    function onEnterSleep() as Void { WatchUi.requestUpdate(); }
    function onExitSleep()  as Void { WatchUi.requestUpdate(); }
}
