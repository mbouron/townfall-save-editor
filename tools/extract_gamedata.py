"""Build docs/data/*.json from the game's design XMLs.

Extract them first with repak:
  repak unpack -o <out> -i 'Townfall/Content/Townfall/Design/**' <Townfall>/Townfall/Content/Paks/pakchunk0-Windows.pak
Usage: python3 tools/extract_gamedata.py <out>/Townfall/Content/Townfall/Design
"""
import json, sys, pathlib, xml.etree.ElementTree as ET

design = pathlib.Path(sys.argv[1])
out = pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'data'

items = {}
for it in ET.parse(design / 'ItemDatabase.xml').getroot().iter('inventory_item'):
    items[it.findtext('itemID')] = {
        'name': it.findtext('name'),
        'type': it.findtext('type'),
        'equippable': it.findtext('equippable') == 'True',
        'icon': (it.findtext('icon') or '').rsplit('/', 1)[-1],
    }

missions = {}
for f in sorted((design / 'Missions').glob('*.xml')):
    r = ET.parse(f).getroot()
    mid = r.findtext('MissionID')
    objectives = {}
    for o in r.iter('Objective'):
        oid = o.findtext('ReferenceID')
        if oid:
            objectives[oid] = o.findtext('ObjectiveName') or ''
    missions[mid] = {
        'name': r.findtext('MissionName'),
        'description': r.findtext('MissionDescription'),
        'type': r.findtext('MissionType'),
        'order': int(r.findtext('FlowOrderIndex') or 0),
        'file': f.stem,
        'objectives': objectives,
    }

(out / 'items.json').write_text(json.dumps(items, indent=1, ensure_ascii=False))
(out / 'missions.json').write_text(json.dumps(missions, indent=1, ensure_ascii=False))
print(len(items), 'items,', len(missions), 'missions')
