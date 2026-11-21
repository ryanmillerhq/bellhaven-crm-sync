# Initial prompt

The first prompt I gave Claude Code (Opus 5.5) to start this exercise, reproduced word for word.
The exercise workspace page it refers to was provided alongside it as a local file (with my personal API token already removed).
Every later prompt is recorded verbatim in [prompts-log.md](prompts-log.md).

---

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
