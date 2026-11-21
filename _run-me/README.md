# \_run-me — SQL waiting on Ryan

**Everything in this folder still needs to be run. Nothing else does.**

1. Run the files here in filename order: Supabase dashboard → SQL Editor → paste → Run.
   They're written to be safe to re-run (`if not exists`).
2. Tell Claude it's done. Claude checks the result read-only, then moves the file to
   [`db/migrations/`](../db/migrations/) (its permanent home), and this folder goes back to empty.
