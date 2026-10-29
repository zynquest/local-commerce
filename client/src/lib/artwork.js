// Default artwork for items without a photo: an emoji picked from the product or service name (English and common
// Hindi/regional words), else from the store type, else a store or appointment default. Used by SmartImage.

// [emoji, words]. A word matches the start of any word in the name ("rice" matches "Rice", "Ricebran"), so order
// matters: more specific entries first.
const PRODUCT_ART = [
  ['🥘', ['dosa', 'idli', 'vada', 'uttapam', 'upma', 'pongal']],
  ['🍛', ['thali', 'biryani', 'pulao', 'curry', 'sabzi', 'meal', 'paneer butter', 'butter masala', 'dal makhani', 'dal fry', 'dal tadka', 'rajma chawal', 'khichdi', 'kadai paneer', 'palak paneer', 'chole', 'pav bhaji']],
  ['🫓', ['roti', 'chapati', 'paratha', 'naan', 'kulcha', 'puri', 'bhatura']],
  ['🥟', ['samosa', 'momo', 'kachori', 'pakora', 'bhaji', 'spring roll']],
  ['🍕', ['pizza', 'burger', 'sandwich', 'wrap', 'roll', 'frankie']],
  ['🍞', ['bread', 'bun', 'pav', 'loaf', 'toast', 'rusk']],
  ['🧈', ['butter', 'makhan', 'ghee']],
  ['🧀', ['paneer', 'cheese']],
  ['🥛', ['milk', 'doodh', 'dudh', 'curd', 'dahi', 'lassi', 'buttermilk', 'chaas', 'yogurt']],
  ['🎂', ['cake', 'pastry', 'brownie', 'muffin', 'cupcake']],
  ['🍪', ['cookie', 'biscuit', 'khari', 'nankhatai']],
  ['🍬', ['sweet', 'mithai', 'laddu', 'ladoo', 'barfi', 'peda', 'halwa', 'jalebi', 'rasgulla', 'gulab', 'kaju katli', 'toffee', 'candy', 'chocolate']],
  ['🌾', ['atta', 'flour', 'maida', 'besan', 'sooji', 'suji', 'rava', 'wheat', 'gehu', 'ragi', 'jowar', 'bajra', 'millet']],
  ['🍚', ['rice', 'chawal', 'basmati', 'poha', 'idli rava', 'sona masoori']],
  ['🫘', ['dal', 'daal', 'toor', 'arhar', 'moong', 'masoor', 'urad', 'chana', 'rajma', 'lobia', 'pulse', 'lentil', 'beans', 'soya']],
  ['🫙', ['pickle', 'achar', 'achaar', 'jam', 'sauce', 'ketchup', 'chutney', 'honey', 'shahad']],
  ['🛢️', ['oil', 'tel', 'mustard oil', 'sunflower']],
  ['🧂', ['salt', 'namak', 'sugar', 'cheeni', 'shakkar', 'jaggery', 'gud', 'gur']],
  ['🌶️', ['chilli', 'chili', 'mirch', 'masala', 'spice', 'haldi', 'turmeric', 'jeera', 'cumin', 'dhania', 'coriander powder', 'garam', 'pepper', 'elaichi', 'cardamom', 'clove', 'laung']],
  ['🥜', ['dry fruit', 'cashew', 'kaju', 'almond', 'badam', 'pista', 'walnut', 'akhrot', 'kishmish', 'raisin', 'peanut', 'moongphali', 'makhana', 'dates', 'khajur']],
  ['☕', ['tea', 'chai', 'coffee', 'filter coffee']],
  ['🧃', ['juice', 'sharbat', 'soda', 'cola', 'drink', 'water', 'pani', 'coconut water']],
  ['🍜', ['noodle', 'maggi', 'pasta', 'vermicelli', 'sevai', 'seviyan']],
  ['🍟', ['chips', 'namkeen', 'bhujia', 'mixture', 'kurkure', 'snack', 'papad', 'khakhra', 'mathri']],
  ['🍨', ['ice cream', 'icecream', 'kulfi', 'falooda', 'shake', 'milkshake']],
  ['🥚', ['egg', 'anda']],
  ['🍗', ['chicken', 'mutton', 'fish', 'machli', 'prawn', 'meat']],
  ['🍎', ['apple', 'seb']],
  ['🍌', ['banana', 'kela']],
  ['🥭', ['mango', 'aam']],
  ['🍊', ['orange', 'santra', 'mosambi', 'sweet lime']],
  ['🍇', ['grape', 'angoor']],
  ['🍉', ['watermelon', 'tarbooz', 'melon']],
  ['🍍', ['pineapple', 'ananas']],
  ['🥥', ['coconut', 'nariyal']],
  ['🍅', ['tomato', 'tamatar']],
  ['🧅', ['onion', 'pyaz', 'pyaaz', 'kanda']],
  ['🧄', ['garlic', 'lahsun', 'ginger', 'adrak']],
  ['🥔', ['potato', 'aloo', 'alu']],
  ['🥕', ['carrot', 'gajar', 'radish', 'mooli', 'beetroot']],
  ['🥬', ['spinach', 'palak', 'methi', 'cabbage', 'patta gobi', 'lettuce', 'leafy', 'coriander', 'dhaniya', 'mint', 'pudina', 'saag']],
  ['🥦', ['cauliflower', 'gobi', 'broccoli']],
  ['🍆', ['brinjal', 'baingan', 'eggplant']],
  ['🥒', ['cucumber', 'kheera', 'lauki', 'bottle gourd', 'tinda', 'turai', 'karela', 'bitter gourd', 'zucchini']],
  ['🫑', ['capsicum', 'shimla mirch', 'bell pepper']],
  ['🫛', ['peas', 'matar', 'bhindi', 'okra', 'lady finger', 'ladyfinger', 'french beans']],
  ['🌽', ['corn', 'bhutta', 'makka']],
  ['🍋', ['lemon', 'nimbu', 'lime']],
  ['💐', ['bouquet', 'flower', 'phool', 'rose', 'gulab', 'marigold', 'genda', 'jasmine', 'mogra', 'mallige', 'garland', 'mala']],
  ['🪔', ['diya', 'agarbatti', 'incense', 'dhoop', 'camphor', 'kapoor', 'pooja', 'puja', 'kumkum', 'roli', 'sindoor']],
  ['🧼', ['soap', 'sabun', 'handwash', 'body wash', 'shower']],
  ['🧴', ['shampoo', 'conditioner', 'lotion', 'cream', 'moisturiser', 'moisturizer', 'face wash', 'sunscreen', 'hair oil', 'perfume', 'deo']],
  ['🪥', ['toothpaste', 'toothbrush', 'brush', 'colgate', 'dant']],
  ['🧺', ['detergent', 'washing', 'surf', 'bleach', 'cleaner', 'phenyl', 'floor', 'dishwash', 'scrub']],
  ['🧻', ['tissue', 'napkin', 'toilet', 'diaper', 'pad', 'sanitary']],
  ['💡', ['bulb', 'led', 'light', 'lamp', 'tubelight', 'torch']],
  ['🔌', ['wire', 'cable', 'switch', 'socket', 'plug', 'extension', 'mcb', 'adapter']],
  ['🔋', ['battery', 'cell', 'inverter', 'charger', 'power bank']],
  ['🌀', ['fan', 'cooler', 'exhaust']],
  ['📱', ['phone', 'mobile', 'smartphone', 'earphone', 'headphone', 'earbuds', 'cover', 'screen guard', 'tempered']],
  ['💻', ['laptop', 'computer', 'keyboard', 'mouse', 'printer', 'pendrive', 'hard disk']],
  ['🔧', ['tool', 'spanner', 'screw', 'bolt', 'nail', 'hammer', 'pipe', 'tap', 'fitting', 'drill', 'plier', 'hardware', 'lock', 'hinge']],
  ['🎨', ['paint', 'primer', 'putty', 'distemper', 'enamel', 'colour', 'color']],
  ['📒', ['notebook', 'copy', 'register', 'book', 'diary', 'pen', 'pencil', 'eraser', 'stationery', 'paper', 'file', 'marker', 'crayon']],
  ['🎁', ['gift', 'toy', 'teddy', 'doll', 'game', 'puzzle', 'balloon']],
  ['👕', ['shirt', 't-shirt', 'tshirt', 'kurta', 'kurti', 'top', 'jeans', 'trouser', 'pant', 'shorts', 'dress', 'frock', 'jacket', 'sweater', 'hoodie', 'innerwear', 'vest', 'socks', 'banian']],
  ['🥻', ['saree', 'sari', 'lehenga', 'dupatta', 'salwar', 'suit', 'dhoti', 'blouse']],
  ['👟', ['shoe', 'sandal', 'chappal', 'slipper', 'sneaker', 'footwear', 'boot', 'heel']],
  ['👜', ['bag', 'purse', 'wallet', 'backpack', 'suitcase', 'luggage']],
  ['💍', ['ring', 'necklace', 'earring', 'jhumka', 'bangle', 'chudi', 'bracelet', 'anklet', 'payal', 'chain', 'jewellery', 'jewelry', 'gold', 'silver']],
  ['💄', ['lipstick', 'kajal', 'eyeliner', 'mascara', 'foundation', 'compact', 'nail polish', 'makeup', 'bindi']],
  ['⌚', ['watch', 'clock', 'spectacle', 'sunglasses', 'glasses', 'frame']],
  ['💊', ['tablet', 'medicine', 'syrup', 'capsule', 'ointment', 'bandage', 'sanitizer', 'mask', 'thermometer']],
  ['🍳', ['kadai', 'kadhai', 'tawa', 'pan', 'cooker', 'pressure', 'utensil', 'steel', 'plate', 'glass', 'bowl', 'spoon', 'knife', 'container', 'bottle', 'tiffin', 'flask']],
  ['🪑', ['chair', 'table', 'sofa', 'bed', 'mattress', 'pillow', 'cushion', 'curtain', 'bedsheet', 'blanket', 'carpet', 'mat']],
  ['🐾', ['pet', 'dog', 'cat', 'pedigree', 'whiskas', 'fish food']],
  ['🌱', ['seed', 'beej', 'fertiliser', 'fertilizer', 'khad', 'urea', 'dap', 'pesticide', 'plant', 'pot', 'soil']],
  ['🛞', ['tyre', 'tire', 'tube', 'helmet', 'engine oil', 'spare', 'brake', 'clutch']],
  ['🚲', ['cycle', 'bicycle']],
  ['💧', ['water can', 'bisleri', 'jar']],
];

