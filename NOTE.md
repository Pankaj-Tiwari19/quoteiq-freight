# One-page note — what I decided, and what I left out

## The thesis
Extraction is the visible problem; models read messy documents well now. The hard problem is what to do with a number that is not comparable: a freight-only quote next to an all-in one, a "40'" against a 40HC lane, a "per w/m" LCL rate, a USD rate with no agreed FX, a smudged digit, "the Jebel Ali 20s" that could be either of two lanes. The system's job is to refuse to compare those silently, say exactly why, and give the buyer one place to decide — with the decision and its reason recorded beside the model's reading, never over it.

## Five decisions
**1. The model reads; the code calculates.** The extractor records what the supplier wrote — rate, currency, unit wording, inclusions, footnotes as conditions — with evidence and a confidence label. Unit variants, density, FX, the programme rebate and every total are deterministic and leave a trace on each cell. A wrong number is always a wrong *reading*, checkable against the source in seconds.

**2. Non-comparable is a state, not a blank.** Freight-only and partial quotes are converted for information but have no comparable value; they never enter a ranking or a total. The buyer can accept a supplier's basis as comparable, once, with a reason — and that assumption then appears on every lane, in the export and in the award memo.

**3. Discounts are read at programme level.** "4% above 200 TEU" is a statement about the whole award, not a lane. The extractor captures it as a condition (validated: page-2 footnote, 0 silent applications); code applies it only when the committed programme clears the threshold, on FCL lanes only, and records it as an assumption. Any other discount wording stays in the risk register.

**4. Questionnaire pass/fail is decided by rules, not by the model.** Answers are read from the supplier's own response; ISO 9001 and insurance ≥ USD 1M are evaluated in code. An INR cover note against a USD rule is "partial" — the buyer decides, with a reason.

**5. The analyst never does arithmetic.** It can only call the same functions the award page uses (cheapest per lane, split vs single, FX ±5%, review items) and explain what they return. "Which cells are you least sure about?" is answered from the review list — exactly the amber cells on the grid.

## What I left out, and why
Real email channel and supplier portal; live FX (a frozen rate is what an evaluation should use); OCR fallback; a code-execution tool for the analyst; streaming; per-lane award overrides. Vendor A, C and E documents are generated fixtures with an answer key so extraction quality is measurable, not asserted.

## Where the interesting problem was
Not extraction. It was that a buyer with ₹4 crore on the line needs to see three things on every cell at once — what the supplier said, what we made of it, and what we assumed to get there — and to be stopped, visibly, wherever one of those is missing.
