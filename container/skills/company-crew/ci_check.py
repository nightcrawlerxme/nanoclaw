# CI/PR Check Skill for NanoClaw
#
# Handles messages like:
#   "@Panda check the CI for waitinc/chasseflow"
#   "@Panda why did PR #42 fail?"
#   "@Panda what's the status of the deploy pipeline?"
#
# Routes: NanoClaw → CrewAI tech crew → OpenHands (GH CLI) → Agent-S (if GUI needed)

import re
import httpx
import os
from datetime import datetime
import uuid

# Dashboard runs on host at port 8080; container reaches host via host.docker.internal
DASHBOARD_URL = os.getenv("DASHBOARD_API_URL", "http://host.docker.internal:8080")


def match(message: str) -> bool:
    """Check if message is asking about CI/PR status."""
    patterns = [
        r"check\s+(the\s+)?ci",
        r"(ci|pipeline|workflow|action|build)\s+(status|failed|failing|broken|red)",
        r"(pr|pull\s+request)\s*#?\d+\s+(fail|status|check)",
        r"why\s+(did|is)\s+(pr|the\s+build|ci|pipeline)",
        r"what('s|\s+is)\s+(wrong|happening)\s+with\s+(the\s+)?(ci|build|pr|pipeline)",
        r"deploy(ment)?\s+(status|fail|broken)",
    ]
    text = message.lower()
    return any(re.search(p, text) for p in patterns)


async def run(message: str, context: dict) -> str:
    """Handle CI/PR check request."""

    repo_match = re.search(r'([a-zA-Z0-9_-]+/[a-zA-Z0-9_-]+)', message)
    repo = repo_match.group(1) if repo_match else context.get("default_repo", "W-A-I-T/chasseflow")

    pr_match = re.search(r'#(\d+)|pr\s*(\d+)|pull\s*request\s*(\d+)', message.lower())
    pr_number = None
    if pr_match:
        pr_number = int(next(g for g in pr_match.groups() if g))

    task_id = f"ci-{uuid.uuid4().hex[:8]}"

    if "why" in message.lower() or "fail" in message.lower():
        task_desc = f"Diagnose CI failure for {repo}" + (f" PR #{pr_number}" if pr_number else "")
    elif "deploy" in message.lower():
        task_desc = f"Check deployment status for {repo}"
    else:
        task_desc = f"Check CI status for {repo}" + (f" PR #{pr_number}" if pr_number else "")

    # Use existing /api/task endpoint (dept=tech, request=task_desc)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{DASHBOARD_URL}/api/task",
                json={
                    "dept": "tech",
                    "request": task_desc,
                }
            )

            if response.status_code == 200:
                result = response.json()
                if result.get("status") == "ok":
                    return f"CI check for `{repo}`:\n\n{result['result'][:2000]}"
                return f"Checking CI for `{repo}`... Task ID: `{task_id}`\n\nI'll message you when done."
            else:
                return f"Failed to start CI check: {response.text}"

    except httpx.TimeoutException:
        return f"CI check queued. Task ID: `{task_id}`\n\nI'll message you when results are ready."
    except Exception as e:
        return f"Error starting CI check: {str(e)}"


SKILL_META = {
    "name": "ci-check",
    "description": "Check CI/CD pipeline and PR status",
    "triggers": ["check ci", "ci status", "pr failed", "why did", "pipeline", "deploy status"],
    "priority": 80,
}
