# Accepted card saves

The authoring session accepts a prepared source edit and its output files in
one local store transaction. Its baseline names the draft key, generation,
source manifest and launch. A changed baseline asks for a fresh review.

`snapshot({assets:true})` supplies copied bytes to the output preparer.
`accept(prepared)` keeps the current source visible until the write succeeds.
During that write the editor holds source edits. A failed write keeps the
prepared output ready for another Save. A successful write adds one Undo step.
Earlier files stay available when Undo restores an earlier portrait.

Ordinary field saves keep their current behavior, including newer edits made
while an earlier save finishes. Seed text and image instructions belong to the
transient generation client; acceptance receives approved output files.
