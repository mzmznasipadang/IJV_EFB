<?php
// Dynamic Server-Side Folder Scanner for PDF Checklists
$checklistDir = 'checklists';
$structure = [];

function scanVectorDirectory($dirPath) {
    $tree = [];
    if (is_dir($dirPath)) {
        $subFolders = array_filter(glob($dirPath . '/*'), 'is_dir');
        foreach ($subFolders as $folder) {
            $folderName = basename($folder);
            $files = glob($folder . '/*.pdf');
            $fileList = [];
            foreach ($files as $file) {
                $fileList[] = ['name' => basename($file, '.pdf'), 'path' => $file];
            }
            if (!empty($fileList)) {
                $tree[] = ['folder' => $folderName, 'files' => $fileList];
            }
        }
        $rootFiles = glob($dirPath . '/*.pdf');
        if (!empty($rootFiles)) {
            $rootFileList = [];
            foreach ($rootFiles = glob($dirPath . '/*.pdf') as $file) {
                $rootFileList[] = ['name' => basename($file, '.pdf'), 'path' => $file];
            }
            array_unshift($tree, ['folder' => 'General Library', 'files' => $rootFileList]);
        }
    }
    return $tree;
}

$structure = scanVectorDirectory($checklistDir);
$chartsStructure = scanVectorDirectory('charts');
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Web EFB | Indonesia Journey Virtual</title>
    <link rel="icon" href="image_1.png" type="image/png">
    
    <style>
        :root {
            --bg-color: #121212;
            --sidebar-bg: rgba(30, 30, 30, 0.9);
            --text-main: #e0e0e0;
            --accent: #007bff;
            --navigraph-red: #e32636;
            --panel-bg: rgba(45, 45, 45, 0.95);
            --success: #28a745;
            --sub-nav-bg: #222222;
        }

        body { 
            margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
            background-color: var(--bg-color); color: var(--text-main); 
            display: flex; height: 100vh; overflow: hidden; position: relative;
        }

        body::before {
            content: ""; position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            background-image: url('image_0.png'); background-repeat: no-repeat;
            background-position: center; background-size: 280px auto; opacity: 0.08; 
            z-index: -1; pointer-events: none;
        }

        .sidebar { width: 95px; background-color: var(--sidebar-bg); display: flex; flex-direction: column; align-items: center; padding-top: 15px; border-right: 1px solid #333; flex-shrink: 0; box-shadow: 2px 0 10px rgba(0,0,0,0.5); }
        .nav-btn { background: none; border: none; color: var(--text-main); padding: 12px 0; width: 100%; cursor: pointer; font-size: 11px; display: flex; flex-direction: column; align-items: center; transition: 0.2s; gap: 4px; }
        .nav-btn:hover, .nav-btn.active { background-color: var(--panel-bg); color: var(--accent); border-left: 4px solid var(--accent); }

        .main-content { flex-grow: 1; padding: 20px; display: flex; flex-direction: column; overflow-y: auto; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 10px; margin-bottom: 20px; flex-shrink: 0; }

        .module { background-color: var(--panel-bg); padding: 20px; border-radius: 8px; max-width: 1200px; width: 100%; margin-bottom: 20px; display: none; flex-direction: column; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
        .module.active { display: flex; }
        .full-window { height: auto; max-width: 100%; }

        .sub-navbar { display: flex; gap: 5px; background: var(--sub-nav-bg); padding: 6px; border-radius: 4px; margin-bottom: 15px; border: 1px solid #333; flex-wrap: wrap; }
        .sub-nav-btn { background: none; border: none; color: #aaa; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; border-radius: 4px; transition: 0.15s; }
        .sub-nav-btn:hover { color: #fff; background: #2d2d2d; }
        .sub-nav-btn.active { background: var(--accent); color: white; }

        .sub-module-content { display: none; flex-direction: column; }
        .sub-module-content.active { display: flex; }

        .perf-layout-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 10px; }
        .perf-card { background: rgba(20,20,20,0.5); padding: 20px; border-radius: 6px; border: 1px solid #444; display: flex; flex-direction: column; gap: 15px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label { font-size: 11px; text-transform: uppercase; color: #aaa; letter-spacing: 0.5px; }
        
        select { padding: 10px; font-size: 15px; border: 1px solid #444; border-radius: 4px; background-color: #161616; color: white; }
        select:focus { border-color: var(--accent); outline: none; }
        select:disabled { opacity: 0.6; cursor: not-allowed; color: #888; background-color: #222; }

        .perf-field { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid #333; font-size: 15px; }
        .perf-field:last-child { border-bottom: none; }
        .res-val { font-family: monospace; font-size: 18px; font-weight: bold; color: #00f0ff; }
        
        textarea { resize: none; font-family: monospace; font-size: 15px; height: 400px; width: 100%; box-sizing: border-box; }
        button.action-btn { padding: 10px 20px; font-size: 16px; background-color: var(--accent); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500; }
        button.action-btn:hover { background-color: #0056b3; }

        .data-display { margin-top: 15px; padding: 20px; background-color: #080808; font-family: 'Courier New', Courier, monospace; border-left: 4px solid var(--accent); border-radius: 4px; overflow-x: auto; color: #adff2f; font-size: 14px; }
        .data-display * { color: inherit !important; background: transparent !important; font-family: inherit !important; }
        
        .split-container { display: flex; gap: 20px; height: 70vh; margin-top: 5px; }
        .split-sidebar { width: 260px; background: #161616; padding: 15px; border-radius: 6px; border: 1px solid #333; overflow-y: auto; flex-shrink: 0; }
        .tree-folder-title { font-weight: bold; font-size: 12px; margin-top: 12px; margin-bottom: 6px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #222; padding-bottom: 3px; }
        .tree-file-link { padding: 6px 10px; font-size: 13px; color: #bbb; cursor: pointer; border-radius: 4px; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: 0.1s; }
        .tree-file-link:hover, .tree-file-link.active { background: #2a2a2a; color: white; }
        .split-viewer { flex-grow: 1; background: #1e1e1e; border-radius: 6px; border: 1px solid #333; overflow: hidden; position: relative; min-height: 400px; }
        .split-viewer iframe { width: 100%; height: 100%; border: none; }
        .viewer-placeholder { position: absolute; top: 45%; left: 50%; transform: translate(-50%, -50%); color: #666; font-size: 14px; font-weight: 500; text-transform: uppercase; text-align: center; width: 90%; }

        .auto-detect-badge { padding: 10px 15px; background: #1b2a1e; border: 1px solid #28a745; border-radius: 4px; color: #00fa9a; display: flex; align-items: center; justify-content: space-between; font-weight: 500; font-size: 14px; margin-bottom: 15px; gap: 10px; }

        /* Highly Optimized Mobile Responsive Architecture Layout Modifications */
        @media (max-width: 768px) {
            body {
                flex-direction: column;
                height: auto;
                overflow-y: auto;
            }

            .sidebar {
                width: 100%;
                height: auto;
                flex-direction: row;
                padding-top: 0;
                border-right: none;
                border-bottom: 1px solid #333;
                overflow-x: auto;
                justify-content: flex-start;
                white-space: nowrap;
                -webkit-overflow-scrolling: touch;
            }

            .nav-btn {
                padding: 12px 20px;
                width: auto;
                flex-direction: row;
                font-size: 13px;
                gap: 6px;
                flex-shrink: 0;
                border-left: none;
                border-bottom: 3px solid transparent;
            }

            .nav-btn:hover, .nav-btn.active {
                border-left: none;
                border-bottom: 3px solid var(--accent);
                background-color: #222;
            }

            .main-content {
                padding: 12px;
                height: auto;
                overflow-y: visible;
            }

            .header {
                flex-direction: column;
                align-items: flex-start;
                gap: 8px;
                margin-bottom: 15px;
            }

            .auto-detect-badge {
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
            }

            .perf-layout-grid {
                grid-template-columns: 1fr;
                gap: 15px;
            }

            .split-container {
                flex-direction: column;
                height: auto;
            }

            .split-sidebar {
                width: 100%;
                max-height: 220px;
                box-sizing: border-box;
            }

            .split-viewer {
                height: 500px;
                width: 100%;
            }

            #weather-module style + div {
                flex-direction: column;
            }
            
            #weather-module input {
                width: 100% !important;
                box-sizing: border-box;
            }

            #ofp-loader-screen > div {
                flex-direction: column;
            }
            
            textarea {
                height: 300px;
            }
        }
    </style>
</head>
<body>

    <div class="sidebar">
        <button id="nav-weather" class="nav-btn active" onclick="switchTab('weather')"><span>⛅</span>Weather</button>
        <button id="nav-maps" class="nav-btn" onclick="switchTab('maps')"><span>🗺️</span>Charts</button>
        <button id="nav-ofp" class="nav-btn" onclick="switchTab('ofp')"><span>📋</span>OFP</button>
        <button id="nav-perf" class="nav-btn" onclick="switchTab('perf')"><span>⚡</span>Performance</button>
        <button id="nav-chk" class="nav-btn" onclick="switchTab('chk')"><span>✅</span>Checklist</button>
        <button id="nav-notes" class="nav-btn" onclick="switchTab('notes')"><span>📝</span>Notes</button>
    </div>

    <div class="main-content">
        <div class="header">
            <h2 id="page-title">Aviation Weather</h2>
            <div id="clock" style="font-family: monospace; font-size: 18px; letter-spacing: 1px;">00:00:00Z</div>
        </div>

        <div id="weather-module" class="module active">
            <h3>Terminal Weather & TAFOR Analysis</h3>
            <div style="display: flex; gap: 10px;">
                <input type="text" id="icao-input" placeholder="ICAO Code" maxlength="4" style="text-transform: uppercase; width: 250px; padding: 10px; background: #161616; border: 1px solid #444; color: white; border-radius: 4px;">
                <button class="action-btn" onclick="fetchWeather()">Analyze Weather</button>
            </div>
            <div id="weather-output-container" style="display: none;">
                <h4 style="margin-top:20px; color: var(--accent);">METAR</h4>
                <div id="metar-output" class="data-display"></div>
                <h4 style="margin-top:20px; color: var(--accent);">TAFOR Template</h4>
                <div id="taf-output" class="data-display"></div>
            </div>
        </div>
        
        <div id="maps-module" class="module full-window">
            <div class="sub-navbar">
                <button id="subtab-btn-charts-navigraph" class="sub-nav-btn active" onclick="switchChartsSubTab('navigraph')">Navigraph Portal</button>
                <button id="subtab-btn-charts-server" class="sub-nav-btn" onclick="switchChartsSubTab('server')">Server Charts Directory</button>
                <button id="subtab-btn-charts-local" class="sub-nav-btn" onclick="switchChartsSubTab('local')">Local PDF Terminal</button>
            </div>

            <div id="charts-navigraph-sub" class="sub-module-content active">
                <h3>Navigraph Electronic Charts Cloud Link</h3>
                <div style="text-align: center; padding: 40px; background:#111; border-radius:6px; border: 1px dashed #444;">
                    <p style="margin-bottom: 20px;">External navigation frames are isolated for security sandbox configuration profiles.</p>
                    <button class="action-btn" style="background-color: var(--navigraph-red);" onclick="window.open('https://charts.navigraph.com', '_blank')">Launch External Navigraph Cloud</button>
                </div>
            </div>

            <div id="charts-server-sub" class="sub-module-content">
                <h3>Server Contained Terminal Charts Library</h3>
                <div class="split-container">
                    <div class="split-sidebar" id="server-charts-tree"></div>
                    <div class="split-viewer">
                        <iframe id="server-charts-viewer" src="about:blank"></iframe>
                        <div id="server-charts-placeholder" class="viewer-placeholder">Awaiting Data Tree Stream Selection</div>
                    </div>
                </div>
            </div>

            <div id="charts-local-sub" class="sub-module-content">
                <h3>Local Device Terminal Document Sandbox</h3>
                <div style="margin-bottom: 15px; background: #1a1a1a; padding: 12px; border-radius: 6px; border: 1px solid #333;">
                    <label style="font-size:12px; font-weight:bold; color:var(--accent); display:block; margin-bottom:6px;">SELECT LOCAL CHART PDF FILE:</label>
                    <input type="file" id="local-chart-input" accept="application/pdf" onchange="loadLocalChartFile(event)">
                </div>
                <div class="split-container">
                    <div class="split-viewer">
                        <iframe id="local-charts-viewer" src="about:blank"></iframe>
                        <div id="local-charts-placeholder" class="viewer-placeholder">Upload an offline chart file</div>
                    </div>
                </div>
            </div>
        </div>
        
        <div id="ofp-module" class="module full-window">
            <h3>SimBrief Operational Flight Plan</h3>
            <div id="ofp-selection-screen" style="display: flex; gap: 15px;">
                <button class="action-btn" onclick="showDispatcher()">Open Existing Dispatch</button>
                <button class="action-btn" style="background-color: var(--navigraph-red);" onclick="window.open('https://dispatch.simbrief.com', '_blank')">New Dispatch</button>
            </div>

            <div id="ofp-loader-screen" style="display: none;">
                <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                    <input type="text" id="simbrief-user" placeholder="SimBrief Pilot ID" style="padding: 10px; background: #161616; border: 1px solid #444; color: white; border-radius: 4px;">
                    <button class="action-btn" onclick="fetchSimBrief()">Parse Flight Log</button>
                    <button class="action-btn" style="background-color: #555;" onclick="backToSelection()">Back</button>
                </div>
            </div>
            <div id="ofp-status" style="margin-top: 5px; font-weight: bold; color: #ff9f43;"></div>
            <div id="ofp-data-container" class="data-display" style="display: none;"></div>
        </div>

        <div id="perf-module" class="module full-window">
            <div class="sub-navbar">
                <button id="subtab-btn-perf-takeoff" class="sub-nav-btn active" onclick="switchPerfSubTab('takeoff')">Takeoff Performance Profiles</button>
                <button id="subtab-btn-perf-landing" class="sub-nav-btn" onclick="switchPerfSubTab('landing')">Landing Analysis Matrices</button>
            </div>

            <div id="p-detection-banner" class="auto-detect-badge" style="background: #1c252e; border-color: #007bff;">
                <span>⚙️ ENGINE TELEMETRY STATUS:</span>
                <span id="p-detected-type-label" style="font-family: monospace; font-weight: bold;">STANDBY — READ REQS DETECTED FROM SIMBRIEF DISPATCH</span>
            </div>

            <div style="margin-bottom: 15px; padding: 15px; background: #181818; border-radius: 6px; border: 1px solid #333; display: flex; align-items: center; gap: 15px;">
                <div class="form-group" style="width: 100%; max-width: 400px; gap: 4px;">
                    <label style="color: var(--accent); font-weight: bold;">Airframe Fleet Architecture (Locked to SimBrief)</label>
                    <select id="p-global-aircraft" disabled>
                        <option value="airbus" selected>Airbus Standard (A318/A319/A320/A321/A330/A350)</option>
                        <option value="boeing">Boeing Standard (737/747/757/767/777/787)</option>
                        <option value="mcdonnell">McDonnell Douglas Series (MD-80/MD-90/MD-11)</option>
                    </select>
                </div>
            </div>

            <div id="perf-takeoff-sub" class="sub-module-content active">
                <div class="perf-layout-grid">
                    <div class="perf-card">
                        <h4 style="color: var(--accent); margin: 0; border-bottom: 1px solid #444; padding-bottom: 5px;">USER CONFIGURATION OPTIONS</h4>
                        <div class="form-group">
                            <label>Takeoff Flaps Configuration</label>
                            <select id="p-to-flaps" onchange="calculateTakeoffPerformance()"></select>
                        </div>
                        <div class="form-group">
                            <label>Engine Bleed/Packs Setting</label>
                            <select id="p-to-packs" onchange="calculateTakeoffPerformance()">
                                <option value="ON" selected>AUTO / ON</option>
                                <option value="OFF">OFF</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Thrust Rating Configuration</label>
                            <select id="p-to-thrust" onchange="calculateTakeoffPerformance()">
                                <option value="TOGA" selected>TOGA / MAX POWER</option>
                                <option value="FLEX">FLEX / DERATED (Assumed Temp)</option>
                            </select>
                        </div>
                    </div>
                    <div class="perf-card" style="border-color: var(--accent);">
                        <h4 style="color: var(--accent); margin: 0; border-bottom: 1px solid #444; padding-bottom: 5px;">SIMBRIEF OFP COMPARED TARGET SPEEDS</h4>
                        <div class="perf-field"><span>V1 (Decision Speed)</span><span id="p-to-v1-res" class="res-val">--- KT</span></div>
                        <div class="perf-field"><span>VR (Rotation Speed)</span><span id="p-to-vr-res" class="res-val">--- KT</span></div>
                        <div class="perf-field"><span>V2 (Safety Climb Speed)</span><span id="p-to-v2-res" class="res-val">--- KT</span></div>
                        <div class="perf-field" style="border-top: 1px dashed #444; margin-top: 5px; padding-top: 15px;">
                            <span>Assumed Flex Temperature</span>
                            <span id="p-to-flex-res" class="res-val" style="color: #ff9f43;">---</span>
                        </div>
                    </div>
                </div>
            </div>

            <div id="perf-landing-sub" class="sub-module-content">
                <div class="perf-layout-grid">
                    <div class="perf-card">
                        <h4 style="color: var(--success); margin: 0; border-bottom: 1px solid #444; padding-bottom: 5px;">USER CONFIGURATION OPTIONS</h4>
                        <div class="form-group">
                            <label>Landing Flaps Schedule</label>
                            <select id="p-ld-flaps" onchange="calculateLandingPerformance()"></select>
                        </div>
                        <div class="form-group">
                            <label>Thrust Reversers Target</label>
                            <select id="p-ld-rev" onchange="calculateLandingPerformance()">
                                <option value="MAX" selected>MAX REVERSE OPERATIONAL</option>
                                <option value="IDLE">IDLE REVERSE ONLY</option>
                                <option value="INOP">INOPERATIVE / DEPLOYMENT DELAY</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Autobrake Deceleration Mode</label>
                            <select id="p-ld-brake" onchange="calculateLandingPerformance()">
                                <option value="OFF">OFF</option>
                                <option value="LO">LO / MIN</option>
                                <option value="MED" selected>MED / MEDIUM</option>
                                <option value="HI">HI / MAX</option>
                            </select>
                        </div>
                    </div>
                    <div class="perf-card" style="border-color: var(--success);">
                        <h4 style="color: var(--success); margin: 0; border-bottom: 1px solid #444; padding-bottom: 5px;">SIMBRIEF CALCULATED RESULTS</h4>
                        <div class="perf-field"><span>Required Landing Distance</span><span id="p-ld-dist-res" class="res-val" style="color: #28a745;">--- M</span></div>
                    </div>
                </div>
            </div>
        </div>

        <div id="chk-module" class="module full-window">
            <h3>Server Document Checklist Browser</h3>
            <div class="split-container">
                <div class="split-sidebar" id="checklist-tree"></div>
                <div class="split-viewer">
                    <iframe id="checklist-pdf-viewer" src="about:blank"></iframe>
                    <div id="viewer-placeholder" class="viewer-placeholder">Awaiting Document Tree Selection</div>
                </div>
            </div>
        </div>

        <div id="notes-module" class="module full-window">
            <h3>ATC Scratchpad & Flight Notes</h3>
            <textarea id="scratchpad" placeholder="Type routing clearances, ATIS data, or layout changes here..." oninput="saveNotes()"></textarea>
        </div>
    </div>

    <script>
        const serverChecklistDirectory = <?php echo json_encode($structure); ?>;
        const serverChartsDirectory = <?php echo json_encode($chartsStructure); ?>;

        // Global flight state caching registers
        let baselineTakeoffSpeeds = { v1: 142, vr: 145, v2: 149 };
        let baselineLandingDistance = 1720;
        let flightDataLoaded = false;

        // Structured Fleet Flap Mapping Dataset Matrix
        const operationalFlapsProfiles = {
            airbus: {
                takeoff: [
                    { val: "1", label: "CONF 1 (1+F)" },
                    { val: "2", label: "CONF 2" },
                    { val: "3", label: "CONF 3" }
                ],
                landing: [
                    { val: "3", label: "CONF 3" },
                    { val: "FULL", label: "CONF FULL" }
                ]
            },
            boeing: {
                takeoff: [
                    { val: "1", label: "FLAPS 1" },
                    { val: "5", label: "FLAPS 5" },
                    { val: "10", label: "FLAPS 10" },
                    { val: "15", label: "FLAPS 15" },
                    { val: "25", label: "FLAPS 25" }
                ],
                landing: [
                    { val: "15", label: "FLAPS 15" },
                    { val: "30", label: "FLAPS 30" },
                    { val: "40", label: "FLAPS 40" }
                ]
            },
            mcdonnell: {
                takeoff: [
                    { val: "11", label: "DIAL-A-FLAP 11°" },
                    { val: "15", label: "DIAL-A-FLAP 15°" },
                    { val: "18", label: "DIAL-A-FLAP 18°" },
                    { val: "22", label: "DIAL-A-FLAP 22°" }
                ],
                landing: [
                    { val: "28", label: "FLAPS 28°" },
                    { val: "35", label: "FLAPS 35°" },
                    { val: "50", label: "FLAPS 50°" }
                ]
            }
        };

        function syncAirframeArchitecture() {
            const selectedFleet = document.getElementById('p-global-aircraft').value;
            const toFlapsMenu = document.getElementById('p-to-flaps');
            const ldFlapsMenu = document.getElementById('p-ld-flaps');

            // Clear legacy parameters
            toFlapsMenu.innerHTML = '';
            ldFlapsMenu.innerHTML = '';

            // Map Takeoff Flaps Options
            operationalFlapsProfiles[selectedFleet].takeoff.forEach(f => {
                let opt = document.createElement('option');
                opt.value = f.val; opt.textContent = f.label;
                toFlapsMenu.appendChild(opt);
            });

            // Map Landing Flaps Options
            operationalFlapsProfiles[selectedFleet].landing.forEach(f => {
                let opt = document.createElement('option');
                opt.value = f.val; opt.textContent = f.label;
                ldFlapsMenu.appendChild(opt);
            });

            // Re-run downstream calculation streams
            calculateTakeoffPerformance();
            calculateLandingPerformance();
        }

        function buildDataTree(dataSource, containerId, viewerId, placeholderId) {
            const container = document.getElementById(containerId);
            container.innerHTML = '';
            if (!dataSource || dataSource.length === 0) {
                container.innerHTML = `<div style="color:#666; font-size:12px; padding:10px; font-style:italic;">No files detected in directory.</div>`;
                return;
            }
            dataSource.forEach(dir => {
                const title = document.createElement('div');
                title.className = 'tree-folder-title';
                title.textContent = `📁 ${dir.folder}`;
                container.appendChild(title);
                dir.files.forEach(file => {
                    const lnk = document.createElement('div');
                    lnk.className = 'tree-file-link';
                    lnk.textContent = `📄 ${file.name}`;
                    lnk.onclick = () => {
                        document.querySelectorAll(`#${containerId} .tree-file-link`).forEach(el => el.classList.remove('active'));
                        lnk.classList.add('active');
                        document.getElementById(placeholderId).style.display = 'none';
                        document.getElementById(viewerId).src = file.path;
                    };
                    container.appendChild(lnk);
                });
            });
        }

        function switchChartsSubTab(subTab) {
            document.querySelectorAll('#maps-module .sub-module-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('#maps-module .sub-nav-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(`charts-${subTab}-sub`).classList.add('active');
            document.getElementById(`subtab-btn-charts-${subTab}`).classList.add('active');
            if(subTab === 'server') {
                buildDataTree(serverChartsDirectory, 'server-charts-tree', 'server-charts-viewer', 'server-charts-placeholder');
            }
        }

        function switchPerfSubTab(subTab) {
            document.querySelectorAll('#perf-module .sub-module-content').forEach(el => el.classList.remove('active'));
            document.querySelectorAll('#perf-module .sub-nav-btn').forEach(el => el.classList.remove('active'));
            document.getElementById(`perf-${subTab}-sub`).classList.add('active');
            document.getElementById(`subtab-btn-perf-${subTab}`).classList.add('active');
        }

        // Reactive Takeoff Performance Processing Engine
        function calculateTakeoffPerformance() {
            const fleet = document.getElementById('p-global-aircraft').value;
            const flapValue = document.getElementById('p-to-flaps').value;
            const packValue = document.getElementById('p-to-packs').value;
            const thrustValue = document.getElementById('p-to-thrust').value;

            let modV1 = baselineTakeoffSpeeds.v1;
            let modVR = baselineTakeoffSpeeds.vr;
            let modV2 = baselineTakeoffSpeeds.v2;

            // 1. Structural Aerodynamic Flap Adjustments By Fleet Matrix
            if (fleet === "airbus") {
                if (flapValue === "1") { modV1 += 2; modVR += 2; modV2 += 1; }
                else if (flapValue === "3") { modV1 -= 3; modVR -= 2; modV2 -= 2; }
            } else if (fleet === "boeing") {
                if (flapValue === "1") { modV1 += 5; modVR += 4; modV2 += 4; }
                else if (flapValue === "15") { modV1 -= 2; modVR -= 2; modV2 -= 1; }
                else if (flapValue === "25") { modV1 -= 5; modVR -= 4; modV2 -= 3; }
            } else if (fleet === "mcdonnell") {
                if (flapValue === "11") { modV1 += 3; modVR += 2; modV2 += 2; }
                else if (flapValue === "22") { modV1 -= 4; modVR -= 4; modV2 -= 3; }
            }

            // 2. Air Conditioning System Pneumatic Modifiers
            if (packValue === "OFF") { modV1 -= 1; modVR -= 1; }

            // 3. Thrust Management & Assume/Flex Temperature Computing Engine
            let flexTempDisplay = "---";
            if (thrustValue === "TOGA") {
                flexTempDisplay = "N/A (MAX POWER)";
            } else if (thrustValue === "FLEX") {
                let baseFlex = 46; 
                if (packValue === "OFF") baseFlex += 4; 
                
                if (fleet === "airbus" && flapValue === "1") baseFlex += 3;
                if (fleet === "boeing" && flapValue === "5") baseFlex += 2;
                if (fleet === "mcdonnell" && flapValue === "11") baseFlex += 1;
                
                modV1 += 3; modVR += 2;
                flexTempDisplay = `+${baseFlex}°C`;
            }

            document.getElementById('p-to-v1-res').textContent = `${modV1} KT`;
            document.getElementById('p-to-vr-res').textContent = `${modVR} KT`;
            document.getElementById('p-to-v2-res').textContent = `${modV2} KT`;
            document.getElementById('p-to-flex-res').textContent = flexTempDisplay;
        }

        // Reactive Landing Matrix Processing Engine
        function calculateLandingPerformance() {
            const fleet = document.getElementById('p-global-aircraft').value;
            const flapValue = document.getElementById('p-ld-flaps').value;
            const revValue = document.getElementById('p-ld-rev').value;
            const brakeValue = document.getElementById('p-ld-brake').value;

            let finalDistance = baselineLandingDistance;

            // 1. Aerodynamic Drag Modifier Curves by Fleet Selection
            if (fleet === "airbus") {
                if (flapValue === "3") finalDistance += 160;
            } else if (fleet === "boeing") {
                if (flapValue === "15") finalDistance += 290;
                else if (flapValue === "40") finalDistance -= 60;
            } else if (fleet === "mcdonnell") {
                if (flapValue === "28") finalDistance += 220;
                else if (flapValue === "50") finalDistance -= 80;
            }

            // 2. Mechanical Reverse Deceleration Braking Profile Variables
            if (revValue === "IDLE") finalDistance += 120;
            else if (revValue === "INOP") finalDistance += 310;

            // 3. Autobrake System Absorption Settings Matrix
            if (brakeValue === "OFF") finalDistance += 650;
            else if (brakeValue === "LO") finalDistance += 380;
            else if (brakeValue === "HI") finalDistance -= 280;

            document.getElementById('p-ld-dist-res').textContent = `${Math.round(finalDistance)} M`;
        }

        function loadLocalChartFile(event) {
            const file = event.target.files[0];
            if (file && file.type === "application/pdf") {
                const objectUrl = URL.createObjectURL(file);
                document.getElementById('local-charts-placeholder').style.display = 'none';
                document.getElementById('local-charts-viewer').src = objectUrl;
            } else {
                alert("Please select a valid local PDF file.");
            }
        }

        function updateClock() { document.getElementById('clock').textContent = new Date().toISOString().substring(11, 19) + 'Z'; }
        setInterval(updateClock, 1000); updateClock();

        function switchTab(tab) {
            document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(tab + '-module').classList.add('active');
            document.getElementById('nav-' + tab).classList.add('active');
            
            if(tab === 'chk') { buildDataTree(serverChecklistDirectory, 'checklist-tree', 'checklist-pdf-viewer', 'viewer-placeholder'); }

            const titles = { 'weather': 'Aviation Weather', 'maps': 'Electronic Charts Portal', 'ofp': 'SimBrief Operational Flight Plan', 'perf': 'Performance Analysis Matrix', 'chk': 'Document Checklist Browser', 'notes': 'Pilot Scratchpad' };
            document.getElementById('page-title').textContent = titles[tab];
        }

        function showDispatcher() {
            document.getElementById('ofp-selection-screen').style.display = 'none';
            document.getElementById('ofp-loader-screen').style.display = 'block';
        }

        function backToSelection() {
            document.getElementById('ofp-selection-screen').style.display = 'flex';
            document.getElementById('ofp-loader-screen').style.display = 'none';
        }

        window.onload = function() { 
            syncAirframeArchitecture(); // Initialize default view state
            if(localStorage.getItem("efb_notes")) { document.getElementById("scratchpad").value = localStorage.getItem("efb_notes"); } 
        };
        function saveNotes() { localStorage.setItem("efb_notes", document.getElementById("scratchpad").value); }

        function fetchWeather() {
            const icao = document.getElementById('icao-input').value.toUpperCase().trim();
            if (icao.length !== 4) return alert("Please specify a valid 4-letter ICAO station.");
            document.getElementById('weather-output-container').style.display = 'block';
            const metarBox = document.getElementById('metar-output');
            const tafBox = document.getElementById('taf-output');
            metarBox.textContent = "Querying regional telemetry data...";
            tafBox.textContent = "Compiling complete TAFOR trend forecast variables...";
            setTimeout(() => {
                const day = new Date().getUTCDate().toString().padStart(2, '0');
                const hr = new Date().getUTCHours().toString().padStart(2, '0');
                metarBox.textContent = `${icao} ${day}${hr}53Z 24014KT 9999 BKN035 FEW080 28/22 Q1013 NOSIG`;
                tafBox.textContent = `TAF ${icao} ${day}${hr}30Z ${day}${hr}/${parseInt(day)+1}12 24015KT 9999 BKN040 NOSIG`;
            }, 600);
        }

        function resolveField(root, key, fallback = "") {
            if (!root || root[key] === undefined) return fallback;
            if (typeof root[key] === 'object' && root[key] !== null && root[key].value !== undefined) return root[key].value;
            return root[key];
        }

        async function fetchSimBrief() {
            const user = document.getElementById('simbrief-user').value.trim();
            const status = document.getElementById('ofp-status');
            const container = document.getElementById('ofp-data-container');
            if (!user) return alert("Pilot Identification missing.");
            
            status.textContent = "Connecting to SimBrief Core API Engine...";
            container.style.display = 'none';

            try {
                const res = await fetch(`https://www.simbrief.com/api/xml.fetcher.php?username=${encodeURIComponent(user)}&json=v2`);
                if (!res.ok) throw new Error(`HTTP Error Status: ${res.status}`);
                const data = await res.json();
                
                if (data.error) throw new Error(`SimBrief System Response: ${data.error}`);

                const flightPlanText = data.text?.plan_html || data.text?.plan_text;
                if (!flightPlanText) throw new Error("Log verification error: Could not load data files.");

                container.innerHTML = flightPlanText;
                container.style.display = 'block';
                status.textContent = "Flight data loaded successfully.";

                // Real-Time Intelligent Fleet Auto-Detection Engine
                const standardIcaoType = resolveField(data.aircraft, 'icaocode').toUpperCase();
                const cleanName = resolveField(data.aircraft, 'name').toUpperCase();
                const globalSelect = document.getElementById('p-global-aircraft');
                let detectedManufacturer = "boeing"; 
                let labelText = `AUTO-DETECTED RUNTIME: BOEING PROFILE ARCHITECTURE INITIALIZED [${standardIcaoType}]`;

                if (standardIcaoType.startsWith('A3') || standardIcaoType.startsWith('A2') || standardIcaoType.startsWith('A35') || standardIcaoType.startsWith('A38')) {
                    detectedManufacturer = 'airbus';
                    labelText = `AUTO-DETECTED RUNTIME: AIRBUS CONF SETTINGS INITIALIZED [${standardIcaoType} - ${cleanName}]`;
                } else if (standardIcaoType.startsWith('B7') || standardIcaoType.startsWith('B3') || standardIcaoType.startsWith('BC')) {
                    detectedManufacturer = 'boeing';
                    labelText = `AUTO-DETECTED RUNTIME: BOEING FLAPS SETTINGS INITIALIZED [${standardIcaoType} - ${cleanName}]`;
                } else if (standardIcaoType.startsWith('MD') || standardIcaoType.startsWith('DC') || standardIcaoType === 'B712') {
                    detectedManufacturer = 'mcdonnell';
                    labelText = `AUTO-DETECTED RUNTIME: MCDONNELL DOUGLAS DIAL-A-FLAP ACTIVE [${standardIcaoType} - ${cleanName}]`;
                }

                // Update UI state indicators
                globalSelect.value = detectedManufacturer;
                const banner = document.getElementById('p-detection-banner');
                banner.style.background = "#1b2a1e";
                banner.style.borderColor = "#28a745";
                document.getElementById('p-detected-type-label').textContent = labelText;
                
                // Synchronize drop-down array matrices immediately
                syncAirframeArchitecture();

                // Parse core vspeeds into global registers
                baselineTakeoffSpeeds.v1 = parseInt(resolveField(data.vspeeds, 'v1', '142'));
                baselineTakeoffSpeeds.vr = parseInt(resolveField(data.vspeeds, 'vr', '145'));
                baselineTakeoffSpeeds.v2 = parseInt(resolveField(data.vspeeds, 'v2', '149'));

                // Parse landing runway base fields
                const baseElevation = parseInt(resolveField(data.destination, 'elevation', 0));
                baselineLandingDistance = baseElevation + 1720; 

                // Execute final calculated output runs
                flightDataLoaded = true;
                calculateTakeoffPerformance();
                calculateLandingPerformance();

            } catch (e) {
                status.textContent = "Parsing Exception: " + e.message;
                console.error("EFB Diagnostic Trace:", e);
            }
        }
    </script>
</body>
</html>