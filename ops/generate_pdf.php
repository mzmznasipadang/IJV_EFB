<?php
session_start();
if (($_SESSION['authenticated'] ?? false) !== true) {
    http_response_code(401);
    exit('Sign in to the EFB before generating a PDF.');
}
session_write_close();

// 1. Configure production-ready error management and reporting limits
ini_set('display_errors', 0);
ini_set('display_startup_errors', 0);
error_reporting(E_ALL);

// 2. Import Dompdf Framework Modules
require_once __DIR__ . '/dompdf/autoload.inc.php';
use Dompdf\Dompdf;
use Dompdf\Options;

// 3. Receive raw stream payloads sent natively via JS fetch application/json 
$rawInput = file_get_contents('php://input');
$rawData = json_decode($rawInput, true);

// Fallback: Handle backward-compatible standard multi-part form payloads
if (!$rawData && isset($_POST['json_payload'])) {
    $rawData = json_decode($_POST['json_payload'], true);
}

// Exit immediately if payload execution criteria are missing
if (!is_array($rawData) || !is_array($rawData['general'] ?? null)) {
    header('HTTP/1.1 400 Bad Request');
    die("Error: Payload mapping failed. Ensure dispatch is downlinked first.");
}

// Weight unit label from the dispatch itself (SimBrief params.units is "kgs" or "lbs")
$u = str_starts_with(strtoupper((string)($rawData['params']['units'] ?? '')), 'LB') ? 'LBS' : 'KGS';

// Preferred: the IJV WeasyPrint renderer (private ofp-renderer service). Any failure falls through to Dompdf below.
$renderUrl = getenv('OFP_RENDER_URL');
$renderToken = getenv('OFP_RENDER_TOKEN');
$payload = json_encode($rawData);
if ($renderUrl && $renderToken && $payload !== false && strlen($payload) <= 5 * 1024 * 1024) {
    $ch = curl_init($renderUrl);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $payload,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Render-Token: ' . $renderToken],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 3,
        CURLOPT_TIMEOUT => 30,
        CURLOPT_MAXFILESIZE => 50 * 1024 * 1024,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
    ]);
    $pdf = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($status === 200 && is_string($pdf) && str_starts_with($pdf, '%PDF')) {
        $g = $rawData['general'];
        $name = preg_replace('/[^A-Za-z0-9_.-]/', '', ($g['icao_airline'] ?? 'FLIGHT') . ($g['flight_number'] ?? 'PLAN')) . '_Briefing.pdf';
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="' . $name . '"');
        header('Content-Length: ' . strlen($pdf));
        echo $pdf;
        exit;
    }
    error_log('OFP renderer unavailable (HTTP ' . $status . ' ' . curl_error($ch) . '); using Dompdf fallback');
}

// 4. Custom Filter Helpers matching strict GIA805 structural expectations
function formatCruiseProfile($profile, $cost_index) {
    if (!$profile) return "";
    $p = strtoupper(str_replace(" ", "", $profile));
    if (strpos($p, 'M') === 0 || $p === 'LRC') return $profile;
    if (strpos($p, 'CI') === 0) {
        preg_match('/(\d+)/', $p, $matches);
        return $matches ? "CI" . str_pad((int)$matches[1], 3, '0', STR_PAD_LEFT) : "CI" . str_pad((int)$cost_index, 3, '0', STR_PAD_LEFT);
    }
    return $profile;
}

function php_date($fmt, $timestamp) {
    if (empty($timestamp) || (int)$timestamp === 0) {
        return "";
    }
    try {
        $dt = new DateTime("@" . (int)$timestamp);
        $dt->setTimezone(new DateTimeZone('UTC'));
        
        switch ($fmt) {
            case 'd': return $dt->format('d');
            case 'm': return $dt->format('m');
            case 'y': return $dt->format('y');
            case 'Hi': return $dt->format('Hi');
            case 'H:i': return $dt->format('H:i');
            case 'H.i': return $dt->format('H.i');
            case 'dMy': return strtoupper($dt->format('dMye')); 
            case 'Y-m-d': return $dt->format('Y-m-d');
            case 'd-m-y': return $dt->format('d-m-y');
            default: return $dt->format('Y-m-d');
        }
    } catch (Exception $e) {
        return "";
    }
}

function formatPerfPerfFactor($p) {
    $val = (float)$p - 1;
    return ($val >= 0 ? '+' : '-') . str_pad(number_format(abs($val * 100), 1), 6, '0', STR_PAD_LEFT);
}

function formatAirportElevation($v) {
    return str_pad((int)$v, 4, '0', STR_PAD_LEFT);
}

function formatAvgWindComp($v) {
    $int_v = (int)$v;
    return ($int_v < 0 ? 'M' : 'P') . str_pad(abs($int_v), 3, '0', STR_PAD_LEFT);
}

function getFormattedFir($s) {
    if (preg_match('/EET\/([A-Z0-9\s]+)/', (string)$s, $matches)) {
        return "EET/" . $matches[1];
    }
    return "";
}

function formatWindMatrixRow($f) {
    $target_levels = ['10000', '18000', '24000', '30000', '34000', '39000', '45000'];
    $ident = $f['ident'] ?? '';
    $row_str = str_pad($ident, 7, ' ', STR_PAD_RIGHT) . " ";
    
    $levels_data = [];
    if (isset($f['wind_data']['level'])) {
        $levels = $f['wind_data']['level'];
        if (isset($levels['altitude'])) { 
            $levels = [$levels];
        }
        foreach ($levels as $lvl) {
            $levels_data[(string)($lvl['altitude'] ?? '')] = $lvl;
        }
    }
    
    foreach ($target_levels as $altitude) {
        if (isset($levels_data[$altitude])) {
            $data = $levels_data[$altitude];
            $wdir = (int)$data['wind_dir'];
            $wspd = (int)$data['wind_spd'];
            $oat = (int)$data['oat'];
            $cell_str = str_pad($wdir, 3, '0', STR_PAD_LEFT) . str_pad($wspd, 3, '0', STR_PAD_LEFT) . ($oat < 0 ? 'M' : 'P') . str_pad(abs($oat), 2, '0', STR_PAD_LEFT);
            $row_str .= str_pad($cell_str, 10, ' ', STR_PAD_RIGHT);
        } else {
            $row_str .= "......... ";
        }
    }
    return $row_str;
}

function getWeatherPrognosisTimes($etd) {
    try {
        $date = new DateTime("@" . (int)$etd);
        $date->setTimezone(new DateTimeZone('UTC'));
        $hour = (int)$date->format('H');
        $next_hour = ceil($hour / 3) * 3;
        $weather_prog_times = [];
        
        for ($i = 0; $i < 5; $i++) {
            $days_to_add = 0;
            $calc_hour = $next_hour;
            while ($calc_hour >= 24) {
                $calc_hour -= 24;
                $days_to_add += 1;
            }
            $current_prog_date = clone $date;
            if ($days_to_add > 0) {
                $current_prog_date->modify("+" . $days_to_add . " days");
            }
            $formatted_time = $current_prog_date->format('d') . '00' . str_pad($calc_hour, 2, '0', STR_PAD_LEFT);
            $weather_prog_times['time'][] = $formatted_time;
            $next_hour += 3;
        }
        return implode(" ", $weather_prog_times['time'] ?? []) . 'UKM';
    } catch (Exception $e) {
        return "PROG TIMES N/A";
    }
}

