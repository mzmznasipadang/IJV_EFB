<?php
require_once __DIR__ . '/dompdf/autoload.inc.php';
require_once __DIR__ . '/hoppie.php';

session_start();

// Strict Auth Enforcer: If unauthorized, boot back to root landing page
if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true) {
    header('Location: /index.php');
    exit;
}

// Handle Logout Command
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: /index.php');
    exit;
}

// Dedicated Backend Handler: Dynamic SimBrief Execution & PDF Streaming Bridge
if (isset($_GET['generate_pdf']) && isset($_GET['username'])) {
    // Sanitize input to prevent command injection vulnerabilities
    $username = preg_replace('/[^A-Za-z0-9_\-]/', '', $_GET['username']);
    if (empty($username)) {
        die("Invalid SimBrief username criteria provided.");
    }
    
    $output = [];
    $retval = null;
    
    // Invoke the headless Python process layer
    exec("python3 IJV.py " . escapeshellarg($username), $output, $retval);
    
    $targetFile = "operational_flight_plan.pdf";
    if ($retval === 0 && file_exists($targetFile)) {
        // Clear previous output buffers to avoid corrupting binary document
        if (ob_get_level()) ob_end_clean();
        
        header('Content-Type: application/pdf');
        header('Content-Disposition: inline; filename="IJV_OFP_' . $username . '.pdf"');
        header('Content-Length: ' . filesize($targetFile));
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        
        readfile($targetFile);
        @unlink($targetFile); // Safe housekeeping delete cycle
    } else {
        header('Content-Type: text/plain');
        echo "Operational Critical Failure: PDF Generation layer broken.\n";
        echo "Exit Exception Code: $retval\n";
        echo "Terminal Trace Logs:\n" . implode("\n", $output);
    }
    exit;
}

// Retrieve Profile values populated by landing page SSO response
$pilotName = "Capt. " . ($_SESSION['pilot_name'] ?? 'Pilot');
$pilotCallsign = $_SESSION['pilot_callsign'] ?? 'IJV';
$openAipKey = trim((string)getenv('OPENAIP_API_KEY'));

if (isset($_GET['openaip_tile'])) {
    session_write_close();
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        header('Allow: GET');
        http_response_code(405);
        exit;
    }
    $tile = $_GET['openaip_tile'];
    if (!is_string($tile) || !preg_match('/\A(\d{1,2})\/(\d{1,6})\/(\d{1,6})\z/', $tile, $coords)) {
        http_response_code(400);
        exit;
    }
    [, $z, $x, $y] = array_map('intval', $coords);
    if ($z < 2 || $z > 19 || $x >= (1 << $z) || $y >= (1 << $z)) {
        http_response_code(400);
        exit;
    }
    if ($openAipKey === '') {
        http_response_code(503);
        exit;
    }

    $context = stream_context_create(['http' => [
        'timeout' => 6,
        'follow_location' => 0,
        'header' => ['X-OpenAIP-API-Key: ' . $openAipKey, 'Accept: image/png'],
    ]]);
    $maxBytes = 1024 * 1024;
    $png = @file_get_contents("https://api.tiles.openaip.net/api/data/openaip/$z/$x/$y.png", false, $context, 0, $maxBytes + 1);
    if ($png === false || strlen($png) > $maxBytes || !str_starts_with($png, "\x89PNG\r\n\x1a\n")) {
        http_response_code(502);
        exit;
    }
    header('Content-Type: image/png');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=3600');
    echo $png;
    exit;
}

// International SIGMETs (aviationweather.gov isigmet excludes US domestic), cached 5 min for all crews
if (isset($_GET['sigmets'])) {
    session_write_close();
    header('Content-Type: application/json');
    $cacheFile = sys_get_temp_dir() . '/ijv_efb_isigmet.json';
    if (!is_file($cacheFile) || filemtime($cacheFile) < time() - 300) {
        $fresh = @file_get_contents('https://aviationweather.gov/api/data/isigmet?format=json', false,
            stream_context_create(["http" => ["timeout" => 15, "user_agent" => "WebEFBFlightDeck/2.0"]]));
        if ($fresh !== false && is_array(json_decode($fresh, true))) file_put_contents($cacheFile, $fresh, LOCK_EX);
    }
    $cached = @file_get_contents($cacheFile);
    if ($cached === false) http_response_code(503);
    echo $cached ?: '[]';
    exit;
}

