loadAPI(19);

host.defineController(
    "Custom",
    "BitwigPlaybackUtility",
    "1.0",
    "d4f8a1b2-c3e5-4907-b6d8-e9f0a1b2c3d4",
    "Custom"
);

host.defineMidiPorts(0, 0);

var transport;
var masterTrack;
var targetVolume = 0.795; // ~0 dB in Bitwig's normalized scale
var isCounting = false;
var isFading = false;
var currentPosition = 0.0;
var startBeatPosition = 0.0;
var waitingForFirstPosition = false;
var initStateSeen = false; // true after the first isPlaying observer fire
var countInEnabled = true;
var metronomeEnabled = false;
var isPlaying = false;
var PREF_COUNT_IN;
var PREF_COUNT_BEATS;
var countInConfirmed = false;
var countInTicks = 0;

var COUNT_BEATS = 8.0;

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

    PREF_COUNT_BEATS = state.getNumberSetting("Count-in Beats", "Playback", 4, 32, 4, "beats", 8);
    PREF_COUNT_BEATS.markInterested();
    PREF_COUNT_BEATS.addRawValueObserver(function(value) {
        COUNT_BEATS = value;
    });

    transport.isMetronomeEnabled().markInterested();
    transport.isMetronomeEnabled().addValueObserver(function(en) {
        metronomeEnabled = en;
    });

    // Remember the user's master volume when not fading
    masterTrack.volume().addValueObserver(function(value) {
        if (!isFading) {
            targetVolume = value;
        }
    });

    // Driven by Bitwig's audio engine position — fires every engine cycle
    transport.playPosition().addValueObserver(function(position) {
        currentPosition = position;

        if (waitingForFirstPosition) {
            waitingForFirstPosition = false;
            var shiftedPos = position - COUNT_BEATS;
            if (shiftedPos >= 0) {
                transport.setPosition(shiftedPos);
                startBeatPosition = shiftedPos;
            } else {
                startBeatPosition = position;
            }
            isCounting = true;
            host.println("Count-in: start=" + startBeatPosition.toFixed(3) + " end=" + (startBeatPosition + COUNT_BEATS).toFixed(3));
            return;
        }

        if (isCounting) {
            updateFade(position);
        }
    });

    transport.isPlaying().addValueObserver(function(playing) {
        isPlaying = playing;
        if (!playing) {
            if (countInEnabled) {
                transport.isMetronomeEnabled().set(true);
            }
            if (initStateSeen && (isCounting || isFading)) {
                // Aborted mid count-in: restore master immediately
                isCounting = false;
                isFading = false;
                waitingForFirstPosition = false;
                masterTrack.volume().set(targetVolume);
            }
            initStateSeen = true;
            return;
        }

        // playing = true
        if (!initStateSeen) {
            // Transport was already playing when script loaded — skip count-in
            initStateSeen = true;
            return;
        }
        if (countInEnabled) {
            startCountIn();
        }
    });

    host.println("BitwigPlaybackUtility initialized");
}

function startCountIn() {
    isFading = true;
    isCounting = false;
    waitingForFirstPosition = true;
    countInConfirmed = false;
    countInTicks = 0;
    masterTrack.volume().set(0.0);
}

// Called every engine cycle while counting; position is in quarter-note beats
function updateFade(position) {
    var elapsed = position - startBeatPosition;
    if (elapsed < 0) return;
    countInTicks++;
    if (elapsed < COUNT_BEATS * 0.5) countInConfirmed = true;
    if (!countInConfirmed) {
        // setPosition が効かない場合: 20ティック後に現在位置からフォールバック
        if (countInTicks > 20) {
            startBeatPosition = position;
            countInConfirmed = true;
            countInTicks = 0;
        }
        return;
    }

    if (elapsed >= COUNT_BEATS) {
        masterTrack.volume().set(targetVolume);
        isCounting = false;
        isFading = false;
        host.println(COUNT_BEATS + "-count complete at beat " + position.toFixed(3));
        return;
    }

    // Disable metronome halfway through beat 8 so beat 9 never fires
    if (elapsed >= COUNT_BEATS - 0.5) {
        transport.isMetronomeEnabled().set(false);
    }

    if (elapsed > 0) {
        var progress = elapsed / COUNT_BEATS;
        masterTrack.volume().set(targetVolume * Math.sqrt(progress));
    }
}

function cancelFade() {
    isCounting = false;
    isFading = false;
    waitingForFirstPosition = false;
    masterTrack.volume().set(targetVolume);
}

function flush() {}

function exit() {
    cancelFade();
    transport.isMetronomeEnabled().set(false);
    host.println("BitwigPlaybackUtility exited");
}