function formatCoord($val, $is_lat) {
    $val = (float)$val;
    if ($is_lat) {
        $direction = $val >= 0 ? 'N' : 'S';
        $deg = (int)abs($val);
        $minutes = (abs($val) - $deg) * 60;
        return $direction . str_pad($deg, 2, '0', STR_PAD_LEFT) . str_pad(number_format($minutes, 1), 4, '0', STR_PAD_LEFT);
    } else {
        $direction = $val >= 0 ? 'E' : 'W';
        $deg = (int)abs($val);
        $minutes = (abs($val) - $deg) * 60;
        return $direction . str_pad($deg, 3, '0', STR_PAD_LEFT) . str_pad(number_format($minutes, 1), 4, '0', STR_PAD_LEFT);
    }
}

function formatLatLon($val1, $val2) {
    return formatCoord($val1, true) . " " . formatCoord($val2, false);
}

function formatLatLonEtops($val1, $val2) {
    return formatCoord($val1, true) . " " . formatCoord($val2, false);
}

function get_filtered_notams($notam_raw, $limit = 4) {
    $notam_list = [];
    if (isset($notam_raw[0])) { $notam_list = $notam_raw; }
    elseif (!empty($notam_raw)) { $notam_list = [$notam_raw]; }
    if (empty($notam_list)) return [];
    
    $urgent_keywords = ['CLSD', 'CLOSED', 'U/S', 'UNSERVICEABLE', 'DANGER', 'RESTRICTED', 'RWY', 'RUNWAY', 'ILS', 'GNSS', 'GPS'];
    $scored = [];
    $seen = [];
    foreach ($notam_list as $n) {
        $nid = $n['notam_id'] ?? '';
        if (in_array($nid, $seen)) continue;
        $txt = $n['notam_text'] ?? $n['notam_raw'] ?? '';
        $score = 0;
        foreach ($urgent_keywords as $kw) {
            if (strpos(strtoupper($txt), $kw) !== false) $score++;
        }
        if ($score == 0) $score = 0.1;
        $seen[] = $nid;
        $scored[] = ['id' => $nid, 'text' => $txt, 'score' => $score];
    }
    usort($scored, function($a, $b) { return $b['score'] <=> $a['score']; });
    return array_slice($scored, 0, $limit);
}

// 5. Structure and assemble loop arrays safely
$alternates_list = [];
if (isset($rawData['alternate'])) {
    $alternates_list = isset($rawData['alternate']['icao_code']) ? [$rawData['alternate']] : $rawData['alternate'];
}

$navlog_alt1 = null;
if (isset($rawData['alternate_navlog'])) {
    if (isset($rawData['alternate_navlog'][0])) {
        $navlog_alt1 = $rawData['alternate_navlog'][0];
    } elseif (is_array($rawData['alternate_navlog'])) {
        $navlog_alt1 = $rawData['alternate_navlog'];
    }
}

$map_images = [];
if (isset($rawData['images']['map'])) {
    $base_url = $rawData['images']['directory'] ?? '';
    $maps_raw = $rawData['images']['map'];
    if (isset($maps_raw['name'])) {
        $maps_raw = [$maps_raw];
    }
    foreach ($maps_raw as $m) {
        $map_images[] = ['name' => $m['name'], 'url' => $base_url . $m['link']];
    }
}

$airport_info = [];
$weather_info = [];

// Base departure layout node
if (isset($rawData['origin'])) {
    $t_val = php_date('Hi', $rawData['times']['sched_out'] ?? 0);
    $t_val = (!empty($t_val) ? $t_val . "Z" : "....");
    $airport_info[] = [
        'icao' => $rawData['origin']['icao_code'] ?? '', 'iata' => $rawData['origin']['iata_code'] ?? '',
        'label' => 'STD', 'time' => $t_val, 'notams' => get_filtered_notams($rawData['origin']['notam'] ?? []),
        'taf' => $rawData['origin']['taf'] ?? 'N/A'
    ];
    $weather_info[] = [
        'title' => "DEPARTURE AIRPORT : " . ($rawData['origin']['icao_code'] ?? ''),
        'data' => ($rawData['origin']['taf'] ?? '') . "\n" . ($rawData['origin']['metar'] ?? '')
    ];
}

// Base arrival layout node
if (isset($rawData['destination'])) {
    $t_val = php_date('Hi', $rawData['times']['est_in'] ?? 0);
    $t_val = (!empty($t_val) ? $t_val . "Z" : "....");
    $airport_info[] = [
        'icao' => $rawData['destination']['icao_code'] ?? '', 'iata' => $rawData['destination']['iata_code'] ?? '',
        'label' => 'ETA', 'time' => $t_val, 'notams' => get_filtered_notams($rawData['destination']['notam'] ?? []),
        'taf' => $rawData['destination']['taf'] ?? 'N/A'
    ];
    $weather_info[] = [
        'title' => "DESTINATION AIRPORT : " . ($rawData['destination']['icao_code'] ?? ''),
        'data' => ($rawData['destination']['taf'] ?? '') . "\n" . ($rawData['destination']['metar'] ?? '')
    ];
}

// Alternate structural tracking node
foreach ($alternates_list as $alt) {
    $t_val = "....";
    if (isset($rawData['times']['est_in']) && isset($alt['ete'])) {
        $t_val = php_date('Hi', (int)$rawData['times']['est_in'] + (int)$alt['ete']);
        if (!empty($t_val)) $t_val .= "Z";
    }
    $airport_info[] = [
        'icao' => $alt['icao_code'] ?? '', 'iata' => $alt['iata_code'] ?? '',
        'label' => 'ETA (ALTN)', 'time' => $t_val, 'notams' => get_filtered_notams($alt['notam'] ?? []),
        'taf' => $alt['taf'] ?? 'N/A'
    ];
    $weather_info[] = [
        'title' => "DESTINATION ALTERNATE AIRPORT : " . ($alt['icao_code'] ?? ''),
        'data' => ($alt['taf'] ?? '') . "\n" . ($alt['metar'] ?? '')
    ];
}

// ETOPS alternate validation mapping
$etops_apts_list = [];
if (isset($rawData['etops']['suitable_airport'])) {
    $etops_apts = $rawData['etops']['suitable_airport'];
    if (isset($etops_apts['icao_code'])) { $etops_apts = [$etops_apts]; }
    foreach ($etops_apts as $apt) {
        $etops_apts_list[] = $apt['icao_code'];
        $airport_info[] = [
            'icao' => $apt['icao_code'], 'iata' => $apt['iata_code'] ?? '',
            'label' => 'VALIDITY', 'time' => 'REFER ETOPS', 'notams' => [], 'taf' => 'Refer to Wx Pkg'
        ];
        $wx_data = ($apt['taf'] ?? '') . "\n" . ($apt['metar'] ?? '');
        if (!trim($wx_data)) $wx_data = "WEATHER DATA NOT AVAILABLE IN JSON";
        $weather_info[] = [
            'title' => "ENROUTE ALTERNATE AIRPORT : " . $apt['icao_code'], 'data' => $wx_data
        ];
    }
}

// Consolidated Notam parsing lists
$notam_groups = [];
$notam_groups[] = ['title' => "DEPARTURE AIRPORT : " . ($rawData['origin']['icao_code'] ?? ''), 'notams' => $rawData['origin']['notam'] ?? []];
$notam_groups[] = ['title' => "DESTINATION AIRPORT : " . ($rawData['destination']['icao_code'] ?? ''), 'notams' => $rawData['destination']['notam'] ?? []];
foreach ($alternates_list as $alt) {
    $notam_groups[] = ['title' => "ALTERNATE AIRPORT : " . ($alt['icao_code'] ?? ''), 'notams' => $alt['notam'] ?? []];
}

$global_notams = [];
if (isset($rawData['notams']['notamdrec'])) {
    $global_notams = isset($rawData['notams']['notamdrec']['icao_id']) ? [$rawData['notams']['notamdrec']] : $rawData['notams']['notamdrec'];
}