const SERVICE_ART = [
  ['🧔', ['beard', 'shave', 'shaving', 'moustache', 'mustache']],
  ['🎨', ['colour', 'color', 'highlight', 'balayage', 'henna hair', 'dye']],
  ['🧖', ['facial', 'cleanup', 'clean-up', 'clean up', 'bleach', 'detan', 'de-tan', 'face pack', 'skin']],
  ['💆', ['spa', 'massage', 'head massage', 'body massage', 'aroma', 'champi']],
  ['💅', ['manicure', 'pedicure', 'nail', 'gel', 'extension']],
  ['✨', ['threading', 'eyebrow', 'waxing', 'wax', 'upper lip', 'lash']],
  ['👰', ['bridal', 'bride', 'party makeup', 'makeup', 'make-up', 'saree draping', 'draping']],
  ['🌿', ['mehendi', 'mehndi', 'henna']],
  ['💇', ['haircut', 'hair cut', 'hairstyle', 'hair style', 'kids cut', 'blow dry', 'hair']],
  ['🦷', ['dental', 'tooth', 'teeth', 'root canal', 'scaling', 'braces', 'filling', 'extraction', 'whitening']],
  ['👁️', ['eye', 'vision', 'spectacle', 'contact lens', 'lens']],
  ['🩺', ['consultation', 'checkup', 'check-up', 'doctor', 'general physician', 'opd', 'follow up', 'follow-up', 'review']],
  ['🧪', ['blood test', 'test', 'lab', 'sugar test', 'thyroid', 'x-ray', 'xray', 'scan', 'ecg']],
  ['🦴', ['physio', 'physiotherapy', 'back pain', 'knee', 'joint', 'rehab', 'posture']],
  ['🌱', ['ayurveda', 'ayurvedic', 'panchakarma', 'homeopathy', 'homoeopathy', 'naturopathy']],
  ['💉', ['vaccination', 'vaccine', 'injection', 'dressing']],
  ['🐶', ['pet', 'dog', 'cat', 'grooming', 'vet', 'deworming']],
  ['🧘', ['yoga', 'meditation', 'pranayama']],
  ['🏋️', ['gym', 'workout', 'training', 'personal trainer', 'fitness', 'zumba', 'aerobics']],
  ['💃', ['dance', 'bharatanatyam', 'kathak', 'bollywood']],
  ['🎵', ['music', 'guitar', 'keyboard', 'piano', 'singing', 'vocal', 'tabla', 'violin', 'flute']],
  ['📚', ['tuition', 'coaching', 'class', 'lesson', 'maths', 'science', 'english', 'exam']],
  ['🚗', ['driving', 'car wash', 'car service', 'car', 'detailing']],
  ['🏍️', ['bike', 'two wheeler', 'scooter', 'motorcycle']],
  ['📸', ['photo', 'photoshoot', 'shoot', 'portrait', 'passport', 'video']],
  ['🧵', ['stitching', 'tailoring', 'alteration', 'blouse', 'fall pico', 'embroidery']],
  ['🔧', ['repair', 'service', 'installation', 'fix', 'ac', 'fridge', 'washing machine', 'ro', 'mobile repair', 'laptop repair']],
  ['🗣️', ['counselling', 'counseling', 'therapy', 'therapist', 'consult']],
  ['⚖️', ['legal', 'lawyer', 'notary', 'affidavit', 'agreement']],
  ['🧾', ['tax', 'gst', 'itr', 'accounting', 'audit', 'filing']],
];

