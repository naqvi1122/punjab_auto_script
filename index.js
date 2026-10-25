/**
 * CM Punjab Youth Games - Registration Form Auto-Filler
 * Uses Puppeteer for browser automation + optional 2Captcha for CAPTCHA solving
 *
 * Usage:
 *   npm start              - Run with all records in records.json
 *   npm run dry-run        - Open form but don't submit (for testing)
 *   node index.js --record 0   - Fill only record at index 0
 */

require('dotenv').config();
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// ─── Config ───────────────────────────────────────────────────────
const CONFIG = {
  twoCaptchaKey: process.env.TWO_CAPTCHA_API_KEY || '',
  headless: process.env.HEADLESS === 'true',
  delayBetween: parseInt(process.env.DELAY_BETWEEN_RECORDS) || 3000,
  autoSubmit: process.env.AUTO_SUBMIT === 'true',
  formUrl: process.env.FORM_URL || 'https://youthgames.punjab.gov.pk/#registration',
  dryRun: process.argv.includes('--dry-run'),
  singleRecord: process.argv.includes('--record')
    ? parseInt(process.argv[process.argv.indexOf('--record') + 1])
    : null,
};

// ─── 2Captcha Setup (optional) ───────────────────────────────────
let solver = null;
if (CONFIG.twoCaptchaKey) {
  try {
    const Captcha = require('2captcha');
    solver = new Captcha.Solver(CONFIG.twoCaptchaKey);
    console.log('✅ 2Captcha API configured');
  } catch (e) {
    console.log('⚠️  2Captcha module not loaded, using built-in math solver');
  }
}

// ─── Helper: wait ─────────────────────────────────────────────────
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Helper: locate installed Chrome (puppeteer-core ships no browser) ──
const CHROME_PATHS = [
  process.env.CHROME_PATH ? path.resolve(process.env.CHROME_PATH) : null,
  ...(process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
          : null,
        process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe')
          : null,
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']),
].filter(Boolean);

function findChrome() {
  return CHROME_PATHS.find((p) => fs.existsSync(p)) || null;
}

// ─── Helper: list photos available in photos/ ─────────────────────
const PHOTOS_DIR = path.resolve('photos');

function loadPhotos() {
  if (!fs.existsSync(PHOTOS_DIR)) return [];
  return fs.readdirSync(PHOTOS_DIR)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => path.join(PHOTOS_DIR, f));
}

// ─── Helper: solve math CAPTCHA locally ──────────────────────────
function solveMathCaptcha(text) {
  // Extracts "X + Y = ?" or "X - Y = ?" etc.
  const match = text.match(/(\d+)\s*([+\-×x*÷/])\s*(\d+)/);
  if (!match) return null;

  const a = parseInt(match[1]);
  const op = match[2];
  const b = parseInt(match[3]);

  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': case 'x': case '*': return a * b;
    case '÷': case '/': return Math.floor(a / b);
    default: return null;
  }
}

// ─── Helper: open the disclaimer popup and tick "I agree" ────────
// "Submit →" validates the form and only then opens a popup whose
// "I Agree & Submit →" button stays disabled until the checkbox is ticked.
async function openDisclaimer(page) {
  await page.click('#registration-submit-btn');

  try {
    await page.waitForSelector('#disclaimerModal.show', { visible: true, timeout: 10000 });
  } catch (e) {
    // Popup never opened -> the form failed validation; report which fields
    const invalid = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#registration-form :invalid'))
        .map((el) => el.id || el.name || el.tagName)
    );
    return { ok: false, reason: `popup did not open, invalid fields: ${invalid.join(', ') || 'unknown'}` };
  }
  await wait(600); // let the modal fade-in finish

  await page.click('#disclaimer-checkbox');
  try {
    await page.waitForFunction(() => {
      const btn = document.getElementById('disclaimer-agree-button');
      return btn && !btn.disabled;
    }, { timeout: 5000 });
  } catch (e) {
    return { ok: false, reason: '"I Agree & Submit" stayed disabled after ticking the checkbox' };
  }
  return { ok: true };
}

