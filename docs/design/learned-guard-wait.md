# Learning from a standing guard

Guard uses the ordinary Wait action with a destination card. After an
unanswered request, adaptive learning records that Wait as an attempt.
The saved trial keeps its known place target and matches the committed
log entry’s `guards` field. Plain Wait keeps its empty target.

Validation uses saved action shape and known places. A later road change
can keep earlier Guard trials, even after their source log is trimmed.
A fresh shared rules version carries this validation change to the server.
