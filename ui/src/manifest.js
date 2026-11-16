const indoMaleFirst = ["Budi", "Joko", "Agus", "Andi", "Rizky", "Aditya", "Pratama", "Hidayat", "Saputra", "Eko", "Tri", "Wawan", "Hendra", "Aris", "Dimas", "Ahmad", "Ilham", "Guntur", "Fajar", "Rian", "Bambang", "Dedi", "Heri", "Roni", "Taufik", "Suryo", "Anwar", "Hafiz", "Reza", "Bayu", "Doni", "Farhan", "Kevin", "Rudi", "Cecep", "Asep", "Irfan", "Arie", "Dani", "Yusuf", "Hendro", "Setyo", "Teguh", "Gunadi", "Satria", "Bagus", "Fikri", "Zaki", "Rahmat", "Zul", "Akbar"];
const indoFemaleFirst = ["Siti", "Sri", "Dian", "Putri", "Sari", "Kartika", "Dewi", "Aulia", "Megawati", "Indah", "Rina", "Anisa", "Fitri", "Yanti", "Eka", "Maya", "Dwi", "Novi", "Wulan", "Ayu", "Lestari", "Siska", "Citra", "Nadia", "Amalia", "Intan", "Gita", "Dina", "Melati", "Chandra", "Viona", "Tari", "Sarah", "Amanda", "Anggraini", "Bella", "Nanda", "Ratih", "Shinta", "Niken", "Pratiwi", "Utami", "Widya", "Endah", "Ratna", "Santi", "Siska", "Dwi", "Puspita", "Wati", "Mega"];
const indoLastNames = ["Wijaya", "Kusuma", "Santoso", "Siregar", "Nasution", "Hutapea", "Prakasa", "Gunawan", "Sutrisno", "Wibowo", "Budiman", "Setiawan", "Utami", "Lestari", "Mulyono", "Suhendra", "Zulkarnain", "Tanjung", "Pane", "Siddiq", "Habibie", "Yudhoyono", "Simanjuntak", "Pangaribuan", "Lubis", "Pasaribu", "Ginting", "Sembiring", "Tarigan", "Prasetyo", "Nugroho", "Pramono", "Haryanto", "Sudarsono", "Wicaksono", "Saputro", "Kurniawan", "Saraswati", "Palupi", "Hartono", "Salim", "Widjaja", "Riady", "Makarim", "Thohir", "Sadikin", "Purnama", "Subagyo", "Pradipta", "Suwondo", "Wahyudi", "Laksana"];
const foreignNamesDatabase = [{ name: "John Smith", nat: "United States" }, { name: "Hans Müller", nat: "Germany" }, { name: "Takashi Tanaka", nat: "Japan" }, { name: "David Campbell", nat: "United Kingdom" }, { name: "Chloe Laurent", nat: "France" }, { name: "Zhang Wei", nat: "China" }];

export function generateManifest(commanderName, activePassengerCount, activeEquipCategory) {
    const rows = []
    const appendManifestRow = (id, name, role, nationality) => rows.push({ id, name, role, nationality })
    let idCounter = 1;

    let pilotCount = 2;
    let faCount = 4;

    const category = typeof activeEquipCategory === 'string' ? activeEquipCategory.trim().toUpperCase() : 'M';

    if (category === 'SMALL' || category === 'S') {
        pilotCount = 2;
        faCount = 3;
    } else if (category === 'HEAVY' || category === 'H') {
        pilotCount = 3;
        faCount = Math.floor(Math.random() * (16 - 12 + 1)) + 12;
    } else {
        pilotCount = 2;
        faCount = Math.floor(Math.random() * (6 - 4 + 1)) + 4;
    }

    appendManifestRow(idCounter++, commanderName, "Captain (PIC)", "Indonesia");
    appendManifestRow(idCounter++, "F/O " + getRandomIndoName('M'), "First Officer (SIC)", "Indonesia");
    
    if (pilotCount === 3) {
        appendManifestRow(idCounter++, "SFO " + getRandomIndoName('M'), "Second First Officer (Relief)", "Indonesia");
    }
    
    for(let i = 1; i <= faCount; i++) {
        appendManifestRow(idCounter++, "FA " + getRandomIndoName(Math.random() > 0.2 ? 'F' : 'M'), "Flight Attendant", "Indonesia");
    }

    for(let p = 1; p <= activePassengerCount; p++) {
        if(Math.random() > 0.90) {
            let f = foreignNamesDatabase[Math.floor(Math.random() * foreignNamesDatabase.length)];
            appendManifestRow(idCounter++, f.name, "Passenger", f.nat);
        } else {
            appendManifestRow(idCounter++, getRandomIndoName(), "Passenger", "Indonesia");
        }
    }
    return rows
}

function getRandomIndoName(gender = null) {
    let firstPool = (gender === 'M') ? indoMaleFirst : (gender === 'F' ? indoFemaleFirst : (Math.random() < 0.5 ? indoMaleFirst : indoFemaleFirst));
    return firstPool[Math.floor(Math.random() * firstPool.length)] + " " + indoLastNames[Math.floor(Math.random() * indoLastNames.length)];
}
