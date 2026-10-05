# Security

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/33rd-kk/poseorbit/security/advisories/new)**
(the Security tab, "Report a vulnerability"). Do not open a public issue.

Say what is affected, how to reproduce it, and what an attacker could do.
You will get an answer within a week; a fix and an advisory follow when the
report is confirmed, crediting you unless you would rather not be.

## Supported versions

Only the latest release gets fixes.

## What to keep in mind

- `python -m poseorbit serve` listens on 127.0.0.1 by default and has no
  authentication unless `POSEORBIT_TOKEN` is set. Set a token, and put a
  reverse proxy with its own limits in front, before exposing it to anyone
  else: it decodes whatever pictures it is sent.
- Model files are downloaded from Hugging Face on first use (see `NOTICE`
  for the repositories). Pass `weights_dir` to keep them somewhere you
  control.
- Dependencies are watched by Dependabot and audited weekly with pip-audit.