// Store types (businessCategories.js and free text) → artwork for logos and as a hint for items.
const STORE_ART = [
  ['🛒', ['grocery', 'kirana', 'supermarket', 'general store', 'provision']],
  ['🥬', ['vegetable', 'fruit', 'sabzi']],
  ['🥛', ['dairy', 'milk']],
  ['🥖', ['bakery', 'bake']],
  ['🍬', ['sweet', 'mithai']],
  ['🍛', ['restaurant', 'tiffin', 'meals', 'dhaba', 'mess', 'food', 'home-made', 'homemade']],
  ['☕', ['cafe', 'snack', 'tea', 'juice', 'ice cream']],
  ['🍗', ['meat', 'fish', 'chicken']],
  ['🥜', ['dry fruit', 'spice', 'organic']],
  ['🌾', ['flour', 'mill']],
  ['💧', ['water']],
  ['💐', ['flower', 'florist']],
  ['🪔', ['pooja', 'puja']],
  ['💊', ['medical', 'pharmacy', 'chemist']],
  ['🔧', ['hardware', 'plumbing', 'sanitary', 'building']],
  ['💡', ['electrical', 'electricals']],
  ['🎨', ['paint']],
  ['📱', ['mobile', 'electronics', 'phone']],
  ['💻', ['computer', 'printing']],
  ['📒', ['stationery', 'book']],
  ['🎁', ['gift', 'toy']],
  ['👕', ['clothing', 'garment', 'kids wear', 'tailoring', 'boutique']],
  ['🥻', ['saree', 'ethnic']],
  ['👟', ['footwear', 'shoe']],
  ['👜', ['bag', 'luggage']],
  ['💍', ['jewellery', 'jewelry', 'bangle']],
  ['💄', ['cosmetic', 'beauty product']],
  ['⌚', ['watch', 'optical']],
  ['🪑', ['furniture', 'furnishing', 'decor']],
  ['🍳', ['kitchenware', 'utensil', 'plastic', 'household']],
  ['⚽', ['sports', 'fitness equipment']],
  ['🐾', ['pet']],
  ['🌱', ['seed', 'fertili', 'agri', 'cattle', 'nursery']],
  ['🛞', ['auto', 'tyre']],
  ['🚲', ['cycle']],
  ['🧺', ['laundry', 'dry clean']],
  ['🖼️', ['handicraft']],
  ['💇', ['hair', 'salon', 'barber']],
  ['💄', ['beauty parlour', 'parlour', 'parlor', 'makeup', 'bridal']],
  ['💆', ['spa', 'massage']],
  ['💅', ['nail']],
  ['🌿', ['mehendi', 'mehndi']],
  ['🖋️', ['tattoo']],
  ['🦷', ['dental', 'dentist']],
  ['👁️', ['eye']],
  ['🩺', ['clinic', 'doctor', 'skin']],
  ['🦴', ['physio']],
  ['🌱', ['ayurveda', 'homeopathy']],
  ['🧪', ['diagnostic', 'lab']],
  ['🐶', ['veterinary', 'grooming']],
  ['🧘', ['yoga']],
  ['🏋️', ['gym']],
  ['💃', ['dance']],
  ['🎵', ['music']],
  ['📚', ['tuition', 'coaching']],
  ['🚗', ['driving', 'car wash', 'car service']],
  ['📸', ['photo']],
  ['🔧', ['repair']],
  ['🏍️', ['bike service']],
  ['🗣️', ['counselling']],
  ['⚖️', ['lawyer', 'notary']],
  ['🧾', ['ca ', 'tax']],
];

