"""UserPromptSubmit hook: append each user prompt verbatim to docs/prompts-log.md.

Redacts the CRM API token (read from .env) and anything that looks like a bearer token,
because the repo is public. Never blocks the prompt: any failure exits 0 silently.
"""
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
LOG = ROOT / "docs" / "prompts-log.md"


def secrets_from_env() -> list[str]:
    env = ROOT / ".env"
    found = []
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            key, _, value = line.partition("=")
            if key.strip() in {"CRM_API_TOKEN"} and value.strip().strip("'\""):
                found.append(value.strip().strip("'\""))
    return found


def main() -> None:
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8") or "{}")
    prompt = payload.get("prompt", "")
    if not prompt.strip():
        return
    for secret in secrets_from_env():
        prompt = prompt.replace(secret, "[REDACTED_CRM_TOKEN]")
    prompt = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{16,}", r"\1[REDACTED]", prompt)

    existing = LOG.read_text(encoding="utf-8") if LOG.exists() else "# Prompt log\n"
    n = len(re.findall(r"^## Prompt \d+", existing, flags=re.M)) + 1
    stamp = datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M UTC%z")
    fence = "````"
    while fence in prompt:
        fence += "`"
    entry = f"\n## Prompt {n} ({stamp})\n\n{fence}text\n{prompt}\n{fence}\n"
    with LOG.open("a", encoding="utf-8", newline="\n") as fh:
        fh.write(entry)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
