export const forecastFields = [
    'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'visibility',
    'weather_code', 'cloud_cover', 'temperature_2m', 'dew_point_2m', 'pressure_msl',
];

const metarWeatherCodes = {
    45: "FG", 48: "FZFG", 51: "-DZ", 53: "DZ", 55: "+DZ", 56: "-FZDZ", 57: "+FZDZ",
    61: "-RA", 63: "RA", 65: "+RA", 66: "-FZRA", 67: "+FZRA", 71: "-SN", 73: "SN",
    75: "+SN", 77: "SG", 80: "-SHRA", 81: "SHRA", 82: "+SHRA",
    85: "-SHSN", 86: "+SHSN", 95: "TS", 96: "TSGR", 97: "TS", 99: "+TSGR",
};

export function formatOpenMeteoForecast(icao, hourly) {
    if (!Array.isArray(hourly?.time)) return [];

    const pad = (value, width) => String(value).padStart(width, '0');
    const temperature = value => value === null ? '//' :
        (value < 0 ? 'M' : '') + pad(Math.abs(Math.round(value)), 2);

    const lines = [];
    for (const [index, time] of hourly.time.entries()) {
        if (typeof time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) continue;

        const value = field => {
            const sample = hourly[field]?.[index];
            return Number.isFinite(sample) ? sample : null;
        };
        if (!forecastFields.some(field => value(field) !== null)) continue;

        const stamp = time.slice(8, 10) + time.slice(11, 13) + time.slice(14, 16) + 'Z';
        const speed = value('wind_speed_10m');
        const direction = value('wind_direction_10m');
        const gust = value('wind_gusts_10m');
        let wind = '/////KT';
        if (speed !== null) {
            const speedKt = Math.round(speed);
            const directionGroup = direction === null ? '///' : pad((Math.round(direction / 10) * 10) || 360, 3);
            const gustGroup = gust !== null && Math.round(gust) - speedKt >= 10 ? 'G' + pad(Math.round(gust), 2) : '';
            wind = speedKt === 0 && !gustGroup ? '00000KT' : directionGroup + pad(speedKt, 2) + gustGroup + 'KT';
        }

        const visibility = value('visibility');
        const visibilityStep = visibility < 800 ? 50 : visibility < 5000 ? 100 : 1000;
        const vis = visibility === null ? '////' : visibility >= 10000 ? '9999' :
            pad(Math.floor(visibility / visibilityStep) * visibilityStep, 4);

        const cover = value('cloud_cover');
        let cloud = '//////';
        if (cover === 0) {
            cloud = 'SKC';
        } else if (cover !== null) {
            // Total cloud cover estimates amount. The model provides no cloud base for this group.
            const oktas = Math.round(cover * 8 / 100);
            const amount = cover === 100 ? 'OVC' : oktas <= 2 ? 'FEW' : oktas <= 4 ? 'SCT' : 'BKN';
            cloud = amount + '///';
        }

        const temp = temperature(value('temperature_2m')) + '/' + temperature(value('dew_point_2m'));
        const pressure = value('pressure_msl');
        const altimeter = pressure === null ? 'Q////' : 'Q' + pad(Math.floor(pressure), 4);
        lines.push([icao, stamp, wind, vis, metarWeatherCodes[value('weather_code')], cloud, temp,
            altimeter, 'RMK OPEN-METEO FORECAST'].filter(Boolean).join(' '));
    }
    return lines;
}
