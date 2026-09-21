#!/usr/bin/env bash
# Adds COUNT random, linked notes to NOTESIUM_DIR, one every INTERVAL seconds.
# Each note links back to the previous one, and occasionally to an earlier
# random note, so the graph stays connected (no orphans besides note #1's
# usual lack of incoming link until a later note links back to it).
set -euo pipefail

NOTESIUM_BIN="${NOTESIUM_BIN:-$HOME/.local/bin/notesium}"
export NOTESIUM_DIR="${NOTESIUM_DIR:-$HOME/notes}"
COUNT="${1:-50}"
INTERVAL="${2:-0.5}"

ADJECTIVES=(Wandering Rusted Foggy Slow Cracked Midnight Copper Hollow Quiet Restless
            Bright Salted Frozen Tangled Distant Gentle Stormy Golden Silent Crooked)
NOUNS=(Lighthouse Kettle Timetable Ledger Hinge Radio Starter Harbor Gate Signal
       Compass Orchard Tunnel Foundry Meadow Lantern Anchor Glacier Market Ravine)
VERBS=(drifted rattled settled surfaced lingered folded crackled wandered steadied
       unraveled)
SUBJECTS=(the tide the engine the letter the crew the frost the market the signal
          the garden the ledger the storm)

rand() { local -n arr=$1; echo "${arr[$((RANDOM % ${#arr[@]}))]}"; }

title() { echo "$(rand ADJECTIVES) $(rand NOUNS)"; }

sentence() {
    echo "$(rand SUBJECTS | sed 's/^./\U&/') $(rand VERBS) for $((RANDOM % 12 + 1)) $(rand NOUNS | tr '[:upper:]' '[:lower:]')s before anyone noticed."
}

base_epoch=$(date +%s)
prev_file=""
prev_title=""
declare -a all_files
declare -a all_titles

for ((i = 0; i < COUNT; i++)); do
    ctime_epoch=$((base_epoch + i))
    ctime=$(date -u -d "@$ctime_epoch" +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -r "$ctime_epoch" -u +%Y-%m-%dT%H:%M:%S)
    filename=$("$NOTESIUM_BIN" new --verbose --ctime="$ctime" | awk -F: '/^filename/{print $2}')
    path="$NOTESIUM_DIR/$filename"

    t="$(title)"
    {
        echo "# $t"
        echo
        echo "$(sentence)"
        if [ -n "$prev_file" ]; then
            echo
            echo "Comes after [$prev_title]($prev_file)."
        fi
        if [ "${#all_files[@]}" -gt 3 ] && ((RANDOM % 2 == 0)); then
            idx=$((RANDOM % ${#all_files[@]}))
            echo
            echo "Also related to [${all_titles[$idx]}](${all_files[$idx]})."
        fi
    } > "$path"

    echo "[$((i + 1))/$COUNT] $filename  $t"

    all_files+=("$filename")
    all_titles+=("$t")
    prev_file="$filename"
    prev_title="$t"

    sleep "$INTERVAL"
done
