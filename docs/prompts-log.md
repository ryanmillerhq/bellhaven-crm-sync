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