foreach ($etops_apts_list as $etops_icao) {
    $apt_notams = array_filter($global_notams, function($n) use ($etops_icao) { return ($n['icao_id'] ?? '') === $etops_icao; });
    if (!empty($apt_notams)) {
        $notam_groups[] = ['title' => "ETOPS ALTERNATE : " . $etops_icao, 'notams' => $apt_notams];
    }
}

$enroute_firs = $rawData['atc']['fir_enroute'] ?? [];
foreach ($enroute_firs as $fir) {
    $fir_n = array_filter($global_notams, function($n) use ($fir) { return ($n['icao_id'] ?? '') === $fir; });
    if (!empty($fir_n)) {
        $notam_groups[] = ['title' => "ENROUTE FIR : " . $fir, 'notams' => $fir_n];
    }
}

foreach ($notam_groups as &$group) {
    if (isset($group['notams']['notam_id'])) {
        $group['notams'] = [$group['notams']];
    }
}
unset($group);

$etops_alternates_str = "...";
if (isset($rawData['etops']['suitable_airport'])) {
    $airports = $rawData['etops']['suitable_airport'];
    if (isset($airports['icao_code'])) { $airports = [$airports]; }
    $codes = array_map(function($apt) { return $apt['icao_code'] ?? ''; }, $airports);
    $etops_alternates_str = implode(" ", $codes);
}

try {
    $req_id = $rawData['params']['request_id'] ?? '';
    $hash_int = $req_id ? hexdec(substr($req_id, 0, 8)) : 0;
    $fooId = 1000 + ($hash_int % 9000);
} catch (Exception $e) {
    $fooId = 1234;
}

// 6. BUILD DYNAMIC HEADER LOGIC MATCHING GIA805 PATTERNS EXACTLY
$airlineCallsign = ($rawData['atc']['callsign'] ?? ($rawData['general']['icao_airline'] ?? '') . ($rawData['general']['flight_number'] ?? ''));
if (empty($airlineCallsign)) { $airlineCallsign = "GIA" . ($rawData['general']['flight_number'] ?? '223'); }

// Handle strict timestamp formats without defaulting back to 1970 standard
$rawOutTime = (int)($rawData['times']['sched_out'] ?? time());
$briefingDateStr = date('d-m-y', $rawOutTime);
$briefingTimeStr = date('Hi', $rawOutTime);
$originIcaoCode = ($rawData['origin']['icao_code'] ?? 'XXXX');

// Target meta line tracker rule
$gia805MetaHeader = "BRIEFING TEXT " . strtoupper($airlineCallsign) . "-" . $briefingDateStr . "-" . $briefingTimeStr . "-" . strtoupper($originIcaoCode);

