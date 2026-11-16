<?php
// Shared Hoppie ACARS client for the EFB endpoints and the IJVOPS poller (docker/hoppie_poll.php)
const ACARS_LOG_DIR = '/var/lib/ijv-acars';

function hoppie_station(): string {
    return getenv('HOPPIE_STATION') ?: 'IJVOPS';
}

// Returns Hoppie's reply body, or false on network failure. Hoppie answers HTTP 200 for errors too.
function hoppie_request(string $type, string $to, string $packet = ''): string|false {
    $logon = getenv('HOPPIE_LOGON') ?: '';
    if ($logon === '') return false;
    return @file_get_contents('https://www.hoppie.nl/acars/system/connect.html', false, stream_context_create(['http' => [
        'method' => 'POST',
        'timeout' => 15,
        'header' => "Content-Type: application/x-www-form-urlencoded\r\nUser-Agent: WebEFBFlightDeck/2.0\r\n",
        'content' => http_build_query(['logon' => $logon, 'from' => hoppie_station(), 'to' => $to, 'type' => $type, 'packet' => $packet]),
    ]]));
}

function hoppie_ok(string|false $reply): bool {
    return $reply !== false && str_starts_with(strtolower(trim($reply)), 'ok');
}

// Messages in a poll reply look like: ok {IJV123 telex {WX WIII}} {IJV123 progress {WIII/WSSS OUT/0512}}
function hoppie_parse(string $reply): array {
    preg_match_all('/\{(\S+) (\S+) \{([^}]*)\}\}/', $reply, $matches, PREG_SET_ORDER);
    return array_map(fn($m) => ['from' => strtoupper($m[1]), 'type' => strtolower($m[2]), 'text' => trim($m[3])], $matches);
}

function acars_log_file(string $callsign): ?string {
    return preg_match('/^[A-Z0-9]{3,8}$/D', $callsign) ? ACARS_LOG_DIR . "/$callsign.json" : null;
}

// Keeps the newest 50 entries per callsign: {time, dir: up|down, type, text}
function acars_log(string $callsign, string $dir, string $type, string $text): void {
    $file = acars_log_file($callsign);
    if (!$file || !is_dir(ACARS_LOG_DIR)) return;
    $handle = fopen($file, 'c+');
    if (!$handle) return;
    flock($handle, LOCK_EX);
    $entries = json_decode(stream_get_contents($handle) ?: '[]', true) ?: [];
    $entries[] = ['time' => time(), 'dir' => $dir, 'type' => $type, 'text' => $text];
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode(array_slice($entries, -50)));
    flock($handle, LOCK_UN);
    fclose($handle);
}

function hoppie_send(string $to, string $text): string|true {
    $reply = hoppie_request('telex', $to, $text);
    if (!hoppie_ok($reply)) return $reply === false ? 'Hoppie ACARS did not respond.' : trim(substr($reply, 0, 200));
    acars_log($to, 'up', 'telex', $text);
    return true;
}
