const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const filePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, 'records.json');

function updateCnic(cnic) {
  if (typeof cnic !== 'string' || !/^\d{5}-\d{7}-\d$/.test(cnic)) {
    throw new Error('Every cnic value must use the format 12345-1234567-1.');
  }

  const digits = cnic.replace(/-/g, '').split('');
  const positions = new Set();

  while (positions.size < 2) {
    positions.add(crypto.randomInt(0, 12));
  }

  for (const position of positions) {
    const currentDigit = Number(digits[position]);
    const replacement = crypto.randomInt(0, 9);
    digits[position] = String(replacement >= currentDigit ? replacement + 1 : replacement);
  }

  return `${digits.slice(0, 5).join('')}-${digits.slice(5, 12).join('')}-${digits[12]}`;
}

function updateRecords(value, replacements) {
  if (Array.isArray(value)) {
    for (const item of value) {
      updateRecords(item, replacements);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key.toLowerCase() === 'cnic') {
        if (!replacements.has(item)) {
          replacements.set(item, updateCnic(item));
        }
        value[key] = replacements.get(item);
      } else {
        updateRecords(item, replacements);
      }
    }
  }
}

function main() {
  const original = fs.readFileSync(filePath, 'utf8');
  const records = JSON.parse(original);
  const replacements = new Map();

  updateRecords(records, replacements);

  if (replacements.size === 0) {
    throw new Error('No cnic fields were found; the file was not changed.');
  }

  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, {
      encoding: 'utf8',
      mode: fs.statSync(filePath).mode,
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
    throw error;
  }

  console.log(`Updated ${replacements.size} distinct CNIC value(s) in ${filePath}.`);
}

try {
  main();
} catch (error) {
  console.error(`CNIC update failed: ${error.message}`);
  process.exitCode = 1;
}
