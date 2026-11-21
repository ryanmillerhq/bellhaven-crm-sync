# Prompt log

Every prompt I (Ryan) gave Claude Code during this exercise, word for word, in order.
New prompts are appended automatically by a `UserPromptSubmit` hook ([.claude/hooks/log_prompt.py](../.claude/hooks/log_prompt.py)); messages I sent mid-turn (while Claude was already working) are appended by Claude and marked as such. Secrets (the CRM token) are redacted automatically.

## Prompt 1 (2026-11-21, session start)

````text
please help me complete this exercise for my Clipboard application for the job of "Sales Operations Analyst"

Here is the html of the exercise workspace page, which includes all instructions, links to context, and submission fields.

Please plan out this project thoroughly before starting.

I have already read the instructions thoroughly, so you should as well, because there are a few complexities and intricacies that you should keep in quick memory.

Go ahead and establish a public github repo in my portfolio for this project.

Also, can you please spin up a subagent that I can use to do the writeup, including sketching what next to build. For the local app, let's make the UI nice, you can lean on my UI from my other app ("C:\Users\ryanm\My Drive\Code\zenith-web-app"), including the lordicons. Let's also host the app to vercel for good measure after we get it working locally.

We won't do a humanlike scraper, because their site doesn't seem to have bot detection, although we should note that capability if we need to scrape other sources in the future that don't appreciate being scraped.

When you get to the point of developing the matching logic, please do an outline of what you're thinking, and I will correct your overall structure and logic before you can anything deeper.

Please also write this initial prompt into an md doc in /docs, and another doc to record all of my prompts word for word ongoing for the Clipboard team to review if they'd like.

I removed the personal API token from the original html (MY_TOKEN), please create an env file for me to put it in.
````

## Prompt 2 (2026-11-21, sent mid-turn)

````text
For the scaper, let's just use selenium, have it navigate to the website, and then we'll map a flexible xpath for it to scrape the data from each communities page, with pagination (via url or via pagination buttons, whichever seems easier/more robust)
````

## Prompt 3 (2026-11-21 15:07 UTC-0400)

````text
Let's make an effort to make the review app intuitive and simple, with extra visuals for review progress.

Ideally, it will present one case at a time, with all the context needed to make a decision, with simple buttons and input boxes to update the necessary fields, and all the logic that the instructions describe surrounding how to handle duplicates and change of ownership simplified into one-click confirmation after the reasoning/context has been reviewed by the human.
````

## Prompt 4 (2026-11-21 15:11 UTC-0400)

````text
For "what you'd build next", I'm thinking we whip up some kind of mcp (we can demo it locally) so that I can connect claude directly into the review app and use it to pull data and perform ops.

Let's make all of the interactions on the review app have light, pleasing animations/reactions to interactions, such as hovers, page changes, etc. Don't go overboard, only where it would be tasteful, just so that review app feels more modern and less static.
````

## Prompt 5 (2026-11-21 15:22 UTC-0400)

````text
I added the api key to .env, created the free supabase, i'm going to use the session pooler instead of the transaction pooler, adding that into the .env now
````

## Prompt 6 (2026-11-21 15:22 UTC-0400)

````text
go ahead and try "DATABASE_URL" in .env to access the database
````

## Prompt 7 (2026-11-21 15:23 UTC-0400)

````text
make sure and do very nice, segmented commits throughout this project so that our versioning and progress is very well documented in the repo
````

## Prompt 8 (2026-11-21 15:26 UTC-0400)

````text
vercel project deployed, let me kknow when you want me to add env vars:
https://bellhaven-crm-sync.vercel.app/

It's connected to the git repo
````

## Prompt 9 (2026-11-21 15:27 UTC-0400)

````text
any migrations you want me to run in supabase, put them in a _run-me folder in the project root
````

## Prompt 10 (2026-11-21 15:30 UTC-0400)

````text
other stuff I would build next is an enrichment pathway, scraping linkedin and something like rocketreach to get contact info, separate table for contacts to be associated with these accounts, some sort of pipeline tracking system with a simple visuals page, as well as some prominent dashboard visualization pages that show these accounts as dots on a map of the US, color coded, with the ability to zoom and pull up info, even filter to just the ones that need attention and resolve their case via the map visual in a hover card.

We could even gamify the review process
````

## Prompt 11 (2026-11-21 15:32 UTC-0400)

````text
ran that migration.
````

## Prompt 12 (2026-11-21 15:33 UTC-0400)

````text
you can move the project instructions page to docs
````