// Hoppie ACARS: telex uplink from the VA ops station, and the per-callsign log the poller writes.
// The logon code never leaves the server.
if (isset($_GET['hoppie'])) {
    session_write_close();
    header('Content-Type: application/json');
    if (!getenv('HOPPIE_LOGON')) {
        http_response_code(503);
        exit(json_encode(['error' => 'Hoppie ACARS is not configured on this EFB.']));
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        $file = acars_log_file(strtoupper((string)($_GET['callsign'] ?? '')));
        exit($file && is_file($file) ? file_get_contents($file) : '[]');
    }
    $body = json_decode(file_get_contents('php://input', false, null, 0, 8192), true);
    $to = strtoupper(trim((string)($body['to'] ?? '')));
    $text = strtoupper(trim(preg_replace('/\s+/', ' ', (string)($body['text'] ?? ''))));
    if (!acars_log_file($to) || !preg_match('/^[\x20-\x7E]{1,1500}$/D', $text)) {
        http_response_code(400);
        exit(json_encode(['error' => 'Invalid callsign or message.']));
    }
    $result = hoppie_send($to, $text);
    if ($result !== true) {
        http_response_code(502);
        exit(json_encode(['error' => $result]));
    }
    exit(json_encode(['ok' => true]));
}

// CORSWeather Proxy Module
if (isset($_GET['proxy_weather']) && isset($_GET['icao']) && isset($_GET['type'])) {
    session_write_close();
    header('Content-Type: application/json');
    $icaoCode = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $_GET['icao']));
    if ($_GET['type'] === 'airport') {
        if (!preg_match('/^[A-Z0-9]{4}$/D', $icaoCode)) {
            echo json_encode([]);
            exit;
        }
        $cacheFile = sys_get_temp_dir() . '/ijv_efb_ourairports.csv';
        if (!is_file($cacheFile) || filemtime($cacheFile) < time() - 7 * 86400) {
            $fresh = @file_get_contents(
                'https://davidmegginson.github.io/ourairports-data/airports.csv',
                false,
                stream_context_create(["http" => ["timeout" => 15, "user_agent" => "WebEFBFlightDeck/2.0"]])
            );
            if ($fresh !== false && strlen($fresh) > 100000 && str_starts_with($fresh, '"id","ident",')) {
                $tempFile = tempnam(sys_get_temp_dir(), 'ijv_airports_');
                if ($tempFile !== false) {
                    if (file_put_contents($tempFile, $fresh) !== strlen($fresh) || !rename($tempFile, $cacheFile)) {
                        unlink($tempFile);
                    }
                }
            }
        }

        $airport = [];
        $catalog = @fopen($cacheFile, 'r');
        if ($catalog === false) {
            http_response_code(503);
        } else {
            $columns = array_flip(fgetcsv($catalog, 0, ',', '"', '') ?: []);
            if (!isset($columns['icao_code'], $columns['ident'], $columns['latitude_deg'], $columns['longitude_deg'])) {
                http_response_code(503);
            } else {
                while (($row = fgetcsv($catalog, 0, ',', '"', '')) !== false) {
                    $officialCode = $row[$columns['icao_code']] ?? '';
                    $ident = $row[$columns['ident']] ?? '';
                    if ($officialCode !== $icaoCode && ($officialCode !== '' || $ident !== $icaoCode)) continue;
                    $lat = $row[$columns['latitude_deg']] ?? '';
                    $lon = $row[$columns['longitude_deg']] ?? '';
                    if (is_numeric($lat) && is_numeric($lon) && abs((float)$lat) <= 90 && abs((float)$lon) <= 180) {
                        $airport = [["icaoId" => $icaoCode, "lat" => (float)$lat, "lon" => (float)$lon]];
                        if ($officialCode === $icaoCode) break;
                    }
                }
            }
            fclose($catalog);
        }
        echo json_encode($airport);
        exit;
    }
    $reqType = ($_GET['type'] === 'taf') ? 'taf' : 'metar';
    $targetUrl = "https://aviationweather.gov/api/data/{$reqType}?ids={$icaoCode}&format=json";
    
    $streamOptions = [
        "http" => [
            "method" => "GET",
            "header" => "User-Agent: WebEFBFlightDeck/2.0 (Simulated Operations Framework)\r\n"
        ]
    ];
    $networkContext = stream_context_create($streamOptions);
    $apiPayload = @file_get_contents($targetUrl, false, $networkContext);
    echo ($apiPayload === false || trim($apiPayload) === '') ? json_encode([]) : $apiPayload;
    exit;
}

