#!/usr/bin/env bash
# Adds COUNT random, linked notes to NOTESIUM_DIR, one every INTERVAL seconds.
# Each note links back to the previous one, plus a random number of extra
# links drawn from both notes already on disk before this run and notes
# created earlier in this run - so pre-existing notes can pick up incoming
# links and turn into hubs too, not just the newly created chain.
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
all_files=()
all_titles=()

# Seed the link pool with notes already on disk, so this run's random extra
# links can point at pre-existing notes too, not just ones it creates itself.
while IFS=: read -r existing_file _ existing_title; do
    [ -n "$existing_file" ] || continue
    existing_title="${existing_title# }"
    all_files+=("$existing_file")
    all_titles+=("$existing_title")
done < <("$NOTESIUM_BIN" list --prefix=label)
existing_count="${#all_files[@]}"
echo "seeded link pool with $existing_count existing notes"

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

        if [ "${#all_files[@]}" -gt 0 ]; then
            extra_links=$((RANDOM % 3 + 1))
            declare -A chosen=()
            for ((j = 0; j < extra_links && j < ${#all_files[@]}; j++)); do
                idx=$((RANDOM % ${#all_files[@]}))
                [ -n "${chosen[$idx]:-}" ] && continue
                [ "${all_files[$idx]}" = "$filename" ] && continue
                chosen[$idx]=1
                echo
                echo "Also related to [${all_titles[$idx]}](${all_files[$idx]})."
            done
            unset chosen
        fi
    } > "$path"

    echo "[$((i + 1))/$COUNT] $filename  $t"

    all_files+=("$filename")
    all_titles+=("$t")
    prev_file="$filename"
    prev_title="$t"

    sleep "$INTERVAL"
done
