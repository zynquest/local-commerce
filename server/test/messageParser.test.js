// Unit tests for the WhatsApp-message catalog parser (no database).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseCatalogMessage, parsePrice } from '../src/catalog/messageParser.js';

const parse = (text) => parseCatalogMessage(text).items;
const ok = (items) => items.filter((i) => !i.error).map((i) => [i.name, i.mrp, i.list_price]);
const errors = (items) => items.filter((i) => i.error).map((i) => i.error);

describe('message parser: the two documented formats', () => {
  test('format 1: three lines per product (blank lines ignored)', () => {
    const items = parse('Green Apple 4 pc\n200\n100\nTomatoes\n30\n28\n');
    assert.deepEqual(ok(items), [['Green Apple 4 pc', 200, 100], ['Tomatoes', 30, 28]]);
    assert.deepEqual(items.map((i) => i.lines), [[1, 3], [4, 6]]);
  });

  test('format 2: Name,MRP,List price separated by |', () => {
    assert.deepEqual(ok(parse('Milk,25,21|Wheat Flour,71,69 ')), [['Milk', 25, 21], ['Wheat Flour', 71, 69]]);
  });

  test('both formats in one message, plus one-per-line entries and tabs (Excel copy)', () => {
    const items = parse('Green Apple 4 pc\n200\n100\nMilk,25,21|Bread, 40, 35\nCurd,30,28\nGhee\t650\t599');
    assert.deepEqual(ok(items), [['Green Apple 4 pc', 200, 100], ['Milk', 25, 21], ['Bread', 40, 35], ['Curd', 30, 28], ['Ghee', 650, 599]]);
  });
});

describe('message parser: WhatsApp copy-paste noise', () => {
  test('timestamps/sender, *bold*, bullets, ₹ / Rs / MRP labels, /- and 1,250 grouping', () => {
    const items = parse('[15/10/26, 9:41 PM] Ramesh: *Basmati Rice 5kg*\nMRP: ₹ 1,250\nRs. 1,100/-\n15/10/26, 9:42 pm - Ramesh: • Sugar 1kg\n₹50\n45\n1. Eggs (12)\n84\n78');
    assert.deepEqual(ok(items), [['Basmati Rice 5kg', 1250, 1100], ['Sugar 1kg', 50, 45], ['Eggs (12)', 84, 78]]);
  });

  test('prices', () => {
    assert.equal(parsePrice('₹ 1,25,000'), 125000);
    assert.equal(parsePrice('71.50'), 71.5);
    assert.equal(parsePrice('SP - 99/-'), 99);
    assert.equal(parsePrice('4 pc'), null);
    assert.equal(parsePrice('abc'), null);
  });
});

describe('message parser: a broken product never affects the others', () => {
  test('each error is reported on its own product, with its lines', () => {
    const msg = [
      'Onion', '40', // 1-2: list price missing
      'Bread,40|Butter,abc,50|Ghee,1,250,1,200|,30,20', // 3
      'Sugar 1kg 50 45', // 4
      'Paneer', '90', '120', // 5-7: list > MRP
      '55', // 8: price without name
      'Curd', // 9: no prices
      'Milk,25,21', 'Milk,24,20', // 10, 11: duplicate
      'Tomatoes', '30', '28', // 12-14: fine
    ].join('\n');
    const items = parse(msg);
    assert.deepEqual(errors(items), [
      'missing_list_price', 'missing_field', 'mrp_not_number', 'ambiguous_commas', 'missing_name',
      'one_line_spaces', 'list_over_mrp', 'price_without_name', 'missing_prices', 'duplicate',
    ]);
    assert.deepEqual(ok(items), [['Milk', 25, 21], ['Tomatoes', 30, 28]]);
    const dup = items.find((i) => i.error === 'duplicate');
    assert.deepEqual(dup.params, { n: items.find((i) => i.name === 'Milk').index });
    assert.deepEqual(items.find((i) => i.error === 'list_over_mrp').lines, [5, 7]);
    assert.equal(items.find((i) => i.error === 'mrp_not_number').source, 'Butter,abc,50');
  });

  test('a missing price line does not shift the following products', () => {
    const items = parse('Apple\n120\nBanana\n60\n50\nCherry\n300\n250');
    assert.deepEqual(errors(items), ['missing_list_price']);
    assert.deepEqual(ok(items), [['Banana', 60, 50], ['Cherry', 300, 250]]);
  });

  test('empty input → no items', () => {
    assert.equal(parse('\n  \n').length, 0);
  });
});
