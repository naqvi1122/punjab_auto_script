# CM Punjab Youth Games - Auto Registration Filler

Automated form filler for the CM Punjab Youth Games registration portal using Puppeteer + optional 2Captcha.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your settings. The 2Captcha key is optional — the built-in solver handles the math CAPTCHA. Chrome is detected in common install locations; if it is installed elsewhere, set `CHROME_PATH` in `.env` to the browser executable.

3. **Add your records:**
   Edit `records.json` with your registration data (see format below).

4. **Add photos:**
   Drop profile photos (PNG/JPG/JPEG, max 256KB) into the `photos/` folder. Each record gets a random one. To pin a specific photo, set `"photo"` in that record.

5. **Run:**
   ```bash
   npm start
   ```

## Anonymize CNIC values

Run this before using real records in a test environment:

```bash
node anonymize-cnic.js
```

The script updates `records.json` in place. It changes exactly two digits in each distinct CNIC, retains the format and final digit, and refuses to write if a CNIC has an unexpected format. Make a separate secure copy first if you may need to restore the original values.

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Fill all records |
| `npm run dry-run` | Fill forms without submitting (testing) |
| `node index.js --record 0` | Fill only the first record |
| `node index.js --record 2` | Fill only the third record |
| `node anonymize-cnic.js` | Change two digits in each distinct CNIC |

## Record Format (records.json)

```json
{
  "category": "2",
  "subCategory": "1",
  "instituteName": "Government High School Model Town",
  "fullName": "Ali Hassan",
  "fatherName": "Muhammad Hassan",
  "cnic": "35202-1234567-1",
  "gender": "Male",
  "dob": "2010-06-20",
  "division": "6",
  "district": "auto",
  "tehsil": "auto",
  "unionCouncil": "auto",
  "phone": "0301-1234567",
  "address": "House 123, Street 5, Model Town, Lahore",
  "sport": "6",
  "kitSize": "2",
  "joggersSize": "5"
}
```

`"photo"` is optional (e.g. `"photo": "photos/ali_hassan.jpg"`). If omitted, a random image from `photos/` is used.

## Field Value Reference

### Category
| Value | Label |
|-------|-------|
| 1 | Schools (Middle) |
| 2 | Schools (Secondary) |
| 3 | College |
| 4 | Universities |
| 5 | Special Persons |

### Sub Category
| Value | Label |
|-------|-------|
| 1 | Public |
| 2 | Private |
| 4 | Madrassa |
| 5 | Non Formal |
| 6 | Labour School |
| 12 | Open Category |

### Gender
`Male`, `Female`, `Other`

### Division
| Value | Label |
|-------|-------|
| 1 | Bahawalpur |
| 2 | DG Khan |
| 3 | Faisalabad |
| 4 | Gujranwala |
| 5 | Gujrat |
| 6 | Lahore |
| 7 | Multan |
| 8 | Rawalpindi |
| 9 | Sahiwal |
| 10 | Sargodha |

### District / Tehsil / Union Council
Set to `"auto"` to pick the first available option, or use the numeric ID from the form.

### Sports
| Value | Label |
|-------|-------|
| 1 | Athletics |
| 2 | Badminton |
| 6 | Cricket (Hard Ball) |
| 9 | Football |
| 13 | Kabaddi (Boys Only) |
| 20 | Tug of War |

### Kit Size
| Value | Label |
|-------|-------|
| 1 | Small |
| 2 | Medium |
| 3 | Large |
| 4 | XL |
| 5 | 2XL |
| 6 | 3XL |

### Joggers Size
| Value | Size |
|-------|------|
| 1 | 33 |
| 2 | 34 |
| 3 | 35 |
| 4 | 36 |
| 5 | 37 |
| 6 | 38 |
| 7 | 39 |
| 8 | 40 |
| 9 | 41 |
| 10 | 42 |
| 11 | 43 |
| 12 | 44 |
| 13 | 45 |
| 14 | 46 |

### DOB Limits by Category
- Schools (Middle): 2011–2018
- Schools (Secondary): 2009–2016
- College: 2003–2010
- Universities: Varies
- Special Persons: Varies

## Notes

- The math CAPTCHA (e.g., "8 + 7 = ?") is solved automatically — no 2Captcha key needed.
- Set `HEADLESS=false` in `.env` to watch the browser fill forms.
- Set `AUTO_SUBMIT=false` to review each form before submitting.
- Photos must be PNG/JPG/JPEG and under 256KB.
