// Toy unit: explode — exits 1 at import time. run() sees status ok + exitCode 1;
// score() sees the grader die mid-import with exit 1 and must record the unit as
// inconclusive, never crash the bench (plan AC (d)).
process.exit(1);
