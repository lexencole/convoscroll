# Conversation Markdown for browser import

Read this when converting a transcript into a ConvoScroll `.md` file. An existing `.convcanvas` project can be imported directly and does not need conversion.

## Minimal complete file

````md
<!-- conversation-markdown:v2 -->
<!-- document: {"title":"Example conversation","locale":"en"} -->

<!-- message: {"role":"user","displayName":"Alex"} -->
How can I sort these values?
<!-- /message -->

<!-- message: {"role":"assistant","displayName":"Assistant"} -->
Use `sorted` to return a new list:

```python
values = [3, 1, 2]
print(sorted(values))
```
<!-- /message -->
````

Replace the example metadata and content with the selected source. Omit metadata that is not known or needed.

## Structure and metadata

- Put `<!-- conversation-markdown:v2 -->` on the first nonempty line.
- Put each structural marker on its own line. Marker parameters are JSON objects: use double-quoted keys and strings, escape embedded quotes and backslashes, and omit trailing commas.
- Include at most one `document` marker, before any messages. Its only fields are optional strings: `title`, `subtitle`, and `locale`.
- Use `"locale":"en"` for English generated image labels or `"locale":"zh-CN"` for Simplified Chinese. Regional variants such as `en-GB` also work. Omitted or unsupported values use Chinese labels without changing the original value. This does not translate body text, titles, or names and is independent of the interface language.
- Wrap each message in `<!-- message: {...} -->` and `<!-- /message -->`. Do not put body text outside a message or force roles to alternate.
- Each message requires `role`: `user`, `assistant`, `system`, `developer`, `tool`, or `unknown`. Use only the roles within the requested scope. For `unknown`, also provide a nonempty `sourceRole` describing the source label or unresolved identity.
- Optional message fields are `sourceRole`, `displayName`, `model`, `status`, and `timestamp`. `status` is `complete`, `streaming`, `error`, or `cancelled`. `timestamp` is an ISO 8601 string with a time zone. Other fields are strings. Do not invent identities, versions, timestamps, or statuses.
- Do not add custom fields or IDs. The importer generates stable IDs. Unknown fields, invalid JSON, invalid roles, or missing closing markers reject the import.

## Body content

Keep Markdown inside the appropriate message. Preserve code fences and language tags, LaTeX math delimiters, table structure, and links. Raw HTML is not rendered as HTML. Blank lines at the edges of body blocks are trimmed during import.

Structural markers inside fenced code blocks are treated as literal content. If the source contains a marker-like line outside a code block, protect that literal passage with a code fence so it cannot change the conversation structure; disclose the formatting change. Choose a fence longer than any fence inside the passage.

## Images and files

The browser importer cannot read files beside a Markdown file. Do not generate `image` or `file` markers with `src` for this workflow: the browser rejects them. Add attachments with the editor after importing the text.

Use a visible placeholder in the correct message, such as `[Image: quarterly results chart]` or `[Attachment: notes.pdf]`, until the actual file is added. Do not use Markdown image syntax or remote image URLs to bypass attachment handling. If those occur in the source, retain the filename, caption, and URL as appropriate text or links and report any image that cannot be restored. Ordinary citation links can remain links.

## Optional process records

Use these only for visible source records within the user's requested scope. Place them inside the corresponding message. An empty reasoning block may retain a visible timing label without inventing reasoning text.

```md
<!-- reasoning: {"title":"Visible reasoning","durationMs":12000} -->
Reasoning text present in the supplied source, if requested.
<!-- /reasoning -->
<!-- tool-call: {"toolName":"search","callId":"search-1","summary":"Search for the supplied topic","status":"success"} -->
<!-- tool-result: {"callId":"search-1","summary":"Three results returned","status":"success"} -->
```

Replace the example title, duration, names, status, and summaries with supported source values, or omit optional fields except as noted below. If a tool result's status is unknown, set `"status":"neutral"`: omitting it defaults to `success` and would imply completion without evidence. Reasoning and tool calls already default to `neutral`. For multiple calls, use a distinct `callId` for each call and reuse that ID only for its associated results.

| Marker | Form | Allowed fields |
| --- | --- | --- |
| `reasoning` | Body followed by `<!-- /reasoning -->`; no nested structural markers | `title`, `summary`, `status`, `durationMs`, `displayState`, `exportState` |
| `tool-call` | One line | Required `toolName`; optional `callId`, `summary`, `input`, `status`, `durationMs`, `displayState`, `exportState` |
| `tool-result` | One line | `callId`, `summary`, `output`, `status`, `durationMs`, `displayState`, `exportState` |

`input` and `output` accept JSON values; include full parameters or results only when requested. `durationMs` is a nonnegative number. Trace `status` is `neutral`, `pending`, `running`, `success`, or `error`; these differ from message statuses. Text fields are strings.

`displayState` accepts `collapsed` or `expanded` and defaults to `collapsed`. `exportState` accepts `current`, `collapsed`, or `expanded` and defaults to `current`. Omit these fields for the normal collapsed presentation. The export dialog's folding option can override these settings, so check the final PNG when a particular presentation is requested.

Without `callId`, a tool call gets a generated ID and a tool result refers to the most recent call in the document. Prefer explicit IDs when several calls are present. Do not create results without matching calls or fabricate missing calls to satisfy validation; retain an unpaired visible result as labeled body text if needed.

## Import check

Save as UTF-8 with an `.md` extension. Check the browser's import preview against the intended title, message count, and content. Fix reported errors in the file and retry before replacing the current project. Plain Markdown without the version header imports as one assistant message, so it does not preserve a multi-message conversation's structure.
