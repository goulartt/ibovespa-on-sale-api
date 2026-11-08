const fs = require('fs');
const path = require('path');

// Writes to a temp file and renames it, so readers never see a half-written file.
function writeAtomically(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, file);
}

module.exports = { writeAtomically };
