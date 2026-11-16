<?php
// The container healthcheck renders this page every 15 s; skip sessions so it leaves no 7-day session files behind
if (isset($_SERVER['HTTP_X_EFB_HEALTHCHECK'])) $_SESSION = []; else session_start();
header('Referrer-Policy: no-referrer');

define('VAMSYS_CLIENT_ID', getenv('VAMSYS_CLIENT_ID') ?: '867');
define('VAMSYS_REDIRECT_URI', getenv('VAMSYS_REDIRECT_URI') ?: 'https://efb.ijvirtual.org/index.php');
define('VAMSYS_AUTH_URL', 'https://vamsys.io/oauth/authorize');
define('VAMSYS_TOKEN_URL', 'https://vamsys.io/oauth/token');
define('VAMSYS_USER_URL', 'https://vamsys.io/api/v3/pilot/user');

function vamsysRequest(string $url, array $options): ?array
{
    $request = curl_init($url);
    curl_setopt_array($request, $options + [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
    ]);
    $body = curl_exec($request);
    $status = curl_getinfo($request, CURLINFO_HTTP_CODE);
    $data = is_string($body) && $status === 200 ? json_decode($body, true) : null;
    if (!is_array($data)) {
        error_log('vAMSYS request failed for ' . $url . ' (HTTP ' . $status . ')');
        return null;
    }
    return $data;
}

if (($_SESSION['authenticated'] ?? false) === true) {
    header('Location: /ops/index.php');
    exit;
}

$loginError = null;
if (isset($_GET['code']) || isset($_GET['error'])) {
    $state = $_GET['state'] ?? null;
    $expectedState = $_SESSION['oauth_state'] ?? '';
    $verifier = $_SESSION['oauth_verifier'] ?? '';
    $code = $_GET['code'] ?? null;

    if (!is_string($state) || $expectedState === '' || $verifier === '' || !hash_equals($expectedState, $state)) {
        http_response_code(400);
        exit('The vAMSYS sign-in request has expired or is invalid. Return to the login page and try again.');
    }
    unset($_SESSION['oauth_state'], $_SESSION['oauth_verifier']);

    if (isset($_GET['error']) || !is_string($code) || $code === '') {
        http_response_code(400);
        $loginError = 'vAMSYS sign-in was not completed. Please try again.';
    } else {
        $token = vamsysRequest(VAMSYS_TOKEN_URL, [
            CURLOPT_POST => true,
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/x-www-form-urlencoded'],
            CURLOPT_POSTFIELDS => http_build_query([
                'grant_type' => 'authorization_code',
                'client_id' => VAMSYS_CLIENT_ID,
                'redirect_uri' => VAMSYS_REDIRECT_URI,
                'code' => $code,
                'code_verifier' => $verifier,
            ]),
        ]);
        $accessToken = $token['access_token'] ?? null;
        $user = null;
        if (is_string($accessToken) && $accessToken !== '') {
            $profile = vamsysRequest(VAMSYS_USER_URL, [
                CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: Bearer ' . $accessToken],
            ]);
            $user = $profile['data'] ?? null;
        }

        $pilot = $user['pilot'] ?? null;
        $callsign = $pilot['username'] ?? null;
        if (!is_int($user['id'] ?? null) || !is_int($pilot['id'] ?? null) ||
            !is_string($callsign) || trim($callsign) === '') {
            http_response_code(403);
            $loginError = 'Sign-in failed. Check that your vAMSYS account is linked to this airline and try again.';
        } elseif (!session_regenerate_id(true)) {
            http_response_code(500);
            $loginError = 'The EFB could not start a session. Please try again.';
        } else {
            $name = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? ''));
            $_SESSION['pilot_name'] = $name !== '' ? $name : $callsign;
            $_SESSION['pilot_callsign'] = $callsign;
            $_SESSION['authenticated'] = true;
            header('Location: /ops/index.php', true, 303);
            exit;
        }
    }
}

$_SESSION['oauth_state'] ??= bin2hex(random_bytes(16));
$_SESSION['oauth_verifier'] ??= rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
$codeChallenge = rtrim(strtr(base64_encode(hash('sha256', $_SESSION['oauth_verifier'], true)), '+/', '-_'), '=');

$vamsysLoginUrl = VAMSYS_AUTH_URL . '?' . http_build_query([
    'client_id' => VAMSYS_CLIENT_ID,
    'redirect_uri' => VAMSYS_REDIRECT_URI,
    'response_type' => 'code',
    'scope' => 'identity:basic pilot:read',
    'state' => $_SESSION['oauth_state'],
    'code_challenge' => $codeChallenge,
    'code_challenge_method' => 'S256',
], '', '&', PHP_QUERY_RFC3986);

// Login form: remember the pilot's SimBrief ID for the Flight Folder, then hand off to vAMSYS
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $simbriefId = trim((string)($_POST['simbrief_id'] ?? ''));
    $_SESSION['simbrief_id'] = preg_match('/^[A-Za-z0-9_.-]{1,40}$/D', $simbriefId) ? $simbriefId : '';
    $_SESSION['acars_pref'] = ($_POST['acars_pref'] ?? '') === 'hoppie' ? 'hoppie' : 'none';
    header('Location: ' . $vamsysLoginUrl, true, 303);
    exit;
}

