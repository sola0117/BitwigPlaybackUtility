loadAPI(19);

host.defineController(
    "Custom",
    "BitwigPlaybackUtility",
    "1.0",
    "d4f8a1b2-c3e5-4907-b6d8-e9f0a1b2c3d4",
    "Custom"
);

host.defineMidiPorts(0, 0);

// API objects
var transport;
var masterTrack;

// Document state settings
var PREF_COUNT_IN;
var PREF_COUNT_BEATS;
var PREF_COUNT_IN_VOLUME;

// Playback preferences (mirrored from document state)
var countInEnabled = true;
var countBeats = 8;

// Transport state
var isPlaying = false;
var isPlayingReady = false; // skips initial observer fire
var tempo = 120.0;          // current BPM; used to convert 300ms to beats

// Volume state
var targetVolume = 0.795;    // ~0 dB in Bitwig's normalized scale; tracks user's master volume
var countInVolume = Math.pow(10, -24 / 60) * 0.795; // volume during count-in; default -24 dB
var pendingVolume = null;    // volume to apply on next flush(); null = no pending change

// Metronome state
var metronomeEnabled = false;

// Count-in state machine
var COUNT_IN = { IDLE: 0, WAITING: 1, COUNTING: 2 };
var countInState = COUNT_IN.IDLE;
var startBeatPosition = 0.0;

// Position tracking for count-in pre-roll offset
var lastShiftedTarget = -1;
var intendedStartPosition = -1;
var isRestoringPosition = false;

function init() {
    transport = host.createTransport();
    masterTrack = host.createMasterTrack(0);

    var state = host.getDocumentState();

    PREF_COUNT_IN = state.getEnumSetting("Count-in", "Playback", ["ON", "OFF"], "OFF");
    PREF_COUNT_IN.markInterested();
    PREF_COUNT_IN.addValueObserver(function(value) {
        countInEnabled = (value === "ON");
        if (countInEnabled && !metronomeEnabled && !isPlaying) {
            transport.isMetronomeEnabled().set(true);
        } else if (!countInEnabled && metronomeEnabled) {
            transport.isMetronomeEnabled().set(false);
        }
    });

    PREF_COUNT_BEATS = state.getEnumSetting("Count-in Beats", "Playback", ["4", "8", "16", "32"], "8");
    PREF_COUNT_BEATS.markInterested();
    PREF_COUNT_BEATS.addValueObserver(function(value) {
        countBeats = parseInt(value, 10);
    });

    PREF_COUNT_IN_VOLUME = state.getEnumSetting("Count-in Volume", "Playback", ["0dB", "-18dB", "-24dB", "-32dB", "-∞dB"], "-24dB");
    PREF_COUNT_IN_VOLUME.markInterested();
    PREF_COUNT_IN_VOLUME.addValueObserver(function(value) {
        // Bitwig volume uses a cube-root response: normalized = 10^(dB/60) * 0.795
        countInVolume = (value === "-∞dB") ? 0.0 : Math.pow(10, parseInt(value, 10) / 60) * 0.795;
    });

    transport.tempo().markInterested();
    transport.tempo().addRawValueObserver(function(bpm) {
        tempo = bpm;
    });

    transport.isMetronomeEnabled().markInterested();
    transport.isMetronomeEnabled().addValueObserver(function(en) {
        var wasEnabled = metronomeEnabled;
        metronomeEnabled = en;
        // Only turn count-in off when the user explicitly disables the metronome (not on initial fire)
        if (!en && wasEnabled && !isPlaying && countInEnabled) {
            PREF_COUNT_IN.set("OFF");
        }
    });

    masterTrack.volume().markInterested();
    masterTrack.volume().addValueObserver(function(value) {
        if (countInState === COUNT_IN.IDLE) {
            targetVolume = value;
        }
    });

    // Fires every audio engine cycle
    transport.playPosition().addValueObserver(function(position) {
        if (!isPlaying && countInEnabled && countInState === COUNT_IN.IDLE) {
            handleStoppedPosition(position);
            return;
        }

        if (countInState === COUNT_IN.WAITING) {
            startBeatPosition = position;
            countInState = COUNT_IN.COUNTING;
            return;
        }

        if (countInState === COUNT_IN.COUNTING) {
            updateFade(position);
        }
    });

    transport.isPlaying().markInterested();
    transport.isPlaying().addValueObserver(function(playing) {
        isPlaying = playing;

        if (!isPlayingReady) {
            isPlayingReady = true;
            return;
        }

        if (!playing) {
            handleStop();
            return;
        }

        if (countInEnabled) {
            startCountIn();
        }
    });

    host.println("BitwigPlaybackUtility initialized");
}

function handleStoppedPosition(position) {
    if (isRestoringPosition) {
        if (Math.abs(position - intendedStartPosition) <= 0.1) {
            isRestoringPosition = false;
        }
        return;
    }
    var shiftedPos = position - countBeats;
    if (shiftedPos >= 0 && Math.abs(position - lastShiftedTarget) > 0.1) {
        intendedStartPosition = shiftedPos;
        lastShiftedTarget = shiftedPos;
        transport.setPosition(shiftedPos);
    }
}

function handleStop() {
    if (countInEnabled) {
        transport.isMetronomeEnabled().set(true);
    }
    if (countInState !== COUNT_IN.IDLE) {
        countInState = COUNT_IN.IDLE;
        pendingVolume = targetVolume;
    }
    if (countInEnabled && intendedStartPosition >= 0) {
        isRestoringPosition = true;
        lastShiftedTarget = intendedStartPosition;
        transport.setPosition(intendedStartPosition);
    }
}

function startCountIn() {
    countInState = COUNT_IN.WAITING;
    pendingVolume = countInVolume;
}

// Called every engine cycle while counting; position is in quarter-note beats
function updateFade(position) {
    var elapsed = position - startBeatPosition;

    if (elapsed >= countBeats) {
        pendingVolume = targetVolume;
        countInState = COUNT_IN.IDLE;
        return;
    }

    // Disable metronome just before the last beat so it never fires after count-in ends
    if (elapsed >= countBeats - 0.5) {
        transport.isMetronomeEnabled().set(false);
    }

    // Fade from countInVolume to targetVolume over the 150ms before count-in ends
    var fadeBeats = (0.15 * tempo) / 60.0;
    if (elapsed >= countBeats - fadeBeats) {
        var progress = Math.sqrt((elapsed - (countBeats - fadeBeats)) / fadeBeats);
        pendingVolume = countInVolume + (targetVolume - countInVolume) * progress;
    }
}

// flush() is called once per UI frame — apply pending volume here to avoid
// Bitwig batching multiple setImmediately() calls from playPosition and discarding all but the last
function flush() {
    if (pendingVolume !== null) {
        masterTrack.volume().setImmediately(pendingVolume);
        pendingVolume = null;
    }
}

function exit() {
    countInState = COUNT_IN.IDLE;
    masterTrack.volume().setImmediately(targetVolume);
    transport.isMetronomeEnabled().set(false);
    host.println("BitwigPlaybackUtility exited");
}
