// Seeding from a local OpenStreetMap extract (extract-osm): osmium filters a .pbf, readExtract turns it into the same
// rows fetch-osm makes (same osm:<type>/<id> refs), cityRows cuts one city's box. Needs osmium; skipped without it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { cityRows, filterExtract, readExtract } from '../src/seed/pbf.js';

const hasOsmium = spawnSync('osmium', ['--version']).status === 0;

// A kirana (node), a bakery drawn as a building (closed way), a chain, a salon (not seeded), a nameless shop,
// a neighbourhood name, and a shop outside the city box. Sorted like real extracts: nodes, then ways.
const OSM = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
  <node id="1" version="1" lat="26.9000" lon="75.8000"><tag k="shop" v="convenience"/><tag k="name" v="Sharma Kirana"/><tag k="phone" v="+91 98290 12345"/></node>
  <node id="2" version="1" lat="26.9010" lon="75.8010"/>
  <node id="3" version="1" lat="26.9010" lon="75.8020"/>
  <node id="4" version="1" lat="26.9020" lon="75.8020"/>
  <node id="5" version="1" lat="26.9020" lon="75.8010"/>
  <node id="6" version="1" lat="26.9030" lon="75.8030"><tag k="shop" v="supermarket"/><tag k="name" v="Reliance Fresh"/><tag k="brand:wikidata" v="Q7311015"/></node>
  <node id="7" version="1" lat="26.9040" lon="75.8040"><tag k="shop" v="hairdresser"/><tag k="name" v="Style Salon"/></node>
  <node id="8" version="1" lat="26.9050" lon="75.8050"><tag k="shop" v="convenience"/></node>
  <node id="9" version="1" lat="26.9005" lon="75.8005"><tag k="place" v="neighbourhood"/><tag k="name" v="Bani Park"/></node>
  <node id="11" version="1" lat="28.6000" lon="77.2000"><tag k="shop" v="bakery"/><tag k="name" v="Far Away Bakery"/></node>
  <way id="10" version="1"><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="5"/><nd ref="2"/><tag k="building" v="yes"/><tag k="shop" v="bakery"/><tag k="name" v="Rawat Mishthan Bhandar"/></way>
</osm>`;

describe('seeding from a local OSM extract', { skip: !hasOsmium && 'osmium not installed' }, () => {
  test('rows match fetch-osm: refs, centres of buildings, localities; chains, salons and nameless shops left out', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfl-pbf-'));
    try {
      const xml = path.join(dir, 'test.osm');
      const pbf = path.join(dir, 'test.osm.pbf');
      fs.writeFileSync(xml, OSM);
      assert.equal(spawnSync('osmium', ['cat', xml, '-o', pbf, '--overwrite']).status, 0);
      const data = await readExtract(filterExtract(pbf, () => {}));
      assert.deepEqual(data.places.map((p) => p.name), ['Bani Park']);

      const rows = cityRows(data, { bbox: [26.8, 75.7, 27.0, 75.9], city: 'Jaipur' });
      const byRef = Object.fromEntries(rows.map((r) => [r.source_ref, r]));
      assert.deepEqual(Object.keys(byRef).sort(), ['osm:node/1', 'osm:way/10']);
      assert.equal(byRef['osm:node/1'].category, 'grocery');
      assert.equal(byRef['osm:node/1'].locality, 'Bani Park');
      assert.equal(byRef['osm:node/1'].phone, '+91 98290 12345');
      assert.equal(byRef['osm:way/10'].name, 'Rawat Mishthan Bhandar');
      assert.equal(byRef['osm:way/10'].lat, '26.901500', 'centre of the building');
      assert.equal(byRef['osm:way/10'].lng, '75.801500');
      assert.match(byRef['osm:way/10'].address, /Jaipur/);

      const withChains = cityRows(data, { bbox: [26.8, 75.7, 27.0, 75.9], city: 'Jaipur', includeChains: true });
      assert.ok(withChains.some((r) => r.source_ref === 'osm:node/6'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
