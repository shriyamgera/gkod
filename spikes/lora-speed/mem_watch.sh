#!/bin/sh
# Log swap use and memory pressure every 10 s while a job runs:  ./mem_watch.sh logs/mem.log &
while true; do
  echo "$(date +%H:%M:%S) $(sysctl -n vm.swapusage | sed 's/(encrypted)//') | $(memory_pressure | tail -1)" >> "$1"
  sleep 10
done