export const DEFAULT_SHOP_ART = '🛒';
export const DEFAULT_APPOINTMENT_ART = '📅';

const words = (s) =>
  ` ${String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `;

/** First entry with a keyword that starts a word in `text` (multi-word keywords match as a phrase). */
function lookup(table, text) {
  const hay = words(text);
  if (hay.trim() === '') return null;
  for (const [emoji, keys] of table) if (keys.some((k) => hay.includes(` ${k}`))) return emoji;
  return null;
}

/**
 * Artwork emoji. kind: 'product' | 'service' (from the item name, then the store type `hint`), 'shop' |
 * 'appointments' (a store logo, from its store type `hint` or name).
 */
export function artFor(name, kind = 'product', hint = '') {
  const appt = kind === 'service' || kind === 'appointments';
  const fallback = appt ? DEFAULT_APPOINTMENT_ART : DEFAULT_SHOP_ART;
  if (kind === 'product') return lookup(PRODUCT_ART, name) || lookup(STORE_ART, hint) || fallback;
  if (kind === 'service') return lookup(SERVICE_ART, name) || lookup(STORE_ART, hint) || fallback;
  return lookup(STORE_ART, hint) || lookup(STORE_ART, name) || fallback;
}

/** Background colours: green for shops, violet for appointment businesses. */
export const artColors = (kind) => (kind === 'service' || kind === 'appointments' ? ['#f5f3ff', '#ddd6fe', '#6d28d9'] : ['#ecfdf5', '#d1fae5', '#047857']);
