---
name: company-crew
description: Dispatch tasks to the WAIT-Tech AI company crew (CrewAI) or Agent-S3 for GUI/desktop control. Routes to Tech, Marketing, Sales, HR, Government, or Grants departments. Use when the user asks to build software, find tenders, write content, research leads, hire, take a desktop screenshot, control the GUI, open an app, click something, or anything business-related.
---

# WAIT-Tech Company Crew

Dispatch business tasks to the WAIT-Tech multi-agent crew running on the host. The crew has departments for every function of the company.

## Departments

| Dept | Use for |
|------|---------|
| `tech` | Build software, fix bugs, write code, APIs, databases |
| `government` | Find Canada Buys tenders, RFPs, government contracts |
| `grants` | SR&ED, IRAP, CDAP, funding programs |
| `sales` | Prospect research, outreach, quotes, leads |
| `marketing` | Content, SEO, social media, campaigns |
| `hr` | Hiring, contractor search, salary research |
| `pipeline` | Full end-to-end: find tender → build it automatically |
| `auto` | Let the crew auto-detect the right department |

## How to dispatch

Call the crew API with a POST request:

```bash
curl -s -X POST http://host.docker.internal:8080/api/task \
  -H "Content-Type: application/json" \
  -d "{\"dept\": \"auto\", \"request\": \"YOUR TASK HERE\"}" \
  --max-time 1800
```

The response is JSON with a `result` field containing the full crew output.

### Parse the result

```bash
RESPONSE=$(curl -s -X POST http://host.docker.internal:8080/api/task \
  -H "Content-Type: application/json" \
  -d "{\"dept\": \"auto\", \"request\": \"YOUR TASK HERE\"}" \
  --max-time 1800)
echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['result'])"
```

## Examples

**Build something:**
```bash
curl -s -X POST http://host.docker.internal:8080/api/task \
  -H "Content-Type: application/json" \
  -d '{"dept": "tech", "request": "Add a REST endpoint to the EventBox API for QR code check-in"}' \
  --max-time 1800
```

**Find tenders:**
```bash
curl -s -X POST http://host.docker.internal:8080/api/task \
  -H "Content-Type: application/json" \
  -d '{"dept": "government", "request": "software event management"}' \
  --max-time 1800
```

**Auto-route:**
```bash
curl -s -X POST http://host.docker.internal:8080/api/task \
  -H "Content-Type: application/json" \
  -d '{"dept": "auto", "request": "Research competitors for ChasséFlow and write a comparison"}' \
  --max-time 1800
```

## Agent-S3 GUI tasks

For tasks that require controlling the desktop (clicking, browsing, screenshots), call Agent-S3 directly:

```bash
curl -s -X POST http://host.docker.internal:8080/api/agent-s \
  -H "Content-Type: application/json" \
  -d '{"task": "Open Firefox and go to google.com"}' \
  --max-time 1800
```

Use this when the user asks to: click something, open an app, take a screenshot, fill a form, browse a website visually, or control the desktop in any way. For everything else (code, research, business tasks), use `/api/task` instead.

## Service health check

Before dispatching, verify the dashboard is reachable:

```bash
curl -s --max-time 3 http://host.docker.internal:8080/api/status
```

If this fails, the agent-dashboard service is down. Inform the user.

## Reports

Completed crew tasks save markdown reports. List them:

```bash
curl -s http://host.docker.internal:8080/api/reports
```

## Notes

- Tasks can take up to 30 min — use `--max-time 1800` (30 min timeout)
- If the response `status` is `running_background`, the task is still executing. Tell the user the result will arrive via WhatsApp automatically. Do NOT retry or block.
- Poll a running task: `curl -s http://host.docker.internal:8080/api/task/result/{task_id}`
- Results are saved to `~/company-crew/reports/tasks/` on the host
- The `pipeline` dept runs a full end-to-end workflow (slowest, most powerful)
- Always use `auto` dept when the user hasn't specified one — the crew will route it correctly
