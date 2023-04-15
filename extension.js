'use strict';


const {Gio, GObject, GLib, St} = imports.gi;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;
const PanelMenu = imports.ui.panelMenu;
const MessageTray = imports.ui.messageTray;
const QuickSettings = imports.ui.quickSettings;
const QuickSettingsMenu = imports.ui.main.panel.statusArea.quickSettings;
const Clutter = imports.gi.Clutter;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

const Config = imports.misc.config;
const shellVersion = Math.floor(Config.PACKAGE_VERSION);
const toggleNameProperty = (shellVersion > 43) ? 'title' : 'label';

const ICON = 'alarm-symbolic';

const urgencyMapping = {
    0: MessageTray.Urgency.LOW,
    1: MessageTray.Urgency.NORMAL,
    2: MessageTray.Urgency.CRITICAL,
};


const FeatureMenuToggle = GObject.registerClass(
class FeatureMenuToggle extends QuickSettings.QuickMenuToggle {
    _init(_settings) {
        super._init({
            [toggleNameProperty]: Me.metadata.name,
            iconName: ICON,
            toggleMode: true,
        });

        _settings.bind('timer-enabled',
            this, 'checked',
            Gio.SettingsBindFlags.DEFAULT);

        this.menu.setHeader(ICON, Me.metadata.name);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this.menu.addAction('Settings',
            () => ExtensionUtils.openPrefs(),
            'preferences-system-symbolic');
    }
});


const FeatureIndicator = GObject.registerClass(
class FeatureIndicator extends QuickSettings.SystemIndicator {
    _init(_settings) {
        super._init();

        this._indicator = this._addIndicator();
        this._indicator.icon_name = ICON;

        _settings.bind('timer-enabled',
            this._indicator, 'visible',
            Gio.SettingsBindFlags.DEFAULT);

        this.quickSettingsItems.push(new FeatureMenuToggle(_settings));

        this.connect('destroy', () => {
            this.quickSettingsItems.forEach(item => item.destroy());
        });

        QuickSettingsMenu._indicators.add_child(this);
        QuickSettingsMenu._addItems(this.quickSettingsItems);

        if (shellVersion > 43) {
            for (const item of this.quickSettingsItems) {
                QuickSettingsMenu.menu._grid.set_child_below_sibling(item,
                    QuickSettingsMenu._backgroundApps.quickSettingsItems[0]);
            }
        }
    }
});


class Extension {
    constructor() {
        this._indicator = null;
        this._timer = null;
        this._timerLabel = null;
        this._notifyLoop = null;
        this._timerSec = null;
        this._startSec = null;
        this._lastSec = null;
        this._diffSec = null;
        this._settings = null;
        this._showTimerId = null;
        this._closingId = null;
        this._timerEnabledId = null;
    }


    _notify() {
        let messageText = this._settings.get_string('message-text') || 'It is time to stretch your back!';
        let iconName = this._settings.get_string('icon-name') || ICON;
        let urgencyLevel = this._settings.get_int('urgency-level');
        let playSound = this._settings.get_boolean('play-sound');
        let soundName = this._settings.get_string('sound-name') || 'complete';

        let mappedUrgency = urgencyMapping[urgencyLevel];

        let source = new MessageTray.Source(Me.metadata.name, iconName);
        Main.messageTray.add(source);
        let notification = new MessageTray.Notification(source, Me.metadata.name, messageText);
        notification.setUrgency(mappedUrgency);
        notification._soundName = soundName;
        source.showNotification(notification);

        if (playSound) {
            notification.playSound();
        }
    }


    _formatTime(totalSeconds) {
        let totalMinutes = Math.floor(totalSeconds / 60);
        let seconds = totalSeconds % 60;
        let hours = Math.floor(totalMinutes / 60);
        let minutes = totalMinutes % 60;

        if (hours < 10) {
            hours = "0" + hours;
        }

        if (minutes < 10) {
            minutes = "0" + minutes;
        }

        if (seconds < 10) {
            seconds = "0" + seconds;
        }

        if (hours > 0) {
            return `${hours}:${minutes}:${seconds}`;
        } else {
            return `${minutes}:${seconds}`;
        }
    }


    _getTimeLeft() {
        return this._formatTime(this._timerSec - this._diffSec)
    }


    _addTimer() {
        this._timer = new PanelMenu.Button(0.0, Me.metadata.name, false);
        this._timerLabel = new St.Label({text: this._getTimeLeft(), y_expand: true, y_align: Clutter.ActorAlign.CENTER });
        this._timer.add_child(this._timerLabel);
        Main.panel.addToStatusArea(Me.metadata.name, this._timer);
    }


    _removeTimer() {
        this._timer.destroy();
        this._timer = null;
    }


    _startTimer() {
        this._timerSec = this._settings.get_int('interval-min') * 60;
        this._startSec = Math.floor(new Date().getTime() / 1000);
        this._lastSec = this._startSec;
        this._diffSec = this._lastSec - this._startSec;

        if (this._settings.get_boolean('show-timer')) {
            this._addTimer();
        }

        this._notifyLoop = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._updateTimer();
            return GLib.SOURCE_CONTINUE;
        });
    }


    _updateTimer() {
        this._lastSec = Math.floor(new Date().getTime() / 1000);
        this._diffSec = this._lastSec - this._startSec;

        if (this._settings.get_boolean('show-timer')) {
            this._timerLabel.set_text(this._getTimeLeft());
        }

        if (this._diffSec >= this._timerSec) {
            this._notify();
            this._startSec = Math.floor(new Date().getTime() / 1000);
            this._lastSec = this._startSec;
        }
    }


    _stopTimer() {
        GLib.Source.remove(this._notifyLoop);
        this._notifyLoop = null;
        if (this._timer) {
            this._removeTimer();
        }
        this._timerSec = null;
        this._startSec = null;
        this._lastSec = null;
        this._diffSec = null;
    }


    enable() {
        this._settings = ExtensionUtils.getSettings();
        this._indicator = new FeatureIndicator(this._settings);

        this._timerEnabledId = this._settings.connect('changed::timer-enabled', function (_, key) {
            if (this._settings.get_boolean(key)) {
                this._startTimer();
            } else {
                this._stopTimer();
            }
        }.bind(this));

        this._showTimerId = this._settings.connect('changed::show-timer', function (_, key) {
            if (this._settings.get_boolean('timer-enabled')) {
                if (this._settings.get_boolean(key)) {
                    this._addTimer();
                } else {
                    this._removeTimer();
                }
            }
        }.bind(this));

        // https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2621
        this._closingId = global.display.connect('closing', () => {
            this.disable();
        })
    }


    disable() {
        if (this._notifyLoop) {
            this._stopTimer()
        }

        this._settings.set_boolean('timer-enabled', false);
        this._settings.disconnect(this._showTimerId);
        this._settings.disconnect(this._timerEnabledId);
        this._settings = null;
        this._showTimerId = null;
        this._timerEnabledId = null;
        global.display.disconnect(this._closingId);
        this._closingId = null;
        this._indicator.destroy();
        this._indicator = null;
    }
}


function init() {
    return new Extension();
}
