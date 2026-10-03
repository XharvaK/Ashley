#!/usr/bin/env bash
# Run only the fixed courier implementation; activation and private credentials belong to the Owner.
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec /usr/bin/python3 "$script_dir/self_courier.py"