// Hero images: drop .jpg/.png/.webp files into /login-bg and they rotate automatically
$loginImages = array_map(fn($f) => '/login-bg/' . rawurlencode(basename($f)),
    glob(__DIR__ . '/login-bg/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', GLOB_BRACE) ?: []);

$uiManifest = __DIR__ . '/ops/ui/.vite/manifest.json';
$uiCss = is_file($uiManifest) ? (json_decode(file_get_contents($uiManifest), true)['src/main.jsx']['css'] ?? []) : [];
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#eef0f4">
    <title>IJV EFB | EFB Access</title>
    <meta name="description" content="Indonesia Journey Virtual's Electronic Flight Bag: SimBrief dispatch, IJV briefing PDF, NOTAMs, winds aloft, weather and charts for IJV crews.">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Indonesia Journey Virtual">
    <meta property="og:title" content="IJV Electronic Flight Bag">
    <meta property="og:description" content="SimBrief dispatch, IJV briefing PDF, NOTAMs, winds aloft, weather and charts for Indonesia Journey Virtual crews.">
    <meta property="og:url" content="https://efb.ijvirtual.org/">
    <meta property="og:image" content="https://efb.ijvirtual.org/og-image.jpg">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="Garuda Indonesia A330 over Jakarta with the IJV Electronic Flight Bag logo">
    <meta name="twitter:card" content="summary_large_image">
    <script>
        // Same appearance preference as the Flight Deck (light / dark / system)
        (() => {
            let preference = 'system';
            try {
                const stored = localStorage.getItem('ijv-efb-appearance');
                if (stored === 'light' || stored === 'dark') preference = stored;
            } catch {}
            const dark = preference === 'dark' ||
                (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
            document.documentElement.classList.toggle('dark', dark);
            document.querySelector('meta[name="theme-color"]').content = dark ? '#111824' : '#eef0f4';
        })();
    </script>
    <?php foreach ($uiCss as $stylesheet): ?>
        <link rel="stylesheet" href="/ops/ui/<?= htmlspecialchars($stylesheet) ?>">
    <?php endforeach; ?>
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100dvh; background: var(--background, #eef0f4); color: var(--foreground, #13274b);
            font-family: "Inter Variable", Inter, system-ui, sans-serif; }
        .wrapper { min-height: 100dvh; }
        .card { display: flex; flex-direction: column; min-height: 100dvh; background: var(--card, #fff); }
        .col-left { display: flex; flex: 1; flex-direction: column; width: 100%; background: var(--card, #fff); }
        .header { padding: 28px 30px 24px; text-align: center; background: var(--route, #214575); color: #fff; }
        .header img { height: 56px; max-width: 100%; }
        .header h1 { margin: 16px 0 4px; font-size: 20px; font-weight: 700; letter-spacing: 2px; }
        .header p { margin: 0; font-size: 12px; letter-spacing: 2.4px; text-transform: uppercase; color: var(--route-muted, #dae7f9); }
        .form-area { flex: 1; padding: 30px; }
        .form-group { margin-bottom: 20px; }
        .label { display: block; margin-bottom: 6px; font-size: 11.2px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted-foreground, #526279); }
        .hint { margin: 6px 0 0; font-size: 12px; color: var(--muted-foreground, #526279); }
        input, select { width: 100%; padding: 10px; font: inherit; font-size: 14px; color: var(--foreground, #13274b);
            background: var(--muted, #f4f6f9); border: 1px solid var(--border, #dfe4ec); border-radius: 6px; transition: border-color .2s, box-shadow .2s; }
        input:focus, select:focus { outline: none; border-color: var(--ring, #2d5ba5); box-shadow: 0 0 0 1px var(--ring, #2d5ba5); background: var(--card, #fff); }
        .alert { margin-bottom: 20px; padding: 12px 14px; border-radius: 6px; font-size: 14px;
            color: var(--destructive, #a21f36); border: 1px solid currentColor; background: var(--muted, #f4f6f9); }
        .btn-submit { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin-top: 10px; padding: 12px;
            border: 0; border-radius: 4px; font: inherit; font-size: 14px; font-weight: 600; letter-spacing: .03em; cursor: pointer;
            color: var(--primary-foreground, #fff); background: var(--primary, #09295f); transition: filter .2s; }
        .btn-submit:hover { filter: brightness(1.15); }
        .btn-submit:disabled { opacity: .7; cursor: progress; }
        .btn-submit:focus-visible { outline: 2px solid var(--ring, #2d5ba5); outline-offset: 2px; }
        .footer { padding: 15px; text-align: center; font-size: 11px; color: var(--muted-foreground, #526279); background: var(--muted, #f4f6f9); border-top: 1px solid var(--border, #dfe4ec); }
        .footer strong { display: block; margin-bottom: 6px; color: var(--destructive, #a21f36); }
        .col-right { display: none; }
        @media (min-width: 1024px) {
            .wrapper { display: flex; align-items: center; justify-content: center; padding: 20px; }
            .card { flex-direction: row; width: 100%; max-width: 1200px; height: 80vh; min-height: 600px; border-radius: 4px; overflow: hidden;
                box-shadow: 0 25px 50px -12px rgb(0 0 0 / .25); }
            .col-left { width: 35%; border-right: 1px solid var(--border, #dfe4ec); }
            .form-area { overflow-y: auto; }
            .col-right { display: block; position: relative; width: 65%; overflow: hidden; background: var(--route, #214575); }
        }
        .bg { position: absolute; inset: 0; background-size: cover; background-position: center; transition: opacity .5s; }
        /* Soft progressive blur under the hero text, plus the reference's dark left-edge gradient */
        .blur { position: absolute; inset: 0; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
            mask-image: linear-gradient(to top, #000 0%, transparent 40%); -webkit-mask-image: linear-gradient(to top, #000 0%, transparent 40%); }
        .overlay { position: absolute; inset: 0; background: linear-gradient(to left, rgb(0 0 0 / 0), rgb(0 0 0 / .2) 50%, rgb(0 0 0 / .7)); }
        .hero-text { position: absolute; right: 30px; bottom: 30px; text-align: right; color: #fff; }
        .hero-text h2 { margin: 0; font-size: 2.5rem; font-weight: 700; text-shadow: 0 2px 4px rgb(0 0 0 / .5); }
        .hero-text p { margin: 5px 0 0; font-size: .9rem; color: var(--dock-active, #ffa824); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
        @media (prefers-reduced-motion: reduce) { .bg { transition: none; } }
    </style>
</head>
<body>
<div class="wrapper">
    <main class="card">
        <div class="col-left">
            <div class="header">
                <img src="/image_0.png" alt="Indonesia Journey Virtual">
                <h1>EFB ACCESS</h1>
                <p>vAMSYS Pilot Authentication</p>
            </div>
            <div class="form-area">
                <?php if ($loginError !== null): ?>
                    <div class="alert" role="alert"><?= htmlspecialchars($loginError) ?></div>
                <?php endif; ?>
                <form id="login-form" method="post" action="/index.php">
                    <div class="form-group">
                        <label class="label" for="simbrief_id">SimBrief User ID</label>
                        <input id="simbrief_id" name="simbrief_id" placeholder="123456 or username" autocomplete="off" maxlength="40"
                            pattern="[A-Za-z0-9_.\-]+" aria-describedby="simbrief-hint">
                        <p class="hint" id="simbrief-hint">Optional. Used to load your latest dispatch in the Flight Folder.</p>
                    </div>
                    <div class="form-group">
                        <label class="label" for="acars_pref">ACARS Client</label>
                        <select id="acars_pref" name="acars_pref">
                            <option value="none" selected>None / SimBrief Only</option>
                            <option value="hoppie">Hoppie ACARS (SIGMET alerts)</option>
                        </select>
                    </div>
                    <button type="submit" id="submitBtn" class="btn-submit">🔒 Log in with vAMSYS</button>
                </form>
            </div>
            <div class="footer">
                <strong>⚠ For flight simulation use only. Not for real-world navigation or flight operations.</strong>
                © <?= date('Y') ?> Indonesia Journey Virtual. All rights reserved.
            </div>
        </div>
        <div class="col-right" aria-hidden="true">
            <div class="bg" id="bg-rotator"></div>
            <div class="blur"></div>
            <div class="overlay"></div>
            <div class="hero-text">
                <h2>Welcome aboard.</h2>
                <p>Indonesia Journey Virtual</p>
            </div>
        </div>
    </main>
</div>
<script>
    (() => {
        const field = document.getElementById('simbrief_id');
        try { field.value = localStorage.getItem('ijv-efb-simbrief-id') || ''; } catch {}
        document.getElementById('login-form').addEventListener('submit', () => {
            try { localStorage.setItem('ijv-efb-simbrief-id', field.value.trim()); } catch {}
            const btn = document.getElementById('submitBtn');
            btn.disabled = true;
            btn.textContent = 'Redirecting to vAMSYS…';
        });

        const images = <?= json_encode($loginImages, JSON_HEX_TAG | JSON_UNESCAPED_SLASHES) ?>;
        const rotator = document.getElementById('bg-rotator');
        if (!images.length) return;
        let last = -1;
        const show = () => {
            let i = Math.floor(Math.random() * images.length);
            if (images.length > 1 && i === last) i = (i + 1) % images.length;
            last = i;
            rotator.style.opacity = '0.8';
            setTimeout(() => { rotator.style.backgroundImage = `url("${images[i]}")`; rotator.style.opacity = '1'; }, 300);
        };
        // Image side only exists at desktop width; start when it appears so phones never download the photos
        let started = false;
        const start = () => {
            if (started) return;
            started = true;
            show();
            if (images.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(show, 8000);
        };
        const desktop = matchMedia('(min-width: 1024px)');
        if (desktop.matches) start();
        else desktop.addEventListener('change', e => e.matches && start());
    })();
</script>
</body>
</html>
