import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class MiWatchFaceApp extends Application.AppBase {

    function initialize() {
        AppBase.initialize();
    }

    function onStart(state as Dictionary?) as Void {}
    function onStop(state as Dictionary?) as Void {}

    function getInitialView() as [Views] or [Views, InputDelegates] {
        return [new MiWatchFaceView()];
    }
}

function getApp() as MiWatchFaceApp {
    return Application.getApp() as MiWatchFaceApp;
}
