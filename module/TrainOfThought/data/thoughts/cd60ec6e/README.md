# Deferred questions

A question that got deferred is still a decision that has not been made. It is captured here, at the moment
it is deferred, with the date and the reason - not reconstructed from a chat log later.

## The trigger
The operator says: "Train of Thought - I am ready for outstanding questions". Then every `next[]` line that
starts with `ask:` is put to them, one at a time, and each answer lands as a `decision` trail line.

## The ritual for every session
If a question is asked and the operator moves on without answering, append one line:
`ask: <the question> (deferred <YYYY-MM-DD>: <why it was not the moment>)`

A question already answered elsewhere is removed by closing it with its decision, not by deleting the line.
