// Blocks the flow for 45 seconds of app idle time.
// F13 needs a wait longer than the emulator's 30s screen timeout; Maestro has no
// sleep command, so the orchestration thread busy-waits here while the app keeps
// running (and must keep the display on by itself).
const startedAt = Date.now();
while (Date.now() - startedAt < 45000) {
  // busy wait
}
output.idleMs = Date.now() - startedAt;
