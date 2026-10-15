// Five demo stores for `npm run demo:create` (src/cli/demo-stores.js). Orders go to the platform's WhatsApp.
// Product art is generated SVG: [emoji, alternate emoji, palette]. Grocery reuses the original demo catalog.
import { config } from './config.js';
import { demoProducts, demoStore } from './seed-data.js';

// Compact product rows: [name, category, mrp, list price, [emoji, altEmoji], description, specs, tags?, rating?, reviews?, inStock?]
const rows = (prefix, palette, list) =>
  list.map(([name, category, mrp, offer, [emoji, alt], description, specs, tags = '', rating = null, reviews = 0, inStock = true], i) => ({
    sku_id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
    name,
    category,
    mrp,
    offer_price: offer,
    images: { emoji, alt, palette: palette[category] || Object.values(palette)[0] },
    description,
    specs_json: JSON.stringify(specs),
    tags,
    rating,
    review_count: reviews,
    in_stock: inStock ? 'TRUE' : 'FALSE',
  }));

const green = ['#f0fdf4', '#22c55e', '#bbf7d0'];
const leafy = ['#ecfccb', '#65a30d', '#d9f99d'];
const red = ['#fff1f2', '#ef4444', '#fecaca'];
const orange = ['#fff7ed', '#f97316', '#fed7aa'];
const pink = ['#fdf2f8', '#ec4899', '#fbcfe8'];
const rose = ['#fff1f2', '#e11d48', '#fecdd3'];
const yellow = ['#fefce8', '#eab308', '#fef08a'];
const blue = ['#eff6ff', '#3b82f6', '#bfdbfe'];
const slate = ['#f8fafc', '#64748b', '#e2e8f0'];
const amber = ['#fffbeb', '#d97706', '#fde68a'];
const brown = ['#fdf8f6', '#a16207', '#fde4cf'];

