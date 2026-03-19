# Human Response Handler for NanoClaw
#
# Handles replies to escalation messages:
#   "done"    - Mark task as manually completed
#   "skip"    - Cancel the task
#   "approve" - Continue with suggested action
#   Other     - Pass as instructions to agents

import re
import httpx
import os
from typing import Optional

# Dashboard on host at port 8080
DASHBOARD_URL = os.getenv("DASHBOARD_API_URL", "http://host.docker.internal:8080")


def match(message: str, context: dict = None) -> bool:
    context = context or {}
    if context.get("escalation_pending") or context.get("reply_to_task_id"):
        return True
    if re.search(r'\b(task|id)[:\s]+[a-z]+-[a-f0-9]+\b', message.lower()):
        return True
    response_patterns = [
        r'^(done|skip|cancel|approve|approved)\.?$',
        r'^(yes|no|ok|okay)\.?$',
        r'^(continue|proceed|go ahead)',
        r'^(fix it|try again|retry)',
    ]
    text = message.strip().lower()
    return any(re.match(p, text) for p in response_patterns)


async def run(message: str, context: dict = None) -> str:
    context = context or {}
    task_id = context.get("reply_to_task_id") or _extract_task_id(message)

    if not task_id:
        return (
            "I'm not sure which task you're responding to.\n\n"
            "Please reply directly to the escalation message, "
            "or include the task ID like: `task: ci-abc123 done`"
        )

    text = message.strip().lower()

    if text in ("done", "completed", "finished", "handled"):
        return await _mark_done(task_id)
    elif text in ("skip", "cancel", "abort", "nevermind", "nvm"):
        return await _cancel_task(task_id)
    elif text in ("approve", "approved", "yes", "ok", "okay", "proceed", "continue", "go ahead"):
        return await _approve(task_id)
    elif text in ("retry", "try again", "again"):
        return await _retry(task_id)
    else:
        return await _send_instructions(task_id, message)


def _extract_task_id(message: str) -> Optional[str]:
    for p in [r'task[:\s]+([a-z]+-[a-f0-9]+)', r'id[:\s]+([a-z]+-[a-f0-9]+)', r'`([a-z]+-[a-f0-9]+)`']:
        m = re.search(p, message.lower())
        if m:
            return m.group(1)
    return None


async def _mark_done(task_id: str) -> str:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{DASHBOARD_URL}/api/task/{task_id}/result",
                json={"success": True, "data": {"status": "manually_completed"}, "agent": "human"}
            )
            return f"✅ Task `{task_id}` marked as completed." if r.status_code == 200 else f"⚠️ Could not update task: {r.text}"
    except Exception as e:
        return f"Error marking task done: {e}"


async def _cancel_task(task_id: str) -> str:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{DASHBOARD_URL}/api/task/{task_id}/error",
                json={"error": "Cancelled by user", "agent": "human"}
            )
            return f"🚫 Task `{task_id}` cancelled." if r.status_code == 200 else f"⚠️ Could not cancel: {r.text}"
    except Exception as e:
        return f"Error cancelling: {e}"


async def _approve(task_id: str) -> str:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{DASHBOARD_URL}/api/task/{task_id}/resume",
                json={"action": "approved", "by": "human"}
            )
            return f"✅ Approved. Resuming task `{task_id}`..." if r.status_code == 200 else f"⚠️ Could not resume: {r.text}"
    except Exception as e:
        return f"Error approving: {e}"


async def _retry(task_id: str) -> str:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(f"{DASHBOARD_URL}/api/task/{task_id}/retry")
            return f"🔄 Retrying task `{task_id}`..." if r.status_code == 200 else f"⚠️ Could not retry: {r.text}"
    except Exception as e:
        return f"Error retrying: {e}"


async def _send_instructions(task_id: str, instructions: str) -> str:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{DASHBOARD_URL}/api/task/{task_id}/resume",
                json={"action": "instructions", "instructions": instructions, "by": "human"}
            )
            return f"📨 Instructions sent. Resuming `{task_id}`..." if r.status_code == 200 else f"⚠️ Could not send: {r.text}"
    except Exception as e:
        return f"Error sending instructions: {e}"


SKILL_META = {
    "name": "human-response",
    "description": "Handle human responses to agent escalations",
    "triggers": ["done", "skip", "cancel", "approve", "retry"],
    "priority": 100,
    "requires_context": True,
}