// Folder Directory Scanners
$checklistDir = dirname(__DIR__) . '/checklists'; 
$chartsDir = dirname(__DIR__) . '/charts';

function scanVectorDirectory($dirPath) {
    $tree = [];
    if (is_dir($dirPath)) {
        $subFolders = array_filter(glob($dirPath . '/*'), 'is_dir');
        foreach ($subFolders as $folder) {
            $folderName = basename($folder);
            $files = glob($folder . '/*.pdf');
            $fileList = [];
            foreach ($files as $file) {
                $fileList[] = ['name' => basename($file, '.pdf'), 'path' => str_replace(dirname(__DIR__), '', $file)];
            }
            if (!empty($fileList)) {
                $tree[] = ['folder' => $folderName, 'files' => $fileList];
            }
        }
        $rootFiles = glob($dirPath . '/*.pdf');
        if (!empty($rootFiles)) {
            $rootFileList = [];
            foreach ($rootFiles as $file) {
                $rootFileList[] = ['name' => basename($file, '.pdf'), 'path' => str_replace(dirname(__DIR__), '', $file)];
            }
            array_unshift($tree, ['folder' => 'General Library', 'files' => $rootFileList]);
        }
    }
    return $tree;
}

$structure = scanVectorDirectory($checklistDir);
$chartsStructure = scanVectorDirectory($chartsDir);
$uiManifest = __DIR__ . '/ui/.vite/manifest.json';
$uiEntry = is_file($uiManifest) ? (json_decode(file_get_contents($uiManifest), true)['src/main.jsx'] ?? null) : null;
if (!$uiEntry) {
    http_response_code(503);
    exit('The EFB frontend assets are missing. Build and deploy the Docker image to install them.');
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#eef0f4">
    <title>IJV Electronic Flight Bag</title>
    <script>
        (() => {
            let preference = 'system';
            try {
                const stored = localStorage.getItem('ijv-efb-appearance');
                if (stored === 'light' || stored === 'dark') preference = stored;
            } catch {}
            const dark = preference === 'dark' ||
                (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
            document.documentElement.dataset.appearance = preference;
            document.documentElement.classList.toggle('dark', dark);
            document.querySelector('meta[name="theme-color"]').content = dark ? '#111824' : '#eef0f4';
        })();
    </script>
    <?php foreach ($uiEntry['css'] ?? [] as $stylesheet): ?>
        <link rel="stylesheet" href="/ops/ui/<?= htmlspecialchars($stylesheet) ?>">
    <?php endforeach; ?>
    <script type="module" src="/ops/ui/<?= htmlspecialchars($uiEntry['file']) ?>"></script>
</head>
<body>
    <div id="root"></div>
    <noscript>Enable JavaScript to use the EFB.</noscript>
    <script id="efb-config" type="application/json"><?= json_encode([
        'pilotName' => $pilotName,
        'pilotCallsign' => $pilotCallsign,
        'simbriefId' => $_SESSION['simbrief_id'] ?? '',
        'acars' => ($_SESSION['acars_pref'] ?? '') === 'hoppie' && getenv('HOPPIE_LOGON'),
        'openAipAvailable' => $openAipKey !== '',
        'charts' => $chartsStructure,
        'checklists' => $structure,
    ], JSON_HEX_TAG | JSON_INVALID_UTF8_SUBSTITUTE) ?></script>
</body>
</html>
