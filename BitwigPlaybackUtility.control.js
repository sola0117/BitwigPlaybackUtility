loadAPI(18);

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

var COUNT_BEATS = 8.0;

function init() {
    transport = host.createTransport();
    masterTrack = host.createMasterTrack(0);

    var state = host.getDocumentState();
    var countInSetting = state.getBooleanSetting("Count-in (8 beats)", "Playback", true);
    countInSetting.addValueObserver(function(value) {
        countInEnabled = value;
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

        // Capture the exact beat position on the first tick after play starts
        if (waitingForFirstPosition) {
            waitingForFirstPosition = false;
            startBeatPosition = position;
            isCounting = true;
            host.println("Count-in: start=" + startBeatPosition.toFixed(3) + " end=" + (startBeatPosition + COUNT_BEATS).toFixed(3));
        }

        if (isCounting) {
            updateFade(position);
        }
    });

    transport.isPlaying().addValueObserver(function(isPlaying) {
        if (!isPlaying) {
            // Always keep metronome ON while stopped — fires immediately on init too
            transport.isMetronomeEnabled().set(true);
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

        // isPlaying = true
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

    // Metronome is guaranteed ON (set whenever transport is stopped),
    // so beat 1 fires without any script latency.
    masterTrack.volume().set(0.0);
}

// Called every engine cycle while counting; position is in quarter-note beats
function updateFade(position) {
    var elapsed = position - startBeatPosition;

    if (elapsed >= COUNT_BEATS) {
        masterTrack.volume().set(targetVolume);
        isCounting = false;
        isFading = false;
        host.println("8-count complete at beat " + position.toFixed(3));
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