// 7. OPEN CAPTURE INTERCEPT BUFFER
ob_start();
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8"/>
    <title><?= htmlspecialchars($airlineCallsign) ?></title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        @page {
            margin: 1.10cm 1.20cm 1.10cm 1.20cm;
            size: A4 portrait;
            font-family: Courier, monospace;
            @top-left {
                content: "<?= $gia805MetaHeader ?> PAGE " counter(page) " OF " counter(pages);
                font-family: Courier, monospace;
                font-size: 10.5pt;
                font-weight: bold;
                padding-bottom: 25px;
            }
            @bottom-left {
                content: "PAGE " counter(page) " of " counter(pages);
                font-family: Courier, monospace;
                font-size: 10.5pt;
                font-weight: bold;
                padding-top: 15px;
            }
        }
        @page landscape-page {
            size: A4 landscape;
            margin: 0.8cm 1.0cm;
            @top-left {
                content: "PACKAGE GIA<?= ($rawData['general']['flight_number'] ?? '') ?>";
                font-family: Courier, monospace;
                font-size: 10pt;
                font-weight: bold;
            }
            @bottom-right {
                content: "PAGE " counter(page) " OF " counter(pages);
                font-family: Courier, monospace;
                font-size: 10pt;
                font-weight: bold;
            }
        }
        body {
            font-family: Courier, monospace;
            font-size: 11pt;
            line-height: 14pt;
            color: #000;
        }
        pre {
            white-space: pre-wrap;
            font-family: Courier, monospace;
            display: block;
            font-size: 11pt;
            line-height: 14pt;
        }
        .nw-container { width: 100%; margin-bottom: 15px; page-break-inside: avoid; font-family: Courier, monospace; }
        .nw-header {
            font-weight: bold;
            font-size: 11.5pt;
            margin-bottom: 4px;
            text-transform: uppercase;
            font-family: Courier, monospace;
        }
        .nw-content { font-size: 11pt; font-family: Courier, monospace; }
        .section-title {
            font-weight: bold;
            display: block;
            margin-top: 4px;
            margin-bottom: 2px;
            font-family: Courier, monospace;
        }
        .footer-box {
            border: 1px solid black;
            padding: 8px;
            text-align: center;
            margin-top: 25px;
            font-family: Courier, monospace;
            font-size: 9.5pt;
            line-height: 12pt;
            page-break-inside: avoid;
        }
        .landscape-section { page: landscape-page; font-family: Courier, monospace; font-size: 10.5pt; }
        .notam-header-landscape { text-align: center; font-weight: bold; font-size: 14pt; margin-bottom: 12px; width: 100%; }
        .notam-columns { column-count: 2; column-gap: 0.8cm; text-align: justify; }
        .notam-group { break-inside: auto; margin-bottom: 15px; display: block; }
        .notam-group-header { font-weight: bold; border-bottom: 1px dashed black; margin-bottom: 5px; margin-top: 10px; font-size: 11.5pt; padding: 2px; }
        .notam-item { margin-bottom: 12px; break-inside: avoid; }
        .wx-header { text-align: center; font-weight: bold; margin-bottom: 25px; font-size: 12pt; }
        .wx-section { margin-bottom: 25px; break-inside: avoid; }
        .wx-airport-title { font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 2px; margin-bottom: 8px; font-family: Courier, monospace; }
        .wx-data { font-family: Courier, monospace; font-size: 11pt; white-space: pre-wrap; line-height: 14pt; }
        .map-container { text-align: center; width: 100%; height: 100%; }
        .map-title { font-weight: bold; font-size: 13pt; margin-bottom: 10px; text-align: center; }
        .map-image { max-width: 100%; max-height: 16.5cm; object-fit: contain; border: 1px solid #000; }
        .nav-row { white-space: pre-wrap; page-break-inside: avoid; display: block; font-family: Courier, monospace; }
        .page-break { page-break-after: always; }
        .dashed-separator { border: 0; border-top: 1px dashed #000; margin: 12px 0; width: 100%; }
    </style>
</head>
<body>

    <div style="margin-bottom: 25px;">
        <span style="font-size: 12pt; font-weight: bold; display: block;">Garuda Indonesia</span>
        <span style="font-size: 11pt; display: block; margin-bottom: 15px;">FLIGHT DISPATCH CENTER</span>
        <span style="font-size: 11pt; font-weight: bold; display: block;">BRIEFING TEXT</span>
        <span style="font-size: 11pt; display: block; font-weight: bold; margin-top: 2px;">
            <?= strtoupper($airlineCallsign) ?> <?= ($rawData['origin']['icao_code'] ?? 'XXXX') ?>-<?= ($rawData['destination']['icao_code'] ?? 'XXXX') ?> <?= ($rawData['aircraft']['reg'] ?? 'XXXX') ?> <?= date('Y-m-d', $rawOutTime) ?>
        </span>
    </div>

    <pre>
1. CREW ALERT
   NIL

2. AIRCRAFT STATUS
   APU       : SERVICEABLE
   HIL       : NIL

3. NOTAM & WEATHER
    </pre>

    <?php foreach ($airport_info as $apt): ?>
    <div class="nw-container">
        <div class="nw-header">
            <?= $apt['icao'] ?>/<?= $apt['iata'] ?> &nbsp;&nbsp; <?= $apt['time'] ?>
        </div>
        <div class="nw-content">
            <span class="section-title">NOTAM:</span>
            <pre style="margin: 0; font-size: 11pt;"><?php if (!empty($apt['notams'])): ?><?php $last_key = array_key_last($apt['notams']); foreach ($apt['notams'] as $key => $n): ?><?= $n['id'] . "\n" . $n['text'] . "\n" ?><?php if ($key !== $last_key): ?>.
<?php endif; ?><?php endforeach; ?><?php else: ?>NO SIGNIFICANT NOTAM.
<?php endif; ?></pre>
            <span class="section-title">FORECAST WEATHER:</span>
            <pre style="margin: 0; font-size: 11pt;"><?= (!empty($apt['taf']) ? $apt['taf'] : 'REFER TO WX PKG') ?></pre>
        </div>
    </div>
    <div class="dashed-separator"></div>
    <?php endforeach; ?>

    <pre>
4. SIGNIFICANT WX EN-ROUTE
   TYPHOON      : NIL
   TURBULENCE   : LIGHT
   JETSTREAM    : PSE CHECK SIGWX
   CLOUDS       : PSE CHECK SIGWX
   WIND COMP.   : <?= formatAvgWindComp($rawData['general']['avg_wind_comp'] ?? 0) ?>

5. EST PAYLOAD
   PAX          : <?= ($rawData['weights']['pax_count'] ?? 0) ?>
   CARGO        : <?= ($rawData['weights']['cargo'] ?? 0) ?>
   PAYLOAD      : <?= ($rawData['weights']['payload'] ?? 0) ?> <?= $u ?>
    </pre>

    <div class="footer-box">
        <b>Flight Dispatch Center</b><br>
        Operation Center II Building 3rd Floor | Garuda City | Soekarno-Hatta International Airport<br>
        Cengkareng 19120, Indonesia<br>
        Office Phone: +62 21 559 0451, +62 21 2560 1524, +62 21 559 15428 | Fax: +62 21 550 1911<br>
        Email Address: flight-dispatch-center@garuda-indonesia.com; cflightdispatch@gmail.com;<br>
        SITA Address: JKTOIGA
    </div>

    <div class="page-break"></div>

    <pre>---------------------------------------------------------------------------
                             DISPATCH RELEASE
---------------------------------------------------------------------------
VALID U/I <?= php_date('Hi', ($rawOutTime + 21600)) ?>Z
REF PLAN <?= substr(($rawData['params']['request_id'] ?? '00000'), -5) ?> / REV NBR <?= ($rawData['general']['release'] ?? '0') ?>
<?= strtoupper($airlineCallsign) ?>   <?= php_date('dMy', $rawOutTime) ?> ETD <?= php_date('Hi', $rawOutTime) ?>Z  ETA <?= php_date('Hi', $rawData['times']['est_in'] ?? 0) ?>Z / FT <?= php_date('Hi', $rawData['times']['est_block'] ?? 0) ?> IFR <?= ($rawData['aircraft']['reg'] ?? '') ?>

1.  POD/POA : <?= ($rawData['origin']['icao_code'] ?? '') ?>/<?= ($rawData['destination']['icao_code'] ?? '') ?>

2.  INITIAL DESTINATION (FOR PLANNED RE-DISPATCH AS APPLICABLE):

3.  WX
    ORG <?= ($rawData['origin']['iata_code'] ?? '') ?>/<?= ($rawData['origin']['icao_code'] ?? '') ?>  CHECKED             <?php if (count($alternates_list) > 0): ?>AL1 <?= ($alternates_list[0]['iata_code'] ?? '') ?>/<?= ($alternates_list[0]['icao_code'] ?? '') ?>  CHECKED <?php endif; ?>
    DES <?= ($rawData['destination']['iata_code'] ?? '') ?>/<?= ($rawData['destination']['icao_code'] ?? '') ?>  CHECKED             <?php if (count($alternates_list) > 1): ?>AL2 <?= ($alternates_list[1]['iata_code'] ?? '') ?>/<?= ($alternates_list[1]['icao_code'] ?? '') ?>  CHECKED <?php endif; ?>

4.  NOTAM AND/OR AERONAUTICAL INFORMATION
    ALL NOTAMS SIGNIFICANT TO FLIGHT ARE CONSIDERED

5.  LOAD
    EST PAX ADL<?= str_pad(($rawData['weights']['pax_count'] ?? 0), 3, '0', STR_PAD_LEFT) ?>/CHD000/INF000          TOTAL  <?= ($rawData['weights']['pax_count'] ?? 0) ?>
    EST CGO <?= ($rawData['weights']['cargo'] ?? 0) ?> <?= $u ?>
    EST PLD <?= ($rawData['weights']['payload'] ?? 0) ?> <?= $u ?>

6.  FLIGHT PLAN DATA
    TRP   <?= str_pad(($rawData['fuel']['enroute_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   <?= $u ?> <?= php_date('H:i', $rawData['times']['est_time_enroute'] ?? 0) ?>         EZF    <?= str_pad(($rawData['weights']['est_zfw'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   MAX <?= str_pad(($rawData['weights']['max_zfw'] ?? 0), 6, '0', STR_PAD_LEFT) ?>
    RES   <?= str_pad(($rawData['fuel']['reserve'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   <?= $u ?> <?= php_date('H:i', $rawData['times']['reserve_time'] ?? 0) ?>         ELW    <?= str_pad(($rawData['weights']['est_ldw'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   MAX <?= str_pad(($rawData['weights']['max_ldw'] ?? 0), 6, '0', STR_PAD_LEFT) ?>
    <?php if (count($alternates_list) > 0): ?>ALT   <?= str_pad(($rawData['fuel']['alternate_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   <?= $u ?> <?= php_date('H:i', $alternates_list[0]['burn'] ?? 0) ?>         ETW    <?= str_pad(($rawData['weights']['est_tow'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   MAX <?= str_pad(($rawData['weights']['max_tow'] ?? 0), 6, '0', STR_PAD_LEFT) ?><?php endif; ?>
    BLK   <?= str_pad(($rawData['fuel']['plan_ramp'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   <?= $u ?> <?= php_date('H:i', $rawData['times']['endurance'] ?? 0) ?>

7.  ETOPS FLIGHT: <?php if (empty($rawData['etops']) || $rawData['etops'] == '0'): ?> NO <?php else: ?> YES     ETOPS DIVERSION TIME: <?= ($rawData['etops']['rule'] ?? '') ?> MIN <?php endif; ?>

8.  ENROUTE / ETOPS ALTERNATE: <?= $etops_alternates_str ?>

9.  TAKE OFF ALTERNATE (IF REQUIRED) : ......

10. DESTINATION ALTERNATE: 1. <?php if (count($alternates_list) > 0): ?><?= $alternates_list[0]['icao_code'] ?><?php else: ?>....<?php endif; ?>   2. <?php if (count($alternates_list) > 1): ?><?= $alternates_list[1]['icao_code'] ?><?php else: ?>....<?php endif; ?>

11. FUEL REQ AFTER BRIEF: ............. <?= $u ?>

    REASON FOR DISCRETIONARY FUEL :....................

12. NOTOC  / (DGR):

13. REMARKS: NONE

I HEREBY RELEASE THIS FLIGHT IN FULL COMPLIANCE WITH CIVIL AVIATION SAFETY
REGULATIONS AND OPERATION MANUAL PART A (OM-A)
    DISPATCHED BY               : FOO. <?= strtoupper($rawData['crew']['dx'] ?? '') ?> - <?= $fooId ?>

I HEREBY PREPARE AND ARRANGE THIS FLIGHT DISPATCH RELEASE ACCORDING TO THE
INSTRUCTION AND DATA PROVIDED BY PT. GARUDA INDONESIA (PERSERO) TBK.
    NAME / ID                   : .................. / ........

                                   SIGN ......................

I HEREBY ACCEPT THIS FLIGHT DISPATCH RELEASE WITH FULL ACKNOWLEDGEMENT.
    PILOT IN COMMAND            :  CAPT. <?= strtoupper($rawData['crew']['cpt'] ?? '') ?>

                                   SIGN ......................</pre>

    <div class="page-break"></div>

    <pre>---------------------------------------------------------------------------
                        COMPUTERIZED FLIGHT PLAN
---------------------------------------------------------------------------
PLAN <?= substr(($rawData['params']['request_id'] ?? '00000'), -5) ?> / REV NUM <?= str_pad(($rawData['general']['release'] ?? 0), 2, '0', STR_PAD_LEFT) ?>       <?= ($rawData['origin']['icao_code'] ?? '') ?> TO <?= ($rawData['destination']['icao_code'] ?? '') ?>  <?= ($rawData['aircraft']['icaocode'] ?? '') ?>  <?= formatCruiseProfile(($rawData['general']['cruise_profile'] ?? ''), ($rawData['general']['costindex'] ?? 0)) ?>/F  IFR  <?= php_date('d/m/y', $rawOutTime) ?>
NONSTOP COMPUTED <?= php_date('Hi', $rawData['params']['time_generated'] ?? 0) ?> ETD <?= php_date('Hi', $rawOutTime) ?>Z PROGS <?= getWeatherPrognosisTimes($rawOutTime) ?> <?= ($rawData['aircraft']['reg'] ?? '') ?> <?= $u ?>

GARUDA INDONESIA CFP

SPD SKD   CLB-<?= ($rawData['general']['climb_profile'] ?? '') ?>  CRZ-<?= formatCruiseProfile(($rawData['general']['cruise_profile'] ?? ''), ($rawData['general']['costindex'] ?? 0)) ?>   DSC-<?= ($rawData['general']['descent_profile'] ?? '') ?>
<?php if (!empty($rawData['etops']) && is_array($rawData['etops'])): ?>
ETOPS FLTPLN <?= ($rawData['etops']['rule'] ?? '') ?> MINUTES
<?php endif; ?>

FUEL         CORR      ENDUR

<?= str_pad(($rawData['fuel']['enroute_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', $rawData['times']['est_time_enroute'] ?? 0) ?>    TRIPF INCL <?= formatPerfPerfFactor($rawData['aircraft']['fuelfact'] ?? 1) ?>PCT HIGH CONS
<?= str_pad(($rawData['fuel']['contingency'] ?? 0), 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', $rawData['times']['contfuel_time'] ?? 0) ?>    CONTINGENCY/RR
<?= str_pad(($rawData['fuel']['reserve'] ?? 0), 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', $rawData['times']['reserve_time'] ?? 0) ?>    FINAL RESERVE FUEL
<?php if (count($alternates_list) > 0): ?><?= str_pad(($rawData['fuel']['alternate_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', $alternates_list[0]['burn'] ?? 0) ?>    ALTN <?= $alternates_list[0]['icao_code'] ?><?php endif; ?>
<?= str_pad(0, 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', 0) ?>    EXTRA HOLDING FUEL
<?= str_pad(((int)($rawData['fuel']['etops'] ?? 0)), 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', ((int)($rawData['times']['etopsfuel_time'] ?? 0))) ?>    ADDITIONAL FUEL
<?= str_pad(((int)($rawData['fuel']['plan_takeoff'] ?? 0)), 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', ((int)($rawData['times']['endurance'] ?? 0))) ?>    REQ
<?= str_pad(0, 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', 0) ?>    TANKERING
<?= str_pad(0, 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', 0) ?>    DISCRETIONARY FUEL
<?= str_pad(($rawData['fuel']['plan_takeoff'] ?? 0), 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', $rawData['times']['endurance'] ?? 0) ?>    TKOF
<?= str_pad(($rawData['fuel']['taxi'] ?? 0), 6, '0', STR_PAD_LEFT) ?>       .. ..                 TAXI
<?= str_pad(($rawData['fuel']['plan_ramp'] ?? 0), 6, '0', STR_PAD_LEFT) ?>       .. ..     <?= php_date('H:i', $rawData['times']['endurance'] ?? 0) ?>    BLOCK  FUEL REM .. ..

                ARR  .. ..     TDN   .. ..
                DEP  .. ..     A/B   .. ..
                FLT  .. ..     AIR   .. ..

FBURN ADJUSTMENT FOR 1000<?= $u ?> INCR/DECR IN TOW <?= str_pad(($rawData['impacts']['zfw_plus_1000']['burn_difference'] ?? 0), 4, '0', STR_PAD_LEFT) ?><?= $u ?>/<?= str_pad(str_replace('-', '', ($rawData['impacts']['zfw_minus_1000']['burn_difference'] ?? 0)), 4, '0', STR_PAD_LEFT) ?><?= $u ?>

FL SUMMARIES
CRZ          TOW      TRF         TIM      FL
<?php if (isset($rawData['impacts']['plus_2000ft'])): ?>
<?= formatCruiseProfile(($rawData['general']['cruise_profile'] ?? ''), ($rawData['impacts']['plus_2000ft']['cost_index'] ?? 0)) ?>       <?= str_pad(($rawData['weights']['est_tow'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   <?= str_pad(($rawData['impacts']['plus_2000ft']['enroute_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>      <?= php_date('H:i', $rawData['impacts']['plus_2000ft']['time_enroute'] ?? 0) ?>     <?= ($rawData['impacts']['plus_2000ft']['initial_fl'] ?? '') ?>
<?php endif; ?>
<?= formatCruiseProfile(($rawData['general']['cruise_profile'] ?? ''), ($rawData['general']['costindex'] ?? 0)) ?>       <?= str_pad(($rawData['weights']['est_tow'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   <?= str_pad(($rawData['fuel']['enroute_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>      <?= php_date('H:i', $rawData['times']['est_time_enroute'] ?? 0) ?>     <?= floor((int)($rawData['general']['initial_altitude'] ?? 0) / 100) ?>
<?php if (isset($rawData['impacts']['minus_2000ft'])): ?>
<?= formatCruiseProfile(($rawData['general']['cruise_profile'] ?? ''), ($rawData['impacts']['minus_2000ft']['cost_index'] ?? 0)) ?>       <?= str_pad(($rawData['weights']['est_tow'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   <?= str_pad(($rawData['impacts']['minus_2000ft']['enroute_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>      <?= php_date('H:i', $rawData['impacts']['minus_2000ft']['time_enroute'] ?? 0) ?>     <?= ($rawData['impacts']['minus_2000ft']['initial_fl'] ?? '') ?>
<?php endif; ?>

FLT NBR <?= strtoupper($airlineCallsign) ?>   DTE <?= php_date('d/m/y', $rawOutTime) ?>

 EZF       PLD        ELW       ETW     CRZ
<?= str_pad(($rawData['weights']['est_zfw'] ?? 0), 6, '0', STR_PAD_LEFT) ?>    <?= str_pad(($rawData['weights']['payload'] ?? 0), 6, '0', STR_PAD_LEFT) ?>     <?= str_pad(($rawData['weights']['est_ldw'] ?? 0), 6, '0', STR_PAD_LEFT) ?>    <?= str_pad(($rawData['weights']['est_tow'] ?? 0), 6, '0', STR_PAD_LEFT) ?>   <?= formatCruiseProfile(($rawData['general']['cruise_profile'] ?? ''), ($rawData['general']['costindex'] ?? 0)) ?>

<?php if (!empty($rawData['etops']) && is_array($rawData['etops'])): ?>
ENRT ALTN SUITABLE
<?php 
$etops_apts = $rawData['etops']['suitable_airport'] ?? [];
if (isset($etops_apts['icao_code'])) { $etops_apts = [$etops_apts]; }
foreach ($etops_apts as $airport): 
?>
<?= $airport['icao_code'] ?> VALIDITY WINDOW <?= substr(($airport['suitability_start'] ?? ''), 11, 5) ?>Z TO <?= substr(($airport['suitability_end'] ?? ''), 11, 5) ?>Z
<?php endforeach; ?>

-E.ENT <?= str_replace('.', '', formatLatLonEtops(($rawData['etops']['entry']['pos_lat_fix'] ?? 0), ($rawData['etops']['entry']['pos_long_fix'] ?? 0))) ?>  0000 NM <?= php_date('H:i', $rawData['etops']['entry']['elapsed_time'] ?? 0) ?>    <?= ($rawData['etops']['entry']['icao_code'] ?? '') ?>  <?= str_replace('.', '', formatLatLonEtops(($rawData['etops']['entry']['pos_lat_apt'] ?? 0), ($rawData['etops']['entry']['pos_long_apt'] ?? 0))) ?>
-E.EXT <?= str_replace('.', '', formatLatLonEtops(($rawData['etops']['exit']['pos_lat_fix'] ?? 0), ($rawData['etops']['exit']['pos_long_fix'] ?? 0))) ?>  0000 NM <?= php_date('H:i', $rawData['etops']['exit']['elapsed_time'] ?? 0) ?>    <?= ($rawData['etops']['exit']['icao_code'] ?? '') ?>  <?= str_replace('.', '', formatLatLonEtops(($rawData['etops']['exit']['pos_lat_apt'] ?? 0), ($rawData['etops']['exit']['pos_long_apt'] ?? 0))) ?>

<?php 
$criticalEtp = $rawData['etops']['critical_point']['fix_type'] ?? '';
$etps = $rawData['etops']['equal_time_point'] ?? [];
if (isset($etps['pos_lat'])) { $etps = [$etps]; }
foreach ($etps as $idx => $etp) {
    if ((float)($etp['pos_lat'] ?? 0) == (float)($rawData['etops']['critical_point']['pos_lat'] ?? 0)) {
        $criticalEtp = 'ETP' . ($idx + 1);
    }
}
$def_val = (float)($rawData['etops']['critical_point']['est_fob'] ?? 0) - (float)($rawData['etops']['critical_point']['critical_fuel'] ?? 0);
$deficit = $def_val > 0 ? 0 : abs($def_val);
?>
MOST CRITICAL FUEL SCENARIO AT : <?= $criticalEtp ?> FUEL DEFICIT OF <?= $deficit ?> <?= $u ?>

<?php if (count($etps) > 0): ?>
                                                         TIME TO
                   DIST        W/C    CFR   FOB    EXC   ETP/ALT
<?php foreach ($etps as $idx => $etp): 
    $da1 = isset($etp['div_airport'][0]) ? $etp['div_airport'][0] : ($etp['div_airport'] ?? []);
    $da2 = (isset($etp['div_airport'][1])) ? $etp['div_airport'][1] : (isset($etp['div_airport']['icao_code']) ? $etp['div_airport'] : ($etp['div_airport'][0] ?? []));
?>
ETP<?= ($idx + 1) ?> <?= ($da1['icao_code'] ?? '') ?>/<?= ($da2['icao_code'] ?? '') ?>   <?= str_pad(($da1['distance'] ?? 0), 4, '0', STR_PAD_LEFT) ?>/<?= str_pad(($da2['distance'] ?? 0), 4, '0', STR_PAD_LEFT) ?>  <?= formatAvgWindComp($da1['avg_wind_comp'] ?? 0) ?>/<?= formatAvgWindComp($da2['avg_wind_comp'] ?? 0) ?> <?= str_pad(($etp['critical_fuel'] ?? 0), 5, '0', STR_PAD_LEFT) ?> <?= str_pad(($etp['est_fob'] ?? 0), 6, '0', STR_PAD_LEFT) ?> <?= str_pad(((int)($etp['est_fob'] ?? 0) - (int)($etp['critical_fuel'] ?? 0)), 5, '0', STR_PAD_LEFT) ?> <?= php_date('Hi', $etp['elapsed_time'] ?? 0) ?>/<?= php_date('Hi', $etp['div_time'] ?? 0) ?>
     <?= formatLatLonEtops(($etp['pos_lat'] ?? 0), ($etp['pos_long'] ?? 0)) ?>
<?php endforeach; ?>
<?php endif; ?>
<?php endif; ?>

ETO TIM   AWY     WPT/FRQ      TTK   DIS  TAS  FLV   TD /TP   FBO    PFRM
ATO TIM      COORD             MTK   TTL  G/S  GMA   WIND     ABO    AFRM

        <?= ($rawData['origin']['icao_code'] ?? '') ?>                                                       <?= str_pad(($rawData['fuel']['taxi'] ?? 0), 5, '0', STR_PAD_LEFT) ?>  <?= str_pad(($rawData['fuel']['plan_takeoff'] ?? 0), 6, '0', STR_PAD_LEFT) ?>
        ELEV <?= formatAirportElevation($rawData['origin']['elevation'] ?? 0) ?> FT
        <?= formatLatLon(($rawData['origin']['pos_lat'] ?? 0), ($rawData['origin']['pos_long'] ?? 0)) ?>
</pre>
<div>
<?php 
$totalDistance = 0; 
$fixes = $rawData['navlog']['fix'] ?? [];
foreach ($fixes as $fix): 
    $totalDistance += (int)($fix['distance'] ?? 0);
    if (!empty($fix['fir_crossing']['fir'])):
        $fir_list = isset($fix['fir_crossing']['fir']['fir_icao']) ? [$fix['fir_crossing']['fir']] : $fix['fir_crossing']['fir'];
        foreach ($fir_list as $fir):
?>
<div class="nav-row">
    0000  <?= str_pad(($fix['via_airway'] ?? ''), 6, ' ', STR_PAD_RIGHT) ?> FIR/<?= ($fir['fir_icao'] ?? '') ?>      <?= ($fix['track_true'] ?? '') ?>T  000  <?= str_pad(($fix['true_airspeed'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= (($fix['stage'] ?? '') === 'CLB' ? 'CLB ' : str_pad(floor((int)($fix['altitude_feet'] ?? 0) / 100), 3, '0', STR_PAD_LEFT) . ' ') ?>  <?= str_pad("ISA", 7, ' ', STR_PAD_RIGHT) ?> <?= str_pad(($fix['fuel_totalused'] ?? 0), 5, '0', STR_PAD_LEFT) ?>  <?= str_pad(($fix['fuel_plan_onboard'] ?? 0), 6, '0', STR_PAD_LEFT) ?>
    <?= php_date('Hi', $fix['time_total'] ?? 0) ?>    <?= formatLatLon(($fir['pos_lat_entry'] ?? 0), ($fir['pos_long_entry'] ?? 0)) ?>    <?= ($fix['track_mag'] ?? '') ?>M  0000 <?= str_pad(($fix['groundspeed'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= str_pad(floor((int)($fix['mora'] ?? 0) / 100), 3, '0', STR_PAD_LEFT) ?>   <?= ($fix['wind_dir'] ?? 0) ?><?= str_pad(($fix['wind_spd'] ?? 0), 3, '0', STR_PAD_LEFT) ?>
</div>
        <?php endforeach; ?>
    <?php endif; ?>

<div class="nav-row">
    <?= php_date('Hi', $fix['time_leg'] ?? 0) ?>  <?= str_pad(($fix['via_airway'] ?? ''), 6, ' ', STR_PAD_RIGHT) ?> <?= str_pad(($fix['ident'] ?? ''), 12, ' ', STR_PAD_RIGHT) ?>  <?= ($fix['track_true'] ?? '') ?>T  <?= str_pad(($fix['distance'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= str_pad(($fix['true_airspeed'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= (($fix['stage'] ?? '') === 'CLB' ? 'CLB ' : str_pad(floor((int)($fix['altitude_feet'] ?? 0) / 100), 3, '0', STR_PAD_LEFT) . ' ') ?>  <?= str_pad("ISA", 7, ' ', STR_PAD_RIGHT) ?> <?= str_pad(($fix['fuel_totalused'] ?? 0), 5, '0', STR_PAD_LEFT) ?>  <?= str_pad(($fix['fuel_plan_onboard'] ?? 0), 6, '0', STR_PAD_LEFT) ?>
    <?= php_date('Hi', $fix['time_total'] ?? 0) ?>    <?= formatLatLon(($fix['pos_lat'] ?? 0), ($fix['pos_long'] ?? 0)) ?>    <?= ($fix['track_mag'] ?? '') ?>M  <?= str_pad($totalDistance, 4, '0', STR_PAD_LEFT) ?> <?= str_pad(($fix['groundspeed'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= str_pad(floor((int)($fix['mora'] ?? 0) / 100), 3, '0', STR_PAD_LEFT) ?>   <?= ($fix['wind_dir'] ?? 0) ?><?= str_pad(($fix['wind_spd'] ?? 0), 3, '0', STR_PAD_LEFT) ?>
    <?php if (($fix['ident'] ?? '') === ($rawData['destination']['icao_code'] ?? '')): ?>
        ELEV <?= formatAirportElevation($rawData['destination']['elevation'] ?? 0) ?> FT
    <?php endif; ?>
</div>
<?php endforeach; ?>
</div>
<pre>
<?= getFormattedFir($rawData['atc']['section18'] ?? '') ?>
TRACK USED = -OPT

G/C DIST <?= ($rawData['origin']['icao_code'] ?? '') ?>/<?= ($rawData['destination']['icao_code'] ?? '') ?>  <?= ($rawData['general']['gc_distance'] ?? '') ?> NM

ROUTE DIST <?= ($rawData['general']['route_distance'] ?? '') ?>NM

MAX FL / AVG.TAS  FL390 / <?= (int)($rawData['general']['cruise_tas'] ?? 0) ?>

AVG COMP P<?= str_pad(abs((int)($rawData['general']['avg_comp_wind'] ?? 0)), 3, '0', STR_PAD_LEFT) ?>

         GMA  DIST  TTK  W/C   FL   TIME   FUEL BOF
<?php foreach ($alternates_list as $alt): ?>
<?= $alt['icao_code'] ?>          <?= str_pad(($alt['distance'] ?? 0), 4, '0', STR_PAD_LEFT) ?>  <?= str_pad(($alt['track_true'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= ($alt['avg_wind_comp'] ?? 0) ?>  <?= floor((int)($alt['cruise_altitude'] ?? 0) / 100) ?>  <?= php_date('H.i', $alt['ete'] ?? 0) ?>  <?= str_pad(($alt['burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>
         <?= ($rawData['destination']['icao_code'] ?? '') ?> <?= ($alt['route_ifps'] ?? '') ?> <?= $alt['icao_code'] ?>
<?php endforeach; ?>

                             ALTERNATE DATA

ETO TIM   AWY     WPT/FRQ      TTK   DIS  TAS  FLV   TD /TP   FBO    PFRM
ATO TIM      COORD             MTK   TTL  G/S  GMA   WIND     ABO    AFRM
<?php if (!empty($navlog_alt1['fix'])): ?>
<?php $ns_alt_dist = 0; foreach ($navlog_alt1['fix'] as $fix): $ns_alt_dist += (int)($fix['distance'] ?? 0); ?>
    <?= php_date('Hi', $fix['time_leg'] ?? 0) ?>  <?= str_pad(($fix['via_airway'] ?? ''), 6, ' ', STR_PAD_RIGHT) ?> <?= str_pad(($fix['ident'] ?? '') . ' ' . ($fix['frequency'] ?? ''), 12, ' ', STR_PAD_RIGHT) ?>  <?= ($fix['track_true'] ?? '') ?>T  <?= str_pad(($fix['distance'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= str_pad(($fix['true_airspeed'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= (($fix['stage'] ?? '') === 'CLB' ? 'CLB ' : str_pad(floor((int)($fix['altitude_feet'] ?? 0) / 100), 3, '0', STR_PAD_LEFT) . ' ') ?>  <?= str_pad("ISA", 7, ' ', STR_PAD_RIGHT) ?> <?= str_pad(($fix['fuel_totalused'] ?? 0), 5, '0', STR_PAD_LEFT) ?>  <?= str_pad(($fix['fuel_plan_onboard'] ?? 0), 6, '0', STR_PAD_LEFT) ?>
    <?= php_date('Hi', $fix['time_total'] ?? 0) ?>    <?= formatLatLon(($fix['pos_lat'] ?? 0), ($fix['pos_long'] ?? 0)) ?>    <?= ($fix['track_mag'] ?? '') ?>M  <?= str_pad($ns_alt_dist, 4, '0', STR_PAD_LEFT) ?> <?= str_pad(($fix['groundspeed'] ?? 0), 3, '0', STR_PAD_LEFT) ?>  <?= str_pad(floor((int)($fix['mora'] ?? 0) / 100), 3, '0', STR_PAD_LEFT) ?>   <?= ($fix['wind_dir'] ?? 0) ?><?= str_pad(($fix['wind_spd'] ?? 0), 3, '0', STR_PAD_LEFT) ?>
        <?php if (($fix['ident'] ?? '') === ($alternates_list[0]['icao_code'] ?? '')): ?>ELEV <?= formatAirportElevation($alternates_list[0]['elevation'] ?? 0) ?> FT <?php endif; ?>
<?php endforeach; ?>
<?php endif; ?>

CLIMB
         FL100     FL180     FL240     FL300     FL340     FL390     FL450
<?php foreach ($fixes as $fix): ?>
<?php if (($fix['stage'] ?? '') === 'CLB' && ($fix['ident'] ?? '') !== 'TOC'): ?>
<?= formatWindMatrixRow($fix) ?>
<?php endif; ?>
<?php endforeach; ?>

CRUISE
         FL100     FL180     FL240     FL300     FL340     FL390     FL450
<?php foreach ($fixes as $fix): ?>
<?php if (($fix['stage'] ?? '') === 'CRZ' && ($fix['ident'] ?? '') !== 'TOD'): ?>
<?= formatWindMatrixRow($fix) ?>
<?php endif; ?>
<?php endforeach; ?>

DESCENT
         FL100     FL180     FL240     FL300     FL340     FL390     FL450
<?php foreach ($fixes as $fix): ?>
<?php if (($fix['stage'] ?? '') === 'DSC'): ?>
<?= formatWindMatrixRow($fix) ?>
<?php endif; ?>
<?php endforeach; ?>

I CERTIFY THAT HAVE SATISFIED MYSELF THAT ALL FACTORS WHICH FORM THE BASIS OF
FLIGHT PREPARATION ARE IN ACCORDANCE WITH THE PERTINENT REGULATIONS LAID DOWN
BY THE INDONESIAN CIVIL AVIATION, CAPTAIN <?= strtoupper($rawData['crew']['cpt'] ?? '') ?>

PIC             : CAPTAIN <?= strtoupper($rawData['crew']['cpt'] ?? '') ?>

SIGN            : .. .. .. .. .. ..

PREPARED BY     : FOO. <?= strtoupper($rawData['crew']['dx'] ?? '') ?> - <?= $fooId ?>

CAPTAINS SIGNATURE FOR COMPLETION OF JOURNAL AFTER FLIGHT

                                      .. .. .. .. ..

<?php 
if (!empty($rawData['atc']['flightplan_text'])) {
    $lines = explode("\n", $rawData['atc']['flightplan_text']);
    foreach ($lines as $line) {
        if (trim($line)) {
            echo htmlspecialchars($line) . "\n";
        }
    }
}
?>

<?php if (!empty($rawData['etops']) && isset($rawData['etops']['equal_time_point'])): ?>
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
<?php 
$etps_analysis = $rawData['etops']['equal_time_point'];
if (isset($etps_analysis['pos_lat'])) { $etps_analysis = [$etps_analysis]; }
foreach ($etps_analysis as $etp):
?>
2D
ETP <?= str_replace('.', '', formatLatLonEtops(($etp['pos_lat'] ?? 0), ($etp['pos_long'] ?? 0))) ?>
TO ETP BURN <?= str_pad(((int)($rawData['fuel']['plan_takeoff'] ?? 0) - (int)($etp['est_fob'] ?? 0)), 6, '0', STR_PAD_LEFT) ?>
       TIME  <?= php_date('H.i', $etp['elapsed_time'] ?? 0) ?>
       DIST   0000
       ETP AIRPORTS
       <?php 
       $da1 = isset($etp['div_airport'][0]) ? $etp['div_airport'][0] : ($etp['div_airport'] ?? []);
       $da2 = (isset($etp['div_airport'][1])) ? $etp['div_airport'][1] : (isset($etp['div_airport']['icao_code']) ? $etp['div_airport'] : ($etp['div_airport'][0] ?? []));
       ?>
       <?= ($da1['icao_code'] ?? '') ?>    <?= ($da2['icao_code'] ?? '') ?>
TIME   <?= php_date('H.i', $etp['div_time'] ?? 0) ?>   <?= php_date('H.i', $etp['div_time'] ?? 0) ?>
RQFUEL <?= str_pad(($etp['div_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>  <?= str_pad(($etp['div_burn'] ?? 0), 6, '0', STR_PAD_LEFT) ?>
FL     <?= floor((int)($etp['div_altitude'] ?? 0) / 100) ?>   <?= floor((int)($etp['div_altitude'] ?? 0) / 100) ?>
DIST   <?= str_pad(($da1['distance'] ?? 0), 4, '0', STR_PAD_LEFT) ?>    <?= str_pad(($da2['distance'] ?? 0), 4, '0', STR_PAD_LEFT) ?>
WIND   <?= formatAvgWindComp($da1['avg_wind_comp'] ?? 0) ?>    <?= formatAvgWindComp($da2['avg_wind_comp'] ?? 0) ?>
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

<?php endforeach; ?>
<?php endif; ?>

END OF NAVTECH DATAPLAN
REQUEST NO. <?= substr(($rawData['params']['request_id'] ?? '00000'), -5) ?> / REV NBR <?= ($rawData['general']['release'] ?? '0') ?>
</pre>

    <div class="landscape-section">
        <div class="notam-header-landscape">
            NOTAM BRIEFING<br>
            <?= strtoupper($airlineCallsign) ?> - <?= date('Y-m-d', $rawOutTime) ?>
        </div>

        <div class="notam-columns">
        <?php foreach ($notam_groups as $group): ?>
            <?php if (!empty($group['notams'])): ?>
            <div class="notam-group">
                <div class="notam-group-header"><?= $group['title'] ?></div>
                <?php foreach ($group['notams'] as $n): ?>
                <div class="notam-item">
                    <b><?= ($n['notam_id'] ?? '') ?></b> <?= ($n['notam_nrc'] ?? '') ?><br>
                    Q) <?= ($n['notam_qcode'] ?? '') ?><br>
                    A) <?= ($n['location_id'] ?? '') ?>
                    B) <?= ($n['notam_effective_dtg'] ?? $n['date_effective'] ?? '') ?>
                    <?php if (!empty($n['notam_expire_dtg']) || !empty($n['date_expire'])): ?>C) <?= ($n['notam_expire_dtg'] ?? $n['date_expire'] ?? '') ?><br><?php endif; ?>
                    <?php if (!empty($n['notam_schedule'])): ?>D) <?= $n['notam_schedule'] ?><br><?php endif; ?>
                    E) <?= ($n['notam_text'] ?? '') ?><br>
                    <?php if (!empty($n['lower_limit'])): ?>F) <?= $n['lower_limit'] ?> G) <?= $n['upper_limit'] ?><?php endif; ?>
                </div>
                <?php endforeach; ?>
            </div>
            <?php endif; ?>
        <?php endforeach; ?>
        </div>
    </div>

    <div class="page-break"></div>

    <div class="wx-header">
        THE FOLLOWING ARE EXTRACT FROM:<br>
        BADAN METEOROLOGI, KLIMATOLOGI, DAN GEOFISIKA<br>
        BIDANG METEOROLOGI PENERBANGAN<br>
        WHICH MAY EFFECT TO THE OPERATION OF FLIGHT<br><br>
        WEATHER BRIEFING
    </div>
    <hr style="border-top: 1px solid #000; margin-bottom: 20px;">

    <?php foreach ($weather_info as $wx): ?>
    <div class="wx-section">
        <div class="wx-airport-title"><?= $wx['title'] ?></div>
        <div class="wx-data"><?= nl2br(htmlspecialchars($wx['data'])) ?></div>
    </div>
    <?php endforeach; ?>

    <div class="page-break"></div>

    <?php if (!empty($map_images)): ?>
    <div class="landscape-section">
        <div style="text-align: center; font-weight: bold; font-size: 14pt; margin-bottom: 15px;">
            FLIGHT MAPS<br>
            <?= strtoupper($airlineCallsign) ?> - <?= date('Y-m-d', $rawOutTime) ?>
        </div>

        <?php $last_map_key = array_key_last($map_images); foreach ($map_images as $m_key => $map): ?>
            <div class="map-container">
                <div class="map-title"><?= $map['name'] ?></div>
                <img src="<?= htmlspecialchars($map['url']) ?>" class="map-image">
            </div>
            <?php if ($m_key !== $last_map_key): ?><div class="page-break"></div><?php endif; ?>
        <?php endforeach; ?>
    </div>
    <?php endif; ?>

</body>
</html>
<?php
// 8. COMPILE AND RENDER PDF OVER THE INTERCEPT STREAM
$htmlOutput = ob_get_clean();

$options = new Options();
$options->set('isRemoteEnabled', true);
$options->setAllowedRemoteHosts(['simbrief.com', 'www.simbrief.com', 'dispatch.simbrief.com']);
$options->set('isHtml5ParserEnabled', true);
$options->set('chroot', __DIR__);

$dompdf = new Dompdf($options);
$dompdf->loadHtml($htmlOutput);
$dompdf->setPaper('A4', 'portrait');
$dompdf->render();

$filename = strtoupper($airlineCallsign) . "_Briefing_Final.pdf";
$dompdf->stream($filename, ["Attachment" => false]);
exit;
?>