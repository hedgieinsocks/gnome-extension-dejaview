import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import GLib from "gi://GLib";
import St from "gi://St";

const ICON = "alarm-symbolic";
const TEXT = "It is time to stretch your back!";

const urgencyMapping = {
  0: MessageTray.Urgency.LOW,
  1: MessageTray.Urgency.NORMAL,
  2: MessageTray.Urgency.CRITICAL,
};

const DejaviewIndicator = GObject.registerClass(
  class DejaviewIndicator extends QuickSettings.SystemIndicator {
    _init(extensionObject) {
      super._init();

      this._indicator = this._addIndicator();
      this._indicator.icon_name = ICON;

      this._settings = extensionObject.getSettings();
      this._settings.bind(
        "timer-enabled",
        this._indicator,
        "visible",
        Gio.SettingsBindFlags.DEFAULT,
      );
    }
  },
);

const DejaviewMenuToggle = GObject.registerClass(
  class DejaviewMenuToggle extends QuickSettings.QuickMenuToggle {
    _init(extensionObject) {
      super._init({
        title: extensionObject.metadata.name,
        gicon: Gio.Icon.new_for_string(ICON),
        toggleMode: true,
      });

      this._settings = extensionObject.getSettings();
      this._settings.bind(
        "timer-enabled",
        this,
        "checked",
        Gio.SettingsBindFlags.DEFAULT,
      );

      this.menu.setHeader(ICON, extensionObject.metadata.name);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this.menu.addAction(
        "Settings",
        () => extensionObject.openPreferences(),
        "preferences-system-symbolic",
      );
    }
  },
);

export default class DejaviewExtension extends Extension {
  constructor(metadata) {
    super(metadata);
    this._indicator = null;
    this._timer = null;
    this._timerLabel = null;
    this._notifyLoop = null;
    this._timerSec = null;
    this._startSec = null;
    this._lastSec = null;
    this._diffSec = null;
    this._settings = null;
    this._source = null;
    this._showTimerId = null;
    this._closingId = null;
    this._timerEnabledId = null;
  }

  _notify() {
    const messageText = this._settings.get_string("message-text") || TEXT;
    const iconName = this._settings.get_string("icon-name") || ICON;
    const urgencyLevel = this._settings.get_int("urgency-level");
    const mappedUrgency = urgencyMapping[urgencyLevel];

    const notification = new MessageTray.Notification({
      source: this._source,
      iconName: iconName,
      title: this.metadata.name,
      body: messageText,
      urgency: mappedUrgency,
    });

    this._source.addNotification(notification);
  }

  _formatTime(totalSeconds) {
    const totalMinutes = Math.floor(totalSeconds / 60);
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
    return this._formatTime(this._timerSec - this._diffSec);
  }

  _addTimer() {
    this._timer = new PanelMenu.Button(0.0, this.metadata.name, false);
    this._timerLabel = new St.Label({
      text: this._getTimeLeft(),
      y_expand: true,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._timer.add_child(this._timerLabel);
    Main.panel.addToStatusArea(this.metadata.name, this._timer);
  }

  _removeTimer() {
    this._timer.destroy();
    this._timer = null;
  }

  _startTimer() {
    this._timerSec = this._settings.get_int("interval-min") * 60;
    this._startSec = Math.floor(new Date().getTime() / 1000);
    this._lastSec = this._startSec;
    this._diffSec = this._lastSec - this._startSec;

    if (this._settings.get_boolean("show-timer")) {
      this._addTimer();
    }

    this._notifyLoop = GLib.timeout_add_seconds(
      GLib.PRIORITY_DEFAULT,
      1,
      () => {
        this._updateTimer();
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  _updateTimer() {
    this._lastSec = Math.floor(new Date().getTime() / 1000);
    this._diffSec = this._lastSec - this._startSec;

    if (this._settings.get_boolean("show-timer")) {
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
    this._source = MessageTray.getSystemSource();
    this._settings = this.getSettings();
    // https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2621
    this._settings.set_boolean("timer-enabled", false);
    this._indicator = new DejaviewIndicator(this);
    this._indicator.quickSettingsItems.push(new DejaviewMenuToggle(this));

    Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);

    const autoStart = this._settings.get_boolean("auto-start");
    if (autoStart) {
      this._settings.set_boolean("timer-enabled", true);
      this._startTimer();
    }

    this._timerEnabledId = this._settings.connect(
      "changed::timer-enabled",
      function (_, key) {
        if (this._settings.get_boolean(key)) {
          this._startTimer();
        } else {
          this._stopTimer();
        }
      }.bind(this),
    );

    this._showTimerId = this._settings.connect(
      "changed::show-timer",
      function (_, key) {
        if (this._settings.get_boolean("timer-enabled")) {
          if (this._settings.get_boolean(key)) {
            this._addTimer();
          } else {
            this._removeTimer();
          }
        }
      }.bind(this),
    );

    // https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/2621
    this._closingId = global.display.connect("closing", () => {
      this.disable();
    });
  }

  disable() {
    if (this._notifyLoop) {
      this._stopTimer();
    }
    this._settings.set_boolean("timer-enabled", false);
    this._settings.disconnect(this._showTimerId);
    this._settings.disconnect(this._timerEnabledId);
    this._settings = null;
    this._showTimerId = null;
    this._timerEnabledId = null;
    global.display.disconnect(this._closingId);
    this._closingId = null;
    this._indicator.quickSettingsItems.forEach((item) => item.destroy());
    this._indicator.destroy();
    this._indicator = null;
    this._source = null;
  }
}
