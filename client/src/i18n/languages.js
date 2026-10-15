// English + the 22 languages of the Eighth Schedule of the Constitution of India, ordered by number of speakers.
// `script` documents the writing system used in the translations.
export const LANGUAGES = [
  { code: 'en', name: 'English', english: 'English', script: 'Latin', dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', script: 'Devanagari', dir: 'ltr' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali', script: 'Bengali', dir: 'ltr' },
  { code: 'mr', name: 'मराठी', english: 'Marathi', script: 'Devanagari', dir: 'ltr' },
  { code: 'te', name: 'తెలుగు', english: 'Telugu', script: 'Telugu', dir: 'ltr' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil', script: 'Tamil', dir: 'ltr' },
  { code: 'gu', name: 'ગુજરાતી', english: 'Gujarati', script: 'Gujarati', dir: 'ltr' },
  { code: 'ur', name: 'اردو', english: 'Urdu', script: 'Perso-Arabic', dir: 'rtl' },
  { code: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada', script: 'Kannada', dir: 'ltr' },
  { code: 'or', name: 'ଓଡ଼ିଆ', english: 'Odia', script: 'Odia', dir: 'ltr' },
  { code: 'ml', name: 'മലയാളം', english: 'Malayalam', script: 'Malayalam', dir: 'ltr' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ', english: 'Punjabi', script: 'Gurmukhi', dir: 'ltr' },
  { code: 'as', name: 'অসমীয়া', english: 'Assamese', script: 'Bengali-Assamese', dir: 'ltr' },
  { code: 'mai', name: 'मैथिली', english: 'Maithili', script: 'Devanagari', dir: 'ltr' },
  { code: 'sat', name: 'ᱥᱟᱱᱛᱟᱲᱤ', english: 'Santali', script: 'Ol Chiki', dir: 'ltr' },
  { code: 'ks', name: 'کٲشُر', english: 'Kashmiri', script: 'Perso-Arabic', dir: 'rtl' },
  { code: 'ne', name: 'नेपाली', english: 'Nepali', script: 'Devanagari', dir: 'ltr' },
  { code: 'sd', name: 'سنڌي', english: 'Sindhi', script: 'Perso-Arabic', dir: 'rtl' },
  { code: 'kok', name: 'कोंकणी', english: 'Konkani', script: 'Devanagari', dir: 'ltr' },
  { code: 'doi', name: 'डोगरी', english: 'Dogri', script: 'Devanagari', dir: 'ltr' },
  { code: 'mni', name: 'মৈতৈলোন্', english: 'Manipuri', script: 'Bengali', dir: 'ltr' },
  { code: 'brx', name: 'बड़ो', english: 'Bodo', script: 'Devanagari', dir: 'ltr' },
  { code: 'sa', name: 'संस्कृतम्', english: 'Sanskrit', script: 'Devanagari', dir: 'ltr' },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const DEFAULT_LANGUAGE = 'en';
export const getLanguage = (code) => LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
export const isLanguage = (code) => LANGUAGE_CODES.includes(code);

/** Intl locale for dates/plurals; Western (latn) digits keep prices readable for all users. */
export const intlLocale = (code) => `${code === 'en' ? 'en' : code}-IN-u-nu-latn`;
