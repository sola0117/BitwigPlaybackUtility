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
var currentBpm = 120.0;
var targetVolume = 0.795; // ~0 dB in Bitwig's normalized scale
var isFading = false;
var taskCounter = 0;
var isInitialized = false;

function init() {
    transport = host.createTransport();
    masterTrack = host.createMasterTrack(0);

    // Track live BPM (raw value = actual BPM)
    transport.tempo().addRawValueObserver(function(bpm) {
        currentBpm = bpm;
    });

    // Remember the user's intended master volume when not fading
    masterTrack.volume().addValueObserver(function(value) {
        if (!isFading) {
            targetVolume = value;
        }
    });

    // React to transport play/stop
    transport.isPlaying().addValueObserver(function(isPlaying) {
        if (!isInitialized) return;
        if (isPlaying) {
            startCountIn();
        } else {
            cancelFade();
        }
    });

    // Ignore any initial observer fires during script load
    host.scheduleTask(function() {
        isInitialized = true;
    }, null, 300);

    host.println("BitwigPlaybackUtility initialized");
}

function startCountIn() {
    // Each call gets a unique ID; scheduled callbacks check this to detect cancellation
    taskCounter++;
    var myTaskId = taskCounter;

    isFading = true;

    transport.isMetronomeEnabled().set(true);
    masterTrack.volume().set(0.0);

    var beatMs = 60000.0 / currentBpm;
    var totalMs = 8 * beatMs;
    var STEPS = 40;
    var vol = targetVolume;

    host.println("8-count intro started at " + Math.round(currentBpm) + " BPM (" + Math.round(totalMs) + " ms)");

    // Smooth fade-in across 8 beats using a square-root curve
    for (var i = 1; i <= STEPS; i++) {
        (function(step) {
            var delay = Math.round(totalMs * step / STEPS);
            host.scheduleTask(function() {
                if (!isFading || taskCounter !== myTaskId) return;
                var t = step / STEPS;
                masterTrack.volume().set(vol * Math.sqrt(t));
            }, null, delay);
        })(i);
    }

    // Exactly at beat 8: metronome off, master fully restored
    host.scheduleTask(function() {
        if (taskCounter !== myTaskId) return;
        transport.isMetronomeEnabled().set(false);
        masterTrack.volume().set(vol);
        isFading = false;
        host.println("8-count complete: metronome off, master restored");
    }, null, Math.round(totalMs) + 5);
}

function cancelFade() {
    taskCounter++; // Invalidates any in-flight scheduled tasks
    isFading = false;
    masterTrack.volume().set(targetVolume);
    transport.isMetronomeEnabled().set(false);
}

function flush() {}

function exit() {
    cancelFade();
    host.println("BitwigPlaybackUtility exited");
}
