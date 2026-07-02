#!/bin/zsh
# Manual control of the LG UltraFine 32U990A over DDC (Apple Silicon, m1ddc).
# Usage:
#   ./lg.sh tb|hdmi|dp|alt210     switch input (LG-alt VCP 0xF4 codes)
#   ./lg.sh bri <0-100|+n|-n>     set or change brightness
#   ./lg.sh status                luminance probe (26≈TB/DP, 90=HDMI, 30=transition)
#   ./lg.sh list                  list displays

LG=041B0EA8-173D-41AF-B60D-A63236F45C02

case "$1" in
  tb)     m1ddc display $LG set input-alt 208 ;;   # Thunderbolt (confirmed)
  hdmi)   m1ddc display $LG set input-alt 144 ;;   # HDMI (confirmed via luminance probe)
  dp)     m1ddc display $LG set input-alt 209 ;;   # DisplayPort (probable)
  alt210) m1ddc display $LG set input-alt 210 ;;   # unmapped candidate
  bri)
    case "$2" in
      +*|-*) m1ddc display $LG chg luminance $2 ;;
      *)     m1ddc display $LG set luminance $2 ;;
    esac ;;
  status) echo "luminance: $(m1ddc display $LG get luminance 2>&1)" ;;
  list)   m1ddc display list ;;
  *)      sed -n '2,7p' "$0"; exit 1 ;;
esac
