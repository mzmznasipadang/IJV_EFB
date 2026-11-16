<?php
// IJVOPS station poller: answers pilot requests and logs downlinks (OOOI, progress) per callsign.
// One process only: a poll consumes the station's messages, so a second poller would steal them.
require '/var/www/html/ops/hoppie.php';

function weather_text(string $icao): string {
    $get = fn($type) => trim((string)@file_get_contents("https://aviationweather.gov/api/data/$type?ids=$icao&format=raw",
        false, stream_context_create(['http' => ['timeout' => 15, 'user_agent' => 'WebEFBFlightDeck/2.0']])));
    $text = trim($get('metar') . ' ' . $get('taf'));
    return $text !== '' ? $text : "NO WX AVBL FOR $icao";
}

function handle(array $msg): void {
    acars_log($msg['from'], 'down', $msg['type'], $msg['text']);
    if ($msg['type'] !== 'telex') return;
    $text = strtoupper($msg['text']);
    if (preg_match('/^(?:WX|METAR|TAF)\s+([A-Z0-9]{4}(?:\s+[A-Z0-9]{4}){0,2})\s*$/', $text, $m)) {
        $reply = implode(' ', array_map('weather_text', preg_split('/\s+/', $m[1])));
    } else {
        $reply = 'IJV OPS: MSG RCVD. SEND "WX WIII" FOR METAR/TAF (UP TO 3 STATIONS).';
    }
    $result = hoppie_send($msg['from'], substr($reply, 0, 1500));
    if ($result !== true) fwrite(STDERR, "reply to {$msg['from']} failed: $result\n");
}

if (!getenv('HOPPIE_LOGON')) {
    fwrite(STDERR, "HOPPIE_LOGON unset, poller idle\n");
    while (true) sleep(3600);
}
@mkdir(ACARS_LOG_DIR, 0755, true);
while (true) {
    $reply = hoppie_request('poll', 'SERVER');
    if (hoppie_ok($reply)) {
        foreach (hoppie_parse($reply) as $msg) handle($msg);
    } elseif ($reply !== false) {
        fwrite(STDERR, 'poll error: ' . trim(substr($reply, 0, 200)) . "\n");
    }
    sleep(random_int(45, 75)); // Hoppie asks for randomised 45-75 s polling
}
