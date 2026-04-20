loadAPI(18);

host.defineController(
    "Custom",
    "BitwigPlaybackUtility",
    "1.0",
    "d4f8a1b2-c3e5-4907-b6d8-e9f0a1b2c3d4",
    "Custom"
);

var transport;
var masterTrack;
var targetVolume = 0.795; // ~0 dB in Bitwig's normalized scale
var isCounting = false;
var isFading = false;
var currentPosition = 0.0;
var startBeatPosition = 0.0;
var waitingForFirstPosition = false;
var isInitialized = false;

var COUNT_BEATS = 8.0;

function init() {
    transport = host.createTransport();
    masterTrack = host.createMasterTrack(0);

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
        if (!isInitialized) return;
        if (isPlaying) {
            startCountIn();
        } else {
            onTransportStopped();
        }
    });

    // Enable metronome after init so beat 1 is ready when the user first presses play
    host.scheduleTask(function() {
        isInitialized = true;
        transport.isMetronomeEnabled().set(true);
    }, null, 300);

    host.println("BitwigPlaybackUtility initialized");
}

function startCountIn() {
    isFading = true;
    isCounting = false;
    waitingForFirstPosition = true; // startBeatPosition will be set on next position tick

    // Metronome is already ON (enabled at init and on every stop),
    // so beat 1 fires correctly without any latency from this script.
    masterTrack.volume().set(0.0);
}

function onTransportStopped() {
    if (isCounting || isFading) {
        // Aborted mid count-in: restore master immediately
        isCounting = false;
        isFading = false;
        waitingForFirstPosition = false;
        masterTrack.volume().set(targetVolume);
    }
    // Pre-enable metronome so it's ready (and beat 1 sounds) on next play
    transport.isMetronomeEnabled().set(true);
}

// Called every engine cycle while counting; position is in quarter-note beats
function updateFade(position) {
    var elapsed = position - startBeatPosition;

    if (elapsed >= COUNT_BEATS) {
        transport.isMetronomeEnabled().set(false);
        masterTrack.volume().set(targetVolume);
        isCounting = false;
        isFading = false;
        host.println("8-count complete at beat " + position.toFixed(3));
        return;
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
    // Leave metronome state to onTransportStopped / exit
}

function flush() {}

function exit() {
    cancelFade();
    transport.isMetronomeEnabled().set(false);
    host.println("BitwigPlaybackUtility exited");
}
