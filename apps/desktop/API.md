# Polyzon Maker local API

Other programs on the same computer can start generations and take the results. The API is off
until you turn it on in Settings, and works while Polyzon Maker is open.

It listens on `127.0.0.1` only, so nothing on the network can reach it. Every request needs the key
from Settings:

```
Authorization: Bearer YOUR_KEY
```

| Request | What it does |
| --- | --- |
| `GET /v1/status` | Version, whether Polyzon Maker is busy, how many jobs wait |
| `GET /v1/models` | Installed models with their `kind` (`3d`, `picture`) and presets |
| `POST /v1/jobs` | Starts a job, see below |
| `GET /v1/jobs` | All jobs, newest first |
| `GET /v1/jobs/{id}` | One job: `state`, `stage`, `error`, `seconds`, `output` |
| `GET /v1/jobs/{id}/files/{name}` | A file of the job, usually `output` (`model.glb` or `picture.png`) |
| `POST /v1/jobs/{id}/cancel` | Stops a job |
| `DELETE /v1/jobs/{id}` | Deletes a finished job and its files |
| `POST /v1/jobs/{id}/open` | Shows the job in Polyzon Maker's window |
| `POST /v1/jobs/{id}/prepare?height=80` | Has the window check the model and write `print.stl` and `print.3mf` |
| `POST /v1/jobs/{id}/slicer` | Opens the prepared model in the slicer chosen in Settings |
| `GET /v1/catalog` | Every model Polyzon Maker can install, with `installed`; a model a plugin brings also has `plugin`, its plugin's id (PLUGINS.md) |
| `POST /v1/models/{id}/install` | Starts installing a model in the window |

## Starting a job

A picture to a 3D model: send the PNG, JPEG or WebP as the raw body, up to 64 MB.

```
curl -H "Authorization: Bearer YOUR_KEY" --data-binary @cat.png \
  "http://127.0.0.1:7878/v1/jobs?model=trellis2&preset=512&title=Cat"
```

Words to a picture: pass `prompt` to a model of kind `picture`.

```
curl -X POST -H "Authorization: Bearer YOUR_KEY" \
  "http://127.0.0.1:7878/v1/jobs?model=zimage&prompt=a%20red%20boat"
```

`model` is required. `preset`, `seed`, `title` and `thread` are optional; `thread` adds the job to an
earlier generation, so that it shows as one row in Polyzon Maker. The answer is `201` with the job.
Ask for it until `state` is one of `succeeded`, `failed`, `cancelled`, then take the file:

```
curl -H "Authorization: Bearer YOUR_KEY" -o cat.glb \
  "http://127.0.0.1:7878/v1/jobs/JOB_ID/files/model.glb"
```

Jobs show up in Polyzon Maker's window as well, and print files are made there, so Polyzon Maker has to stay open.

## Tools

The parametric tools work through the window, and the person sees them work. A call answers with the live
form of the open tool: `fields` (`name`, `kind`, `value`, limits, `options`, `hint`), `buttons`, and
`building`, `ready`, `error` and `size_mm` for the model. A field that depends on a choice appears only after
that choice.

| Call | What it does |
| --- | --- |
| `GET /v1/tools?query=` | The tools, all of them or those that match |
| `POST /v1/tools/open` | `{"slug": "..."}` opens one |
| `POST /v1/tools/set` | `{"values": {"Field": 40}}` fills fields and waits for the build; a file field takes `{"job": "<id>"}` |
| `POST /v1/tools/press` | `{"label": "..."}` presses a button of the form |
| `POST /v1/tools/status` | The form again, after an answer with `"building": true` |
| `POST /v1/tools/view` | `{"png": "<base64>"}`, a picture of the model |
| `POST /v1/tools/finish` | `{"job": "<id>"}`: the model is now in the library |

What the window refuses comes back as 409 with `{"error": "..."}` in words: which field, and what it takes.

## OpenSCAD

The OpenSCAD page, driven the same way. Each call answers with `title`, `building`, `ready`, `size_mm`, `error`, `warnings`, `seconds` and `params`. The code is not sent back: the caller wrote it.

| Call | What it does |
| --- | --- |
| `POST /v1/scad/open` | `{"code": "...", "title": "..."}`, `{"template": "<id>"}` or `{"program": "<id>"}`; also lists `templates` and `programs` |
| `POST /v1/scad/set` | `{"code": "..."}` and or `{"params": {"name": value}}`, rebuilds |
| `POST /v1/scad/status` | The same answer, after `"building": true` |
| `POST /v1/scad/view` | `{"views": ["iso", "top"], "section": {"axis": "x", "at": 10}}` gives `{"png": "<base64>"}`, one picture with a scale |
| `POST /v1/scad/finish` | `{"job": "<id>"}`: the model is in the library and `model.scad` is beside it |

## CAD

The CAD page, driven the same way. A program is JavaScript in the language of `src/cad/GUIDE.md`. An answer is `{"text": "..."}`: a few lines with the size, one line a part, parameters, warnings, or the error with its line, because a model reads it after every build.

| Call | What it does |
| --- | --- |
| `POST /v1/cad/open` | `{"code": "...", "title": "..."}`, `{"example": "<id>"}` or `{"program": "<id>"}`; also lists examples and kept programs |
| `POST /v1/cad/set` | `{"edits": [{"find": "...", "put": "..."}]}`, `{"code": "..."}` or `{"params": {"name": value}}`, rebuilds. Each `find` must be in the program exactly once |
| `POST /v1/cad/status` | The same answer, after one that says building |
| `POST /v1/cad/view` | `{"views": ["iso", "top"], "section": {"axis": "x", "at": 10}, "part": "wheels", "cell": 256}` gives `{"png": "<base64>"}`, one picture; `cell` is the width of a view in pixels |
| `POST /v1/cad/finish` | `{"job": "<id>"}`: the model is in the library, in its colours, and `model.cad.js` is beside it |

## MCP

`polyzon-maker --mcp` speaks the Model Context Protocol over stdin and stdout, for Claude, Codex, Cursor
and other assistants. Settings shows the command for each. It needs the API turned on, takes the key
from Polyzon Maker's settings, and starts Polyzon Maker when it is closed.

## Errors

Errors come as `{"error": "code"}`.

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `prompt_required`, `model_needs_a_picture`, `preset` | The request does not fit the model |
| 401 | `key` | The key is missing or wrong |
| 403 | `host` | The request did not come to `127.0.0.1` or `localhost` |
| 404 | `job`, `file`, `route` | No such job, file or address |
| 409 | `model_not_installed`, `running` | Install the model first, or stop the job first |
| 413, 415 | `too_large`, `not_a_picture` | The body is over 64 MB, or not a PNG, JPEG or WebP |