export const DEMO_STORES = [
  {
    username: 'demo',
    emoji: '🛒',
    store: { ...demoStore, slug: 'demo', verified: false, whatsapp_number: config.demoWhatsApp },
    products: demoProducts,
  },
  {
    username: 'demo-vegetables',
    emoji: '🥬',
    store: {
      slug: 'demo-vegetables',
      name: 'Hari Bhari Sabzi Mandi',
      category: 'Vegetables & Fruits',
      city: 'Bengaluru',
      address_text: 'Stall 12, KR Market Road, Jayanagar 4th Block, Bengaluru 560011',
      description: 'Farm-fresh vegetables and fruits picked up from the mandi every morning. Washed, weighed fairly and delivered the same day.',
      opening_hours: '06:00-21:00',
      minimum_order: 99,
      delivery_fee: 15,
      theme_color: '#16a34a',
    },
    products: rows('VEG', { Vegetables: green, 'Leafy Greens': leafy, Fruits: red, Herbs: leafy }, [
      ['Tomato (Nati) 1kg', 'Vegetables', 40, 32, ['🍅', '🥗'], 'Juicy country tomatoes, perfect for rasam, curries and chutneys.', { Weight: '1 kg', Origin: 'Kolar' }, 'Bestseller', 4.5, 320],
      ['Onion 1kg', 'Vegetables', 45, 38, ['🧅', '🍳'], 'Medium-sized red onions with a strong flavour.', { Weight: '1 kg', Origin: 'Nashik' }, 'Bestseller', 4.4, 410],
      ['Potato 1kg', 'Vegetables', 40, 34, ['🥔', '🍟'], 'Clean, firm potatoes for sabzi, fries and parathas.', { Weight: '1 kg' }, '', 4.3, 280],
      ['Carrot (Ooty) 500g', 'Vegetables', 35, 30, ['🥕', '🥗'], 'Sweet, crunchy Ooty carrots.', { Weight: '500 g', Origin: 'Ooty' }, '', 4.6, 150],
      ['Green Capsicum 500g', 'Vegetables', 40, 35, ['🫑', '🍕'], 'Fresh shiny capsicum for stir-fries and pizzas.', { Weight: '500 g' }],
      ['Cauliflower (1 pc)', 'Vegetables', 45, 39, ['🥦', '🍲'], 'Tight white florets, about 600–800 g per piece.', { Weight: '600–800 g' }],
      ['Palak (Spinach) Bunch', 'Leafy Greens', 25, 20, ['🥬', '🥗'], 'Tender spinach leaves, cleaned and bundled.', { Quantity: '1 bunch (~250 g)' }, 'Fresh today', 4.5, 90],
      ['Coriander Bunch', 'Herbs', 15, 10, ['🌿', '🍛'], 'Fragrant fresh coriander with roots.', { Quantity: '1 bunch' }],
      ['Green Chilli 100g', 'Vegetables', 12, 10, ['🌶️', '🔥'], 'Spicy green chillies.', { Weight: '100 g' }],
      ['Banana (Yelakki) 1 dozen', 'Fruits', 80, 70, ['🍌', '🍌'], 'Small, sweet Yelakki bananas.', { Quantity: '12 pcs' }, 'Bestseller', 4.7, 260],
      ['Apple (Shimla) 1kg', 'Fruits', 220, 189, ['🍎', '🍏'], 'Crisp Shimla apples.', { Weight: '1 kg', Origin: 'Himachal Pradesh' }, '', 4.4, 120],
      ['Watermelon (1 pc)', 'Fruits', 90, 75, ['🍉', '🍉'], 'Sweet red watermelon, about 2.5–3 kg.', { Weight: '2.5–3 kg' }, '', null, 0, false],
    ]),
  },
  {
    username: 'demo-flowers',
    emoji: '💐',
    store: {
      slug: 'demo-flowers',
      name: 'Malligai Flower Stall',
      category: 'Flowers',
      city: 'Bengaluru',
      address_text: 'Near Ganesha Temple, 8th Cross, Malleshwaram, Bengaluru 560003',
      description: 'Fresh jasmine, roses and marigold for pooja, weddings and gifting. Garlands made to order every morning.',
      opening_hours: '05:30-20:30',
      closed_days: '',
      minimum_order: 50,
      delivery_fee: 20,
      theme_color: '#db2777',
    },
    products: rows('FLW', { 'Pooja Flowers': amber, Garlands: yellow, Bouquets: pink, Loose: rose }, [
      ['Mallige (Jasmine) String 1 metre', 'Pooja Flowers', 60, 50, ['🌼', '🙏'], 'Freshly strung Mysore mallige, very fragrant.', { Length: '1 metre' }, 'Bestseller', 4.8, 540],
      ['Marigold Loose 500g', 'Loose', 80, 60, ['🌼', '🟠'], 'Bright orange marigold for pooja and decoration.', { Weight: '500 g' }, '', 4.5, 210],
      ['Red Rose Loose (20 pcs)', 'Loose', 120, 100, ['🌹', '❤️'], 'Fresh red roses, long-lasting.', { Quantity: '20 stems' }, '', 4.6, 180],
      ['Lotus (5 pcs)', 'Pooja Flowers', 100, 90, ['🪷', '🙏'], 'Pink lotus buds for Lakshmi pooja.', { Quantity: '5 pcs' }],
      ['Tulsi Mala', 'Garlands', 80, 70, ['🌿', '📿'], 'Handmade tulsi garland for daily pooja.', { Length: '2 feet' }],
      ['Marigold Garland (2 ft)', 'Garlands', 70, 60, ['🌼', '🎊'], 'Thick marigold garland, ideal for doors and photos.', { Length: '2 feet' }, 'Festival special'],
      ['Wedding Jasmine-Rose Garland (pair)', 'Garlands', 1500, 1299, ['💮', '💍'], 'Grand jasmine and rose varmala pair. Order one day in advance.', { Quantity: '1 pair', Length: '5 feet each', Notice: 'Order 24 hours ahead' }, 'Made to order', 4.9, 45],
      ['Red Rose Bouquet (12 stems)', 'Bouquets', 550, 449, ['💐', '🎁'], 'Classic dozen red roses wrapped with greens.', { Quantity: '12 stems' }, 'Bestseller', 4.7, 130],
      ['Mixed Flower Bouquet', 'Bouquets', 700, 599, ['💐', '🌸'], 'Gerberas, carnations and roses in seasonal colours.', { Size: 'Medium' }],
      ['Sunflower Bunch (5 stems)', 'Bouquets', 400, 349, ['🌻', '☀️'], 'Cheerful sunflowers.', { Quantity: '5 stems' }],
      ['Kanakambara String 1 metre', 'Pooja Flowers', 50, 40, ['🌸', '🟠'], 'Orange kanakambara (firecracker flower) string.', { Length: '1 metre' }],
      ['Banana Leaf (10 pcs)', 'Pooja Flowers', 60, 50, ['🍃', '🍛'], 'Fresh banana leaves for festivals and meals.', { Quantity: '10 pcs' }],
    ]),
  },
  {
    username: 'demo-electricals',
    emoji: '💡',
    store: {
      slug: 'demo-electricals',
      name: 'Sri Ganesh Electricals',
      category: 'Electricals',
      city: 'Bengaluru',
      address_text: '23, SP Road, Near Minerva Circle, Chickpet, Bengaluru 560002',
      description: 'LED bulbs, fans, switches, wires and extension boards from trusted brands. Free home delivery above ₹999 and electrician on call.',
      opening_hours: '09:30-20:30',
      closed_days: 'Sun',
      minimum_order: 199,
      delivery_fee: 40,
      theme_color: '#2563eb',
    },
    products: rows('ELC', { Lighting: yellow, Fans: blue, 'Switches & Sockets': slate, 'Wires & Cables': orange, Accessories: slate }, [
      ['Philips 9W LED Bulb (B22)', 'Lighting', 140, 99, ['💡', '✨'], 'Cool daylight LED bulb, saves up to 85% energy.', { Power: '9 W', Base: 'B22', Colour: 'Cool day light', Warranty: '1 year' }, 'Bestseller', 4.6, 890],
      ['Syska 20W LED Tube Light 4 ft', 'Lighting', 450, 349, ['💡', '📏'], 'Slim batten tube light with even light.', { Power: '20 W', Length: '4 ft', Warranty: '2 years' }, '', 4.4, 210],
      ['Wipro Garnet 15W LED Panel', 'Lighting', 899, 699, ['💡', '⬜'], 'Round recessed ceiling panel light.', { Power: '15 W', Shape: 'Round', Warranty: '2 years' }],
      ['Crompton 1200mm Ceiling Fan', 'Fans', 2650, 2199, ['🌀', '💨'], 'High-speed 3-blade ceiling fan, energy efficient.', { Sweep: '1200 mm', Speed: '380 RPM', Warranty: '2 years' }, 'Bestseller', 4.5, 340],
      ['Usha 400mm Table Fan', 'Fans', 2400, 1899, ['🌀', '🌬️'], 'Oscillating table fan with 3 speeds.', { Sweep: '400 mm', Warranty: '2 years' }],
      ['Havells Exhaust Fan 150mm', 'Fans', 1350, 1099, ['🌀', '🏠'], 'Kitchen and bathroom ventilation fan.', { Size: '150 mm', Warranty: '2 years' }],
      ['Anchor Roma 6A Switch (pack of 10)', 'Switches & Sockets', 450, 380, ['🔘', '⚡'], 'Modular 1-way switches, white.', { Rating: '6 A', Quantity: '10 pcs' }],
      ['Anchor Roma 6A 3-pin Socket', 'Switches & Sockets', 160, 135, ['🔌', '⚡'], 'Modular 3-pin socket with shutter.', { Rating: '6 A' }],
      ['Finolex 1.5 sq mm Wire (90 m)', 'Wires & Cables', 2400, 1950, ['🧵', '⚡'], 'FR PVC insulated copper house wire, red.', { Size: '1.5 sq mm', Length: '90 m', Colour: 'Red' }, '', 4.7, 95],
      ['Polycab Extension Board 4+1', 'Accessories', 699, 549, ['🔌', '🧰'], '4 sockets with master switch and 1.5 m cord.', { Sockets: '4', Cord: '1.5 m' }, 'Bestseller', 4.3, 260],
      ['Duracell AA Batteries (pack of 4)', 'Accessories', 220, 199, ['🔋', '🔋'], 'Long-lasting alkaline batteries.', { Quantity: '4 pcs', Type: 'AA' }],
      ['Eveready Rechargeable LED Torch', 'Accessories', 450, 379, ['🔦', '🌙'], 'Bright LED torch with 4-hour backup.', { Backup: '4 hours', Charging: 'USB' }, '', null, 0, false],
    ]),
  },
  {
    username: 'demo-bakery',
    emoji: '🎂',
    store: {
      slug: 'demo-bakery',
      name: 'Iyengar Fresh Bakery',
      category: 'Bakery',
      city: 'Bengaluru',
      address_text: '45, 11th Main Road, Basavanagudi, Bengaluru 560004',
      description: 'Classic Iyengar bakery: fresh bread, honey cake, puffs and custom birthday cakes baked every morning since 1985.',
      opening_hours: '07:00-22:00',
      minimum_order: 100,
      delivery_fee: 25,
      theme_color: '#b45309',
    },
    products: rows('BAK', { Breads: brown, Cakes: pink, Snacks: amber, Cookies: brown }, [
      ['Milk Bread 400g', 'Breads', 45, 40, ['🍞', '🥛'], 'Soft, fresh milk bread baked this morning.', { Weight: '400 g', 'Best before': '3 days' }, 'Fresh today', 4.6, 430],
      ['Brown Bread 400g', 'Breads', 55, 50, ['🍞', '🌾'], 'Whole wheat brown bread.', { Weight: '400 g' }],
      ['Pav (pack of 6)', 'Breads', 30, 25, ['🥖', '🍔'], 'Soft ladi pav for pav bhaji and vada pav.', { Quantity: '6 pcs' }],
      ['Honey Cake (per piece)', 'Cakes', 30, 25, ['🍰', '🍯'], 'Iyengar-style honey cake with jam and coconut.', { Quantity: '1 piece' }, 'Bestseller', 4.8, 610],
      ['Black Forest Cake 500g', 'Cakes', 550, 480, ['🎂', '🍒'], 'Chocolate sponge, whipped cream and cherries. Order 3 hours ahead for a name on it.', { Weight: '500 g', Eggless: 'Available on request' }, 'Bestseller', 4.7, 220],
      ['Pineapple Cake 500g', 'Cakes', 500, 430, ['🎂', '🍍'], 'Light sponge with pineapple cream.', { Weight: '500 g' }],
      ['Plum Cake 400g', 'Cakes', 320, 280, ['🍰', '🎄'], 'Rich fruit and nut plum cake.', { Weight: '400 g' }, 'Seasonal'],
      ['Veg Puff', 'Snacks', 25, 22, ['🥟', '🔥'], 'Flaky puff with spicy potato-peas filling.', { Quantity: '1 pc' }, 'Bestseller', 4.5, 380],
      ['Egg Puff', 'Snacks', 30, 27, ['🥚', '🥟'], 'Flaky puff with masala egg.', { Quantity: '1 pc' }],
      ['Dilpasand', 'Snacks', 40, 35, ['🥧', '🥥'], 'Sweet coconut-tutti frutti stuffed pastry.', { Quantity: '1 pc' }],
      ['Butter Biscuits 250g', 'Cookies', 90, 80, ['🍪', '🧈'], 'Melt-in-the-mouth butter biscuits.', { Weight: '250 g' }, '', 4.6, 150],
      ['Coconut Cookies 250g', 'Cookies', 85, 75, ['🍪', '🥥'], 'Crunchy coconut cookies.', { Weight: '250 g' }],
    ]),
  },
];
