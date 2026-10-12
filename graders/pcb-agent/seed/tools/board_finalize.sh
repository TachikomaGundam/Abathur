#!/bin/bash
# r17 finalization pipeline: routed board -> pour -> native refill -> DRC gate -> fab exports
set -e
IN="${1:?routed kicad_pcb}"
OUT="${2:?output board pcb}"
RUN="${3:-evolution-round-17}"
cd /home/lab/workspace/pcb-control
python3 tools/board_zone_pour.py "$IN" "$OUT"
cp /tmp/sr-c4.kicad_pro "$(dirname "$OUT")/$(basename "$OUT" .kicad_pcb).kicad_pro"
D=/home/lab/workspace/pcb-control/reports/recovery/$RUN
kicad-cli pcb drc "$OUT" --refill-zones --save-board --format json --severity-error --output "$D/$(basename "$OUT").drc-refill.json" >/dev/null 2>&1
kicad-cli pcb drc "$OUT" --format json --severity-error --output "$D/$(basename "$OUT").drc-final.json" >/dev/null 2>&1
python3 - "$D/$(basename "$OUT").drc-final.json" <<'EOF'
import json, sys, collections
d = json.load(open(sys.argv[1]))
v = d.get('violations', []); u = d.get('unconnected_items', [])
print(f"GATE: errors={len(v)} {dict(collections.Counter(x.get('type','?') for x in v))} unconnected={len(u)}")
EOF
mkdir -p "$D/fab-out"
kicad-cli pcb export gerbers "$OUT" -o "$D/fab-out/gerbers.zip" >/dev/null
kicad-cli pcb export drill "$OUT" -o "$D/fab-out/" >/dev/null
kicad-cli pcb export pos "$OUT" -o "$D/fab-out/pos.pos" --units mm >/dev/null
echo "fab exports -> $D/fab-out/"; ls "$D/fab-out/" | head
