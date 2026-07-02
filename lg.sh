#!/bin/zsh
# Manual control of the LG UltraFine 32U990A over DDC (Apple Silicon, m1ddc).
# Usage:
#   ./lg.sh tb|hdmi|dp            switch input (LG-alt VCP 0xF4 codes)
#   ./lg.sh bri <0-100|+n|-n>     set or change brightness
#   ./lg.sh current               infer active input from luminance profile
#   ./lg.sh status                raw luminance probe (TB=26, DP=30, HDMI=90)
#   ./lg.sh regs                  dump input-related registers (0x60, 0xF4, 0x10)
#   ./lg.sh list                  list displays

# Auto-discover the LG UltraFine's UUID; fall back to the known one.
LG=$(m1ddc display list 2>/dev/null | awk -F'[()]' '/ULTRAFINE/ {print $2; exit}')
[[ -z "$LG" ]] && LG=041B0EA8-173D-41AF-B60D-A63236F45C02

case "$1" in
  tb)     m1ddc display $LG set input-alt 210 ;;   # Thunderbolt 5 (= USB-C slot in LG's table)
  hdmi)   m1ddc display $LG set input-alt 144 ;;   # HDMI 1
  dp)     m1ddc display $LG set input-alt 208 ;;   # DisplayPort 1
  bri)
    case "$2" in
      +*|-*) m1ddc display $LG chg luminance $2 ;;
      *)     m1ddc display $LG set luminance $2 ;;
    esac ;;
  status) echo "luminance: $(m1ddc display $LG get luminance 2>&1)" ;;
  regs)
    # Dump the input-related registers in one shot.
    echo "display:                  $LG"
    echo "VCP 0x60 (get input):     $(m1ddc display $LG get input 2>&1)   # always 15 — readback lies"
    echo "VCP 0xF4 (get input-alt): $(m1ddc display $LG get input-alt 2>&1)   # write-only — read is garbage"
    echo "VCP 0x10 (get luminance): $(m1ddc display $LG get luminance 2>&1)   # per-input profile: TB=26 DP=30 HDMI=90"
    ;;
  current)
    # No trustworthy input readback on this monitor (VCP 0x60 always says 15;
    # 0xF4 is write-only). Infer from the per-input brightness profile instead.
    # NOTE: values below must match your actual per-input brightness settings.
    v=$(m1ddc display $LG get luminance 2>/dev/null)
    case "$v" in
      26) echo "thunderbolt (luminance=$v)" ;;
      30) echo "displayport (luminance=$v)" ;;
      90) echo "hdmi (luminance=$v)" ;;
      "") echo "unknown — display not enumerated (TB link down?)" ;;
      *)  echo "unknown profile (luminance=$v) — update the map in lg.sh" ;;
    esac ;;
  list)   m1ddc display list ;;
  *)      sed -n '2,7p' "$0"; exit 1 ;;
esac