// ─── Helper: read the outcome after the form POST redirects back ──
// The server re-renders the form with data-registration-success="1" (and a
// tracking ID) or data-has-server-errors="1" (and an error banner).
function readSubmitResult(page) {
  return page.evaluate(() => {
    const form = document.getElementById('registration-form');
    const idEl = document.getElementById('registration-success-tracking-id');
    const trackingId =
      (idEl && idEl.textContent.trim()) ||
      new URL(location.href).searchParams.get('tracking') ||
      null;

    if (form && form.dataset.registrationSuccess === '1') {
      return { status: 'SUCCESS', trackingId };
    }
    if (form && form.dataset.hasServerErrors === '1') {
      const box = document.getElementById('registration-errors');
      const message = box ? box.innerText.replace(/\s+/g, ' ').trim().slice(0, 300) : null;
      return { status: 'ERROR', message };
    }
    return { status: 'UNKNOWN', trackingId, url: location.href };
  });
}

// ─── Main form filler ─────────────────────────────────────────────
async function fillForm(page, record, index, photos) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📝 RECORD ${index + 1}: ${record.fullName}`);
  console.log(`${'═'.repeat(60)}`);

  // Navigate to registration page
  await page.goto(CONFIG.formUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(2000);

  // ── Use page.evaluate for React-controlled form fields ──
  // This uses the native setter pattern to trigger React's change detection

  // 1. PARTICIPATION CATEGORY
  console.log('  → Setting category:', record.categoryLabel || record.category);
  await page.evaluate((val) => {
    const el = document.getElementById('participation-category');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.category);
  await wait(1500);

  // 2. SUB CATEGORY
  console.log('  → Setting sub-category:', record.subCategoryLabel || record.subCategory);
  await page.evaluate((val) => {
    const el = document.getElementById('participation-subcategory');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.subCategory);
  await wait(1000);

  // 3. CLICK "Enter manually" for institute name
  console.log('  → Clicking "Enter manually" for institute');
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent.includes('Enter manually'));
    if (btn) btn.click();
  });
  await wait(500);

  // 4. INSTITUTE NAME
  console.log('  → Setting institute:', record.instituteName);
  await page.evaluate((val) => {
    const el = document.querySelector('input[placeholder*="Type your institute"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.instituteName);
  await wait(300);

  // 5. FULL NAME
  console.log('  → Setting name:', record.fullName);
  await page.evaluate((val) => {
    const el = document.querySelector('input[placeholder="Ahmad"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.fullName);

  // 6. FATHER NAME
  console.log('  → Setting father name:', record.fatherName);
  await page.evaluate((val) => {
    const el = document.querySelector('input[placeholder="Raza"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.fatherName);

  // 7. CNIC
  console.log('  → Setting CNIC:', record.cnic);
  await page.evaluate((val) => {
    const el = document.querySelector('input[placeholder="30000-0000000-0"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.cnic);

  // 8. GENDER
  console.log('  → Setting gender:', record.gender);
  await page.evaluate((val) => {
    const el = document.getElementById('gender');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.gender);

  // 9. DATE OF BIRTH
  console.log('  → Setting DOB:', record.dob);
  await page.evaluate((val) => {
    const el = document.querySelector('input[type="date"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.dob);

  // 10. DIVISION (cascading)
  console.log('  → Setting division:', record.divisionLabel || record.division);
  await page.evaluate((val) => {
    const el = document.getElementById('division');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.division);
  await wait(2000); // Wait for district dropdown to populate

  // 11. DISTRICT (cascading)
  console.log('  → Setting district...');
  await page.evaluate((val) => {
    const el = document.getElementById('district');
    if (!el || el.options.length <= 1) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    if (val === 'auto') {
      setter.call(el, el.options[1].value);
    } else {
      setter.call(el, val);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.district);
  await wait(2000); // Wait for tehsil dropdown to populate

  // 12. TEHSIL (cascading)
  console.log('  → Setting tehsil...');
  await page.evaluate((val) => {
    const el = document.getElementById('tehsil');
    if (!el || el.options.length <= 1) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    if (val === 'auto') {
      setter.call(el, el.options[1].value);
    } else {
      setter.call(el, val);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.tehsil);
  await wait(2000); // Wait for UC dropdown to populate

  // 13. UNION COUNCIL (cascading)
  console.log('  → Setting union council...');
  await page.evaluate((val) => {
    const el = document.getElementById('union-council');
    if (!el || el.options.length <= 1) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    if (val === 'auto') {
      setter.call(el, el.options[1].value);
    } else {
      setter.call(el, val);
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.unionCouncil);
  await wait(500);

  // 14. PHONE
  console.log('  → Setting phone:', record.phone);
  await page.evaluate((val) => {
    const el = document.querySelector('input[type="tel"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.phone);

  // 15. ADDRESS
  console.log('  → Setting address:', record.address);
  await page.evaluate((val) => {
    const el = document.querySelector('input[placeholder="Street, area, postal code"]');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.address);

  // 16. SPORT
  console.log('  → Setting sport:', record.sportLabel || record.sport);
  await page.evaluate((val) => {
    const el = document.getElementById('sport-id');
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.sport);
  await wait(500);

  // 17. KIT SIZE
  console.log('  → Setting kit size:', record.kitSizeLabel || record.kitSize);
  await page.evaluate((val) => {
    const el = document.querySelector('select[name="kit_size_id"]') || document.querySelectorAll('select')[8];
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.kitSize);

  // 18. JOGGERS SIZE
  console.log('  → Setting joggers size:', record.joggersSizeLabel || record.joggersSize);
  await page.evaluate((val) => {
    const el = document.querySelector('select[name="joggers_size_id"]') || document.querySelectorAll('select')[9];
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, record.joggersSize);

  // 19. PHOTO UPLOAD (record.photo if given, otherwise random from photos/)
  const photoPath = record.photo
    ? path.resolve(record.photo)
    : photos[Math.floor(Math.random() * photos.length)];
  if (photoPath) {
    if (fs.existsSync(photoPath)) {
      console.log(`  → Uploading photo${record.photo ? '' : ' (random)'}:`, photoPath);
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.uploadFile(photoPath);
        await wait(1000);
      }
    } else {
      console.log('  ⚠️  Photo not found:', photoPath, '(skipping upload)');
    }
  } else {
    console.log('  ⚠️  No photo set and photos/ is empty (skipping upload)');
  }

  // 20. SOLVE CAPTCHA
  console.log('  → Solving CAPTCHA...');
  const captchaText = await page.evaluate(() => {
    // Look for the CAPTCHA question text on the page
    const allText = document.body.innerText;
    const match = allText.match(/(\d+)\s*[+\-×x*÷/]\s*(\d+)\s*=\s*\?/);
    return match ? match[0] : null;
  });

  if (captchaText) {
    console.log('  → CAPTCHA question:', captchaText);
    const answer = solveMathCaptcha(captchaText);

    if (answer !== null) {
      console.log('  → CAPTCHA answer:', answer);
      await page.evaluate((ans) => {
        const el = document.querySelector('input[placeholder="Enter the answer"]');
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(ans));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, answer);
    } else if (solver) {
      // Fallback to 2Captcha if math solver fails
      console.log('  → Using 2Captcha to solve...');
      try {
        // Take screenshot of CAPTCHA area for 2Captcha
        const captchaImg = await page.screenshot({ encoding: 'base64' });
        const result = await solver.imageCaptcha({ body: captchaImg, numeric: 1 });
        console.log('  → 2Captcha answer:', result.data);
        await page.evaluate((ans) => {
          const el = document.querySelector('input[placeholder="Enter the answer"]');
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, ans);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, result.data);
      } catch (e) {
        console.log('  ❌ 2Captcha error:', e.message);
      }
    } else {
      console.log('  ❌ Could not solve CAPTCHA automatically');
    }
  } else {
    console.log('  ⚠️  CAPTCHA text not found on page');
  }

  // 21. SUBMIT (if auto-submit enabled and not dry-run)
  if (CONFIG.autoSubmit && !CONFIG.dryRun) {
    console.log('  → Submitting form...');
    const popup = await openDisclaimer(page);

    if (!popup.ok) {
      console.log(`  ❌ NOT submitted: ${popup.reason}`);
    } else {
      console.log('  → Popup accepted, clicking "I Agree & Submit"...');
      try {
        // The POST reloads the page, so wait for the navigation together with the click
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }),
          page.click('#disclaimer-agree-button'),
        ]);
        const result = await readSubmitResult(page);
        if (result.status === 'SUCCESS') {
          console.log(`  ✅ Submit result: SUCCESS - tracking ID: ${result.trackingId || '(not shown)'}`);
        } else if (result.status === 'ERROR') {
          console.log(`  ❌ Submit result: SERVER REJECTED - ${result.message || '(no message)'}`);
        } else {
          console.log(`  ⚠️  Submit result: UNKNOWN (page: ${result.url}) - check manually, do not re-run blindly`);
        }
      } catch (e) {
        console.log(`  ⚠️  Submit result: UNKNOWN (${e.message}) - it may have gone through, check manually`);
      }
    }
  } else if (CONFIG.dryRun) {
    // Walk the popup so the whole path is exercised, but never click the final button
    const popup = await openDisclaimer(page);
    if (popup.ok) {
      console.log('  → DRY RUN: popup opened, "I agree" ticked, "I Agree & Submit" is enabled but NOT clicked');
    } else {
      console.log(`  ⚠️  DRY RUN: ${popup.reason}`);
    }
    console.log('  → DRY RUN: Form filled but NOT submitted');
  } else {
    console.log('  → AUTO_SUBMIT is off. Review the form and submit manually.');
    console.log('  → Waiting 30 seconds for manual review...');
    await wait(30000);
  }

  console.log(`✅ Record ${index + 1} (${record.fullName}) - Done!\n`);
}

// ─── Entry point ──────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   CM Punjab Youth Games - Auto Registration Filler   ║
║   Puppeteer + 2Captcha                               ║
╚══════════════════════════════════════════════════════╝
`);

  // Load photos for random assignment
  const photos = loadPhotos();
  if (photos.length === 0) {
    console.log(`⚠️  No photos (jpg/jpeg/png) found in ${PHOTOS_DIR} - photo upload will be skipped`);
  } else {
    console.log(`🖼️  Found ${photos.length} photo(s) in ${PHOTOS_DIR}`);
  }

  // Load records
  const recordsPath = path.resolve('records.json');
  if (!fs.existsSync(recordsPath)) {
    console.error('❌ records.json not found! Create it with your registration data.');
    process.exit(1);
  }

  let records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));

  // Filter to single record if specified
  if (CONFIG.singleRecord !== null) {
    if (CONFIG.singleRecord >= 0 && CONFIG.singleRecord < records.length) {
      records = [records[CONFIG.singleRecord]];
      console.log(`📌 Running single record: index ${CONFIG.singleRecord}`);
    } else {
      console.error(`❌ Record index ${CONFIG.singleRecord} out of range (0-${records.length - 1})`);
      process.exit(1);
    }
  }

  console.log(`📋 Total records to process: ${records.length}`);
  console.log(`🌐 Form URL: ${CONFIG.formUrl}`);
  console.log(`👁️  Headless: ${CONFIG.headless}`);
  console.log(`📤 Auto-submit: ${CONFIG.autoSubmit}`);
  console.log(`🧪 Dry run: ${CONFIG.dryRun}`);
  console.log(`🔑 2Captcha: ${solver ? 'Configured' : 'Not configured (using built-in math solver)'}`);
  console.log('');

  // Locate the user's installed Chrome
  const executablePath = findChrome();
  if (!executablePath) {
    console.error('❌ Chrome not found. Install Google Chrome or Chromium; looked in:');
    CHROME_PATHS.forEach((p) => console.error(`   - ${p}`));
    console.error('   Set CHROME_PATH to the browser executable if it is installed elsewhere.');
    process.exit(1);
  }
  console.log(`🧭 Browser: ${executablePath}`);

  // Launch browser
  const browser = await puppeteer.launch({
    executablePath,
    headless: CONFIG.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1366,900',
    ],
    defaultViewport: { width: 1366, height: 900 },
  });

  const page = await browser.newPage();

  // Set a realistic user-agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  try {
    for (let i = 0; i < records.length; i++) {
      await fillForm(page, records[i], i, photos);

      if (i < records.length - 1) {
        console.log(`⏳ Waiting ${CONFIG.delayBetween / 1000}s before next record...`);
        await wait(CONFIG.delayBetween);
      }
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🎉 ALL ${records.length} RECORDS PROCESSED!`);
    console.log(`${'═'.repeat(60)}\n`);
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    if (CONFIG.dryRun || !CONFIG.autoSubmit) {
      console.log('🔄 Browser will stay open. Close it manually when done.');
      // Keep browser open for manual review
    } else {
      await browser.close();
    }
  }
}

main().catch(console.error);
