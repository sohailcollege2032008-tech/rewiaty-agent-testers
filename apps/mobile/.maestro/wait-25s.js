// Blocks the flow for 25 seconds of app idle time.
// F13 needs a wait longer than the emulator's 15s screen timeout; Maestro has no
// sleep command, so the orchestration thread busy-waits here while the app keeps
// running (and must keep the display on by itself).
const startedAt = Date.now();
while (Date.now() - startedAt < 25000) {
  // busy wait
}
output.idleMs = Date.now() - startedAt;
