// Translates English messages coming from the API into the active language. The server stays English
// (logs, tests, admin); the client maps each known message — including ones with dynamic parts — to a
// locale key. Unknown messages are shown unchanged.
const P = (re, key, names = []) => ({ re, key, names });

const PATTERNS = [
  P(/^(.+) is required$/, 'errors.fieldRequired', ['field']),
  P(/^(.+) must be a number$/, 'errors.fieldNumber', ['field']),
  P(/^(.+) must be 0 or more$/, 'errors.fieldNonNegative', ['field']),
  P(/^(.+) is too large$/, 'errors.fieldTooLarge', ['field']),
  P(/^Max (\d+) characters$/, 'errors.maxChars', ['n']),
  P(/^(\d+) row\(s\) have errors$/, 'errors.rowsHaveErrors', ['count']),
  P(/^Duplicate item code (.+)$/, 'errors.duplicateCode', ['code']),
  P(/^Duplicate product name "(.+)"$/, 'errors.duplicateName', ['name']),
  P(/^Item code (.+) is already used by another product$/, 'errors.codeUsed', ['code']),
  P(/^Your plan allows (\d+) active products\. You have (\d+) and tried to add (\d+)\..*$/, 'errors.planLimitAdding', ['limit', 'used', 'adding']),
  P(/^Your plan allows (\d+) active products\. You have (\d+)\..*$/, 'errors.planLimit', ['limit', 'used']),
  P(/^Please complete: (.+)$/, 'errors.pleaseComplete', ['items']),
  P(/^Cannot (\w+) a store that is (.+)$/, 'errors.cannotTransition', ['action', 'status']),
  P(/^Request failed \((\d+)\)$/, 'errors.requestFailed', ['status']),
  P(/^Business type, store type, store name, store link and WhatsApp number can't be changed after approval\. Message support on WhatsApp (.+) to correct them\.$/, 'setup.lockedNote', ['phone']),
];

const EXACT = {
  'Add at least one item or a note': 'errors.addItemOrNote',
  'Admin login required': 'errors.adminLogin',
  'Already exists': 'errors.alreadyExists',
  'An account with this number exists. Please log in.': 'errors.customerExists',
  'An account with this phone number already exists. Please log in.': 'errors.customerExists',
  'Code expired or not requested. Please request a new code.': 'errors.codeExpired',
  'Could not generate a store link, try a different name': 'errors.slugFailed',
  'Cross-site request blocked': 'errors.generic',
  'Current password is incorrect': 'errors.currentPassword',
  'Details must look like "Weight: 5 kg; Shelf life: 3 months"': 'errors.detailsFormat',
  'Enter a valid amount': 'errors.validAmount',
  'Enter a valid mobile number': 'errors.validMobile',
  'Enter a valid 10-digit mobile number': 'errors.validMobile10',
  'Could not send the code right now. Please try again in a minute.': 'errors.otpSendFailed',
  'Enter the 6-digit code': 'otp.enter',
  'That time was just booked by someone else. Please pick another slot.': 'errors.slotTaken',
  'That time is no longer available. Please pick another slot.': 'errors.slotGone',
  'You already have 3 pending requests here. Please wait for the business to confirm them.': 'errors.tooManyPending',
  'Too many booking requests. Please try again later or message the business on WhatsApp.': 'errors.bookingLimit',
  'This business is not taking bookings yet': 'errors.notTakingBookings',
  'Location on the map': 'review.check.location',
  'Enter your current password': 'errors.enterCurrentPassword',
  'Enter your name': 'errors.enterName',
  'Enter your password': 'errors.enterPassword',
  'Enter your username': 'errors.enterUsername',
  'If the number can receive codes, one has been sent.': 'errors.codeMaybeSent',
  'Image must be under 8 MB': 'errors.imageTooBig',
  'Incorrect code': 'errors.incorrectCode',
  'Incorrect phone number or password': 'errors.incorrectPhoneLogin',
  'Incorrect username or password': 'errors.incorrectLogin',
  'Invalid Instagram handle': 'errors.instagram',
  'Invalid value': 'errors.invalidValue',
  'Item code: letters, numbers, - or _ (max 40)': 'errors.itemCodeFormat',
  'List price cannot be more than MRP': 'errors.listOverMrp',
  'Lowercase letters, numbers and single hyphens only': 'errors.slugFormat',
  'Max 8 images': 'errors.maxImages',
  'Mobile number login is not enabled yet': 'errors.phoneLoginOff',
  'Must be 0 or more': 'errors.nonNegative',
  'Must be an https:// URL': 'errors.httpsUrl',
  'Name is required': 'errors.nameRequired',
  'No account found for this number': 'errors.noAccount',
  'No image received': 'errors.noImage',
  'No store is registered with this number': 'errors.noStoreForNumber',
  'Not found': 'errors.notFound',
  'Nothing to update': 'errors.nothingToUpdate',
  'Order not found': 'errors.orderNotFound',
  'Password is too long': 'errors.passwordTooLong',
  'Password must be at least 8 characters': 'errors.passwordShort',
  'Please choose an image file': 'errors.chooseImage',
  'Please explain the reason (min 5 characters)': 'errors.explainReason',
  'Please log in': 'errors.pleaseLogIn',
  'Please upload an image': 'errors.chooseImage',
  'Product not found': 'product.notFound',
  'Request too large': 'errors.tooLarge',
  'Something went wrong': 'errors.generic',
  'Store name is too short': 'errors.storeNameShort',
  'Store not found': 'status.storeNotFound',
  'That file could not be read as an image': 'errors.badImage',
  'That store link is already taken': 'errors.slugTaken',
  'No sales rep has this ID. Check it, or leave it empty.': 'setup.repUnknown',
  'A sales rep ID is 6 letters or digits': 'setup.repInvalid',
  'Photo upload is on the paid plan. Paste an image link (https://…) instead.': 'pf.uploadPaid',
  'The reopening date must be after today': 'closure.dateAfterToday',
  'This business is temporarily closed and not taking bookings right now.': 'closure.bannerBookings',
  'That username is taken': 'errors.usernameTaken',
  'This code was issued for a different store': 'errors.codeOtherStore',
  'This is already your WhatsApp number for orders': 'errors.sameWhatsApp',
  'This mobile number is already registered. Please log in.': 'errors.mobileRegistered',
  'Too many attempts. Try again in 15 minutes.': 'errors.tooManyAttempts15',
  'Too many attempts. Try again in a few minutes.': 'errors.tooManyAttempts',
  'Too many code requests. Try again in a few minutes.': 'errors.tooManyCodes',
  'Too many codes requested for this number. Try again in 15 minutes.': 'errors.tooManyCodesNumber',
  'Too many wrong attempts. Please request a new code.': 'errors.tooManyWrong',
  'Use HH:MM-HH:MM, e.g. 09:00-21:00': 'errors.hoursFormat',
  'Username: 3–32 letters, numbers, dot, dash or underscore': 'errors.usernameFormat',
  'Your store is already approved': 'errors.alreadyApproved',
  'Your store is already waiting for review': 'errors.alreadyPending',
  "You're offline or the server is unreachable.": 'errors.offline',
};

const FIELD_LABELS = { MRP: 'errors.labelMrp', 'List price': 'errors.labelListPrice' };

/** Returns the translated message (or the original if unknown). */
export function translateMessage(t, message) {
  if (!message || typeof message !== 'string') return message;
  if (EXACT[message]) return t(EXACT[message]);
  for (const { re, key, names } of PATTERNS) {
    const m = message.match(re);
    if (!m) continue;
    const vars = Object.fromEntries(names.map((n, i) => [n, m[i + 1]]));
    if (vars.field) vars.field = FIELD_LABELS[vars.field] ? t(FIELD_LABELS[vars.field]) : vars.field;
    if (vars.count) vars.count = Number(vars.count);
    return t(key, vars);
  }
  return message;
}

/** Translates field-error maps; nested row lists (CSV import) are translated item by item. */
export function translateFields(t, fields) {
  if (!fields || typeof fields !== 'object') return fields;
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) out[k] = v.map((r) => (r && typeof r === 'object' ? { ...r, error: translateMessage(t, r.error) } : r));
    else out[k] = translateMessage(t, v);
  }
  return out;
}
